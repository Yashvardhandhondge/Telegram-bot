const { TelegramClient } = require('telegram');
const { NewMessage } = require('telegram/events');
const { initializeClient } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');
const { enqueueMessage } = require('../utils/queue');

// Global variables
let telegramClient;
const channelMapping = config.loadChannelMapping();
logger.info(`Loaded mapping for ${Object.keys(channelMapping).length} users`);

/**
 * Initialize the Telegram client and start listening for messages
 */
async function initializeListener() {
  try {
    // Initialize Telegram client
    telegramClient = await initializeClient();
    logger.info('Telegram client initialized');
    
    // Start listening for new messages
    await startMessageListener();
    
    // Log success
    logger.info('Telegram message listener started successfully');
  } catch (error) {
    logger.error(`Failed to initialize Telegram listener: ${error.message}`, { error });
    process.exit(1);
  }
}

/**
 * Start listening for new messages
 */
async function startMessageListener() {
  try {
    logger.info('Starting to listen for new messages');
    
    // Create a list of all source chat IDs to monitor
    const sourceChatIds = [];
    for (const user in channelMapping) {
      sourceChatIds.push(...Object.keys(channelMapping[user]));
    }
    logger.info(`Monitoring ${sourceChatIds.length} source channels/groups`);
    
    // Add event handler for new messages - using correct import
    telegramClient.addEventHandler(handleNewMessage, new NewMessage({}));
    
    // Log connected chats for verification
    await logConnectedChats();
  } catch (error) {
    logger.error(`Error starting message listener: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Log all connected chats for verification
 */
async function logConnectedChats() {
  try {
    logger.info('Fetching connected dialogs...');
    
    const dialogs = await telegramClient.getDialogs({});
    logger.info(`Connected to ${dialogs.length} dialogs`);
    
    // Log the first 10 dialogs for verification
    const dialogSample = dialogs.slice(0, 10);
    for (const dialog of dialogSample) {
      const entity = dialog.entity;
      const id = entity.id.toString();
      const title = entity.title || 'Private Chat';
      const type = entity.className || 'Unknown';
      
      logger.info(`Dialog: ${title} (ID: ${id}, Type: ${type})`);
    }
  } catch (error) {
    logger.error(`Error fetching dialogs: ${error.message}`, { error });
  }
}

/**
 * Handle new incoming messages
 * @param {Object} event Telegram event object
 */
async function handleNewMessage(event) {
  try {
    const message = event.message;
    
    // Skip messages without text
    if (!message.text) return;
    
    // Get chat ID
    let chatId;
    if (message.peerId.channelId) {
      chatId = message.peerId.channelId.toString();
    } else if (message.peerId.chatId) {
      chatId = message.peerId.chatId.toString();
    } else if (message.peerId.userId) {
      chatId = message.peerId.userId.toString();
    } else {
      // Try to get ID directly from peer
      chatId = message.peerId.toString();
    }
    
    // Handle thread case
    if (message.replyTo && message.replyTo.replyToMsgId) {
      chatId = `${chatId}/${message.replyTo.replyToMsgId}`;
    }
    
    // Debug log the message
    logger.debug(`Received message: ${JSON.stringify({
      text: message.text.substring(0, 100) + (message.text.length > 100 ? '...' : ''),
      chatId,
      messageId: message.id
    })}`);
    
    // Check if this chat is in our mapping
    if (isChatInMapping(chatId)) {
      logger.info(`Received message from chat ${chatId}`);
      
      // Get message info
      const sender = message.sender ? (message.sender.username || message.sender.id) : 'Unknown';
      
      // Prepare message data for processing
      const messageData = {
        messageId: message.id.toString(),
        chatId: chatId,
        text: message.text,
        senderId: message.fromId ? message.fromId.toString() : null,
        senderUsername: sender,
        date: new Date(message.date * 1000).toISOString(),
        destinationChannels: getDestinationChannels(chatId),
      };
      
      // Enqueue message for processing
      await enqueueMessage(messageData);
    } else {
      logger.debug(`Message from unmapped chat ${chatId}`);
    }
  } catch (error) {
    logger.error(`Error handling message: ${error.message}`, { error });
  }
}

/**
 * Check if a chat is in our mapping
 * @param {string} chatId Chat ID to check
 * @returns {boolean} True if chat is in mapping, false otherwise
 */
function isChatInMapping(chatId) {
  for (const user in channelMapping) {
    if (Object.keys(channelMapping[user]).includes(chatId)) {
      return true;
    }
  }
  return false;
}

/**
 * Get destination channels for a source chat
 * @param {string} sourceChatId Source chat ID
 * @returns {string[]} Array of destination channel IDs
 */
function getDestinationChannels(sourceChatId) {
  for (const user in channelMapping) {
    if (sourceChatId in channelMapping[user]) {
      return channelMapping[user][sourceChatId];
    }
  }
  return [];
}

// Start the listener when this module is loaded
(async () => {
  try {
    await initializeListener();
  } catch (error) {
    logger.error(`Failed to start listener: ${error.message}`, { error });
    process.exit(1);
  }
})();

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down Telegram listener');
  if (telegramClient) {
    await telegramClient.disconnect();
  }
  process.exit(0);
});

// Handle SIGINT for graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down Telegram listener');
  if (telegramClient) {
    await telegramClient.disconnect();
  }
  process.exit(0);
});

module.exports = {
  telegramClient,
  initializeListener,
};