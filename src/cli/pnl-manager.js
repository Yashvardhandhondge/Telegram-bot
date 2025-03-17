#!/usr/bin/env node

const { program } = require('commander');
const logger = require('../utils/logger');
const { createClient } = require('redis');
const config = require('../config');
const telegramService = require('../services/telegramService');
const pnlService = require('../services/pnlService');
const path = require('path');
const fs = require('fs');

// Redis client for managing signal data
let redisClient = null;

/**
 * Initialize Redis connection
 */
async function initRedis() {
  if (!redisClient) {
    // Use configuration from .env via config
    const redisConfig = {
      url: `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}`
    };
    
    logger.info(`Connecting to Redis at ${config.redis.host}:${config.redis.port}`);
    
    redisClient = createClient(redisConfig);
    
    redisClient.on('error', (err) => {
      logger.error(`Redis error: ${err.message}`, { error: err });
    });
    
    redisClient.on('connect', () => {
      logger.info('Connected to Redis successfully');
    });
    
    await redisClient.connect();
    logger.info('Connected to Redis for PNL management');
  }
  
  return redisClient;
}

/**
 * List all active signals
 */
async function listActiveSignals() {
  try {
    const redis = await initRedis();
    
    const activeSignalIds = await redis.sMembers('active_signals');
    
    if (activeSignalIds.length === 0) {
      logger.info('No active signals found');
      return [];
    }
    
    logger.info(`Found ${activeSignalIds.length} active signals`);
    
    const signals = [];
    for (const signalId of activeSignalIds) {
      const signalJson = await redis.get(signalId);
      if (!signalJson) continue;
      
      const signal = JSON.parse(signalJson);
      signals.push(signal);
      
      // Log basic signal info
      logger.info(`- ${signal.pair} ${signal.direction} at ${signal.entryPrice}`);
      logger.info(`  Signal ID: ${signalId}`);
      logger.info(`  Targets: ${signal.targets.map(t => t.price).join(', ')}`);
      logger.info(`  Status: ${signal.status}`);
      
      // Show hit targets
      const hitTargets = signal.targets.filter(t => t.hit);
      if (hitTargets.length > 0) {
        logger.info(`  Hit targets: ${hitTargets.map(t => `${t.number} (${t.price})`).join(', ')}`);
      }
    }
    
    return signals;
  } catch (error) {
    logger.error(`Error listing active signals: ${error.message}`, { error });
    return [];
  }
}

/**
 * List all completed signals
 */
async function listCompletedSignals() {
  try {
    const redis = await initRedis();
    
    const completedSignalIds = await redis.sMembers('completed_signals');
    
    if (completedSignalIds.length === 0) {
      logger.info('No completed signals found');
      return [];
    }
    
    logger.info(`Found ${completedSignalIds.length} completed signals`);
    
    const signals = [];
    for (const signalId of completedSignalIds) {
      const signalJson = await redis.get(signalId);
      if (!signalJson) continue;
      
      const signal = JSON.parse(signalJson);
      signals.push(signal);
      
      // Log basic signal info
      const status = signal.status || (signal.stopped ? 'STOPPED' : 'COMPLETED');
      logger.info(`- ${signal.pair} ${signal.direction} ${status}`);
      logger.info(`  Signal ID: ${signalId}`);
      logger.info(`  Entry: ${signal.entryPrice}`);
      
      // Calculate profit if available
      if (signal.targets && signal.targets.length > 0) {
        const hitTargets = signal.targets.filter(t => t.hit);
        if (hitTargets.length > 0) {
          const totalProfit = hitTargets.reduce((sum, t) => sum + parseFloat(t.profitPercent), 0);
          const avgProfit = (totalProfit / hitTargets.length).toFixed(2);
          logger.info(`  Profit: ${avgProfit}%`);
        }
      }
    }
    
    return signals;
  } catch (error) {
    logger.error(`Error listing completed signals: ${error.message}`, { error });
    return [];
  }
}

