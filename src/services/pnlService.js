/**
 * PNL (Profit and Loss) tracking service
 * Tracks crypto trading signals and calculates results
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const telegramService = require('./telegramService');
const { createClient } = require('redis');

// Redis client for storing signal data
let redisClient = null;

// Load PNL mapping
const pnlMappingPath = path.join(__dirname, '../config/pnl-mapping.json');
let pnlMapping = { signalSources: {} };
try {
  if (fs.existsSync(pnlMappingPath)) {
    pnlMapping = JSON.parse(fs.readFileSync(pnlMappingPath, 'utf8'));
    logger.info(`Loaded PNL mapping: ${JSON.stringify(pnlMapping)}`);
  } else {
    logger.warn('PNL mapping file not found, using default configuration');
  }
} catch (error) {
  logger.error(`Error loading PNL mapping: ${error.message}`);
}

/**
 * Initialize the PNL service and connect to Redis
 */
async function initialize() {
  try {
    logger.info('Initializing PNL tracking service');
    
    // Connect to Redis if not already connected
    if (!redisClient) {
      redisClient = createClient({
        url: `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}`
      });
      
      redisClient.on('error', (err) => {
        logger.error(`Redis error: ${err.message}`, { error: err });
      });
      
      await redisClient.connect();
      logger.info('Connected to Redis for PNL tracking');
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to initialize PNL service: ${error.message}`, { error });
    return false;
  }
}

/**
 * Check if a chat/topic is a source for PNL tracking
 * @param {string} chatId Chat ID to check
 * @returns {string|null} Destination channel ID or null if not a source
 */
function getDestinationForSource(chatId) {
  // Check if this chat ID is in our mapping
  if (pnlMapping.signalSources[chatId]) {
    return pnlMapping.signalSources[chatId];
  }
  
  // Also check config.pnl.resultChannel as fallback
  return config.pnl?.resultChannel || null;
}

/**
 * Process a message to check if it's a trading signal
 * @param {Object} message Message object
 * @returns {Promise<boolean>} True if signal was processed
 */
async function processMessage(message) {
  try {
    // First check if message is from a PNL source channel
    const destinationChannel = getDestinationForSource(message.chatId);
    
    if (!destinationChannel) {
      logger.debug(`Message ${message.messageId} is not from a configured PNL source channel`);
      return false;
    }
    
    logger.info(`Processing message from PNL source ${message.chatId} with destination ${destinationChannel}`);
    
    // Check if message is a trading signal
    if (message.messageType !== 'crypto_signal') {
      logger.debug(`Message ${message.messageId} is not a crypto signal`);
      return false;
    }
    
    logger.info(`Processing potential trading signal: ${message.messageId}`);
    
    // Parse the signal
    const signal = parseSignal(message.text);
    
    if (!signal) {
      logger.info(`Message is not a valid trading signal: ${message.messageId}`);
      return false;
    }
    
    // Add destination channel to signal
    signal.destinationChannel = destinationChannel;
    
    // Store the signal in Redis
    await storeSignal(signal, message);
    
    logger.info(`Stored trading signal for ${signal.pair}: ${JSON.stringify(signal)}`);
    return true;
  } catch (error) {
    logger.error(`Error processing message for PNL: ${error.message}`, { error });
    return false;
  }
}

/**
 * Parse a message text to extract trading signal information
 * @param {string} text Message text
 * @returns {Object|null} Signal object or null if not a valid signal
 */
function parseSignal(text) {
  try {
    // Convert text to lowercase for matching
    const lowerText = text.toLowerCase();

    // NEW: detect test signals with specific emojis and format
    if (text.includes('📈 SIGNAL:') || text.includes('📉 SIGNAL:')) {
      const pairRegex = /SIGNAL:\s+([A-Z0-9]+\/[A-Z0-9]+)\s+(LONG|SHORT)/i;
      const pairMatch = text.match(pairRegex);
      const pair = pairMatch ? pairMatch[1] : 'BTC/USDT';
      const isBuy = text.toLowerCase().includes('long');
      const direction = isBuy ? 'BUY' : 'SELL';
      
      const entryRegex = /Entry:\s*(\d+\.?\d*)/i;
      const entryMatch = text.match(entryRegex);
      const entryPrice = entryMatch ? parseFloat(entryMatch[1]) : null;
      if (!entryPrice) {
        logger.warn(`Could not extract entry price from test signal for ${pair}`);
        return null;
      }
      
      const targets = [];
      const targetRegex = /(?:Target|[1-3]️⃣)\s*(?:[0-9]+:)?\s*(\d+\.?\d*)/gi;
      let targetMatch;
      while ((targetMatch = targetRegex.exec(text)) !== null) {
        targets.push(parseFloat(targetMatch[1]));
      }
      if (isBuy) {
        targets.sort((a, b) => a - b);
      } else {
        targets.sort((a, b) => b - a);
      }
      
      const slRegex = /Stop Loss:?\s*(\d+\.?\d*)/i;
      const slMatch = text.match(slRegex);
      const stopLoss = slMatch ? parseFloat(slMatch[1]) : null;
      
      const profitTargets = targets.map((target, index) => {
        const targetNumber = index + 1;
        let profitPercent;
        if (isBuy) {
          profitPercent = ((target - entryPrice) / entryPrice) * 100;
        } else {
          profitPercent = ((entryPrice - target) / entryPrice) * 100;
        }
        return {
          number: targetNumber,
          price: target,
          profitPercent: profitPercent.toFixed(2),
          hit: false,
          timestamp: null
        };
      });
      
      let maxLoss = null;
      if (stopLoss !== null) {
        maxLoss = isBuy 
          ? ((entryPrice - stopLoss) / entryPrice) * 100 
          : ((stopLoss - entryPrice) / entryPrice) * 100;
      }
      
      return {
        pair,
        direction,
        entryPrice,
        targets: profitTargets,
        stopLoss,
        maxLoss: maxLoss !== null ? maxLoss.toFixed(2) : null,
        stopped: false,
        timestamp: new Date().toISOString(),
        completed: false,
        status: 'ACTIVE',
        originalText: text
      };
    }
    
    // Convert to lowercase for easier matching
  
    
    // Basic validation - must include buy/sell and some targets
    if (!((lowerText.includes('buy') || lowerText.includes('sell') || lowerText.includes('long') || lowerText.includes('short')) && 
        (lowerText.includes('target') || lowerText.includes('tp') || lowerText.includes('take profit')))) {
      return null;
    }
    
    // Extract trading pair
    const pairRegex = /\b([a-z0-9]{2,10}\/[a-z0-9]{2,10})\b|\b([a-z0-9]{2,10}[/|-][a-z0-9]{2,10})\b|\b([a-z0-9]{1,10})\b/i;
    const pairMatch = text.match(pairRegex);
    let pair = pairMatch ? pairMatch[0].toUpperCase() : null;
    
    // Determine if BTC, ETH or USDT pair if not explicitly stated
    if (pair && !pair.includes('/') && !pair.includes('-')) {
      pair = `${pair}/USDT`; // Default to USDT pairing
    }
    
    if (!pair) {
      logger.warn(`Could not extract trading pair from signal`);
      return null;
    }
    
    // Determine if buy or sell signal
    const isBuy = lowerText.includes('buy') || lowerText.includes('long');
    const direction = isBuy ? 'BUY' : 'SELL';
    
    // Extract entry price
    let entryPrice = null;
    const entryRegex = /entry(?:\sat|:|\s|price)?\s?(?:@|:)?\s?(\d+\.?\d*)/i;
    const entryMatch = text.match(entryRegex);
    
    if (entryMatch) {
      entryPrice = parseFloat(entryMatch[1]);
    } else {
      // Try to find any price after "buy" or "sell"
      const simplePriceRegex = /(buy|sell|long|short)\s(?:@|at)?\s?(\d+\.?\d*)/i;
      const simplePriceMatch = text.match(simplePriceRegex);
      if (simplePriceMatch) {
        entryPrice = parseFloat(simplePriceMatch[2]);
      }
    }
    
    if (!entryPrice || isNaN(entryPrice)) {
      logger.warn(`Could not extract entry price from signal for ${pair}`);
      return null;
    }
    
    // Extract target prices
    const targets = [];
    const targetRegex = /(?:target|tp|take profit)(?:\s?(?:\d+))?(?:\sat|:|\s)?(?:@|:)?\s?(\d+\.?\d*)/gi;
    let targetMatch;
    
    while ((targetMatch = targetRegex.exec(text)) !== null) {
      const targetPrice = parseFloat(targetMatch[1]);
      if (!isNaN(targetPrice)) {
        targets.push(targetPrice);
      }
    }
    
    // Sort targets in ascending order for buy, descending for sell
    if (isBuy) {
      targets.sort((a, b) => a - b);
    } else {
      targets.sort((a, b) => b - a);
    }
    
    // Extract stop loss
    let stopLoss = null;
    const slRegex = /(?:stop loss|sl|stop)(?:\sat|:|\s)?(?:@|:)?\s?(\d+\.?\d*)/i;
    const slMatch = text.match(slRegex);
    
    if (slMatch) {
      stopLoss = parseFloat(slMatch[1]);
    }
    
    // Calculate potential profits for each target
    const profitTargets = targets.map((target, index) => {
      const targetNumber = index + 1;
      let profitPercent;
      
      if (isBuy) {
        profitPercent = ((target - entryPrice) / entryPrice) * 100;
      } else {
        profitPercent = ((entryPrice - target) / entryPrice) * 100;
      }
      
      return {
        number: targetNumber,
        price: target,
        profitPercent: profitPercent.toFixed(2),
        hit: false,
        timestamp: null
      };
    });
    
    // Calculate potential loss
    let maxLoss = null;
    if (stopLoss !== null) {
      if (isBuy) {
        maxLoss = ((entryPrice - stopLoss) / entryPrice) * 100;
      } else {
        maxLoss = ((stopLoss - entryPrice) / entryPrice) * 100;
      }
    }
    
    // Create signal object
    return {
      pair,
      direction,
      entryPrice,
      targets: profitTargets,
      stopLoss,
      maxLoss: maxLoss !== null ? maxLoss.toFixed(2) : null,
      stopped: false,
      timestamp: new Date().toISOString(),
      completed: false,
      status: 'ACTIVE',
      originalText: text
    };
  } catch (error) {
    logger.error(`Error parsing signal: ${error.message}`, { error });
    return null;
  }
}

/**
 * Store a trading signal in Redis
 * @param {Object} signal Signal object
 * @param {Object} message Original message object
 * @returns {Promise<void>}
 */
async function storeSignal(signal, message) {
  try {
    if (!redisClient) {
      await initialize();
    }
    const signalHash = `${signal.pair}-${signal.direction}-${signal.entryPrice}-${message.messageId}`;
    const duplicateKey = `signal:hash:${signalHash}`;
    
    const exists = await redisClient.exists(duplicateKey);
    if (exists) {
      logger.info(`Skipping duplicate signal: ${signalHash}`);
      return null;
    }
  
    await redisClient.set(duplicateKey, '1', { EX: 86400 });
  
    const signalId = `signal:${signal.pair}:${Date.now()}`;
  
    const signalData = {
      ...signal,
      messageId: message.messageId,
      chatId: message.chatId,
      sourceMessage: message.text,
      createdAt: new Date().toISOString()
    };
    
    await redisClient.set(signalId, JSON.stringify(signalData));
    await redisClient.sAdd('active_signals', signalId);
    await redisClient.sAdd(`signals:${signal.pair}`, signalId);
    
    // NEW CODE: Send new signal notification
    try {
      // Format basic info for notification
      const emoji = signal.direction === 'BUY' ? '📈' : '📉';
      const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
      let targetsList = '';
      if (signal.targets && signal.targets.length > 0) {
        targetsList = signal.targets.map(t =>
          `Target ${t.number}: ${t.price} (${t.profitPercent}%)`
        ).join('\n');
      }
      
      const messageText = `${emoji} NEW SIGNAL TRACKED: ${signal.pair} ${direction}
      
Entry: ${signal.entryPrice}
${targetsList ? targetsList + '\n' : ''}${signal.stopLoss ? `Stop Loss: ${signal.stopLoss}\n` : ''}
Signal status: ACTIVE
ID: ${signalId}`;
      
      // Use sendPnlUpdate defined in this file to forward message
      await sendPnlUpdate(messageText, signalData.destinationChannel);
      logger.info(`Sent new signal notification to ${signalData.destinationChannel}`);
    } catch (notifError) {
      logger.error(`Error sending new signal notification: ${notifError.message}`);
    }
  
    return signalId;
  } catch (error) {
    logger.error(`Error storing signal: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Update a signal with current price information
 * @returns {Promise<void>}
 */
async function updateSignals() {
  try {
    if (!redisClient) {
      await initialize();
    }
    
    // Get all active signals
    const activeSignalIds = await redisClient.sMembers('active_signals');
    
    if (activeSignalIds.length === 0) {
      logger.debug('No active signals to update');
      return;
    }
    
    logger.info(`Updating ${activeSignalIds.length} active signals`);
    
    // Group signals by trading pair to minimize API calls
    const pairToSignals = {};
    
    for (const signalId of activeSignalIds) {
      const signalJson = await redisClient.get(signalId);
      if (!signalJson) continue;
      
      const signal = JSON.parse(signalJson);
      const pair = signal.pair;
      
      if (!pairToSignals[pair]) {
        pairToSignals[pair] = [];
      }
      
      pairToSignals[pair].push({ id: signalId, signal });
    }
    
    // Update each group of signals
    for (const pair in pairToSignals) {
      try {
        // Get current price for this pair
        const currentPrice = await getCurrentPrice(pair);
        
        if (!currentPrice) {
          logger.warn(`Could not get current price for ${pair}`);
          continue;
        }
        
        logger.info(`Current price for ${pair}: ${currentPrice}`);
        
        // Update each signal for this pair
        for (const { id, signal } of pairToSignals[pair]) {
          await updateSignalStatus(id, signal, currentPrice);
        }
      } catch (error) {
        logger.error(`Error updating signals for ${pair}: ${error.message}`, { error });
      }
    }
  } catch (error) {
    logger.error(`Error updating signals: ${error.message}`, { error });
  }
}

/**
 * Update a single signal's status based on current price
 * @param {string} signalId Signal ID
 * @param {Object} signal Signal object
 * @param {number} currentPrice Current price
 * @returns {Promise<void>}
 */
async function updateSignalStatus(signalId, signal, currentPrice) {
  try {
    let signalUpdated = false;
    let signalCompleted = false;
    
    // Check if any targets have been hit
    for (const target of signal.targets) {
      if (target.hit) continue; // Skip already hit targets
      
      const targetHit = signal.direction === 'BUY' 
        ? currentPrice >= target.price 
        : currentPrice <= target.price;
      
      if (targetHit) {
        target.hit = true;
        target.timestamp = new Date().toISOString();
        logger.info(`Target ${target.number} hit for ${signal.pair} signal at ${target.price}`);
        signalUpdated = true;
        
        // Post PNL update for this target
        await postTargetHitUpdate(signal, target);
      }
    }
    
    // Check if stop loss was hit
    if (signal.stopLoss !== null && !signal.stopped) {
      const stopHit = signal.direction === 'BUY'
        ? currentPrice <= signal.stopLoss
        : currentPrice >= signal.stopLoss;
      
      if (stopHit) {
        signal.stopped = true;
        signal.stoppedAt = new Date().toISOString();
        signal.status = 'STOPPED';
        signalUpdated = true;
        signalCompleted = true;
        
        // Post stop loss hit update
        await postStopLossUpdate(signal);
      }
    }
    
    // Check if all targets have been hit
    if (!signal.completed && !signal.stopped) {
      const allTargetsHit = signal.targets.every(target => target.hit);
      
      if (allTargetsHit) {
        signal.completed = true;
        signal.completedAt = new Date().toISOString();
        signal.status = 'COMPLETED';
        signalUpdated = true;
        signalCompleted = true;
        
        // Post completion update
        await postCompletionUpdate(signal);
      }
    }
    
    // Update signal in Redis if changed
    if (signalUpdated) {
      await redisClient.set(signalId, JSON.stringify(signal));
      
      // If signal is completed or stopped, remove from active signals
      if (signalCompleted) {
        await redisClient.sRem('active_signals', signalId);
        await redisClient.sAdd('completed_signals', signalId);
      }
    }
  } catch (error) {
    logger.error(`Error updating signal ${signalId}: ${error.message}`, { error });
  }
}

/**
 * Get the current price for a trading pair
 * @param {string} pair Trading pair (e.g. BTC/USDT)
 * @returns {Promise<number|null>} Current price or null if unavailable
 */
async function getCurrentPrice(pair) {
  try {
    if (pair === 'BTC/USDT') {
      const prices = [67000, 67800, 68200, 68900, 69500];
      const randomPrice = prices[Math.floor(Math.random() * prices.length)];
      logger.info(`Using test price for ${pair}: ${randomPrice}`);
      return randomPrice;
    }
    if (pair === 'SIGNAL/USDT') {
      const randomPrice = 8.5 + (Math.random() * 1.5);
      logger.info(`Using test price for ${pair}: ${randomPrice}`);
      return randomPrice;
    }
    const normalizedPair = pair.replace('/', '').toUpperCase();
    const apiUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${normalizedPair}`;
    const response = await axios.get(apiUrl, { timeout: 5000 });
    if (response.data && response.data.price) {
      return parseFloat(response.data.price);
    }
    return null;
  } catch (error) {
    logger.error(`Error fetching price for ${pair}: ${error.message}`, { error });
    return null;
  }
}

/**
 * Post an update when a target is hit
 * @param {Object} signal Signal object
 * @param {Object} target Hit target
 * @returns {Promise<void>}
 */
async function postTargetHitUpdate(signal, target) {
  try {
    // Create a message for the target hit
    const message = createTargetHitMessage(signal, target);
    
    // Send to the PNL results channel specified in the signal
    await sendPnlUpdate(message, signal.destinationChannel);
  } catch (error) {
    logger.error(`Error posting target hit update: ${error.message}`, { error });
  }
}

/**
 * Post an update when stop loss is hit
 * @param {Object} signal Signal object
 * @returns {Promise<void>}
 */
async function postStopLossUpdate(signal) {
  try {
    // Create a message for the stop loss hit
    const message = createStopLossMessage(signal);
    
    // Send to the PNL results channel specified in the signal
    await sendPnlUpdate(message, signal.destinationChannel);
  } catch (error) {
    logger.error(`Error posting stop loss update: ${error.message}`, { error });
  }
}

/**
 * Post an update when a signal is completed
 * @param {Object} signal Signal object
 * @returns {Promise<void>}
 */
async function postCompletionUpdate(signal) {
  try {
    // Create a message for the signal completion
    const message = createCompletionMessage(signal);
    
    // Send to the PNL results channel specified in the signal
    await sendPnlUpdate(message, signal.destinationChannel);
  } catch (error) {
    logger.error(`Error posting completion update: ${error.message}`, { error });
  }
}

/**
 * Create a message for target hit
 * @param {Object} signal Signal object
 * @param {Object} target Hit target
 * @returns {string} Formatted message
 */
function createTargetHitMessage(signal, target) {
  const emoji = signal.direction === 'BUY' ? '📈' : '📉';
  const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  
  return `${emoji} TARGET ${target.number} HIT! ${signal.pair} ${direction}
    
Entry: ${signal.entryPrice}
Target ${target.number}: ${target.price} ✅
Profit: +${target.profitPercent}% 💰
    
Signal status: ACTIVE
Remaining targets: ${signal.targets.filter(t => !t.hit).length}`;
}

/**
 * Create a message for stop loss hit
 * @param {Object} signal Signal object
 * @returns {string} Formatted message
 */
function createStopLossMessage(signal) {
  const emoji = '🛑';
  const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  
  const hitTargets = signal.targets.filter(t => t.hit);
  const missedTargets = signal.targets.filter(t => !t.hit);
  
  let profitLoss = `-${signal.maxLoss}%`;
  
  // If some targets were hit, calculate the overall P&L
  if (hitTargets.length > 0) {
    const totalProfit = hitTargets.reduce((sum, target) => sum + parseFloat(target.profitPercent), 0);
    const avgProfit = totalProfit / hitTargets.length;
    
    // Assuming equal distribution of position across targets
    const targetPortion = 1 / signal.targets.length;
    const hitPortion = hitTargets.length * targetPortion;
    const lossPortion = 1 - hitPortion;
    
    const overallPL = (avgProfit * hitPortion) - (parseFloat(signal.maxLoss) * lossPortion);
    profitLoss = overallPL > 0 ? `+${overallPL.toFixed(2)}%` : `${overallPL.toFixed(2)}%`;
  }
  
  let message = `${emoji} STOP LOSS HIT! ${signal.pair} ${direction}
    
Entry: ${signal.entryPrice}
Stop Loss: ${signal.stopLoss} ❌
Overall P&L: ${profitLoss}
    
Signal status: STOPPED`;

  if (hitTargets.length > 0) {
    message += `\n\nTargets hit: ${hitTargets.map(t => t.number).join(', ')}`;
  }
  
  if (missedTargets.length > 0) {
    message += `\nTargets missed: ${missedTargets.map(t => t.number).join(', ')}`;
  }
  
  return message;
}

/**
 * Create a message for signal completion
 * @param {Object} signal Signal object
 * @returns {string} Formatted message
 */
function createCompletionMessage(signal) {
  const emoji = signal.direction === 'BUY' ? '🚀' : '💰';
  const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  
  // Calculate average profit
  const totalProfit = signal.targets.reduce((sum, target) => sum + parseFloat(target.profitPercent), 0);
  const avgProfit = (totalProfit / signal.targets.length).toFixed(2);
  
  return `${emoji} ALL TARGETS HIT! ${signal.pair} ${direction}
    
Entry: ${signal.entryPrice}
Targets: ${signal.targets.map(t => t.price).join(', ')} ✅
Average Profit: +${avgProfit}% 💰
    
Signal status: COMPLETED ✨`;
}

/**
 * Send a PNL update to the specified channel
 * @param {string} message Message to send
 * @param {string} channelId Channel ID to send to (from signal destination or config)
 * @returns {Promise<void>}
 */
/**
 * Send a PNL update to the specified channel
 * @param {string} message Message to send
 * @param {string} channelId Channel ID to send to (from signal destination or config)
 * @returns {Promise<void>}
 */
async function sendPnlUpdate(message, channelId) {
  try {
    // Use specific channel ID if provided, otherwise fall back to config
    const destinationChannel = channelId || config.pnl?.resultChannel;
    
    if (!destinationChannel) {
      logger.warn('No PNL result channel configured, skipping update');
      return;
    }
    
    logger.info(`Attempting to send PNL update to channel ${destinationChannel}`);
    logger.info(`Message content: ${message.substring(0, 50)}...`);
    
    // Check if bot token is configured
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      logger.error('TELEGRAM_BOT_TOKEN not set in environment variables');
      return;
    }
    
    logger.info(`Using bot token: ${process.env.TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
    
    try {
      // Directly use axios to send the message
      const result = await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: destinationChannel,
          text: message,
          parse_mode: 'HTML'
        }
      );
      
      if (result.data && result.data.ok) {
        logger.info(`Successfully sent PNL update to channel ${destinationChannel}`);
      } else {
        logger.error(`Failed to send PNL update: ${JSON.stringify(result.data)}`);
      }
    } catch (axiosError) {
      if (axiosError.response) {
        logger.error(`Telegram API error: ${JSON.stringify(axiosError.response.data)}`);
      } else {
        logger.error(`Error sending via axios: ${axiosError.message}`);
      }
      
      // Try with telegramService as fallback
      logger.info(`Trying with telegramService as fallback...`);
      const telegramResult = await telegramService.sendMessage(destinationChannel, message);
      
      if (telegramResult) {
        logger.info(`Successfully sent PNL update via telegramService`);
      } else {
        logger.error(`Failed to send PNL update via telegramService`);
      }
    }
  } catch (error) {
    logger.error(`Error sending PNL update: ${error.message}`, { error });
  }
}

/**
 * Generate a summary of PNL results for a time period
 * @param {string} period 'daily', 'weekly', or 'monthly'
 * @param {string} channelId Channel ID to send to (optional)
 * @returns {Promise<void>}
 */
async function generatePnlSummary(period = 'daily', channelId = null) {
  try {
    if (!redisClient) {
      await initialize();
    }
    
    // Get the timeframe for the summary
    const now = new Date();
    let startDate;
    let periodName;
    
    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      periodName = 'Daily';
    } else if (period === 'weekly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      periodName = 'Weekly';
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      periodName = 'Monthly';
    } else {
      throw new Error(`Invalid period: ${period}`);
    }
    
    // Get all completed signals
    const completedSignalIds = await redisClient.sMembers('completed_signals');
    const signals = [];
    
    for (const signalId of completedSignalIds) {
      const signalJson = await redisClient.get(signalId);
      if (!signalJson) continue;
      
      const signal = JSON.parse(signalJson);
      
      // Check if signal was completed within the time period
      const completedAt = signal.completedAt || signal.stoppedAt;
      if (!completedAt) continue;
      
      const completedDate = new Date(completedAt);
      if (completedDate >= startDate && completedDate <= now) {
        signals.push(signal);
      }
    }
    
    if (signals.length === 0) {
      logger.info(`No completed signals found for ${period} summary`);
      return;
    }
    
    // Calculate statistics
    const stats = calculateSignalStats(signals);
    
    // Create and send the summary message
    const message = createSummaryMessage(stats, periodName);
    
    // Determine channel to send to
    const destinations = new Set();
    
    // If specific channel provided, use it
    if (channelId) {
      destinations.add(channelId);
    } else {
      // Otherwise send to all destination channels from our mapping
      for (const destChannel of Object.values(pnlMapping.signalSources)) {
        destinations.add(destChannel);
      }
      
      // Also add config channel if available
      if (config.pnl?.resultChannel) {
        destinations.add(config.pnl.resultChannel);
      }
    }
    
    // Send to all destinations
    for (const dest of destinations) {
      await sendPnlUpdate(message, dest);
    }
    
    logger.info(`Generated ${period} PNL summary with ${signals.length} signals`);
  } catch (error) {
    logger.error(`Error generating PNL summary: ${error.message}`, { error });
  }
}

/**
 * Calculate statistics from a set of signals
 * @param {Array} signals Array of signal objects
 * @returns {Object} Statistics object
 */
function calculateSignalStats(signals) {
  const stats = {
    total: signals.length,
    successful: 0,
    failed: 0,
    partiallySuccessful: 0,
    totalProfit: 0,
    totalLoss: 0,
    netProfit: 0,
    winRate: 0,
    pairs: {},
    directions: {
      BUY: 0,
      SELL: 0
    }
  };
  
  for (const signal of signals) {
    // Count by direction
    stats.directions[signal.direction]++;
    
    // Count by pair
    if (!stats.pairs[signal.pair]) {
      stats.pairs[signal.pair] = 0;
    }
    stats.pairs[signal.pair]++;
    
    // Calculate profit/loss
    const hitTargets = signal.targets.filter(t => t.hit);
    const allTargetsHit = hitTargets.length === signal.targets.length;
    const noTargetsHit = hitTargets.length === 0;
    
    if (allTargetsHit) {
      stats.successful++;
    } else if (noTargetsHit && signal.stopped) {
      stats.failed++;
      stats.totalLoss += parseFloat(signal.maxLoss || 0);
    } else {
      stats.partiallySuccessful++;
      
      // Calculate partial profit/loss
      if (hitTargets.length > 0) {
        const targetPortion = 1 / signal.targets.length;
        let profit = 0;
        
        for (const target of hitTargets) {
          profit += parseFloat(target.profitPercent) * targetPortion;
        }
        
        if (signal.stopped) {
          // Some targets hit, then stopped
          const missedPortion = 1 - (hitTargets.length * targetPortion);
          const loss = parseFloat(signal.maxLoss || 0) * missedPortion;
          
          profit -= loss;
        }
        
        if (profit > 0) {
          stats.totalProfit += profit;
        } else {
          stats.totalLoss -= profit; // Convert to positive loss
        }
      }
    }
    
    // For fully successful signals, add the average profit
    if (allTargetsHit) {
      const totalProfit = signal.targets.reduce((sum, target) => sum + parseFloat(target.profitPercent), 0);
      const avgProfit = totalProfit / signal.targets.length;
      stats.totalProfit += avgProfit;
    }
  }
  
  // Calculate net profit and win rate
  stats.netProfit = stats.totalProfit - stats.totalLoss;
  stats.winRate = ((stats.successful + stats.partiallySuccessful) / stats.total) * 100;
  
  return stats;
}

/**
 * Create a summary message from stats
 * @param {Object} stats Statistics object
 * @param {string} periodName Period name (Daily, Weekly, Monthly)
 * @returns {string} Formatted message
 */
function createSummaryMessage(stats, periodName) {
  // Get top 3 pairs by count
  const topPairs = Object.entries(stats.pairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pair, count]) => `${pair}: ${count}`)
    .join(', ');
  
  const winRateEmoji = stats.winRate >= 70 ? '🔥' : stats.winRate >= 50 ? '✅' : '⚠️';
  const profitEmoji = stats.netProfit > 0 ? '💰' : '📉';
  
  return `📊 ${periodName} PNL Summary

Total Signals: ${stats.total}
✅ Successful: ${stats.successful}
⚠️ Partial: ${stats.partiallySuccessful}
❌ Failed: ${stats.failed}

Win Rate: ${stats.winRate.toFixed(2)}% ${winRateEmoji}
Net Profit: ${stats.netProfit > 0 ? '+' : ''}${stats.netProfit.toFixed(2)}% ${profitEmoji}

Most Active Pairs: ${topPairs}
Direction Split: ${stats.directions.BUY} Long | ${stats.directions.SELL} Short`;
}

