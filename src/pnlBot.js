/**
 * PNL (Profit and Loss) Bot
 * Tracks crypto trading signals and reports profits/losses
 */

// Set environment variables to identify this as PNL service
process.env.SERVICE_TYPE = 'pnl';
process.env.PNL_ENABLED = 'true';

const path = require('path');
const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./config');
const pnlService = require('./services/pnlService');
const telegramService = require('./services/telegramService');
const { TelegramClient } = require('telegram');
const { NewMessage } = require('telegram/events');
const { initializeClient } = require('./utils/telegramAuth');
const fs = require('fs');

// Create a PNL-specific logger
const pnlLogger = logger.child({ service: 'pnl-bot' });

// Load PNL channel mapping to determine which channels to monitor
const pnlMappingPath = path.join(__dirname, 'config/pnl-mapping.json');
let pnlChannels = [];

try {
  if (fs.existsSync(pnlMappingPath)) {
    const pnlMapping = require(pnlMappingPath);
    pnlChannels = Object.keys(pnlMapping.signalSources);
    pnlLogger.info(`Loaded PNL channel mapping: ${JSON.stringify(pnlChannels)}`);
    
    // Store PNL channels in environment variable for filtering in main bot
    process.env.PNL_CHANNELS = pnlChannels.join(',');
  } else {
    pnlLogger.warn(`PNL mapping file not found at ${pnlMappingPath}. Creating default mapping.`);
    
    // Create default mapping structure
    const defaultMapping = {
      signalSources: {
        "-1002404846297/5": "-1002404846297/178"
      }
    };
    
    // Ensure directory exists
    const configDir = path.join(__dirname, 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Write default mapping
    fs.writeFileSync(pnlMappingPath, JSON.stringify(defaultMapping, null, 2));
    pnlLogger.info(`Created default PNL mapping at ${pnlMappingPath}`);
    
    // Use the default mapping channels
    pnlChannels = Object.keys(defaultMapping.signalSources);
    process.env.PNL_CHANNELS = pnlChannels.join(',');
  }
} catch (error) {
  pnlLogger.error(`Error loading PNL mapping: ${error.message}`);
}

// PNL Telegram client
let pnlTelegramClient = null;

/**
 * Handle new messages for PNL processing
 */
async function handlePnlMessage(event) {
  try {
    const message = event.message;
    
    // Skip messages without text
    if (!message.text) {
      return;
    }
    
    // Extract chat ID
    let chatId;
    if (message.peerId && typeof message.peerId === 'object') {
      if (message.peerId.channelId) {
        chatId = `${message.peerId.channelId.toString()}`;
      } else if (message.peerId.chatId) {
        chatId = `${message.peerId.chatId.toString()}`;
      } else if (message.peerId.userId) {
        chatId = message.peerId.userId.toString();
      }
    } else if (message.chatId) {
      chatId = message.chatId.toString();
    } else if (message.chat && message.chat.id) {
      chatId = message.chat.id.toString();
    }
    
    // Handle thread IDs
    if (message.groupedId || (message.replyTo && message.replyTo.replyToMsgId)) {
      const threadId = message.groupedId || message.replyTo.replyToMsgId;
      if (!chatId.includes('/')) {
        chatId = `${chatId}/${threadId}`;
      }
    }
    
    if (!chatId) {
      pnlLogger.warn(`Could not determine chat ID for message`);
      return;
    }
    
    // Check if this message is from a channel we're monitoring
    const isMonitoredChannel = pnlChannels.some(channel => {
      return chatId.includes(channel) || 
             chatId.includes(channel.replace('-', '')) ||
             channel.includes(chatId) ||
             channel.includes(chatId.replace('-', ''));
    });
    
    if (!isMonitoredChannel) {
      pnlLogger.debug(`Skipping message from non-monitored channel: ${chatId}`);
      return;
    }
    
    pnlLogger.info(`Processing PNL message from channel ${chatId}`);
    
    // Prepare message for processing
    const messageData = {
      messageId: message.id.toString(),
      chatId: chatId,
      text: message.text,
      messageType: 'crypto_signal', // Assume it's a signal for initial processing
    };
    
    // Process through PNL service
    await pnlService.processMessage(messageData);
  } catch (error) {
    pnlLogger.error(`Error handling PNL message: ${error.message}`, { error });
  }
}

/**
 * Start the PNL message listener
 */
async function startPnlListener() {
  try {
    pnlLogger.info('Starting PNL message listener');
    
    // Reload PNL channel mapping to ensure we have the latest
    try {
      if (fs.existsSync(pnlMappingPath)) {
        delete require.cache[require.resolve(pnlMappingPath)];
        const pnlMapping = require(pnlMappingPath);
        pnlChannels = Object.keys(pnlMapping.signalSources);
        pnlLogger.info(`Refreshed PNL channel mapping: ${JSON.stringify(pnlChannels)}`);
      }
    } catch (error) {
      pnlLogger.error(`Error refreshing PNL mapping: ${error.message}`);
    }
    
    // Initialize client specifically for PNL bot
    pnlTelegramClient = await initializeClient(true); // true = isPnlBot
    
    if (!pnlTelegramClient.connected) {
      await pnlTelegramClient.connect();
    }
    
    // Log which channels we're monitoring
    pnlLogger.info(`PNL Bot monitoring channels: ${JSON.stringify(pnlChannels)}`);
    
    // Set up event handler for new messages
    pnlTelegramClient.addEventHandler(handlePnlMessage, new NewMessage({}));
    
    pnlLogger.info('PNL message listener started successfully');
    return true;
  } catch (error) {
    pnlLogger.error(`Error starting PNL message listener: ${error.message}`, { error });
    return false;
  }
}

/**
 * Initialize the PNL bot
 */
async function initialize() {
  try {
    pnlLogger.info('Initializing PNL Bot');
    
    // Initialize PNL service
    const initialized = await pnlService.initialize();
    
    if (!initialized) {
      throw new Error('Failed to initialize PNL service');
    }
    
    // Initialize Telegram service with PNL flag
    await telegramService.initializeSender(true); // true = isPnlBot
    
    // Start the PNL message listener
    await startPnlListener();
    
    return true;
  } catch (error) {
    pnlLogger.error(`Failed to initialize PNL Bot: ${error.message}`, { error });
    return false;
  }
}

/**
 * Schedule regular updates and summaries
 */
function scheduleJobs() {
  try {
    // IMPORTANT: Reduced frequency to avoid API rate limits
    // Backfill signals every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      try {
        // Reload mapping file to get the latest channels
        let sourceChannels = [];
        try {
          delete require.cache[require.resolve(pnlMappingPath)];
          const refreshedMapping = require(pnlMappingPath);
          sourceChannels = Object.keys(refreshedMapping.signalSources);
          pnlLogger.info(`Refreshed PNL mapping for scheduled backfill: ${JSON.stringify(sourceChannels)}`);
        } catch (mappingError) {
          pnlLogger.error(`Error reloading mapping for backfill: ${mappingError.message}`);
          // Use existing channels as fallback
          sourceChannels = pnlChannels;
        }
        
        // Process only one channel at a time with delays between
        for (const channel of sourceChannels) {
          pnlLogger.info(`Running scheduled backfill for channel ${channel}`);
          
          try {
            // Import backfillSignals from pnlService
            await pnlService.backfillSignals(channel, 5); // Check last 5 messages only (reduced from 10)
            
            // Add delay between processing different channels
            pnlLogger.info('Waiting 10 seconds before processing next channel...');
            await new Promise(resolve => setTimeout(resolve, 10000));
          } catch (error) {
            pnlLogger.error(`Error backfilling channel ${channel}: ${error.message}`);
          }
        }
      } catch (error) {
        pnlLogger.error(`Error in scheduled backfill: ${error.message}`);
      }
    });

    pnlLogger.info('Scheduled automatic backfill every 15 minutes (reduced frequency)');
    
    // Generate daily summary at midnight
    cron.schedule('0 0 * * *', async () => {
      try {
        await pnlService.generatePnlSummary('daily');
      } catch (error) {
        pnlLogger.error(`Error generating daily summary: ${error.message}`, { error });
      }
    });
    
    // Generate weekly summary on Sunday at midnight
    cron.schedule('0 0 * * 0', async () => {
      try {
        await pnlService.generatePnlSummary('weekly');
      } catch (error) {
        pnlLogger.error(`Error generating weekly summary: ${error.message}`, { error });
      }
    });
    
    // Generate monthly summary on the 1st of each month
    cron.schedule('0 0 1 * *', async () => {
      try {
        await pnlService.generatePnlSummary('monthly');
      } catch (error) {
        pnlLogger.error(`Error generating monthly summary: ${error.message}`, { error });
      }
    });
    
    pnlLogger.info('PNL Bot jobs scheduled with reduced frequency to avoid API rate limits');
  } catch (error) {
    pnlLogger.error(`Error scheduling PNL Bot jobs: ${error.message}`, { error });
  }
}