/**
 * Generate a summary for a specific period
 */
async function generateSummary(period) {
  try {
    await pnlService.initialize();
    
    logger.info(`Generating ${period} summary`);
    await pnlService.generatePnlSummary(period);
    
    logger.info(`${period.charAt(0).toUpperCase() + period.slice(1)} summary generated and sent`);
  } catch (error) {
    logger.error(`Error generating summary: ${error.message}`, { error });
  }
}

/**
 * Manually mark a signal as completed (all targets hit)
 */
async function completeSignal(signalId) {
  try {
    const redis = await initRedis();
    
    // Get signal
    const signalJson = await redis.get(signalId);
    
    if (!signalJson) {
      logger.error(`Signal not found: ${signalId}`);
      return false;
    }
    
    const signal = JSON.parse(signalJson);
    
    // Mark all targets as hit
    for (const target of signal.targets) {
      if (!target.hit) {
        target.hit = true;
        target.timestamp = new Date().toISOString();
      }
    }
    
    // Update status
    signal.completed = true;
    signal.completedAt = new Date().toISOString();
    signal.status = 'COMPLETED';
    
    // Save updated signal
    await redis.set(signalId, JSON.stringify(signal));
    
    // Move from active to completed
    await redis.sRem('active_signals', signalId);
    await redis.sAdd('completed_signals', signalId);
    
    // Post completion update
    try {
      // Initialize PNL service for sending updates
      await pnlService.initialize();
      
      // Create completion message
      const emoji = signal.direction === 'BUY' ? '🚀' : '💰';
      const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
      
      // Calculate average profit
      const totalProfit = signal.targets.reduce((sum, target) => sum + parseFloat(target.profitPercent), 0);
      const avgProfit = (totalProfit / signal.targets.length).toFixed(2);
      
      const message = `${emoji} MANUALLY COMPLETED! ${signal.pair} ${direction}
        
Entry: ${signal.entryPrice}
Targets: ${signal.targets.map(t => t.price).join(', ')} ✅
Average Profit: +${avgProfit}% 💰
        
Signal status: COMPLETED (Manual) ✨`;
      
      // Send to the PNL results channel from the signal or fall back to config
      const destinationChannel = signal.destinationChannel || config.pnl?.resultChannel;
      
      if (destinationChannel) {
        await telegramService.sendMessage(destinationChannel, message);
        logger.info(`Sent completion message to ${destinationChannel}`);
      } else {
        logger.warn('No destination channel for PNL update');
      }
    } catch (messageError) {
      logger.error(`Error sending completion message: ${messageError.message}`);
    }
    
    logger.info(`Signal ${signalId} marked as completed`);
    return true;
  } catch (error) {
    logger.error(`Error completing signal: ${error.message}`, { error });
    return false;
  }
}

/**
 * Manually mark a signal as stopped (stop loss hit)
 */
