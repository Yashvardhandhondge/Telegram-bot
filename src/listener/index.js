const { TelegramClient } = require('telegram');
const { NewMessage } = require('telegram/events');
const { initializeClient, sendPing } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');
const { enqueueMessage } = require('../utils/queue');
const { normalizeChannelId } = require('../utils/chatIdMapper');

// Global variables
let telegramClient;
const channelMapping = config.loadChannelMapping();
logger.info(`Loaded mapping for ${Object.keys(channelMapping).length} users`);

// Track processed messages to avoid duplicates
const processedMessages = new Set();
const MAX_PROCESSED_CACHE = 1000; // Maximum number of message IDs to cache

/**
 * Initialize the Telegram client and start polling for messages
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
      logger.info('Ping successful');
    } catch (error) {
      logger.error(`Ping failed: ${error.message}`);
      // Continue anyway, we'll try to recover
    }

    // Still register event handler as backup
    telegramClient.addEventHandler(async (event) => {
      if (event.message && event.message.text) {
        await handleMessage(event.message);
      }
    }, new NewMessage({}));
    
    logger.info('Event handler registered as backup');

    // Start polling mechanism
    startPolling();
    
    // Start connection maintenance
    startConnectionMaintenance();
    
    logger.info('Telegram message listener started successfully');
  } catch (error) {
    logger.error(`Failed to initialize Telegram listener: ${error.message}`, { error });
    process.exit(1);
  }
}

/**
 * Start polling for new messages
 */
