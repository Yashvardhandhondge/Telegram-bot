/**
 * Channel Authentication Manager
 * Handles Telegram authentication for channel creation with separate sessions
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

// Create sessions directory if it doesn't exist
const SESSIONS_DIR = path.join(process.cwd(), 'tmp', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Get the session file path for a phone number
 * @param {string} phoneNumber Phone number
 * @returns {string} File path
 */
function getSessionPath(phoneNumber) {
  // Sanitize phone number to use as filename (remove +, spaces, etc)
  const sanitizedPhone = phoneNumber.replace(/\D/g, '');
  return path.join(SESSIONS_DIR, `session_${sanitizedPhone}.json`);
}

/**
 * Load existing session for a phone number
 * @param {string} phoneNumber Phone number
 * @returns {string|null} Session string or null if not found
 */
function loadSession(phoneNumber) {
  const sessionPath = getSessionPath(phoneNumber);
  
  try {
    if (fs.existsSync(sessionPath)) {
      const sessionData = fs.readFileSync(sessionPath, 'utf8');
      const data = JSON.parse(sessionData);
      return data.session;
    }
  } catch (error) {
    logger.warn(`Error loading session for ${phoneNumber}: ${error.message}`);
  }
  
  return null;
}

/**
 * Save session for a phone number
 * @param {string} phoneNumber Phone number
 * @param {string} sessionString Session string
 */
function saveSession(phoneNumber, sessionString) {
  const sessionPath = getSessionPath(phoneNumber);
  
  try {
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({
        phone: phoneNumber,
        session: sessionString,
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      }),
      'utf8'
    );
    logger.info('Channel session saved to file');
  } catch (error) {
    logger.error(`Error saving session: ${error.message}`);
  }
}

/**
 * Authenticate with Telegram and get a client for channel creation
 * Always asks for phone number input and creates a separate session
 * @returns {Promise<{client: TelegramClient, phoneNumber: string}>} Authenticated client and phone number
 */
async function authenticateForChannelCreation() {
  try {
    // Always ask for phone number input
    const phoneNumber = await input.text('Enter phone number for channel creation (include country code): ');
    if (!phoneNumber || phoneNumber.trim() === '') {
      throw new Error('Phone number is required');
    }
    
    // Check if we have an existing session for this phone
    const existingSession = loadSession(phoneNumber);
    let stringSession;
    
    if (existingSession) {
      logger.info('Loaded existing channel session for the provided phone number');
      stringSession = new StringSession(existingSession);
    } else {
      logger.info('No existing session found, creating new session for channel creation');
      stringSession = new StringSession('');
    }
    
    // Create client with the session
    const client = new TelegramClient(
      stringSession,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 5,
        useWSS: false,
        shouldReconnect: true,
        autoReconnect: true,
        timeout: 60000
      }
    );
    
    // Try to connect with existing session or create new one
    if (existingSession) {
      logger.info('Connecting to Telegram for channel creation...');
      await client.connect();
      
      // Verify connection
      try {
        const me = await client.getMe();
        logger.info('Channel authentication successful');
      } catch (error) {
        logger.warn(`Existing session invalid: ${error.message}`);
        logger.info('Starting new authentication for channel creation...');
        await client.start({
          phoneNumber: async () => phoneNumber,
          password: async () => await input.text('Please enter your password: '),
          phoneCode: async () => await input.text('Please enter the code you received: '),
          onError: (err) => logger.error(`Channel authentication error: ${err.message}`)
        });
      }
    } else {
      // Start new authentication
      logger.info('Starting new authentication for channel creation...');
      await client.start({
        phoneNumber: async () => phoneNumber,
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => logger.error(`Channel authentication error: ${err.message}`)
      });
    }
    
    // Save the session for future use
    const sessionString = client.session.save();
    saveSession(phoneNumber, sessionString);
    
    logger.info('Channel Telegram client initialized');
    return { client, phoneNumber };
  } catch (error) {
    logger.error(`Failed to authenticate for channel creation: ${error.message}`);
    throw error;
  }
}

module.exports = {
  authenticateForChannelCreation,
  loadSession,
  saveSession
};