async function stopSignal(signalId) {
  try {
    const redis = await initRedis();
    
    // Get signal
    const signalJson = await redis.get(signalId);
    
    if (!signalJson) {
      logger.error(`Signal not found: ${signalId}`);
      return false;
    }
    
    const signal = JSON.parse(signalJson);
    
    // Update status
    signal.stopped = true;
    signal.stoppedAt = new Date().toISOString();
    signal.status = 'STOPPED';
    
    // Save updated signal
    await redis.set(signalId, JSON.stringify(signal));
    
    // Move from active to completed
    await redis.sRem('active_signals', signalId);
    await redis.sAdd('completed_signals', signalId);
    
    // Post stop loss update
    try {
      // Initialize PNL service for sending updates
      await pnlService.initialize();
      
      const emoji = '🛑';
      const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
      
      const hitTargets = signal.targets.filter(t => t.hit);
      const missedTargets = signal.targets.filter(t => !t.hit);
      
      let message = `${emoji} MANUALLY STOPPED! ${signal.pair} ${direction}
        
Entry: ${signal.entryPrice}
${signal.stopLoss ? 'Stop Loss: ' + signal.stopLoss + ' ❌' : 'Manually marked as stopped'}
        
Signal status: STOPPED (Manual)`;

      if (hitTargets.length > 0) {
        message += `\n\nTargets hit: ${hitTargets.map(t => t.number).join(', ')}`;
      }
      
      if (missedTargets.length > 0) {
        message += `\nTargets missed: ${missedTargets.map(t => t.number).join(', ')}`;
      }
      
      // Send to the PNL results channel from the signal or fall back to config
      const destinationChannel = signal.destinationChannel || config.pnl?.resultChannel;
      
      if (destinationChannel) {
        await telegramService.sendMessage(destinationChannel, message);
        logger.info(`Sent stop message to ${destinationChannel}`);
      } else {
        logger.warn('No destination channel for PNL update');
      }
    } catch (messageError) {
      logger.error(`Error sending stop message: ${messageError.message}`);
    }
    
    logger.info(`Signal ${signalId} marked as stopped`);
    return true;
  } catch (error) {
    logger.error(`Error stopping signal: ${error.message}`, { error });
    return false;
  }
}

/**
 * Delete a signal
 */
async function deleteSignal(signalId) {
  try {
    const redis = await initRedis();
    
    // Check if signal exists
    const exists = await redis.exists(signalId);
    
    if (!exists) {
      logger.error(`Signal not found: ${signalId}`);
      return false;
    }
    
    // Get signal to extract pair
    const signalJson = await redis.get(signalId);
    let pair = null;
    
    if (signalJson) {
      const signal = JSON.parse(signalJson);
      pair = signal.pair;
    }
    
    // Remove signal from Redis
    await redis.del(signalId);
    
    // Remove from active and completed sets
    await redis.sRem('active_signals', signalId);
    await redis.sRem('completed_signals', signalId);
    
    // Remove from pair index if available
    if (pair) {
      await redis.sRem(`signals:${pair}`, signalId);
    }
    
    logger.info(`Signal ${signalId} deleted`);
    return true;
  } catch (error) {
    logger.error(`Error deleting signal: ${error.message}`, { error });
    return false;
  }
}

/**
 * Manually force an update of all signals
 */
async function forceUpdate() {
  try {
    await pnlService.initialize();
    
    logger.info('Forcing update of all signals');
    await pnlService.updateSignals();
    
    logger.info('Signal update completed');
  } catch (error) {
    logger.error(`Error updating signals: ${error.message}`, { error });
  }
}

/**
 * Load the PNL mapping configuration 
 */
