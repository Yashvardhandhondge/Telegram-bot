
const { NewMessage } = require('telegram/events');
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

    // Make sure client is connected
    if (!telegramClient.connected) {
      logger.info('Reconnecting to Telegram before fetching dialogs...');
      await telegramClient.connect();
    }

    // Try with increased timeout
    const dialogs = await Promise.race([
      telegramClient.getDialogs({}),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout fetching dialogs')), 20000)
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
    // Don't throw error, let the listener start anyway
  }
}

/**
 * Handle new incoming messages
 * @param {Object} event Telegram event object
 */
async function handleNewMessage(event) {
  try {
    const message = event.message;

    // Skip messages without text or media
    if (!message.text && !message.media) {
      logger.debug("Skipping message with no text and no media");
      return;
    }

    // Debug log raw message with sanitization to prevent huge logs
    const messageCopy = JSON.parse(JSON.stringify(message));
    logger.debug(`Message received: ${JSON.stringify(messageCopy)}`);
    // Remove very large or sensitive properties
    if (messageCopy.media && messageCopy.media.photo && messageCopy.media.photo.sizes) {
      messageCopy.media.photo.sizes = `[${messageCopy.media.photo.sizes.length} sizes available]`;
    }
    if (messageCopy.media && messageCopy.media.photo && messageCopy.media.photo.fileReference) {
      messageCopy.media.photo.fileReference = '[file reference available]';
    }
    logger.debug(`Message received: ${JSON.stringify(messageCopy, null, 2).substring(0, 1000)}...`);
    
    // Log media type if present
    if (message.media) {
      logger.info(`Message has media of type: ${message.media.className}`);
    }

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
      logger.warn(`Could not determine chat ID for message: ${message.text ? message.text.substring(0, 100) : '[No text]'}`);
      return;
    }

    // Check if this chat is in our mapping
    if (isChatInMapping(chatId)) {
      logger.info(`Received message from chat ${chatId}: ${message.text ? message.text.substring(0, 30) + '...' : '[Media message]'}`);

      // Get message info
      const sender = message.sender ? message.sender.username || message.sender.id : 'Unknown';

      // Check for media information
      const hasMedia = !!message.media;
      const mediaType = hasMedia ? message.media.className : null;
      
      // Extract sender ID in a robust way
      let senderId = null;
      if (message.fromId) {
        if (typeof message.fromId === 'object') {
          if (message.fromId.userId) senderId = message.fromId.userId.toString();
          else if (message.fromId.channelId) senderId = message.fromId.channelId.toString();
          else if (message.fromId.chatId) senderId = message.fromId.chatId.toString();
        } else {
          senderId = message.fromId.toString();
        }
      }

      // Get message raw data for forwarding with media
      const rawMessage = {
        id: message.id,
        fromChat: chatId
      };

      // Prepare source information for media forwarding
      // This is the critical part - ensure we have correct chat ID and message ID
      const sourceInfo = {
        messageId: message.id,
        chatId: chatId,
        peerId: message.peerId,
        hasPhoto: hasMedia && mediaType === 'MessageMediaPhoto',
        hasDocument: hasMedia && mediaType === 'MessageMediaDocument',
        hasVideo: hasMedia && (mediaType === 'MessageMediaVideo' || 
                              (mediaType === 'MessageMediaDocument' && 
                               message.media.document && 
                               message.media.document.mimeType && 
                               message.media.document.mimeType.startsWith('video/')))
      };

      // Prepare message data for processing
      const messageData = {
        messageId: message.id.toString(),
        chatId: chatId,
        text: message.text || '',
        senderId: senderId,
        senderUsername: sender,
        date: new Date(message.date * 1000).toISOString(),
        destinationChannels: getDestinationChannels(chatId),
        // Add media information
        hasMedia: hasMedia,
        mediaType: mediaType,
        sourceInfo: sourceInfo,
        rawMessage: hasMedia ? JSON.stringify(rawMessage) : null
      };

      // Log more details for media messages
      if (hasMedia) {
        logger.info(`Media message detected: Type=${mediaType}, MessageID=${message.id}, ChatID=${chatId}`);
        
        // Log specific media details for debugging
        if (mediaType === 'MessageMediaPhoto' && message.media.photo) {
          logger.debug(`Photo details: ${JSON.stringify({
            id: message.media.photo.id,
            sizes: message.media.photo.sizes ? message.media.photo.sizes.length : 0,
            dcId: message.media.photo.dcId
          })}`);
        } else if (mediaType === 'MessageMediaDocument' && message.media.document) {
          logger.debug(`Document details: ${JSON.stringify({
            id: message.media.document.id,
            mimeType: message.media.document.mimeType,
            size: message.media.document.size
          })}`);
        }
      }

      // Enqueue message for processing
      await enqueueMessage(messageData);
    } else {
      // Log some useful information for debugging mapping issues
      logger.debug(`Message from unmapped chat ${chatId} (not in our mapping)`);
      if (config.logging.level === 'debug') {
        logger.debug(`Available mappings: ${JSON.stringify(Object.keys(channelMapping['@user1']))}`);
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