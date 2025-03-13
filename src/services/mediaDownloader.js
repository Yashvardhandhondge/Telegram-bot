const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

// Temp directory for downloaded media
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Download media using a separate process
 * @param {Object} messageData Message data with media info
 * @returns {Promise<string|null>} Path to downloaded file or null if failed
 */
async function downloadMediaExternal(messageData) {
  try {
    if (!messageData || !messageData.hasMedia || !messageData.mediaType) {
      logger.error('No media to download');
      return null;
    }
    
    // Create a unique file name for the output
    const timestamp = Date.now();
    const mediaId = messageData.messageId || timestamp;
    const outputFilePath = path.join(tempDir, `media_${mediaId}_${timestamp}`);
    
    // Prepare message data for the downloader
    const inputData = JSON.stringify({
      messageId: messageData.messageId,
      chatId: messageData.chatId,
      sourceInfo: messageData.sourceInfo,
      mediaType: messageData.mediaType,
      outputPath: outputFilePath
    });
    
    logger.info(`Starting media download process for message ${messageData.messageId}`);
    
    // Create a promise to handle the download result
    return new Promise((resolve, reject) => {
      // Use a separate script to download media
      const downloaderProcess = spawn('node', [path.join(process.cwd(), 'src/utils/download-media-script.js')], {
        detached: true,  // Run in the background
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Pass the input data to the process
      downloaderProcess.stdin.write(inputData);
      downloaderProcess.stdin.end();
      
      // Collect output
      let stdout = '';
      let stderr = '';
      
      downloaderProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      downloaderProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Set a timeout
      const timeout = setTimeout(() => {
        try {
          if (downloaderProcess.pid) {
            process.kill(downloaderProcess.pid);
          }
        } catch (e) {
          // Ignore errors killing the process
        }
        reject(new Error('Download process timed out'));
      }, 60000); // 1 minute timeout
      
      // Handle download completion
      downloaderProcess.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code === 0) {
          // Parse the output to get the downloaded file path
          try {
            const result = JSON.parse(stdout);
            if (result.success && result.filePath) {
              logger.info(`Media download process completed successfully: ${result.filePath}`);
              resolve(result.filePath);
            } else {
              logger.error(`Media download process failed: ${result.error || 'Unknown error'}`);
              reject(new Error(result.error || 'Unknown error'));
            }
          } catch (error) {
            logger.error(`Error parsing downloader output: ${error.message}`, { stdout, stderr });
            reject(error);
          }
        } else {
          logger.error(`Media download process failed with code ${code}: ${stderr}`);
          reject(new Error(`Download process exited with code ${code}: ${stderr}`));
        }
      });
      
      // Handle process errors
      downloaderProcess.on('error', (error) => {
        clearTimeout(timeout);
        logger.error(`Media download process error: ${error.message}`);
        reject(error);
      });
    });
  } catch (error) {
    logger.error(`Error in downloadMediaExternal: ${error.message}`, { error });
    return null;
  }
}

module.exports = {
  downloadMediaExternal
};