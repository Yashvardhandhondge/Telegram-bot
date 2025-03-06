const logger = require('../utils/logger');
const config = require('../config');
const telegramService = require('../services/telegramService');

/**
 * Process a message directly (no queue)
 * @param {Object} messageData Message data to process
 * @returns {Promise<Object>} Processing result
 */
async function processMessage(messageData) {
  try {
    logger.info(`Processing message ${messageData.messageId} from chat ${messageData.chatId}`);

    // Get message text and destination channels
    const messageText = messageData.text;
    const destinationChannels = messageData.destinationChannels;

    // Skip processing if no text or destinations
    if (!messageText || !destinationChannels || destinationChannels.length === 0) {
      logger.warning(`Skipping message ${messageData.messageId}: Missing text or destinations`);
      return { success: false, reason: 'Missing text or destinations' };
    }

    // For now, just classify as alert (simplest possible implementation without AI)
    const messageType = 'alert'; // Replace with AI classification later

    // Forward the message directly (for now - no formatting)
    const formattedMessage = `🔄 Forwarded Message:\n\n${messageText}`;

    // Forward to destination channels
    const forwardResults = [];
    for (const channelId of destinationChannels) {
      try {
        logger.info(`Forwarding message to channel ${channelId}`);
        await telegramService.sendMessage(channelId, formattedMessage);
        forwardResults.push({ channelId, success: true });
      } catch (error) {
        logger.error(`Error forwarding to channel ${channelId}: ${error.message}`, { error });
        forwardResults.push({ channelId, success: false, error: error.message });
      }
    }

    // Return processing results
    return {
      success: forwardResults.some((r) => r.success),
      messageId: messageData.messageId,
      messageType,
      forwardResults,
    };
  } catch (error) {
    logger.error(`Error processing message: ${error.message}`, { error });
    return { success: false, error: error.message };
  }
}

// Only start the worker if running with queue
if (process.env.RUN_CONSUMER === 'true') {
  const { messageQueue, queueEnabled } = require('../utils/queue');

  if (queueEnabled && messageQueue) {
    // Process jobs from the queue
    messageQueue.process(processMessage);

    logger.info('Message consumer started');
    logger.info(`Connected to Redis at ${config.redis.host}:${config.redis.port}`);
    logger.info(`Processing queue: ${config.queue.name}`);
  } else {
    logger.error('Cannot start consumer: queue is not enabled');
    process.exit(1);
  }
}

module.exports = {
  processMessage,
};
