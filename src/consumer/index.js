const logger = require('../utils/logger');
const config = require('../config');
const telegramService = require('../services/telegramService');
const aiService = require('../services/aiService');

/**
 * Process a message from the queue
 * @param {Object} job Bull queue job object
 * @returns {Promise<Object>} Processing result
 */
async function processQueueJob(job) {
  try {
    const messageData = job.data;
    logger.info(`Processing queued job ${job.id} for message ${messageData.messageId}`);
    return await processMessage(messageData);
  } catch (error) {
    logger.error(`Error processing job: ${error.message}`, { error });
    throw error; // Re-throw to let Bull handle the retry
  }
}

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
    let destinationChannels = messageData.destinationChannels || [];
    
    // Make sure destination channels don't have minus prefix as the Bot API doesn't need it
    destinationChannels = destinationChannels.map(channel => channel.toString().replace(/^-/, ''));
    
    logger.info(`Processing for ${destinationChannels.length} destination channels: ${JSON.stringify(destinationChannels)}`);
    
    // Skip processing if no text or destinations
    if (!messageText || !destinationChannels || destinationChannels.length === 0) {
      logger.warn(`Skipping message ${messageData.messageId}: Missing text or destinations`);
      return { success: false, reason: 'Missing text or destinations' };
    }
    
    // Use AI to classify the message
    let messageType;
    try {
      messageType = await aiService.classifyMessage(messageText);
      logger.info(`Message ${messageData.messageId} classified as: ${messageType}`);
    } catch (classifyError) {
      logger.error(`Error classifying message: ${classifyError.message}`);
      // Use a fallback classification
      messageType = 'alert'; // Default to alert for safety
      logger.info(`Using fallback classification: ${messageType}`);
    }
    
    // Skip noise messages (optional - comment out if you want to forward everything)
    if (messageType === 'noise') {
      logger.info(`Skipping noise message ${messageData.messageId}`);
      return { success: true, status: 'skipped', reason: 'Noise message' };
    }
    
    // Format the message based on its type
    let formattedMessage;
    try {
      formattedMessage = await aiService.formatMessage(messageText, messageType);
      logger.info(`Message formatted as ${messageType}`);
    } catch (formatError) {
      logger.error(`Error formatting message: ${formatError.message}`);
      // Use a simple fallback format
      formattedMessage = `📤 FORWARDED (${messageType}):\n\n${messageText}`;
      logger.info(`Using fallback formatting`);
    }
    
    // Forward to destination channels using the Bot API
    logger.info(`Forwarding message to ${destinationChannels.length} channels`);
    
    try {
      const forwardResult = await telegramService.forwardMessage(formattedMessage, destinationChannels);
      logger.info(`Forwarding complete: ${forwardResult.success} successful, ${forwardResult.failure} failed`);
      
      if (forwardResult.channels.successful.length > 0) {
        logger.info(`Successfully forwarded to: ${JSON.stringify(forwardResult.channels.successful)}`);
      }
      
      if (forwardResult.channels.failed.length > 0) {
        logger.warn(`Failed to forward to: ${JSON.stringify(forwardResult.channels.failed)}`);
      }
      
      return {
        success: forwardResult.success > 0,
        messageId: messageData.messageId,
        messageType,
        forwardResult
      };
    } catch (forwardError) {
      logger.error(`Error forwarding message: ${forwardError.message}`);
      return { success: false, error: forwardError.message };
    }
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
    messageQueue.process(processQueueJob);
    
    logger.info('Message consumer started');
    logger.info(`Connected to Redis at ${config.redis.host}:${config.redis.port}`);
    logger.info(`Processing queue: ${config.queue.name}`);
    
    // Log queue events
    messageQueue.on('error', (error) => {
      logger.error(`Queue error: ${error.message}`, { error });
    });
    
    messageQueue.on('failed', (job, error) => {
      logger.error(`Job ${job.id} failed: ${error.message}`, {
        jobId: job.id,
        error,
        data: job.data,
      });
    });
    
    messageQueue.on('completed', (job, result) => {
      logger.info(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
    });
  } else {
    logger.warn('Queue is not enabled. Consumer will run in direct processing mode.');
    // No need to exit - the consumer can still process messages directly
  }
}

module.exports = {
  processMessage,
  processQueueJob
};