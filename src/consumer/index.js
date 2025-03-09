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
    let destinationChannels = messageData.destinationChannels;
    
    // Skip processing if no text or destinations
    if (!messageText || !destinationChannels || destinationChannels.length === 0) {
      logger.warn(`Skipping message ${messageData.messageId}: Missing text or destinations`);
      return { success: false, reason: 'Missing text or destinations' };
    }
    
    // Ensure destination channels are strings and have the correct format
    destinationChannels = destinationChannels.map(channel => {
      const channelStr = channel.toString();
      return channelStr.startsWith('-') ? channelStr : `-${channelStr}`;
    });
    
    logger.info(`Formatted destination channels: ${JSON.stringify(destinationChannels)}`);
    
    // Use AI to classify the message
    const messageType = await aiService.classifyMessage(messageText);
    logger.info(`Message ${messageData.messageId} classified as: ${messageType}`);
    
    // TEMPORARY: Allow all messages to be forwarded for testing
    // if (messageType === 'noise') {
    //   logger.info(`Skipping noise message ${messageData.messageId}`);
    //   return { success: true, status: 'skipped', reason: 'Noise message' };
    // }
    
    // Format the message based on its type
    let formattedMessage;
    try {
      formattedMessage = await aiService.formatMessage(messageText, messageType);
      logger.info(`Message formatted as ${messageType}`);
    } catch (formatError) {
      logger.error(`Error formatting message: ${formatError.message}`);
      formattedMessage = `🔄 Forwarded (${messageType}): \n\n${messageText}`;
    }
    
    // Forward to destination channels
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
    logger.error('Cannot start consumer: queue is not enabled');
    // Instead of exiting, just warn and continue
    logger.warn('Consumer will listen for direct processing requests');
  }
}

module.exports = {
  processMessage,
  processQueueJob
};