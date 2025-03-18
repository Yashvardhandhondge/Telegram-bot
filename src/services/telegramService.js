const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const config = require('../config');
const logger = require('../utils/logger');
const axios = require('axios');
const { initializeClient, sendPing } = require('../utils/telegramAuth');

// Global Telegram client instances
let telegramClient;
let pnlTelegramClient;

// Get Telegram Bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Initialize the Telegram client for sending messages
 * @param {boolean} isPnlBot Whether this is for the PNL Bot
 * @returns {Promise<Object>} Telegram client instance
 */
async function initializeSender(isPnlBot = false) {
  try {
    // Choose the appropriate client based on isPnlBot
    if (isPnlBot) {
      // Initialize PNL Telegram client if not already initialized
      if (!pnlTelegramClient) {
        pnlTelegramClient = await initializeClient(true); // true = isPnlBot
        logger.info('PNL Telegram sender initialized');
        
        // Ensure client is connected
        if (!pnlTelegramClient.connected) {
          logger.info('Connecting PNL telegram sender client...');
          await pnlTelegramClient.connect();
          logger.info('PNL Telegram sender client connected');
        }
      }
      
      return pnlTelegramClient;
    } else {
      // Initialize main Telegram client if not already initialized
      if (!telegramClient) {
        telegramClient = await initializeClient(false); // false = not PNL Bot
        logger.info('Main Telegram sender initialized');
        
        // Ensure client is connected
        if (!telegramClient.connected) {
          logger.info('Connecting main telegram sender client...');
          await telegramClient.connect();
          logger.info('Main Telegram sender client connected');
        }
      }
      
      return telegramClient;
    }
  } catch (error) {
    logger.error(`Failed to initialize Telegram sender: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Check if a client is fully connected and working
 * @param {TelegramClient} client Telegram client to check
 * @returns {Promise<boolean>} True if client is connected and working
 */
async function isClientHealthy(client) {
  if (!client || !client.connected) {
    return false;
  }
  
  try {
    // Try a simple API call to verify the client is working
    await client.invoke(new Api.Ping({
      pingId: BigInt(Math.floor(Math.random() * 1000000000))
    }));
    return true;
  } catch (error) {
    logger.error(`Client health check failed: ${error.message}`);
    return false;
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
 * Send a message to a Telegram chat using Bot API
 * @param {string} chatId Chat ID to send the message to
 * @param {string} text Message text to send
 * @param {boolean} isPnlMessage Whether this is a PNL message
 * @returns {Promise<boolean>} True if message was sent successfully, false otherwise
 */
async function sendMessage(chatId, text, isPnlMessage = false) {
  try {
    if (!botToken) {
      logger.error('Cannot send message: TELEGRAM_BOT_TOKEN not set');
      return false;
    }
    
    // Make sure text isn't empty
    if (!text || text.trim() === '') {
      logger.error('Cannot send empty message');
      return false;
    }
    
    // Parse chat ID and thread ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Use the chat ID exactly as provided
    const targetChatId = parsedChatId;
    
    // Prepare request parameters
    const params = {
      chat_id: targetChatId,
      text: text,
      parse_mode: 'HTML'
    };
    
    // Add thread ID if present (message_thread_id in Bot API)
    if (threadId) {
      params.message_thread_id = threadId;
    }
    
    // Send request to Telegram Bot API
    logger.debug(`Sending message to chat ${targetChatId} via Bot API${isPnlMessage ? ' (PNL)' : ''}`);
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, params);
    
    if (response.data && response.data.ok) {
      logger.info(`✅ Successfully sent message to chat ${targetChatId} via Bot API${isPnlMessage ? ' (PNL)' : ''}`);
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
 * Forward a message to all destination channels
 * @param {string|Object} messageData Formatted message text or message data object
 * @param {string[]} destinationChannels Array of destination channel IDs
 * @param {boolean} isPnlMessage Whether this is for PNL bot
 * @returns {Promise<Object>} Object with success and failure counts
 */
async function forwardMessage(messageData, destinationChannels, isPnlMessage = false) {
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
  
  // Check if messageData is a string (just text) or an object
  const isTextOnly = typeof messageData === 'string';
  const text = isTextOnly ? messageData : (messageData.formattedText || messageData.text || '');
  
  // If it's an object with destination channels, convert to the expected format
  if (!isTextOnly && messageData.destinationChannels && !destinationChannels) {
    destinationChannels = messageData.destinationChannels;
  }
  
  logger.info(`Forwarding message to ${destinationChannels.length} channels: ${JSON.stringify(destinationChannels)}`);
  
  // Process each destination channel
  for (const channelId of destinationChannels) {
    try {
      logger.info(`Forwarding to channel: ${channelId}`);
      
      let success = false;
      
      // Send message
      if (text && text.trim() !== '') {
        success = await sendMessage(channelId, text, isPnlMessage);
        if (success) {
          logger.info(`✅ Successfully sent message to channel ${channelId}`);
        } else {
          logger.warn(`❌ Failed to send message to channel ${channelId}`);
        }
      } else {
        logger.warn(`Empty message text for channel ${channelId}, skipping`);
      }
      
      // Update result tracking
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
  
  logger.info(`Forwarding results: ${result.success} successful, ${result.failure} failed`);
  return result;
}

/**
 * Reinitialize the Telegram client after disconnection
 * @param {boolean} isPnlBot Whether to reinitialize the PNL client
 * @returns {Promise<TelegramClient>} Reinitialized client
 */
async function reinitializeClient(isPnlBot = false) {
  try {
    if (isPnlBot) {
      // Clean up existing PNL client if any
      if (pnlTelegramClient) {
        try {
          logger.info('Disconnecting existing PNL client');
          await pnlTelegramClient.disconnect();
        } catch (e) {
          // Ignore disconnection errors
          logger.warn(`Error during PNL client disconnection: ${e.message}`);
        }
        pnlTelegramClient = null;
      }
      
      // Create a fresh PNL client
      const newClient = await initializeClient(true);
      pnlTelegramClient = newClient;
      
      logger.info('PNL Telegram client reinitialized successfully');
      return pnlTelegramClient;
    } else {
      // Clean up existing main client if any
      if (telegramClient) {
        try {
          logger.info('Disconnecting existing client');
          await telegramClient.disconnect();
        } catch (e) {
          // Ignore disconnection errors
          logger.warn(`Error during client disconnection: ${e.message}`);
        }
        telegramClient = null;
      }
      
      // Create a fresh client
      const newClient = await initializeClient(false);
      telegramClient = newClient;
      
      logger.info('Main Telegram client reinitialized successfully');
      return telegramClient;
    }
  } catch (error) {
    logger.error(`Failed to reinitialize client: ${error.message}`);
    throw error;
  }
}

/**
 * Test function to manually trigger a disconnection
 * @param {boolean} isPnlBot Whether to disconnect the PNL client
 * @returns {Promise<boolean>} True if client was disconnected
 */
async function testDisconnection(isPnlBot = false) {
  logger.info('Manually triggering disconnection for testing...');
  
  if (isPnlBot) {
    if (pnlTelegramClient && pnlTelegramClient.connected) {
      await pnlTelegramClient.disconnect();
      logger.info('PNL client manually disconnected for testing');
      return true;
    }
  } else {
    if (telegramClient && telegramClient.connected) {
      await telegramClient.disconnect();
      logger.info('Main client manually disconnected for testing');
      return true;
    }
  }
  
  return false;
}

/**
 * Get the Telegram client instance
 * @param {boolean} isPnlBot Whether to get the PNL client
 * @returns {Object|null} Telegram client instance or null if not initialized
 */
function getTelegramClient(isPnlBot = false) {
  return isPnlBot ? pnlTelegramClient : telegramClient;
}

/**
 * Fetch messages from a channel
 * @param {string} channelId Channel ID to fetch messages from
 * @param {number} limit Maximum number of messages to fetch
 * @param {boolean} isPnlBot Whether to use the PNL client
 * @returns {Promise<Array>} Array of message objects
 */
async function getChannelMessages(channelId, limit = 100, isPnlBot = false) {
  try {
    // Ensure client is initialized
    const client = await initializeSender(isPnlBot);
    
    // Parse channel ID to get main ID and thread ID if present
    let mainChannelId = channelId;
    let threadId = null;
    
    if (channelId.includes('/')) {
      [mainChannelId, threadId] = channelId.split('/');
      threadId = parseInt(threadId);
    }
    
    // Convert to proper format if needed
    if (!mainChannelId.startsWith('-100')) {
      mainChannelId = `-100${mainChannelId.replace(/^-/, '')}`;
    }
    
    logger.info(`Fetching ${limit} messages from channel ${mainChannelId}, thread: ${threadId || 'none'}`);
    
    // Get messages from the channel
    const messages = await client.getMessages(mainChannelId, {
      limit: limit,
      ...(threadId ? { replyTo: threadId } : {})
    });
    
    logger.info(`Retrieved ${messages.length} messages from channel ${channelId}`);
    return messages;
  } catch (error) {
    logger.error(`Error fetching channel messages: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Get info about a specific channel
 * @param {string} channelId Channel ID to get info for
 * @param {boolean} isPnlBot Whether to use the PNL client
 * @returns {Promise<Object>} Channel info object
 */
async function getChannelInfo(channelId, isPnlBot = false) {
  try {
    // Ensure client is initialized
    const client = await initializeSender(isPnlBot);
    
    // Parse channel ID
    let mainChannelId = channelId;
    if (channelId.includes('/')) {
      [mainChannelId] = channelId.split('/');
    }
    
    // Convert to proper format if needed
    if (!mainChannelId.startsWith('-100')) {
      mainChannelId = `-100${mainChannelId.replace(/^-/, '')}`;
    }
    
    logger.info(`Fetching info for channel ${mainChannelId}`);
    
    // Get the entity
    const entity = await client.getEntity(mainChannelId);
    
    // Get full channel info
    const fullChannel = await client.invoke(new Api.channels.GetFullChannel({
      channel: entity
    }));
    
    logger.info(`Retrieved info for channel ${channelId}`);
    
    return {
      id: entity.id.toString(),
      title: entity.title || 'Untitled',
      type: entity.className,
      username: entity.username || null,
      fullInfo: fullChannel?.full_chat || null
    };
  } catch (error) {
    logger.error(`Error fetching channel info: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Get topics in a supergroup
 * @param {string} channelId Channel ID of the supergroup
 * @param {boolean} isPnlBot Whether to use the PNL client
 * @returns {Promise<Array>} Array of topic objects
 */
async function getChannelTopics(channelId, isPnlBot = false) {
  try {
    // Ensure client is initialized
    const client = await initializeSender(isPnlBot);
    
    // Parse channel ID (remove thread ID if present)
    let mainChannelId = channelId;
    if (channelId.includes('/')) {
      [mainChannelId] = channelId.split('/');
    }
    
    // Convert to proper format if needed
    if (!mainChannelId.startsWith('-100')) {
      mainChannelId = `-100${mainChannelId.replace(/^-/, '')}`;
    }
    
    logger.info(`Fetching topics for supergroup ${mainChannelId}`);
    
    // Get the entity
    const entity = await client.getEntity(mainChannelId);
    
    // Get forum topics
    const forumTopics = await client.invoke(new Api.channels.GetForumTopics({
      channel: entity,
      limit: 100
    }));
    
    logger.info(`Retrieved ${forumTopics.topics.length} topics from supergroup ${channelId}`);
    
    return forumTopics.topics.map(topic => ({
      id: topic.id,
      title: topic.title,
      iconColor: topic.iconColor,
      topicId: `${mainChannelId}/${topic.id}`
    }));
  } catch (error) {
    logger.error(`Error fetching channel topics: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Forward a processed message with media to all destination channels
 * @param {Object} messageData Message data with media info
 * @param {boolean} isPnlMessage Whether this is a PNL message
 * @returns {Promise<Object>} Forward result object
 */
async function forwardProcessedMessage(messageData, isPnlMessage = false) {
  // Create a text-only message with a note about media
  const text = messageData.formattedText || messageData.text || '';
  const textWithNote = messageData.hasMedia 
    ? `${text}\n\n[Media attachment not forwarded - media handling disabled]` 
    : text;
  
  // Use the regular text forwarding
  return await forwardMessage(textWithNote, messageData.destinationChannels, isPnlMessage);
}

module.exports = {
  sendMessage,
  forwardMessage,
  forwardProcessedMessage,
  initializeSender,
  reinitializeClient,
  isClientHealthy,
  sendPing,
  testDisconnection,
  // New exports for PNL Bot
  getTelegramClient,
  getChannelMessages,
  getChannelInfo,
  getChannelTopics
};