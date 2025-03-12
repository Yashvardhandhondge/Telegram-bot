/**
 * Utility functions for handling chat IDs in different formats
 */
const logger = require('./logger');

/**
 * Normalize a chat ID to multiple possible formats for matching
 * @param {string} chatId Original chat ID
 * @returns {string[]} Array of possible formats for this chat ID
 */
function normalizeChannelId(chatId) {
  try {
    // If chat ID is empty or not a string/number, return empty array
    if (!chatId || (typeof chatId !== 'string' && typeof chatId !== 'number')) {
      return [];
    }
    
    // Convert to string if it's a number
    const chatIdStr = chatId.toString();
    
    // Check if it has a thread ID
    let mainId, threadId;
    if (chatIdStr.includes('/')) {
      [mainId, threadId] = chatIdStr.split('/');
    } else {
      mainId = chatIdStr;
      threadId = null;
    }
    
    // Remove any minus sign and leading zeros
    const cleanMainId = mainId.replace(/^0+/, '');
    
    // Generate different possible formats
    const possibleFormats = [
      // Original format (with thread ID if present)
      chatIdStr
    ];
    
    if (threadId) {
      // Formats with thread ID
      possibleFormats.push(`${cleanMainId}/${threadId}`);
      possibleFormats.push(`-${cleanMainId}/${threadId}`);
      // Also include formats without the thread ID for matching purposes
      possibleFormats.push(cleanMainId);
      possibleFormats.push(`-${cleanMainId}`);
    } else {
      // No thread: just include plain formats
      possibleFormats.push(cleanMainId);
      possibleFormats.push(`-${cleanMainId}`);
    }
    
    return [...new Set(possibleFormats)]; // Remove duplicates
  } catch (error) {
    console.error(`Error normalizing channel ID ${chatId}: ${error.message}`);
    return [chatId.toString()]; // Return original as fallback
  }
}

/**
 * Check if a chat ID exists in an object's keys with different possible formats
 * @param {Object} obj Object to check keys in
 * @param {string} chatId Chat ID to check
 * @returns {string|null} Matched key or null if not found
 */
function findMatchingKey(obj, chatId) {
  if (!obj || !chatId) {
    return null;
  }
  // Get all possible formats for this chat ID
  const possibleFormats = normalizeChannelId(chatId);
  
  // Check if any of the formats exist in the object keys
  for (const format of possibleFormats) {
    if (format in obj) {
      return format;
    }
  }
  
  return null;
}

module.exports = {
  normalizeChannelId,
  findMatchingKey
};