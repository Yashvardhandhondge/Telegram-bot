const { initializeClient } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');

// Global Telegram client instance
let telegramClient;

/**
 * Initialize the Telegram client for sending messages
 * @returns {Promise<Object>} Telegram client instance
 */
async function initializeSender() {
  try {
    // Initialize Telegram client if not already initialized
    if (!telegramClient) {
      telegramClient = await initializeClient();
      logger.info('Telegram sender initialized');
      
      // Ensure client is connected
      if (!telegramClient.connected) {
        logger.info('Connecting telegram sender client...');
        await telegramClient.connect();
        logger.info('Telegram sender client connected');
      }
    }
    
    return telegramClient;
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
  try {
    // Check if the chat ID includes a thread ID
    if (chatId.includes('/')) {
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
 * Ensure chat ID has the correct format for Telegram API
 * @param {string} chatId Raw chat ID
 * @returns {string} Formatted chat ID with correct prefix
 */
function formatChatId(chatId) {
  // Remove any existing minus sign
  const cleanId = chatId.toString().replace(/^-/, '');
  
  // Add minus sign if it's a group/channel (IDs typically over 100)
  // This is a heuristic that generally works for Telegram group/channel IDs
  if (parseInt(cleanId) > 100) {
    return `-${cleanId}`;
  }
  
  return cleanId;
}

/**
 * Send a message to a Telegram chat
 * @param {string} chatId Chat ID to send the message to
 * @param {string} text Message text to send
 * @returns {Promise<boolean>} True if message was sent successfully, false otherwise
 */
async function sendMessage(chatId, text) {
  try {
    // Make sure client is initialized and connected
    const client = await initializeSender();
    
    // Parse the chat ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Clean up the chat ID - remove minus sign for consistency
    const cleanChatId = parsedChatId.startsWith('-') ? parsedChatId.substring(1) : parsedChatId;
    
    // Try different formats of the chat ID
    const chatIdFormats = [
      // As is (string)
      parsedChatId,
      // Raw ID with no prefix
      cleanChatId,
      // With minus prefix (most common for groups/channels)
      `-${cleanChatId}`,
      // As number
      parseInt(cleanChatId),
      // As negative number (for groups/channels)
      -parseInt(cleanChatId)
    ];
    
    logger.debug(`Trying to send message to channel ${chatId} using multiple formats`);
    
    let success = false;
    let lastError = null;
    
    // Try each format until one works
    for (const idFormat of chatIdFormats) {
      try {
        logger.debug(`Trying to send to chat ID format: ${idFormat}`);
        
        // Create message parameters
        const params = {
          message: text
        };
        
        // Add replyToMsgId if thread is specified
        if (threadId) {
          params.replyToMsgId = threadId;
        }
        
        // Send the message
        await client.sendMessage(idFormat, params);
        
        logger.info(`Sent message to chat ${chatId} using format ${idFormat}`);
        success = true;
        break;
      } catch (error) {
        lastError = error;
        logger.debug(`Failed to send with format ${idFormat}: ${error.message}`);
      }
    }
    
    if (!success && lastError) {
      // Try one more approach - get entity first and then send
      try {
        logger.debug(`Trying alternative approach - resolving entity first for ${formatChatId(cleanChatId)}`);
        
        // Try to resolve the entity first (important in Docker environment)
        const formattedId = formatChatId(cleanChatId);
        const entity = await client.getEntity(formattedId);
        
        if (entity) {
          logger.info(`Successfully resolved entity for ${formattedId}`);
          
          // Create message parameters
          const params = {
            message: text
          };
          
          // Add replyToMsgId if thread is specified
          if (threadId) {
            params.replyToMsgId = threadId;
          }
          
          // Send using the resolved entity
          await client.sendMessage(entity, params);
          logger.info(`Sent message to chat ${chatId} using resolved entity`);
          return true;
        }
      } catch (entityError) {
        logger.error(`Failed to resolve entity: ${entityError.message}`);
        throw lastError; // Throw the original error
      }
    }
    
    return success;
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
    logger.warn('No destination channels provided for forwarding');
    return result;
  }
  
  logger.info(`🚀 Forwarding message to ${destinationChannels.length} channels: ${JSON.stringify(destinationChannels)}`);
  
  // Send message to each destination channel
  for (const channelId of destinationChannels) {
    try {
      // In Docker environment, ensure we're using the right format
      // const formattedChannelId = channelId.toString().startsWith('-') ? channelId : `-${channelId}`;
      const formattedChannelId = channelId.toString().startsWith('-') ? channelId : `${channelId}`;
      logger.info(`Attempting to forward to channel: ${formattedChannelId}`);
      
      const success = await sendMessage(formattedChannelId, text);
      
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

module.exports = {
  sendMessage,
  forwardMessage,
  initializeSender
};