// download-media.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Telegram Bot API details
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const tempDir = path.join(__dirname, 'temp');

// Create temp directory if it doesn't exist
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Download media from Telegram using the Bot API
 * @param {string} fileId Telegram file ID
 * @returns {Promise<string|null>} Path to the downloaded file or null if failed
 */
async function downloadMediaWithBotAPI(fileId) {
  try {
    if (!botToken) {
      console.error('Bot token not set');
      return null;
    }
    
    // Step 1: Get file info from Telegram Bot API
    const fileInfoUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
    const fileInfoResponse = await axios.get(fileInfoUrl);
    
    if (!fileInfoResponse.data.ok || !fileInfoResponse.data.result.file_path) {
      console.error('Failed to get file info:', fileInfoResponse.data);
      return null;
    }
    
    const filePath = fileInfoResponse.data.result.file_path;
    const fileName = path.basename(filePath);
    const outputPath = path.join(tempDir, `${Date.now()}_${fileName}`);
    
    // Step 2: Download the actual file
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream'
    });
    
    // Save the file to disk
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', (err) => {
        console.error('Error writing file:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error downloading media:', error.message);
    return null;
  }
}

module.exports = { downloadMediaWithBotAPI };