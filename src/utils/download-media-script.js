const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

/**
 * Main download function
 */
async function downloadMedia() {
  try {
    // Read input from stdin
    let inputData = '';
    process.stdin.on('data', (chunk) => {
      inputData += chunk.toString();
    });
    
    // Process when stdin ends
    process.stdin.on('end', async () => {
      try {
        // Parse input data
        const data = JSON.parse(inputData);
        const { messageId, chatId, sourceInfo, mediaType, outputPath } = data;
        
        // Initialize Telegram client
        const client = new TelegramClient(
          new StringSession(process.env.TELEGRAM_SESSION_STRING || ''),
          parseInt(process.env.TELEGRAM_API_ID),
          process.env.TELEGRAM_API_HASH,
          {
            connectionRetries: 3,
            shouldReconnect: true,
            autoReconnect: true,
            useWSS: false,
            timeout: 60000
          }
        );
        
        // Connect to Telegram
        await client.connect();
        
        // Create peer for the chat
        const peer = createPeer(chatId);
        if (!peer) {
          throw new Error(`Couldn't create peer for chat ID: ${chatId}`);
        }
        
        // Get the full message to extract media
        const messages = await client.invoke(new Api.messages.GetMessages({
          id: [parseInt(messageId)],
          peer: peer
        }));
        
        if (!messages || !messages.messages || messages.messages.length === 0) {
          throw new Error('Could not find message');
        }
        
        const message = messages.messages[0];
        if (!message || !message.media) {
          throw new Error('Message has no media');
        }
        
        // Generate output file path based on media type
        let filePath;
        if (mediaType === 'MessageMediaPhoto') {
          filePath = `${outputPath}.jpg`;
        } else if (mediaType === 'MessageMediaDocument') {
          filePath = `${outputPath}.bin`;
        } else {
          filePath = `${outputPath}.bin`;
        }
        
        // Download the media
        const buffer = await client.downloadMedia(message.media, {
          outputFile: filePath
        });
        
        // Verify the download
        if (!buffer || buffer.length === 0) {
          throw new Error('Downloaded file is empty');
        }
        
        // Disconnect client
        await client.disconnect();
        
        // Return success with file path
        process.stdout.write(JSON.stringify({
          success: true,
          filePath
        }));
        
        process.exit(0);
      } catch (error) {
        // Return error
        process.stdout.write(JSON.stringify({
          success: false,
          error: error.message
        }));
        
        process.exit(1);
      }
    });
  } catch (error) {
    // Return error
    process.stdout.write(JSON.stringify({
      success: false,
      error: error.message
    }));
    
    process.exit(1);
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
  
  // Remove thread ID if present
  const mainId = idStr.includes('/') ? idStr.split('/')[0] : idStr;
  
  // Channel or supergroup
  if (mainId.startsWith('-100')) {
    return {
      channelId: BigInt(mainId.substring(4)),
      className: 'PeerChannel'
    };
  }
  // Group chat
  else if (mainId.startsWith('-')) {
    return {
      chatId: BigInt(mainId.substring(1)),
      className: 'PeerChat'
    };
  }
  // User
  else {
    return {
      userId: BigInt(mainId),
      className: 'PeerUser'
    };
  }
}

// Run the download function
downloadMedia();