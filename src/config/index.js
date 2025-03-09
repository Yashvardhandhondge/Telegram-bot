const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Application configuration
 */
const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV ,
  },
  
  // Telegram configuration
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    sessionString: process.env.TELEGRAM_SESSION_STRING,
  },
  
  // AI Provider configuration
  ai: {
    provider: process.env.AI_PROVIDER ,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL ,
  },
  
  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST ,
    port: parseInt(process.env.REDIS_PORT) ,
    password: process.env.REDIS_PASSWORD ,
  },
  
  // Queue configuration
  queue: {
    name: process.env.MESSAGE_QUEUE_NAME ,
    maxRetries: parseInt(process.env.MAX_QUEUE_RETRIES) ,
    processTimeout: parseInt(process.env.MESSAGE_PROCESS_TIMEOUT) ,
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL ,
  },
  
  // Message types
  messageTypes: {
    SIGNAL: 'crypto_signal',
    NEWS: 'crypto_news',
    ALERT: 'alert',
    NOISE: 'noise',
  },
  
  // AI Prompts
  prompts: require('./prompts'),
  
  /**
   * Load channel mapping from JSON file
   * @returns {Object} Channel mapping object
   */
  loadChannelMapping() {
    try {
      const mappingPath = path.join(__dirname, 'mapping.json');
      if (fs.existsSync(mappingPath)) {
        const mappingData = fs.readFileSync(mappingPath, 'utf8');
        return JSON.parse(mappingData);
      } else {
        console.warn('Mapping file not found at:', mappingPath);
        return {};
      }
    } catch (error) {
      console.error(`Error loading channel mapping: ${error.message}`);
      return {};
    }
  },
};

// Validate required configuration
if (!config.telegram.apiId || !config.telegram.apiHash) {
  throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables are required');
}

module.exports = config;