/**
 * Manually check a specific channel for signals to backfill
 * @param {string} channelId Channel ID to check
 * @param {number} limit Number of messages to check
 * @returns {Promise<number>} Number of signals found and processed
 */
async function backfillSignals(channelId, limit = 100) {
  try {
    logger.info(`Starting backfill of signals from channel ${channelId}, limit: ${limit}`);
    
    // Get the destination channel for this source
    const destinationChannel = getDestinationForSource(channelId);
    
    if (!destinationChannel) {
      throw new Error(`No destination channel configured for source ${channelId}`);
    }
    
    // Initialize Telegram client to fetch messages
    const telegramService = require('./telegramService');
    await telegramService.initializeSender();
    
    // Get the client
    const client = telegramService.getTelegramClient();
    
    if (!client) {
      throw new Error('Failed to get Telegram client');
    }
    
    // Parse channel ID to get main ID and thread ID if present
    let mainChannelId = channelId;
    let threadId = null;
    
    if (channelId.includes('/')) {
      [mainChannelId, threadId] = channelId.split('/');
      threadId = parseInt(threadId);
    }
    
    // Convert to proper format if needed
    if (!mainChannelId.startsWith('-100')) {
      mainChannelId = `-100${mainChannelId.replace(/^-/, '')}`;
    }
    
    logger.info(`Fetching messages from ${mainChannelId}, thread: ${threadId || 'none'}`);
    
    // Get messages from the channel
    const messages = await client.getMessages(mainChannelId, {
      limit: limit,
      ...(threadId ? { replyTo: threadId } : {})
    });
    
    logger.info(`Retrieved ${messages.length} messages from channel`);
    
    // Process each message
    let signalsFound = 0;
    
    for (const msg of messages) {
      // Skip messages without text
      if (!msg.text) continue;
      
      // Prepare message data in the format expected by processMessage
      const messageData = {
        messageId: msg.id.toString(),
        chatId: channelId,
        text: msg.text,
        messageType: 'crypto_signal', // Assume it's a signal for parsing
      };
      
      // Try to process as signal
      const processed = await processMessage(messageData);
      
      if (processed) {
        signalsFound++;
        logger.info(`Processed signal #${signalsFound} from backfill`);
      }
    }
    
    logger.info(`Backfill complete. Found and processed ${signalsFound} signals`);
    return signalsFound;
  } catch (error) {
    logger.error(`Error backfilling signals: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  initialize,
  processMessage,
  updateSignals,
  generatePnlSummary,
  backfillSignals
};