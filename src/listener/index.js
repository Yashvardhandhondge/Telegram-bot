const { TelegramClient } = require('telegram');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram');
const { initializeClient, sendPing } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');
const { enqueueMessage } = require('../utils/queue');
const { findMatchingKey } = require('../utils/chatIdMapper');

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

    // Ensure client is connected before continuing
    if (!telegramClient.connected) {
      logger.info('Connecting to Telegram...');
      await telegramClient.connect();
      logger.info('Connected to Telegram');
    }

    // Verify connection with a ping
    try {
      await sendPing(telegramClient);
    } catch (error) {
      logger.error(`Ping failed: ${error.message}`);
      // Continue anyway, we'll try to recover
    }

    // Start listening for new messages
    await startMessageListener();

    // Log success
    logger.info('Telegram message listener started successfully');
  } catch (error) {
    logger.error(`Failed to initialize Telegram listener: ${error.message}`, { error });
    
    // Instead of exiting, try to restart after a delay
    logger.info('Will retry initialization in 30 seconds...');
    setTimeout(initializeListener, 30000);
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

    // Add event handler for new messages
    telegramClient.addEventHandler(handleNewMessage, new NewMessage({}));
    logger.info('Message handler added');

    // Set up a periodic connection check and handler re-registration
    setInterval(async () => {
      try {
        if (!telegramClient.connected) {
          logger.warn('Periodic check: Client disconnected, attempting to reconnect...');
          await telegramClient.connect();
          logger.info('Reconnected successfully');
          
          // Re-add the message handler
          telegramClient.addEventHandler(handleNewMessage, new NewMessage({}));
          logger.info('Re-registered message handler after reconnection');
        } else {
          // Send a ping to verify the connection is healthy
          const pingSuccess = await sendPing(telegramClient);
          if (!pingSuccess) {
            logger.warn('Ping failed, connection may be unhealthy, attempting to reconnect...');
            try {
              await telegramClient.disconnect();
            } catch (e) {
              // Ignore disconnection errors
            }
            
            await telegramClient.connect();
            
            // Re-add the event handler
            telegramClient.addEventHandler(handleNewMessage, new NewMessage({}));
            logger.info('Re-registered message handler after reconnection');
          }
        }
      } catch (error) {
        logger.error(`Error in periodic connection check: ${error.message}`, { error });
        
        // Try to recover from serious errors
        try {
          logger.info('Attempting connection recovery...');
          if (telegramClient) {
            try {
              await telegramClient.disconnect();
            } catch (e) {
              // Ignore
            }
          }
          
          // Re-initialize the client
          telegramClient = await initializeClient();
          await telegramClient.connect();
          
          // Re-add event handler
          telegramClient.addEventHandler(handleNewMessage, new NewMessage({}));
          logger.info('Connection recovery successful');
        } catch (recoveryError) {
          logger.error(`Connection recovery failed: ${recoveryError.message}`);
        }
      }
    }, 60000); // Check every minute

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

    // Make sure client is connected
    if (!telegramClient.connected) {
      logger.info('Reconnecting to Telegram before fetching dialogs...');
      await telegramClient.connect();
    }

    // Try with increased timeout
    const dialogs = await Promise.race([
      telegramClient.getDialogs({}),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout fetching dialogs')), 30000)
      )
    ]);
    
    logger.info(`Connected to ${dialogs.length} dialogs`);

    // Log the first 10 dialogs for verification
    const dialogSample = dialogs.slice(0, Math.min(10, dialogs.length));
    for (const dialog of dialogSample) {
      try {
        const entity = dialog.entity;
        const id = entity.id ? entity.id.toString() : 'unknown';
        const title = entity.title || 'Private Chat';
        const type = entity.className || 'Unknown';

        logger.info(`Dialog: ${title} (ID: ${id}, Type: ${type})`);
      } catch (error) {
        logger.error(`Error processing dialog: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error fetching dialogs: ${error.message}`, { error });
    logger.warn('Continuing without dialog information');
    
    // Try to reconnect since dialog fetching failed
    try {
      logger.info('Attempting to reconnect after dialog fetch failure...');
      if (telegramClient.connected) {
        await telegramClient.disconnect();
      }
      await telegramClient.connect();
      logger.info('Reconnected successfully after dialog fetch failure');
    } catch (reconnectError) {
      logger.error(`Failed to reconnect after dialog failure: ${reconnectError.message}`);
    }
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
    if (!message.text) {
      // Note: We're ignoring media messages for now
      if (message.media) {
        logger.debug("Ignoring message with media but no text (media handling disabled)");
      }
      return;
    }

    // Debug log raw message structure (just first level keys to avoid huge logs)
    const messageKeys = Object.keys(message);
    logger.debug(`Message received with keys: ${messageKeys.join(', ')}`);

    // Get chat ID - corrected for the actual message format
    let chatId;

    // Try various ways to get the chat ID based on the actual message structure
    if (message.peerId && typeof message.peerId === 'object') {
      // For newer Telegram client versions
      if (message.peerId.channelId) {
        chatId = `${message.peerId.channelId.toString()}`;
      } else if (message.peerId.chatId) {
        chatId = `${message.peerId.chatId.toString()}`;
      } else if (message.peerId.userId) {
        chatId = message.peerId.userId.toString();
      }
    } else if (message.chatId) {
      // Direct chat ID if available
      chatId = message.chatId.toString();
    } else if (message.chat && message.chat.id) {
      // Another possible format
      chatId = message.chat.id.toString();
    }

    // Handle thread case if applicable
    if (message.groupedId || (message.replyTo && message.replyTo.replyToMsgId)) {
      const threadId = message.groupedId || message.replyTo.replyToMsgId;
      // Some channel formats might already include the thread ID
      if (!chatId.includes('/')) {
        chatId = `${chatId}/${threadId}`;
      }
    }

    if (!chatId) {
      logger.warn(`Could not determine chat ID for message: ${message.text.substring(0, 100)}`);
      return;
    }

    // Log normalized formats for debugging
    const { normalizeChannelId } = require('../utils/chatIdMapper');
    const normalizedFormats = normalizeChannelId(chatId);
    logger.debug(`Normalized formats for chat ID ${chatId}: ${JSON.stringify(normalizedFormats)}`);

    // Check mapping using findMatchingKey
    const matchedKey = findMatchingKey(channelMapping['@user1'], chatId);
    if (matchedKey) {
      logger.info(`Matched key for chat ${chatId} is ${matchedKey}`);
    } else {
      logger.warn(`No matching key found for chat ${chatId} with normalized formats ${JSON.stringify(normalizedFormats)}`);
    }

    // Debug log the processed message
    logger.debug(
      `Processed message from ${chatId}: ${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}`
    );

    // Debug log available mappings
    logger.debug(`Available mappings: ${JSON.stringify(Object.keys(channelMapping['@user1']))}`);
    
    // Check if this chat is in our mapping
    if (isChatInMapping(chatId)) {
      logger.info(`Received message from chat ${chatId}: ${message.text.substring(0, 30)}...`);

      // Get message info
      const sender = message.sender ? message.sender.username || message.sender.id : 'Unknown';

      // Check for media, but we won't process it - just log its presence
      const hasMedia = !!message.media;
      if (hasMedia) {
        logger.info(`Message has media, but media handling is disabled. Message will be processed as text-only.`);
      }

      // Prepare message data for processing
      const messageData = {
        messageId: message.id.toString(),
        chatId: chatId,
        text: message.text,
        senderId: message.fromId ? message.fromId.toString() : null,
        senderUsername: sender,
        date: new Date(message.date * 1000).toISOString(),
        destinationChannels: getDestinationChannels(chatId),
        // Add media flag, but it won't be processed
        hasMedia: hasMedia
      };

      // Enqueue message for processing
      await enqueueMessage(messageData);
    } else {
      // Log some useful information for debugging mapping issues
      logger.debug(`Message from unmapped chat ${chatId} (not in our mapping)`);
      if (config.logging.level === 'debug') {
        logger.debug(`Available mappings: ${JSON.stringify(channelMapping)}`);
      }
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
  try {
    for (const user in channelMapping) {
      const matchedKey = findMatchingKey(channelMapping[user], chatId);
      if (matchedKey) {
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error(`Error checking chat mapping: ${error.message}`, { error });
    return false;
  }
}

/**
 * Get destination channels for a source chat
 * @param {string} sourceChatId Source chat ID
 * @returns {string[]} Array of destination channel IDs
 */
function getDestinationChannels(sourceChatId) {
  try {
    let destinationChannels = [];
    for (const user in channelMapping) {
      const matchedKey = findMatchingKey(channelMapping[user], sourceChatId);
      if (matchedKey) {
        destinationChannels = destinationChannels.concat(channelMapping[user][matchedKey]);
      }
    }
    // Remove duplicates
    destinationChannels = Array.from(new Set(destinationChannels));
    if (destinationChannels.length === 0) {
      logger.warn(`No destination channels found for source chat ID ${sourceChatId}`);
    } else {
      logger.debug(`For source chat ID ${sourceChatId}, destination channels: ${JSON.stringify(destinationChannels)}`);
    }
    return destinationChannels;
  } catch (error) {
    logger.error(`Error getting destination channels: ${error.message}`, { error });
    return [];
  }
}

// Start the listener when this module is loaded
(async () => {
  try {
    await initializeListener();
  } catch (error) {
    logger.error(`Failed to start listener: ${error.message}`, { error });
    
    // Instead of exiting, retry after a delay
    logger.info('Retrying listener initialization in 30 seconds...');
    setTimeout(initializeListener, 30000);
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

// Handle uncaught exceptions for better stability
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`, { error });
  logger.info('Continuing despite uncaught exception');
});

// Handle unhandled promise rejections for better stability
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}, reason: ${reason}`);
  logger.info('Continuing despite unhandled rejection');
});

module.exports = {
  telegramClient,
  initializeListener,
};