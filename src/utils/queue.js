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
    // If queue is enabled, use it
    if (queueEnabled && messageQueue) {
      const job = await messageQueue.add(messageData, {
        // Can add job-specific options here if needed
      });
      
      logger.info(`Enqueued message ${messageData.messageId} with job ID ${job.id}`);
      return job;
    } else {
      // Process immediately if queue is disabled
      logger.info(`Processing message ${messageData.messageId} immediately (queue disabled)`);
      
      try {
        // Import here to avoid circular dependencies
        const consumer = require('../consumer');
        
        // Process the message directly if consumer exists
        if (consumer && typeof consumer.processMessage === 'function') {
          const result = await consumer.processMessage(messageData);
          logger.info(`Direct processing result: ${JSON.stringify(result)}`);
          return result;
        } else {
          // Basic forwarding without full processing
          const telegramService = require('../services/telegramService');
          
          if (messageData.destinationChannels && messageData.destinationChannels.length > 0) {
            const formattedMessage = `🔄 Forwarded:\n\n${messageData.text}`;
            
            for (const channelId of messageData.destinationChannels) {
              try {
                await telegramService.sendMessage(channelId, formattedMessage);
                logger.info(`Directly forwarded message to ${channelId}`);
              } catch (error) {
                logger.error(`Error forwarding to ${channelId}: ${error.message}`);
              }
            }
            
            return { success: true, directForward: true };
          } else {
            logger.warn(`No destination channels for message ${messageData.messageId}`);
            return { success: false, reason: 'No destination channels' };
          }
        }
      } catch (consumerError) {
        logger.error(`Error importing consumer: ${consumerError.message}`, { error: consumerError });
        return null;
      }
    }
  } catch (error) {
    logger.error(`Error enqueueing/processing message: ${error.message}`, { error, messageData });
    // Don't throw so program can continue even if message processing fails
    return null;
  }
}

module.exports = {
  messageQueue,
  enqueueMessage,
  queueEnabled
};