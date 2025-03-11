const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { initializeClient } = require('../utils/telegramAuth');
const { Api } = require('telegram');
const logger = require('../utils/logger');
const FormData = require('form-data');

// Get Telegram Bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Global Telegram client instance for downloading media
let telegramClient;

// Create temporary directory for media downloads if it doesn't exist
const tempDir = path.join(__dirname, '..', '..', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Initialize the Telegram client for downloading media
 * @returns {Promise<Object>} Telegram client instance
 */
async function initializeSender() {
  try {
    // Initialize Telegram client if not already initialized
    if (!telegramClient) {
      telegramClient = await initializeClient();
      logger.info('Telegram client initialized for media downloads');
      
      // Ensure client is connected
      if (!telegramClient.connected) {
        logger.info('Connecting telegram client...');
        await telegramClient.connect();
        logger.info('Telegram client connected');
      }
    }
    
    return telegramClient;
  } catch (error) {
    logger.error(`Failed to initialize Telegram client: ${error.message}`, { error });
    throw error;
  }
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
 * Send a text message to a Telegram chat using Bot API
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
 * Convert a chat ID to a peer for MTProto API
 * @param {string|number} chatId The chat ID to convert
 * @returns {Object} A peer object for the MTProto API
 */
function createPeer(chatId) {
  if (typeof chatId !== 'string' && typeof chatId !== 'number') {
    return null;
  }
  
  const idStr = chatId.toString();
  
  // Channel or supergroup
  if (idStr.startsWith('-100')) {
    return {
      channelId: BigInt(idStr.substring(4)),
      className: 'PeerChannel'
    };
  }
  // Group chat
  else if (idStr.startsWith('-')) {
    return {
      chatId: BigInt(idStr.substring(1)),
      className: 'PeerChat'
    };
  }
  // User
  else {
    return {
      userId: BigInt(idStr),
      className: 'PeerUser'
    };
  }
}

/**
 * Download media from a message
 * @param {Object} messageData Message data with media info
 * @returns {Promise<string|null>} Path to downloaded file or null if failed
 */
async function downloadMedia(messageData) {
  try {
    if (!messageData || !messageData.hasMedia || !messageData.mediaType) {
      logger.error('No media to download');
      return null;
    }
    
    const client = await initializeSender();
    
    // Check which type of media we're dealing with
    const mediaType = messageData.mediaType;
    const sourceInfo = messageData.sourceInfo || {};
    const chatId = sourceInfo.chatId;
    const messageId = sourceInfo.messageId;
    
    if (!chatId || !messageId) {
      logger.error('Missing chat ID or message ID for media download');
      return null;
    }
    
    // Create peer for the chat
    const peer = createPeer(chatId);
    if (!peer) {
      logger.error(`Couldn't create peer for chat ID: ${chatId}`);
      return null;
    }
    
    // Get the full message to extract media
    const messages = await client.invoke(new Api.messages.GetMessages({
      id: [messageId],
      peer: peer
    }));
    
    if (!messages || !messages.messages || messages.messages.length === 0) {
      logger.error('Could not find message for media download');
      return null;
    }
    
    const message = messages.messages[0];
    if (!message || !message.media) {
      logger.error('Message has no media');
      return null;
    }
    
    // Generate a unique filename
    const timestamp = new Date().getTime();
    let filePath;
    
    // Handle photos
    if (mediaType === 'MessageMediaPhoto' && message.media.photo) {
      filePath = path.join(tempDir, `photo_${timestamp}.jpg`);
      
      // Download the photo
      const buffer = await client.downloadMedia(message.media, {
        outputFile: filePath
      });
      
      if (!buffer || buffer.length === 0) {
        logger.error('Downloaded photo is empty');
        return null;
      }
      
      logger.info(`Successfully downloaded photo to ${filePath}`);
      return filePath;
    }
    // Handle documents (including videos, files, etc.)
    else if (mediaType === 'MessageMediaDocument' && message.media.document) {
      const document = message.media.document;
      const mimeType = document.mimeType || 'application/octet-stream';
      
      // Determine file extension
      let extension = '.bin';
      if (mimeType.startsWith('image/')) {
        extension = mimeType.replace('image/', '.');
      } else if (mimeType.startsWith('video/')) {
        extension = mimeType.replace('video/', '.');
      } else if (mimeType.startsWith('audio/')) {
        extension = mimeType.replace('audio/', '.');
      } else if (mimeType === 'application/pdf') {
        extension = '.pdf';
      }
      
      filePath = path.join(tempDir, `document_${timestamp}${extension}`);
      
      // Download the document
      const buffer = await client.downloadMedia(message.media, {
        outputFile: filePath
      });
      
      if (!buffer || buffer.length === 0) {
        logger.error('Downloaded document is empty');
        return null;
      }
      
      logger.info(`Successfully downloaded document to ${filePath}`);
      return filePath;
    }
    
    logger.error(`Unsupported media type: ${mediaType}`);
    return null;
  } catch (error) {
    logger.error(`Error downloading media: ${error.message}`, { error });
    return null;
  }
}

/**
 * Send a photo to a chat using Bot API
 * @param {string} chatId Chat ID to send to
 * @param {string} photoPath Path to the photo file
 * @param {string} caption Optional caption for the photo
 * @returns {Promise<boolean>} True if successful
 */
async function sendPhoto(chatId, photoPath, caption = '') {
  try {
    if (!botToken) {
      logger.error('Bot token not set');
      return false;
    }
    
    if (!fs.existsSync(photoPath)) {
      logger.error(`Photo file not found: ${photoPath}`);
      return false;
    }
    
    // Parse chat ID and thread ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Create form data with the file
    const form = new FormData();
    form.append('chat_id', parsedChatId);
    form.append('photo', fs.createReadStream(photoPath));
    
    if (caption && caption.trim() !== '') {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    
    if (threadId) {
      form.append('message_thread_id', threadId);
    }
    
    // Send the request
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendPhoto`, form, {
      headers: form.getHeaders()
    });
    
    if (response.data && response.data.ok) {
      logger.info(`✅ Successfully sent photo to chat ${parsedChatId}`);
      return true;
    } else {
      logger.error(`Failed to send photo: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    if (error.response && error.response.data) {
      logger.error(`Telegram API error: ${error.response.data.description}`);
    } else {
      logger.error(`Error sending photo: ${error.message}`);
    }
    return false;
  }
}

/**
 * Send a document to a chat using Bot API
 * @param {string} chatId Chat ID to send to
 * @param {string} docPath Path to the document file
 * @param {string} caption Optional caption for the document
 * @returns {Promise<boolean>} True if successful
 */
async function sendDocument(chatId, docPath, caption = '') {
  try {
    if (!botToken) {
      logger.error('Bot token not set');
      return false;
    }
    
    if (!fs.existsSync(docPath)) {
      logger.error(`Document file not found: ${docPath}`);
      return false;
    }
    
    // Parse chat ID and thread ID
    const { chatId: parsedChatId, threadId } = parseChatId(chatId);
    
    // Create form data with the file
    const form = new FormData();
    form.append('chat_id', parsedChatId);
    form.append('document', fs.createReadStream(docPath));
    
    if (caption && caption.trim() !== '') {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    
    if (threadId) {
      form.append('message_thread_id', threadId);
    }
    
    // Send the request
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendDocument`, form, {
      headers: form.getHeaders()
    });
    
    if (response.data && response.data.ok) {
      logger.info(`✅ Successfully sent document to chat ${parsedChatId}`);
      return true;
    } else {
      logger.error(`Failed to send document: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    if (error.response && error.response.data) {
      logger.error(`Telegram API error: ${error.response.data.description}`);
    } else {
      logger.error(`Error sending document: ${error.message}`);
    }
    return false;
  }
}

/**
 * Forward a processed message to all destination channels
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
  
  logger.info(`🚀 Forwarding message to ${destinationChannels.length} channels: ${JSON.stringify(destinationChannels)}`);
  
  // Check if messageData is a string (just text) or an object with media info
  const isTextOnly = typeof messageData === 'string';
  const text = isTextOnly ? messageData : messageData.text || '';
  const hasMedia = !isTextOnly && messageData.hasMedia;
  const mediaType = !isTextOnly && messageData.mediaType;
  
  // Download the media if any
  let mediaPath = null;
  if (hasMedia) {
    try {
      logger.info('Downloading media for forwarding...');
      mediaPath = await downloadMedia(messageData);
      if (mediaPath) {
        logger.info(`Media downloaded to: ${mediaPath}`);
      } else {
        logger.warn('Failed to download media, will send text-only message');
      }
    } catch (downloadError) {
      logger.error(`Error downloading media: ${downloadError.message}`, { error: downloadError });
    }
  }
  
  // Process each destination channel
  for (const channelId of destinationChannels) {
    try {
      // Skip processing if channelId is not a string or number
      if (!channelId || (typeof channelId !== 'string' && typeof channelId !== 'number')) {
        logger.warn(`Invalid channel ID: ${channelId}, skipping`);
        continue;
      }
      
      logger.info(`Forwarding to channel: ${channelId}`);
      
      let success = false;
      
      // Try to send with media if available
      if (mediaPath) {
        try {
          if (mediaType === 'MessageMediaPhoto') {
            success = await sendPhoto(channelId, mediaPath, text);
          } else if (mediaType === 'MessageMediaDocument') {
            success = await sendDocument(channelId, mediaPath, text);
          } else {
            // Unknown media type, try to send as document
            success = await sendDocument(channelId, mediaPath, text);
          }
          
          if (success) {
            logger.info(`✅ Successfully sent media message to channel ${channelId}`);
          } else {
            // If media sending fails, try sending just the text
            logger.warn(`❌ Failed to send media, falling back to text-only for channel ${channelId}`);
            if (text && text.trim() !== '') {
              // Add media indicator if media sending failed
              let textWithMediaNote = text;
              if (mediaType === 'MessageMediaPhoto' && !text.includes('[Image attached]')) {
                textWithMediaNote += '\n\n[📷 Image attached]';
              } else if (mediaType === 'MessageMediaDocument' && !text.includes('[File attached]')) {
                textWithMediaNote += '\n\n[📎 File attached]';
              } else if (!text.includes('[Media attached]')) {
                textWithMediaNote += '\n\n[Media attached]';
              }
              
              success = await sendMessage(channelId, textWithMediaNote);
              if (success) {
                logger.info(`✅ Successfully sent text-only message to channel ${channelId} as fallback`);
              }
            }
          }
        } catch (mediaError) {
          logger.error(`Error sending media to ${channelId}: ${mediaError.message}`, { error: mediaError });
          // Try text fallback
          if (text && text.trim() !== '') {
            success = await sendMessage(channelId, `${text}\n\n[Media sending failed]`);
            if (success) {
              logger.info(`✅ Successfully sent text-only message to channel ${channelId} as fallback`);
            }
          }
        }
      } else {
        // Text-only message or media not available
        if (text && text.trim() !== '') {
          // Add media indicator if we know there's media but couldn't download it
          let finalText = text;
          if (hasMedia && !mediaPath) {
            if (mediaType === 'MessageMediaPhoto' && !text.includes('[Image attached]')) {
              finalText += '\n\n[📷 Image attached]';
            } else if (mediaType === 'MessageMediaDocument' && !text.includes('[File attached]')) {
              finalText += '\n\n[📎 File attached]';
            } else if (!text.includes('[Media attached]')) {
              finalText += '\n\n[Media attached]';
            }
          }
          
          success = await sendMessage(channelId, finalText);
          if (success) {
            logger.info(`✅ Successfully sent text message to channel ${channelId}`);
          }
        } else {
          logger.warn(`Empty message text for channel ${channelId}, skipping`);
          success = false;
        }
      }
      
      if (success) {
        result.success++;
        result.channels.successful.push(channelId);
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
  
  // Clean up downloaded media file
  if (mediaPath && fs.existsSync(mediaPath)) {
    try {
      fs.unlinkSync(mediaPath);
      logger.debug(`Cleaned up temporary media file: ${mediaPath}`);
    } catch (cleanupError) {
      logger.error(`Error cleaning up media file: ${cleanupError.message}`);
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