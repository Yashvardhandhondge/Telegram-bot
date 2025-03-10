const axios = require('axios');
const logger = require('../utils/logger');

// Get Telegram Bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Log warning if bot token is missing
if (!botToken) {
  logger.warn('TELEGRAM_BOT_TOKEN not set in environment. Using fallback mechanism.');
}

/**
 * Parse a Telegram chat ID string (handles thread IDs)
 * @param {string} chatId Chat ID string (may include thread ID)
 * @returns {Object} Object with parsed chat ID and thread ID
 */
function parseChatId(chatId) {
  try {
    // Check if the chat ID includes a thread ID
    if (chatId && chatId.includes('/')) {
      const [mainId, threadId] = chatId.split('/');
      return {
        chatId: mainId,
        threadId: parseInt(threadId)
      };
    }
    
    return {
      chatId,
      threadId: null
    };
  } catch (error) {
    logger.error(`Error parsing chat ID ${chatId}: ${error.message}`, { error });
    return { chatId, threadId: null };
  }
}

/**
 * Send a message to a Telegram chat using Bot API
 * @param {string} chatId Chat ID to send the message to
 * @param {string} text Message text to send
 * @returns {Promise<boolean>} True if message was sent successfully, false otherwise
 */
async function sendMessage(chatId, text) {
  try {
    if (!botToken) {
      logger.error('Cannot send message: TELEGRAM_BOT_TOKEN not set');
      return false;
    }
    
    // Parse chat ID and thread ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Clean the chat ID (remove any minus sign as Bot API doesn't need it)
    const cleanChatId = parsedChatId.toString();
    
    // Prepare request parameters
    const params = {
      chat_id: cleanChatId,
      text: text,
      parse_mode: 'HTML'
    };
    
    // Add thread ID if present (message_thread_id in Bot API)
    if (threadId) {
      params.message_thread_id = threadId;
    }
    
    // Send request to Telegram Bot API
    logger.debug(`Sending message to chat ${cleanChatId} via Bot API`);
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, params);
    
    if (response.data && response.data.ok) {
      logger.info(`✅ Successfully sent message to chat ${cleanChatId} via Bot API`);
      return true;
    } else {
      logger.error(`Failed to send message: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    // Handle Telegram API errors
    if (error.response && error.response.data) {
      logger.error(`Telegram API error: ${error.response.data.description}`);
    } else {
      logger.error(`Error sending message to ${chatId}: ${error.message}`);
    }
    return false;
  }
}

/**
 * Forward a processed message to all destination channels
 * @param {string} text Formatted message text
 * @param {string[]} destinationChannels Array of destination channel IDs
 * @returns {Promise<Object>} Object with success and failure counts
 */
async function forwardMessage(text, destinationChannels) {
  const result = {
    success: 0,
    failure: 0,
    channels: {
      successful: [],
      failed: []
    }
  };
  
  if (!destinationChannels || destinationChannels.length === 0) {
    logger.warn('No destination channels provided for forwarding');
    return result;
  }

  const possibleDestinations = [...destinationChannels.map(channel => channel.toString().replace(/^-/, '')), ...destinationChannels.map(channel => !channel.startsWith('-') ? `-${channel}` : channel)]; 
  
  logger.info(`🚀 Forwarding message to ${possibleDestinations.length} channels: ${JSON.stringify(possibleDestinations)}`);
  
  // Send message to each destination channel
  for (const channelId of possibleDestinations) {
    try {
      logger.info(`Attempting to forward to channel: ${channelId}`);
      
      const success = await sendMessage(channelId, text);
      
      if (success) {
        result.success++;
        result.channels.successful.push(channelId);
        logger.info(`✅ Successfully forwarded to channel ${channelId}`);
      } else {
        result.failure++;
        result.channels.failed.push(channelId);
        logger.warn(`❌ Failed to forward to channel ${channelId}`);
      }
    } catch (error) {
      logger.error(`Error forwarding to channel ${channelId}: ${error.message}`, { error });
      result.failure++;
      result.channels.failed.push(channelId);
    }
  }
  
  logger.info(`📊 Forwarding results: ${result.success} successful, ${result.failure} failed`);
  return result;
}

// For backward compatibility - not actually used with Bot API
function initializeSender() {
  return Promise.resolve(null);
}

module.exports = {
  sendMessage,
  forwardMessage,
  initializeSender
};