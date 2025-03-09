const Queue = require('bull');
const config = require('../config');
const logger = require('./logger');

// Create message queue with Bull
let messageQueue;
let queueEnabled = false;

try {
  // Check if queue should be enabled
  const useQueue = process.env.USE_QUEUE !== 'false' && 
                  (process.env.DOCKER_ENV === 'true' || 
                   config.redis.host === 'localhost' || 
                   config.redis.host === '127.0.0.1');
  
  if (useQueue) {
    messageQueue = new Queue(config.queue.name, {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
      },
      defaultJobOptions: {
        attempts: config.queue.maxRetries,
        removeOnComplete: 100, // Keep the last 100 completed jobs
        removeOnFail: 100, // Keep the last 100 failed jobs
        timeout: config.queue.processTimeout * 1000, // Convert to milliseconds
      },
    });

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

    messageQueue.on('completed', (job) => {
      logger.debug(`Job ${job.id} completed`, {
        jobId: job.id,
        data: job.data,
      });
    });

    queueEnabled = true;
    logger.info(`Message queue initialized: ${config.queue.name}`);
  } else {
    logger.warn(`Queue disabled by configuration. Messages will be processed immediately.`);
  }
} catch (error) {
  logger.error(`Failed to initialize message queue: ${error.message}`, { error });
  logger.warn('Queue disabled: Messages will be processed immediately without queueing');
}

/**
 * Add a message to the queue for processing or process it immediately
 * @param {Object} messageData Message data to process
 * @returns {Promise<Object>} Job instance or processing result
 */
async function enqueueMessage(messageData) {
  try {
    if (!messageData || !messageData.messageId) {
      logger.error('Invalid message data provided to enqueueMessage');
      return { success: false, error: 'Invalid message data' };
    }
    
    logger.info(`🔍 Processing message ${messageData.messageId} from ${messageData.chatId}`);
    logger.info(`Message has ${messageData.destinationChannels.length} destination channels: ${JSON.stringify(messageData.destinationChannels)}`);
    
    // If queue is enabled, use it
    if (queueEnabled && messageQueue) {
      logger.info(`Adding message ${messageData.messageId} to queue`);
      const job = await messageQueue.add(messageData, {
        // Can add job-specific options here if needed
      });
      
      logger.info(`Enqueued message ${messageData.messageId} with job ID ${job.id}`);
      return job;
    } else {
      // Process immediately if queue is disabled
      logger.info(`Processing message ${messageData.messageId} immediately (queue disabled)`);
      
      try {
        const telegramService = require('../services/telegramService');
        const aiService = require('../services/aiService');
        
        // Skip processing if no destination channels
        if (!messageData.destinationChannels || messageData.destinationChannels.length === 0) {
          logger.warn(`No destination channels for message ${messageData.messageId}`);
          return { success: false, reason: 'No destination channels' };
        }
        
        // Classify message
        const messageType = await aiService.classifyMessage(messageData.text);
        logger.info(`Message ${messageData.messageId} classified as: ${messageType}`);
        
        // TESTING: Allow all messages to be forwarded, even noise
        // Skip noise messages
        // if (messageType === 'noise') {
        //   logger.info(`Skipping noise message ${messageData.messageId}`);
        //   return { success: true, status: 'skipped', reason: 'Noise message' };
        // }
        
        if (messageType === 'noise') {
          logger.info(`Message classified as noise but forwarding anyway (for testing)`);
        }
        
        // Format the message based on its type
        const formattedMessage = await aiService.formatMessage(messageData.text, messageType);
        
        // Forward to all destination channels
        logger.info(`Forwarding message to ${messageData.destinationChannels.length} channels`);
        const result = await telegramService.forwardMessage(formattedMessage, messageData.destinationChannels);
        
        logger.info(`Direct forwarding result: Success=${result.success}, Failure=${result.failure}`);
        logger.info(`Successful channels: ${JSON.stringify(result.channels.successful)}`);
        if (result.channels.failed.length > 0) {
          logger.warn(`Failed channels: ${JSON.stringify(result.channels.failed)}`);
        }
        
        return { 
          success: result.success > 0, 
          directForward: true,
          messageType,
          forwardResult: result 
        };
      } catch (error) {
        logger.error(`Error processing message directly: ${error.message}`, { error });
        return { success: false, error: error.message };
      }
    }
  } catch (error) {
    logger.error(`Error enqueueing/processing message: ${error.message}`, { error, messageData });
    // Don't throw so program can continue even if message processing fails
    return { success: false, error: error.message };
  }
}

module.exports = {
  messageQueue,
  enqueueMessage,
  queueEnabled
};