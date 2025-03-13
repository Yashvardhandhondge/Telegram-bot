// test-reconnection.js
const telegramService = require('./services/telegramService');
const logger = require('./utils/logger');

async function testReconnection() {
  try {
    logger.info('Starting reconnection test');
    
    // Initialize client
    const client = await telegramService.initializeSender();
    logger.info('Client initialized');
    
    // Check initial connection state
    logger.info(`Initial connection state: ${client.connected ? 'CONNECTED' : 'DISCONNECTED'}`);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Trigger disconnection
    await telegramService.testDisconnection();
    logger.info('Disconnection triggered');
    
    // Verify disconnection
    try {
      const disconnectedClient = await telegramService.initializeSender();
      logger.info(`After disconnect: Client is ${disconnectedClient.connected ? 'still connected' : 'disconnected'}`);
    } catch (error) {
      logger.info('Confirmed disconnection: Unable to get client');
    }
    
    // Wait for automatic reconnection to happen
    logger.info('Waiting 20 seconds for automatic reconnection...');
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    // Try to manually trigger reconnection
    try {
      await telegramService.reinitializeClient();
      logger.info('Manual reconnection completed');
    } catch (error) {
      logger.error(`Manual reconnection failed: ${error.message}`);
    }
    
    // Final connection check
    try {
      const finalClient = await telegramService.initializeSender();
      const isConnected = finalClient && finalClient.connected;
      logger.info(`Final connection state: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
      
      if (isConnected) {
        // Try a ping to verify the connection is working
        const pingResult = await telegramService.sendPing(finalClient);
        logger.info(`Final ping test: ${pingResult ? 'SUCCESS' : 'FAILED'}`);
      }
    } catch (error) {
      logger.error(`Final connection check failed: ${error.message}`);
    }
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
  } finally {
    // Always exit the script after the test
    logger.info('Test completed, exiting in 2 seconds');
    setTimeout(() => process.exit(0), 2000);
  }
}

testReconnection();