function startPolling() {
  // Use a list of all source chats from the mapping
  const sourceChats = new Set();
  
  for (const user in channelMapping) {
    Object.keys(channelMapping[user]).forEach(key => {
      // Format properly for Telegram API
      const cleanKey = key.toString().replace(/^-/, '');
      if (parseInt(cleanKey) > 100) {
        // Group/channel IDs usually need a minus prefix
        sourceChats.add(`-${cleanKey}`);
      } else {
        sourceChats.add(cleanKey);
      }
    });
  }
  
  logger.info(`Will poll ${sourceChats.size} source chats: ${JSON.stringify(Array.from(sourceChats))}`);
  
  // Start polling each source chat
  const pollInterval = setInterval(async () => {
    try {
      if (!telegramClient || !telegramClient.connected) {
        logger.warn('Client not connected, skipping poll');
        return;
      }
      
      for (const chatId of sourceChats) {
        try {
          await pollChat(chatId);
        } catch (error) {
          logger.error(`Error polling chat ${chatId}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error in poll interval: ${error.message}`);
    }
  }, 5000); // Poll every 5 seconds
  
  // Clean up on exit
  process.on('exit', () => {
    clearInterval(pollInterval);
  });
}

/**
 * Poll a chat for new messages
 * @param {string} chatId Chat ID to poll
 */
async function pollChat(chatId) {
  try {
    // Get latest messages from this chat
    const messages = await telegramClient.getMessages(chatId, {
      limit: 5 // Get latest 5 messages
    });
    
    if (!messages || messages.length === 0) {
      return;
    }
    
    // Process each message (newest first)
    for (const message of messages) {
      try {
        // Skip messages without text or already processed
        if (!message || !message.text || processedMessages.has(message.id.toString())) {
          continue;
        }
        
        // Handle this message
        await handleMessage(message);
        
        // Mark as processed
        processedMessages.add(message.id.toString());
        
        // Clean up processed messages cache if needed
        if (processedMessages.size > MAX_PROCESSED_CACHE) {
          const toRemove = Array.from(processedMessages).slice(0, 100);
          toRemove.forEach(msgId => processedMessages.delete(msgId));
        }
      } catch (messageError) {
        logger.error(`Error handling polled message: ${messageError.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error polling chat ${chatId}: ${error.message}`);
  }
}

/**
 * Handle a message from Telegram
 * @param {Object} message Telegram message object
 */
async function handleMessage(message) {
  try {
    // Skip if already processed
    if (processedMessages.has(message.id.toString())) {
      return;
    }
    
    logger.info(`📨 Processing message ${message.id}`);
    
    // Extract chat ID
    let chatId = null;
    
    // Try to get chat ID from peer info
    if (message.peerId) {
      if (message.peerId.channelId) {
        chatId = message.peerId.channelId.toString();
      } else if (message.peerId.chatId) {
        chatId = message.peerId.chatId.toString();
      } else if (message.peerId.userId) {
        chatId = message.peerId.userId.toString();
      }
    }
    
    // If we couldn't get from peerId, try getting from chat
    if (!chatId && message.chat && message.chat.id) {
      chatId = message.chat.id.toString();
    }
    
    if (!chatId) {
      logger.warn(`Could not determine chat ID for message ${message.id}`);
      return;
    }
    
    logger.info(`📝 Message ${message.id} from chat ${chatId}`);
    
    // Generate normalized formats for matching
    const normalizedFormats = normalizeChannelId(chatId);
    
    // Match against our mapping
    let destinationChannels = [];
    let foundMatch = false;
    
    for (const user in channelMapping) {
      // Try each format against this user's mapping
      for (const format of normalizedFormats) {
        if (format in channelMapping[user]) {
          foundMatch = true;
          const destinations = channelMapping[user][format];
          logger.info(`✅ Match found in user ${user} with key ${format}`);
          
          if (Array.isArray(destinations)) {
            destinationChannels = destinationChannels.concat(destinations);
          }
        }
      }
    }
    
    // Remove duplicates
    destinationChannels = [...new Set(destinationChannels)];
    
    if (!foundMatch || destinationChannels.length === 0) {
      logger.info(`❌ No destination channels found for chat ${chatId}`);
      return;
    }
    
    logger.info(`🎯 Found ${destinationChannels.length} destination channels: ${JSON.stringify(destinationChannels)}`);
    
    // Format destination channels (ensure they have correct prefix)
    const formattedDestinations = destinationChannels.map(dest => {
      const cleanDest = dest.toString().replace(/^-/, '');
      return parseInt(cleanDest) > 100 ? `-${cleanDest}` : cleanDest;
    });
    
    // Prepare message data
    const messageData = {
      messageId: message.id.toString(),
      chatId: chatId,
      text: message.text,
      senderId: message.fromId ? message.fromId.toString() : null,
      senderUsername: message.sender ? message.sender.username || message.sender.id : 'Unknown',
      date: new Date(message.date * 1000).toISOString(),
      destinationChannels: formattedDestinations,
    };
    
    // Process the message and don't wait for it to complete
    logger.info(`⚙️ Enqueueing message ${message.id} for processing`);
    enqueueMessage(messageData)
      .then(result => {
        logger.info(`✅ Enqueue result for message ${message.id}: ${JSON.stringify(result)}`);
        
        // Mark as processed to avoid duplicates
        processedMessages.add(message.id.toString());
      })
      .catch(error => {
        logger.error(`❌ Error enqueueing message ${message.id}: ${error.message}`);
      });
  } catch (error) {
    logger.error(`Error handling message: ${error.message}`, { error });
  }
}

/**
 * Start connection maintenance with periodic pings and reconnection
 */
function startConnectionMaintenance() {
  // Set up ping interval (every 30 seconds)
  const pingInterval = setInterval(async () => {
    try {
      if (!telegramClient) {
        logger.warn('Telegram client not initialized');
        return;
      }
      
      if (!telegramClient.connected) {
        logger.warn('Client disconnected, attempting to reconnect...');
        try {
          await telegramClient.connect();
          logger.info('Reconnected successfully');
        } catch (connectError) {
          logger.error(`Failed to reconnect: ${connectError.message}`);
        }
      }
      
      try {
        await sendPing(telegramClient);
        logger.debug('Ping successful');
      } catch (pingError) {
        logger.error(`Ping failed: ${pingError.message}`);
      }
    } catch (error) {
      logger.error(`Error in ping interval: ${error.message}`);
    }
  }, 30000);
  
  // Clean up interval on process exit
  process.on('exit', () => {
    clearInterval(pingInterval);
  });
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