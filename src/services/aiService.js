const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Validate AI API key
if (!config.ai.apiKey) {
  logger.warn('AI_API_KEY not provided. AI classification and formatting will be limited.');
}

// Add rate limiting to prevent 429 errors
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second minimum between requests

/**
 * Helper function to wait for rate limiting
 * @returns {Promise<void>} Promise that resolves when ready to make a request
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    logger.debug(`Rate limiting: waiting ${waitTime}ms before next AI request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn Function to retry
 * @param {number} maxRetries Maximum number of retries
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(fn, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Wait for rate limiting before each attempt
      await waitForRateLimit();
      
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if it's a rate limit error
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || (2 ** attempt * 1000);
        logger.warn(`Rate limit hit, retrying after ${retryAfter}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else {
        // For other errors, use exponential backoff
        const backoff = 2 ** attempt * 1000;
        logger.warn(`Request failed, retrying after ${backoff}ms (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  
  throw lastError;
}

/**
 * Classify a message using Gemini AI
 * @param {string} messageText Message text to classify
 * @returns {Promise<string>} Message type (signal, news, alert, or noise)
 */
async function classifyMessage(messageText) {
  try {
    // Default to alert if no message text
    if (!messageText || messageText.trim() === '') {
      return 'noise';
    }

    // If no API key, do basic classification based on keywords
    if (!config.ai.apiKey) {
      return basicClassification(messageText);
    }

    // Prepare the prompt with the message
    const prompt = config.prompts.classification.replace('{message}', messageText);
    
    // Use the appropriate AI provider
    if (config.ai.provider.toLowerCase() === 'gemini') {
      const result = await withRetry(() => classifyWithGemini(prompt));
      logger.info(`Classified message as: ${result}`);
      return result;
    } else if (config.ai.provider.toLowerCase() === 'openai') {
      const result = await withRetry(() => classifyWithOpenAI(prompt));
      logger.info(`Classified message as: ${result}`);
      return result;
    } else {
      logger.error(`Unknown AI provider: ${config.ai.provider}`);
      // Default to alert to err on the side of caution
      return 'alert';
    }
  } catch (error) {
    logger.error(`Error classifying message: ${error.message}`, { error });
    // Fallback to basic classification if AI fails
    return basicClassification(messageText);
  }
}

/**
 * Basic classification based on keywords
 * @param {string} messageText Message text to classify
 * @returns {string} Message type (signal, news, alert, or noise)
 */
function basicClassification(messageText) {
  const text = messageText.toLowerCase();
  
  // Signal keywords
  if (text.includes('buy') || text.includes('sell') || text.includes('entry') || 
      text.includes('target') || text.includes('stop loss') || text.includes('chart') ||
      text.includes('signal') || text.includes('trend') || text.includes('breakout')) {
    return 'crypto_signal';
  }
  
  // Alert keywords
  if (text.includes('alert') || text.includes('warning') || text.includes('urgent') || 
      text.includes('attention') || text.includes('hack') || text.includes('exploit') ||
      text.includes('security') || text.includes('breach') || text.includes('risk')) {
    return 'alert';
  }
  
  // News keywords
  if (text.includes('announce') || text.includes('launch') || text.includes('release') || 
      text.includes('update') || text.includes('report') || text.includes('news') ||
      text.includes('publish') || text.includes('price') || text.includes('market')) {
    return 'crypto_news';
  }
  
  // Default to noise
  return 'noise';
}

/**
 * Classify a message using OpenAI
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Message type
 */
async function classifyWithOpenAI(prompt) {
  try {
    const { OpenAI } = require('openai');
    
    const openai = new OpenAI({
      apiKey: config.ai.apiKey
    });
    
    const response = await openai.chat.completions.create({
      model: config.ai.model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 50,
    });
    
    // Extract classification result
    const result = response.choices[0].message.content.trim().toLowerCase();
    
    // Validate result against our expected message types
    if (['crypto_signal', 'crypto_news', 'alert', 'noise'].includes(result)) {
      return result;
    } else {
      logger.warning(`Invalid classification result: ${result}. Defaulting to alert.`);
      return 'alert';
    }
  } catch (error) {
    logger.error(`Error with OpenAI classification: ${error.message}`, { error });
    return 'alert';
  }
}

/**
 * Classify a message using Google's Gemini
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Message type
 */
