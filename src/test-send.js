const logger = require('./utils/logger');
const telegramService = require('./services/telegramService');
const consumer = require('./consumer');
const { messageQueue, checkQueueHealth } = require('./utils/queue');

/**
 * Debug script to diagnose and fix consumer issues
 */
async function debugConsumer() {
  logger.info('=== Starting consumer debug script ===');
  
  // 1. Check queue health
  logger.info('Checking queue health...');
  const queueHealthy = await checkQueueHealth();
  logger.info(`Queue health check result: ${queueHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  
  // 2. Check client connection
  logger.info('Checking Telegram client connection...');
  try {
    const client = await telegramService.initializeSender();
    const isConnected = client && client.connected;
    logger.info(`Client connected: ${isConnected ? 'YES' : 'NO'}`);
    
    // 3. Test a ping
    logger.info('Testing ping...');
    const pingSuccess = await telegramService.sendPing(client);
    logger.info(`Ping test result: ${pingSuccess ? 'SUCCESS' : 'FAILED'}`);
    
    // 4. Check client health
    logger.info('Running client health check...');
    const healthResult = await consumer.checkClientHealth();
    logger.info(`Health check result: ${healthResult ? 'HEALTHY' : 'UNHEALTHY'}`);
  } catch (error) {
    logger.error(`Error checking client: ${error.message}`);
  }
  
  // 5. Test queue processing
  if (messageQueue) {
    logger.info('Checking queue processing...');
    
    try {
      // Get pending jobs count
      const pendingCount = await messageQueue.getJobCounts();
      logger.info(`Queue job counts: ${JSON.stringify(pendingCount)}`);
      
      // Check if processing is active
      const activeCount = pendingCount.active || 0;
      logger.info(`Active jobs: ${activeCount}`);
      
      if (activeCount === 0 && pendingCount.waiting > 0) {
        logger.warn('Queue has waiting jobs but none active - possible stalled worker');
        
        // Try to fix stalled jobs
        logger.info('Cleaning stalled jobs...');
        await messageQueue.clean(0, 'delayed');
        await messageQueue.clean(0, 'wait');
        await messageQueue.clean(0, 'active');
        
        logger.info('Resetting queue processing...');
        // Pause and resume the queue to reset processing
        await messageQueue.pause();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await messageQueue.resume();
        logger.info('Queue processing reset');
      }
    } catch (error) {
      logger.error(`Error checking queue: ${error.message}`);
    }
  }
  
  // 6. Test consumer by processing a test message
  logger.info('Testing direct message processing...');
  try {
    const testMessage = {
      messageId: `test-${Date.now()}`,
      chatId: 'test-channel',
      text: 'This is a test message from the debug script.',
      destinationChannels: [], // Empty to prevent actual sending
      date: new Date().toISOString()
    };
    
    const result = await consumer.processMessage(testMessage);
    logger.info(`Test message processing result: ${JSON.stringify(result)}`);
  } catch (error) {
    logger.error(`Error in test message processing: ${error.message}`);
  }
  
  logger.info('=== Debug script completed ===');
}

// Run the debug script
debugConsumer()
  .then(() => {
    logger.info('Debug completed successfully');
    process.exit(0);
  })
  .catch(error => {
    logger.error(`Debug script failed: ${error.message}`);
    process.exit(1);
  });