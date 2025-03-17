const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const config = require('../config');
const logger = require('../utils/logger');
const axios = require('axios');

// Global Telegram client instance
let telegramClient;

// Get Telegram Bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;

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
 * Initialize Telegram client with existing session or new authentication
 * @returns {Promise<TelegramClient>} Authenticated Telegram client
 */
async function initializeClient() {
  try {
    const stringSession = new StringSession(config.telegram.sessionString || '');
    
    const client = new TelegramClient(
      stringSession,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 10,
        shouldReconnect: true,
        useWSS: false,
        timeout: 30000, // Increase timeout to 30 seconds
        retryDelay: 1000 // Delay between connection retries
      }
    );
    
    // If we have a session string, try to connect directly
    if (config.telegram.sessionString) {
      try {
        logger.info('Connecting to Telegram with existing session...');
        await client.connect();
        
        // Verify connection by getting self info
        const me = await client.getMe();
        logger.info(`Connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
        
        // Check if we're still authenticated
        if (await client.checkAuthorization()) {
          logger.info('Successfully connected to Telegram using existing session');
        } else {
          // If not authorized, handle session expiration
          logger.error('Session expired, cannot continue without valid session');
          throw new Error('Session expired');
        }
      } catch (error) {
        logger.error(`Error connecting with existing session: ${error.message}`, { error });
        throw error;
      }
    } else {
      // No session string provided
      logger.error('No session string provided, cannot initialize client');
      throw new Error('No session string provided');
    }
    
    // Add connection maintenance handler
    setInterval(async () => {
      try {
        if (client.connected) {
          await sendPing(client);
        } else {
          logger.warn('Client disconnected, attempting to reconnect...');
          await client.connect();
          logger.info('Reconnected successfully');
        }
      } catch (error) {
        logger.error(`Error in keep-alive ping: ${error.message}`, { error });
      }
    }, 60000); // Every minute
    
    return client;
  } catch (error) {
    logger.error(`Failed to initialize Telegram client: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Send a ping to verify the connection
 * @param {TelegramClient} client Telegram client
 * @returns {Promise<boolean>} True if ping successful
 */
async function sendPing(client) {
  try {
    if (!client.connected) {
      return false;
    }
    
    // Use the correct API for pinging
    const result = await client.invoke(new Api.Ping({
      pingId: BigInt(Math.floor(Math.random() * 1000000000))
    }));
    
    logger.debug('Ping successful');
    return true;
  } catch (error) {
    logger.error(`Ping failed: ${error.message}`);
    return false;
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
 * @returns {Promise<boolean>} True if message was sent successfully, false otherwise
 */
async function sendMessage(chatId, text) {
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
    logger.debug(`Sending message to chat ${targetChatId} via Bot API`);
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, params);
    
    if (response.data && response.data.ok) {
      logger.info(`✅ Successfully sent message to chat ${targetChatId} via Bot API`);
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
 * @returns {Promise<Object>} Object with success and failure counts
 */
async function forwardMessage(messageData, destinationChannels) {
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
        success = await sendMessage(channelId, text);
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
 * @returns {Promise<TelegramClient>} Reinitialized client
 */
async function reinitializeClient() {
  try {
    // Clean up existing client if any
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
    const stringSession = new StringSession(config.telegram.sessionString || '');
    
    const newClient = new TelegramClient(
      stringSession,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 5,
        useWSS: false,
        shouldReconnect: true,
        timeout: 60000 // 60 second timeout
      }
    );
    
    // Connect the client
    await newClient.connect();
    
    // Verify connection
    const me = await newClient.getMe();
    logger.info(`Reinitialized client connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
    
    // Update global client reference
    telegramClient = newClient;
    
    logger.info('Telegram client reinitialized successfully');
    return telegramClient;
  } catch (error) {
    logger.error(`Failed to reinitialize client: ${error.message}`);
    throw error;
  }
}

/**
 * Test function to manually trigger a disconnection
 * @returns {Promise<boolean>} True if client was disconnected
 */
async function testDisconnection() {
  logger.info('Manually triggering disconnection for testing...');
  if (telegramClient && telegramClient.connected) {
    await telegramClient.disconnect();
    logger.info('Client manually disconnected for testing');
    return true;
  }
  return false;
}

// Keep the media handling code but don't use it
// This will be maintained for future reference

/**
 * Download media from a message
 * This function is kept for future reference but is not used in the current implementation
 */
async function downloadMedia(messageData) {
  logger.info('Media download functionality is disabled');
  return null;
}

/**
 * Send a media message with the appropriate method based on file type
 * This function is kept for future reference but is not used in the current implementation
 */
async function sendMedia(chatId, mediaPath, mediaType, caption = '') {
  logger.info('Media sending functionality is disabled');
  return false;
}

/**
 * Forward a processed message with media to all destination channels
 * This function is kept for future reference but is not used in the current implementation
 */
async function forwardProcessedMessage(messageData) {
  logger.info('Media forwarding functionality is disabled, using text-only forwarding');
  
  // Create a text-only message with a note about media
  const text = messageData.formattedText || messageData.text || '';
  const textWithNote = messageData.hasMedia 
    ? `${text}\n\n[Media attachment not forwarded - media handling disabled]` 
    : text;
  
  // Use the regular text forwarding
  return await forwardMessage(textWithNote, messageData.destinationChannels);
}

// ----- NEW FUNCTIONS FOR PNL BOT (ADDED, NOT MODIFIED) -----

/**
 * Get the Telegram client instance
 * @returns {Object|null} Telegram client instance or null if not initialized
 */
function getTelegramClient() {
  return telegramClient;
}

/**
 * Fetch messages from a channel
 * @param {string} channelId Channel ID to fetch messages from
 * @param {number} limit Maximum number of messages to fetch
 * @returns {Promise<Array>} Array of message objects
 */
async function getChannelMessages(channelId, limit = 100) {
  try {
    // Ensure client is initialized
    const client = await initializeSender();
    
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
 * @returns {Promise<Object>} Channel info object
 */
async function getChannelInfo(channelId) {
  try {
    // Ensure client is initialized
    const client = await initializeSender();
    
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
 * @returns {Promise<Array>} Array of topic objects
 */
async function getChannelTopics(channelId) {
  try {
    // Ensure client is initialized
    const client = await initializeSender();
    
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

module.exports = {
  sendMessage,
  sendMedia,
  forwardMessage,
  forwardProcessedMessage,
  downloadMedia,
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