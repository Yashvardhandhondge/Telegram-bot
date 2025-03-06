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
    env: process.env.NODE_ENV || 'development',
  },

  // Telegram configuration
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    sessionString: process.env.TELEGRAM_SESSION_STRING,
  },

  // AI Provider configuration
  ai: {
    provider: process.env.AI_PROVIDER || 'openai', // openai or gemini
    apiKey: process.env.AI_API_KEY,
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Queue configuration
  queue: {
    name: process.env.MESSAGE_QUEUE_NAME || 'telegram_messages',
    maxRetries: parseInt(process.env.MAX_QUEUE_RETRIES) || 3,
    processTimeout: parseInt(process.env.MESSAGE_PROCESS_TIMEOUT) || 300,
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Message types
  messageTypes: {
    SIGNAL: 'crypto_signal',
    NEWS: 'crypto_news',
    ALERT: 'alert',
    NOISE: 'noise',
  },

  // AI Prompts
  prompts: {
    classification: `
      You are an AI assistant specialized in crypto trading. Your task is to classify the following message from a Telegram crypto group.
      Classify the message as ONE of the following categories:
      1. 'crypto_signal' - if it contains trading signals like buy/sell recommendations, price targets, entry/exit points
      2. 'crypto_news' - if it reports news about cryptocurrencies, blockchain projects, or the crypto market
      3. 'alert' - if it's an urgent message about market warnings, security incidents, or regulatory updates
      4. 'noise' - if it's unrelated to the above categories or is just casual conversation

      The message is delimited by triple quotes:
      """
      {message}
      """

      Only respond with one of the category names: 'crypto_signal', 'crypto_news', 'alert', or 'noise'.
    `,

    formatting: {
      crypto_signal: `
        Format the following crypto trading signal into a clean, standardized format.
        Include the following information if available:
        - Coin/token name and trading pair
        - Action (buy/sell)
        - Entry price or price range
        - Stop loss level
        - Take profit targets
        - Any relevant timeframe or chart information
        
        Original message:
        {message}
        
        Format as a concise, professional trading signal with emoji indicators. Do not include any personal commentary or conversation outside the signal details.
      `,

      crypto_news: `
        Format the following crypto news item into a clear, concise summary.
        Include:
        - A short headline (one line)
        - The main facts in 2-3 bullet points
        - Source attribution if available
        
        Original message:
        {message}
        
        Format as a brief, factual news update suitable for traders. Add relevant emojis if appropriate.
      `,

      alert: `
        Format this alert message to highlight its urgency and key information.
        
        Original message:
        {message}
        
        Keep all important details but organize them clearly with appropriate emphasis and emoji indicators for the alert type.
      `,
    },
  },

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
