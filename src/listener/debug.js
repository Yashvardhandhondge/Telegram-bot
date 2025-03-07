const { TelegramClient } = require('telegram');
const { NewMessage } = require('telegram/events');
const { initializeClient } = require('../utils/telegramAuth');
const config = require('../config');
const logger = require('../utils/logger');

async function startDebugListener() {
  try {
    logger.info('Starting debug listener to identify channel IDs');
    
    // Initialize and connect to Telegram
    const client = await initializeClient();
    
    // Ensure connection
    if (!client.connected) {
      await client.connect();
    }
    
    // Get all dialogs
    const dialogs = await client.getDialogs({});
    logger.info(`Found ${dialogs.length} dialogs`);
    
    // Log all dialog information (source channels/groups)
    for (const dialog of dialogs) {
      try {
        const entity = dialog.entity;
        
        // Only log channels, chats and groups (not users)
        if (entity.className === 'Channel' || entity.className === 'Chat' || entity.className === 'Supergroup') {
          const id = entity.id;
          const title = entity.title || 'Untitled';
          const megagroup = entity.megagroup || false;
          const username = entity.username || 'No username';
          
          logger.info(`Channel/Group: ${title} (ID: ${id}, Type: ${entity.className}, Megagroup: ${megagroup}, Username: @${username})`);
        }
      } catch (error) {
        logger.error(`Error processing dialog: ${error.message}`);
      }
    }
    
    // Setup handler to log all new messages with their chat IDs
    client.addEventHandler(async (event) => {
      try {
        const message = event.message;
        if (!message || !message.text) return;
        
        // Get peer ID details
        let rawChatId = '';
        let formattedChatId = '';
        
        if (message.peerId) {
          if (message.peerId.channelId) {
            rawChatId = message.peerId.channelId;
            formattedChatId = `-100${message.peerId.channelId}`;
          } else if (message.peerId.chatId) {
            rawChatId = message.peerId.chatId;
            formattedChatId = `-${message.peerId.chatId}`;
          } else if (message.peerId.userId) {
            rawChatId = message.peerId.userId;
            formattedChatId = `${message.peerId.userId}`;
          }
        }
        
        // Get thread ID if available
        let threadId = '';
        if (message.replyTo && message.replyTo.replyToMsgId) {
          threadId = message.replyTo.replyToMsgId;
        } else if (message.groupedId) {
          threadId = message.groupedId;
        }
        
        // Log the message with detailed ID information
        logger.info(`DEBUG: Message from ${formattedChatId} ${threadId ? `(Thread: ${threadId})` : ''}`);
        logger.info(`DEBUG: Raw peer ID info: ${JSON.stringify(message.peerId)}`);
        logger.info(`DEBUG: Message text: ${message.text.substring(0, 50)}...`);
        logger.info(`DEBUG: Channel mapping values: ${JSON.stringify(Object.keys(config.loadChannelMapping()['@user1']))}`);
        
        // Get the full entity to log more details
        try {
          const entity = await client.getEntity(message.peerId);
          logger.info(`DEBUG: Entity info: ${JSON.stringify({
            id: entity.id,
            className: entity.className,
            title: entity.title
          })}`);
        } catch (e) {
          logger.error(`DEBUG: Could not get entity: ${e.message}`);
        }
      } catch (error) {
        logger.error(`Error in debug handler: ${error.message}`);
      }
    }, new NewMessage({}));
    
    logger.info('Debug listener started. Waiting for messages to identify channel IDs...');
    logger.info('Press Ctrl+C to stop');
    
  } catch (error) {
    logger.error(`Error starting debug listener: ${error.message}`);
  }
}

// Start the debug listener
startDebugListener();