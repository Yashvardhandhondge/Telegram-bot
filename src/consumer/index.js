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
    const messageText = messageData.text || '';
    let destinationChannels = messageData.destinationChannels || [];
    
    // Filter out any invalid destination channels
    destinationChannels = destinationChannels.filter(channel => 
      channel && (typeof channel === 'string' || typeof channel === 'number')
    );
    
    logger.info(`Processing for ${destinationChannels.length} destination channels: ${JSON.stringify(destinationChannels)}`);
    
    // Skip processing if no destinations
    if (!destinationChannels || destinationChannels.length === 0) {
      logger.warn(`Skipping message ${messageData.messageId}: Missing destinations`);
      return { success: false, reason: 'Missing destinations' };
    }
    
    const hasMedia = messageData.hasMedia || false;
    
    // Handle media-only messages differently
    if (hasMedia && (!messageText || messageText.trim() === '')) {
      logger.info(`Message ${messageData.messageId} has media but no text, forwarding directly`);
      
      try {
        // Forward with original media
        const forwardResult = await telegramService.forwardMessage(messageData, destinationChannels);
        return {
          success: forwardResult.success > 0,
          messageId: messageData.messageId,
          mediaOnly: true,
          mediaType: messageData.mediaType,
          forwardResult
        };
      } catch (mediaError) {
        logger.error(`Error forwarding media-only message: ${mediaError.message}`);
        return { success: false, error: mediaError.message };
      }
    }
    
    // Skip if no text and no media
    if (!messageText.trim() && !hasMedia) {
      logger.warn(`Skipping message ${messageData.messageId}: No content to forward`);
      return { success: false, reason: 'No content' };
    }
    
    // Use AI to classify the message if there's text
    let messageType = 'unclassified';
    let formattedMessage = messageText;
    
    if (messageText && messageText.trim() !== '') {
      try {
        messageType = await aiService.classifyMessage(messageText);
        logger.info(`Message ${messageData.messageId} classified as: ${messageType}`);
        
        // Skip noise messages if they don't have media
        if (messageType === 'noise' && !hasMedia) {
          logger.info(`Skipping noise message ${messageData.messageId}`);
          return { success: true, status: 'skipped', reason: 'Noise message' };
        }
        
        // Format the message based on its type
        formattedMessage = await aiService.formatMessage(messageText, messageType);
        logger.info(`Message formatted as ${messageType}`);
      } catch (formatError) {
        logger.error(`Error formatting message: ${formatError.message}`);
        // Use a simple fallback format
        formattedMessage = `📤 FORWARDED:\n\n${messageText}`;
        logger.info(`Using fallback formatting`);
      }
    } else if (hasMedia) {
      // For media with no text, use a simple caption
      formattedMessage = `📤 Forwarded media`;
      messageType = 'media';
      logger.info(`Using simple caption for media-only message`);
    }
    
    // Forward to destination channels
    logger.info(`Forwarding message to ${destinationChannels.length} channels`);
    
    try {
      // If the message has media, include it in the forwarding
      const forwardData = hasMedia ? {
        ...messageData,
        text: formattedMessage
      } : formattedMessage;
      
      const forwardResult = await telegramService.forwardMessage(forwardData, destinationChannels);
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
        hasMedia,
        mediaType: hasMedia ? messageData.mediaType : null,
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