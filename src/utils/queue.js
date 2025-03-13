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
        // Remove enableReadyCheck and maxRetriesPerRequest as they cause issues with Bull
        connectTimeout: 30000, // Longer timeout
      },
      defaultJobOptions: {
        attempts: config.queue.maxRetries,
        removeOnComplete: 100, // Keep the last 100 completed jobs
        removeOnFail: 100, // Keep the last 100 failed jobs
        timeout: config.queue.processTimeout * 1000, // Convert to milliseconds
      },
      settings: {
        lockDuration: 30000, // 30 seconds
        stalledInterval: 15000, // 15 seconds
        maxStalledCount: 3
      }
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
    
    // Add handlers for connection events
    messageQueue.on('connect', () => {
      logger.info('Queue connected to Redis');
    });
    
    messageQueue.on('disconnect', () => {
      logger.warn('Queue disconnected from Redis');
    });
    
    messageQueue.on('reconnect', () => {
      logger.info('Queue reconnected to Redis');
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
      try {
        const job = await messageQueue.add(messageData, {
          // Can add job-specific options here if needed
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 5000 // Start with 5 second delay, then exponential backoff
          }
        });
        
        logger.info(`Enqueued message ${messageData.messageId} with job ID ${job.id}`);
        return job;
      } catch (queueError) {
        logger.error(`Error adding job to queue: ${queueError.message}`, { error: queueError });
        
        // If we can't queue, try direct processing
        logger.info(`Falling back to direct processing for message ${messageData.messageId}`);
        return await directProcessMessage(messageData);
      }
    } else {
      // Process immediately if queue is disabled
      logger.info(`Processing message ${messageData.messageId} immediately (queue disabled)`);
      return await directProcessMessage(messageData);
    }
  } catch (error) {
    logger.error(`Error enqueueing/processing message: ${error.message}`, { error, messageData });
    // Don't throw so program can continue even if message processing fails
    return null;
  }
}

/**
 * Process a message directly (no queue)
 * @param {Object} messageData Message data to process
 * @returns {Promise<Object>} Processing result
 */
async function directProcessMessage(messageData) {
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
    logger.error(`Error in direct processing: ${consumerError.message}`, { error: consumerError });
    return { success: false, error: consumerError.message };
  }
}

/**
 * Check Redis connection health
 * @returns {Promise<boolean>} True if connection is healthy
 */
async function checkQueueHealth() {
  if (!queueEnabled || !messageQueue) {
    return false;
  }
  
  try {
    // Try to ping the Redis server
    const client = messageQueue.client;
    await client.ping();
    return true;
  } catch (error) {
    logger.error(`Queue health check failed: ${error.message}`);
    return false;
  }
}

module.exports = {
  messageQueue,
  enqueueMessage,
  queueEnabled,
  checkQueueHealth
};