function loadPnlMapping() {
  try {
    const mappingPath = path.join(__dirname, '../config/pnl-mapping.json');
    
    if (!fs.existsSync(mappingPath)) {
      // Create default mapping if doesn't exist
      const defaultMapping = {
        signalSources: {
          "-1002404846297/5": "-1002404846297/178"
        }
      };
      
      // Ensure directory exists
      const dir = path.dirname(mappingPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Write default mapping
      fs.writeFileSync(mappingPath, JSON.stringify(defaultMapping, null, 2));
      logger.info(`Created default PNL mapping at ${mappingPath}`);
      
      return defaultMapping;
    }
    
    const mappingData = fs.readFileSync(mappingPath, 'utf8');
    const mapping = JSON.parse(mappingData);
    logger.info(`Loaded PNL mapping: ${JSON.stringify(mapping)}`);
    return mapping;
  } catch (error) {
    logger.error(`Error loading PNL mapping: ${error.message}`);
    return { signalSources: {} };
  }
}

/**
 * Update PNL mapping configuration
 */
async function updateMapping(sourceChannel, destinationChannel) {
  try {
    // Load existing mapping
    const mapping = loadPnlMapping();
    
    // Update mapping
    mapping.signalSources[sourceChannel] = destinationChannel;
    
    // Save updated mapping
    const mappingPath = path.join(__dirname, '../config/pnl-mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
    
    logger.info(`Updated PNL mapping: ${sourceChannel} -> ${destinationChannel}`);
    return true;
  } catch (error) {
    logger.error(`Error updating PNL mapping: ${error.message}`);
    return false;
  }
}

// Register commands
program
  .name('pnl')
  .description('PNL History Bot Manager');

program
  .command('list-active')
  .description('List all active signals')
  .action(async () => {
    await listActiveSignals();
    process.exit(0);
  });

program
  .command('list-completed')
  .description('List all completed signals')
  .action(async () => {
    await listCompletedSignals();
    process.exit(0);
  });

program
  .command('summary')
  .description('Generate a summary report')
  .option('-p, --period <period>', 'Summary period (daily, weekly, monthly)', 'daily')
  .action(async (options) => {
    await generateSummary(options.period);
    process.exit(0);
  });

program
  .command('complete')
  .description('Mark a signal as completed (all targets hit)')
  .argument('<signalId>', 'ID of the signal to complete')
  .action(async (signalId) => {
    await completeSignal(signalId);
    process.exit(0);
  });

program
  .command('stop')
  .description('Mark a signal as stopped (stop loss hit)')
  .argument('<signalId>', 'ID of the signal to stop')
  .action(async (signalId) => {
    await stopSignal(signalId);
    process.exit(0);
  });

program
  .command('delete')
  .description('Delete a signal')
  .argument('<signalId>', 'ID of the signal to delete')
  .action(async (signalId) => {
    await deleteSignal(signalId);
    process.exit(0);
  });

program
  .command('update')
  .description('Force update of all signals')
  .action(async () => {
    await forceUpdate();
    process.exit(0);
  });

  program
  .command('backfill')
  .description('Backfill signals from a channel')
  .option('-c, --channel <channelId>', 'Channel ID to backfill signals from')
  .option('-l, --limit <limit>', 'Number of messages to check', (val) => parseInt(val), 100)
  .action(async (options) => {
    try {
      // If no channel provided, use the first one from mapping
      let channelId = options.channel;
      if (!channelId) {
        const mapping = loadPnlMapping();
        const sources = Object.keys(mapping.signalSources);
        if (sources.length > 0) {
          channelId = sources[0];
          logger.info(`No channel specified, using first mapped channel: ${channelId}`);
        } else {
          logger.error('No channel specified and no mapping found');
          process.exit(1);
        }
      }
      
      await pnlService.initialize();
      const count = await pnlService.backfillSignals(channelId, options.limit);
      logger.info(`Backfill complete: Found ${count} signals`);
      process.exit(0);
    } catch (error) {
      logger.error(`Backfill failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('mapping')
  .description('Manage channel mapping for PNL tracking')
  .argument('<sourceChannel>', 'Source channel ID (signals channel)')
  .argument('<destinationChannel>', 'Destination channel ID (PNL history channel)')
  .action(async (sourceChannel, destinationChannel) => {
    try {
      await updateMapping(sourceChannel, destinationChannel);
      logger.info(`Mapping updated: ${sourceChannel} -> ${destinationChannel}`);
      process.exit(0);
    } catch (error) {
      logger.error(`Mapping update failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('show-mapping')
  .description('Show current channel mapping for PNL tracking')
  .action(() => {
    const mapping = loadPnlMapping();
    logger.info('Current PNL channel mapping:');
    
    if (Object.keys(mapping.signalSources).length === 0) {
      logger.info('No channel mapping configured');
    } else {
      for (const [source, destination] of Object.entries(mapping.signalSources)) {
        logger.info(`${source} -> ${destination}`);
      }
    }
    process.exit(0);
  });

// Parse command line args and execute
if (require.main === module) {
  program.parse(process.argv);
}

module.exports = {
  listActiveSignals,
  listCompletedSignals,
  generateSummary,
  completeSignal,
  stopSignal,
  deleteSignal,
  forceUpdate,
  loadPnlMapping,
  updateMapping
};