const Queue = require('bull');
const config = require('../config');
const logger = require('./logger');

// Create message queue with Bull
let messageQueue;

try {
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

  logger.info(`Message queue initialized: ${config.queue.name}`);
} catch (error) {
  logger.error(`Failed to initialize message queue: ${error.message}`, { error });
  // Don't throw here - allow the application to continue without queue in dev mode
  if (process.env.NODE_ENV === 'production') {
    throw error;
  }
}

/**
 * Add a message to the queue for processing
 * @param {Object} messageData Message data to process
 * @returns {Promise<Object>} Job instance
 */
async function enqueueMessage(messageData) {
  try {
    if (!messageQueue) {
      logger.error('Cannot enqueue message: queue not initialized');
      return null;
    }
    
    const job = await messageQueue.add(messageData, {
      // Can add job-specific options here if needed
    });
    
    logger.info(`Enqueued message ${messageData.messageId} with job ID ${job.id}`);
    return job;
  } catch (error) {
    logger.error(`Error enqueueing message: ${error.message}`, { error, messageData });
    throw error;
  }
}

module.exports = {
  messageQueue,
  enqueueMessage,
};