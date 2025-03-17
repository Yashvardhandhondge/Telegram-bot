/**
 * PNL (Profit and Loss) Bot
 * Tracks crypto trading signals and reports profits/losses
 */
const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./config');
const pnlService = require('./services/pnlService');
const telegramService = require('./services/telegramService');

/**
 * Initialize the PNL bot
 */
async function initialize() {
  try {
    logger.info('Initializing PNL Bot');
    
    // Initialize PNL service
    const initialized = await pnlService.initialize();
    
    if (!initialized) {
      throw new Error('Failed to initialize PNL service');
    }
    
    // Initialize Telegram service
    await telegramService.initializeSender();
    
    return true;
  } catch (error) {
    logger.error(`Failed to initialize PNL Bot: ${error.message}`, { error });
    return false;
  }
}

/**
 * Schedule regular updates and summaries
 */
function scheduleJobs() {
  try {
    // Update signal status every minute
 // Backfill signals every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    // Get source channels from mapping
    const pnlMapping = require('./config/pnl-mapping.json');
    const sourceChannels = Object.keys(pnlMapping.signalSources);
    
    // Run backfill for each source channel
    for (const channel of sourceChannels) {
      logger.info(`Running scheduled backfill for channel ${channel}`);
      
      try {
        // Import backfillSignals from pnlService
        await pnlService.backfillSignals(channel, 10); // Check last 10 messages
      } catch (error) {
        logger.error(`Error backfilling channel ${channel}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in scheduled backfill: ${error.message}`);
  }
});

logger.info('Scheduled automatic backfill every 5 minutes');
    
    // Generate daily summary at midnight
    cron.schedule('0 0 * * *', async () => {
      try {
        await pnlService.generatePnlSummary('daily');
      } catch (error) {
        logger.error(`Error generating daily summary: ${error.message}`, { error });
      }
    });
    
    // Generate weekly summary on Sunday at midnight
    cron.schedule('0 0 * * 0', async () => {
      try {
        await pnlService.generatePnlSummary('weekly');
      } catch (error) {
        logger.error(`Error generating weekly summary: ${error.message}`, { error });
      }
    });
    
    // Generate monthly summary on the 1st of each month
    cron.schedule('0 0 1 * *', async () => {
      try {
        await pnlService.generatePnlSummary('monthly');
      } catch (error) {
        logger.error(`Error generating monthly summary: ${error.message}`, { error });
      }
    });

    // NEW: Schedule automatic PNL history forwarding every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
      try {
        await pnlService.forwardPnLHistoryUpdate();
      } catch (error) {
        logger.error(`Error forwarding PNL history: ${error.message}`, { error });
      }
    });
    logger.info('PNL Bot jobs scheduled (including automatic PNL history forwarding)');

    // NEW: Schedule real-time updates every minute
    cron.schedule('* * * * *', async () => {
      try {
        await pnlService.updateSignals();
        logger.info('Real-time signal update triggered');
      } catch (error) {
        logger.error(`Error in real-time update: ${error.message}`, { error });
      }
    });
    logger.info('Scheduled real-time signal updates every minute');

  } catch (error) {
    logger.error(`Error scheduling PNL Bot jobs: ${error.message}`, { error });
  }
}

/**
 * Start the PNL bot
 */
async function start() {
  try {
    logger.info('Starting PNL Bot');
    
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
        '🤖 PNL Bot started\n\nTracking trading signals and calculating profits/losses.'
      );
    }
    
    logger.info('PNL Bot started successfully');
    return true;
  } catch (error) {
    logger.error(`Failed to start PNL Bot: ${error.message}`, { error });
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
        logger.info(`Backfill completed. Processed ${count} signals.`);
        process.exit(0);
      } catch (error) {
        logger.error(`Backfill failed: ${error.message}`);
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
        logger.error(`Uncaught error in PNL Bot: ${error.message}`, { error });
        process.exit(1);
      });
  }
}

module.exports = {
  initialize,
  start
};