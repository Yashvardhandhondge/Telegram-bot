const { initializeClient } = require('./utils/telegramAuth');
const logger = require('./utils/logger');
const config = require('./config');

/**
 * Test sending messages to all destination channels
 */
async function testAllDestinations() {
  try {
    logger.info('Starting destination channels test');
    
    // Initialize Telegram client
    const client = await initializeClient();
    logger.info('Telegram client initialized');
    
    // Make sure client is connected
    if (!client.connected) {
      await client.connect();
    }
    
    // Get all unique destination channels
    const destinationChannels = new Set();
    const mapping = config.loadChannelMapping();
    
    // Collect all destination channels
    for (const user in mapping) {
      for (const sourceChannel in mapping[user]) {
        const destinations = mapping[user][sourceChannel];
        if (Array.isArray(destinations)) {
          destinations.forEach(dest => destinationChannels.add(dest));
        }
      }
    }
    
    logger.info(`Found ${destinationChannels.size} unique destination channels`);
    
    // Test sending to each destination
    for (const channelId of destinationChannels) {
      try {
        logger.info(`Testing channel ${channelId}...`);
        
        // Try different formats
        const channelFormats = [
          // Original format
          channelId,
          // Integer format
          parseInt(channelId.replace(/^-/, '')),
          // Negative integer format
          -parseInt(channelId.replace(/^-/, '')),
        ];
        
        let success = false;
        
        for (const format of channelFormats) {
          try {
            logger.info(`Trying format: ${format}`);
            await client.sendMessage(format, {
              message: `📝 TEST: This is a test message sent at ${new Date().toISOString()}`
            });
            logger.info(`SUCCESS! Sent test message to ${channelId} using format ${format}`);
            success = true;
            break;
          } catch (err) {
            logger.error(`Failed with format ${format}: ${err.message}`);
          }
        }
        
        if (!success) {
          logger.error(`❌ Could not send to ${channelId} with any format`);
        }
      } catch (error) {
        logger.error(`Error testing channel ${channelId}: ${error.message}`);
      }
    }
    
    logger.info('Destination channel test completed');
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
  }
}

// Run the test
testAllDestinations();