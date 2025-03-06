const { Api } = require('telegram');
const { initializeClient } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');

// Global Telegram client instance
let telegramClient;

/**
 * Initialize the Telegram client for sending messages
 * @returns {Promise<void>}
 */
async function initializeSender() {
  try {
    // Initialize Telegram client if not already initialized
    if (!telegramClient) {
      telegramClient = await initializeClient();
      logger.info('Telegram sender initialized');
    }
  } catch (error) {
    logger.error(`Failed to initialize Telegram sender: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Parse a Telegram chat ID string
 * @param {string} chatId Chat ID string (may include thread ID)
 * @returns {Object} Object with parsed chat ID and thread ID
 */
function parseChatId(chatId) {
  // Check if the chat ID includes a thread ID
  if (chatId.includes('/')) {
    const [mainId, threadId] = chatId.split('/');
    return {
      chatId: parseInt(mainId),
      threadId: parseInt(threadId)
    };
  }
  
  return {
    chatId: parseInt(chatId),
    threadId: null
  };
}

/**
 * Send a message to a Telegram chat
 * @param {string} chatId Chat ID to send the message to
 * @param {string} text Message text to send
 * @returns {Promise<boolean>} True if message was sent successfully, false otherwise
 */
async function sendMessage(chatId, text) {
  try {
    // Make sure client is initialized
    if (!telegramClient) {
      await initializeSender();
    }
    
    // Parse the chat ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Create message parameters
    const params = {
      peer: parsedChatId,
      message: text
    };
    
    // Add reply to thread if applicable
    if (threadId) {
      params.replyTo = threadId;
    }
    
    // Send the message
    await telegramClient.sendMessage(params);
    
    logger.info(`Sent message to chat ${chatId}`);
    return true;
  } catch (error) {
    logger.error(`Error sending message to ${chatId}: ${error.message}`, { error });
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
    logger.warning('No destination channels provided for forwarding');
    return result;
  }
  
  // Make sure client is initialized
  if (!telegramClient) {
    await initializeSender();
  }
  
  // Send message to each destination channel
  for (const channelId of destinationChannels) {
    try {
      const success = await sendMessage(channelId, text);
      
      if (success) {
        result.success++;
        result.channels.successful.push(channelId);
      } else {
        result.failure++;
        result.channels.failed.push(channelId);
      }
    } catch (error) {
      logger.error(`Error forwarding to channel ${channelId}: ${error.message}`, { error });
      result.failure++;
      result.channels.failed.push(channelId);
    }
  }
  
  return result;
}

// Initialize when module is loaded
(async () => {
  try {
    await initializeSender();
  } catch (error) {
    logger.error(`Failed to initialize Telegram sender: ${error.message}`, { error });
  }
})();

module.exports = {
  sendMessage,
  forwardMessage,
  telegramClient,
};