/**
 * Start the PNL bot
 */
async function start() {
  try {
    pnlLogger.info('Starting PNL Bot');
    
    // Initialize services
    const initialized = await initialize();
    
    if (!initialized) {
      throw new Error('Failed to initialize, exiting');
    }
    
    // Schedule jobs
    scheduleJobs();
    
    // Send startup notification
    if (config.pnl?.resultChannel) {
      await telegramService.sendMessage(
        config.pnl.resultChannel,
        '🤖 PNL Bot started\n\nTracking trading signals and calculating profits/losses.',
        true // isPnlMessage flag
      );
    }
    
    pnlLogger.info('PNL Bot started successfully');
    return true;
  } catch (error) {
    pnlLogger.error(`Failed to start PNL Bot: ${error.message}`, { error });
    return false;
  }
}

// Run the bot if this file is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'backfill') {
    // Parse --channel and --limit from arguments
    let channelArg = null;
    let limit = 50;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--channel' && args[i+1]) {
        channelArg = args[i+1];
        i++;
      } else if (args[i] === '--limit' && args[i+1]) {
        limit = parseInt(args[i+1], 10);
        i++;
      }
    }
    if (!channelArg) {
      console.error('Backfill command requires --channel argument');
      process.exit(1);
    }
    (async () => {
      try {
        const count = await pnlService.backfillSignals(channelArg, limit);
        pnlLogger.info(`Backfill completed. Processed ${count} signals.`);
        process.exit(0);
      } catch (error) {
        pnlLogger.error(`Backfill failed: ${error.message}`);
        process.exit(1);
      }
    })();
  } else {
    // Normal bot startup
    start()
      .then(success => {
        if (!success) process.exit(1);
      })
      .catch(error => {
        pnlLogger.error(`Uncaught error in PNL Bot: ${error.message}`, { error });
        process.exit(1);
      });
  }
}

module.exports = {
  initialize,
  start
};