async function classifyWithGemini(prompt) {
  try {
    // Prepare request to Gemini API
    const url = `https://generativelanguage.googleapis.com/v1/models/${config.ai.model || 'gemini-2.0-flash'}:generateContent`;
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.ai.apiKey
    };
    const data = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 50,
      }
    };
    
    // Call Gemini API
    const response = await axios.post(url, data, { headers });
    
    // Extract result from response
    if (response.data && 
        response.data.candidates && 
        response.data.candidates[0] && 
        response.data.candidates[0].content &&
        response.data.candidates[0].content.parts &&
        response.data.candidates[0].content.parts[0]) {
      
      const result = response.data.candidates[0].content.parts[0].text.trim().toLowerCase();
      
      // Validate result against our expected message types
      if (['crypto_signal', 'crypto_news', 'alert', 'noise'].includes(result)) {
        return result;
      } else {
        logger.warning(`Invalid classification result: ${result}. Defaulting to alert.`);
        return 'alert';
      }
    } else {
      logger.error('Unexpected response format from Gemini API');
      return 'alert';
    }
  } catch (error) {
    logger.error(`Error with Gemini classification: ${error.message}`, { error });
    return 'alert';
  }
}

/**
 * Format a message using AI based on its type
 * @param {string} messageText Text of the message to format
 * @param {string} messageType Type of the message
 * @returns {Promise<string>} Formatted message text
 */
async function formatMessage(messageText, messageType) {
  try {
    // For alerts, we might want to forward as-is or with minimal formatting
    if (messageType === 'alert') {
      // Add alert emoji to beginning of message
      return `🚨 ALERT 🚨\n\n${messageText}`;
    }
    
    // If no API key, do basic formatting
    if (!config.ai.apiKey) {
      return basicFormatting(messageText, messageType);
    }
    
    // Get the formatting prompt for this message type
    let prompt;
    if (config.prompts.formatting[messageType]) {
      prompt = config.prompts.formatting[messageType].replace('{message}', messageText);
    } else {
      logger.warning(`No formatting prompt found for message type ${messageType}`);
      return `🔄 Forwarded: ${messageType.toUpperCase()}\n\n${messageText}`;
    }
    
    try {
      // Use the appropriate AI provider with retry logic
      if (config.ai.provider.toLowerCase() === 'gemini') {
        const result = await withRetry(() => formatWithGemini(prompt));
        logger.debug(`Formatted ${messageType} message`);
        return result;
      } else if (config.ai.provider.toLowerCase() === 'openai') {
        const result = await withRetry(() => formatWithOpenAI(prompt));
        logger.debug(`Formatted ${messageType} message`);
        return result;
      } else {
        logger.error(`Unknown AI provider: ${config.ai.provider}`);
        return basicFormatting(messageText, messageType);
      }
    } catch (error) {
      logger.error(`AI formatting failed after retries: ${error.message}`);
      return basicFormatting(messageText, messageType);
    }
  } catch (error) {
    logger.error(`Error formatting message: ${error.message}`, { error });
    // Return original message with type prefix if formatting fails
    return basicFormatting(messageText, messageType);
  }
}

/**
 * Basic formatting based on message type
 * @param {string} messageText Message text to format
 * @param {string} messageType Type of message
 * @returns {string} Formatted message
 */
function basicFormatting(messageText, messageType) {
  switch (messageType) {
    case 'crypto_signal':
      return `#Signal\n📈 TRADING SIGNAL\n\n${messageText}`;
    
    case 'crypto_news':
      return `#News\n📰 CRYPTO NEWS\n\n${messageText}`;
    
    case 'alert':
      return `#Alert\n🚨 ALERT 🚨\n\n${messageText}`;
    
    default:
      return `🔄 Forwarded Message:\n\n${messageText}`;
  }
}

/**
 * Format a message using OpenAI
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Formatted message
 */
async function formatWithOpenAI(prompt) {
  try {
    const { OpenAI } = require('openai');
    
    const openai = new OpenAI({
      apiKey: config.ai.apiKey
    });
    
    const response = await openai.chat.completions.create({
      model: config.ai.model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error with OpenAI formatting: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Format a message using Google's Gemini
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Formatted message
 */
async function formatWithGemini(prompt) {
  try {
    // Prepare request to Gemini API
    const url = `https://generativelanguage.googleapis.com/v1/models/${config.ai.model || 'gemini-2.0-flash'}:generateContent`;
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.ai.apiKey
    };
    const data = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      }
    };
    
    // Call Gemini API
    const response = await axios.post(url, data, { headers });
    
    // Extract result from response
    if (response.data && 
        response.data.candidates && 
        response.data.candidates[0] && 
        response.data.candidates[0].content &&
        response.data.candidates[0].content.parts &&
        response.data.candidates[0].content.parts[0]) {
      
      return response.data.candidates[0].content.parts[0].text.trim();
    } else {
      logger.error('Unexpected response format from Gemini API');
      throw new Error('Unexpected response format from Gemini API');
    }
  } catch (error) {
    logger.error(`Error with Gemini formatting: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  classifyMessage,
  formatMessage
};