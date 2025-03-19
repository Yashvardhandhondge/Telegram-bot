const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const input = require('input');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Handle flood wait errors by properly waiting the required time
 * @param {Object} error Error object from Telegram API
 * @returns {Promise<boolean>} True if handled, false otherwise
 */
async function handleFloodWait(error) {
  try {
    // Check if this is a flood wait error
    if (error.message && error.message.includes('FLOOD_WAIT_')) {
      // Extract wait time
      const waitTimeMatch = error.message.match(/FLOOD_WAIT_(\d+)/);
      if (waitTimeMatch && waitTimeMatch[1]) {
        const waitSeconds = parseInt(waitTimeMatch[1], 10);
        const waitMillis = waitSeconds * 1000;
        
        logger.warn(`Flood wait detected. Waiting for ${waitSeconds} seconds before retrying...`);
        
        // Wait for the required time
        await new Promise(resolve => setTimeout(resolve, waitMillis + 1000)); // Add 1 second for safety
        
        logger.info(`Flood wait completed. Ready to resume operations.`);
        return true;
      }
    }
    
    return false;
  } catch (handlerError) {
    logger.error(`Error in flood wait handler: ${handlerError.message}`);
    return false;
  }
}

/**
 * Handle various types of connection errors
 * @param {Object} error Error object from Telegram API
 * @param {TelegramClient} client Client that encountered the error
 * @returns {Promise<boolean>} True if handled, false otherwise
 */
async function handleConnectionError(error, client) {
  try {
    // Check for various error types
    if (error.message && (
        error.message.includes('AUTH_KEY_UNREGISTERED') || 
        error.message.includes('AUTH_KEY_INVALID') ||
        error.message.includes('Connection closed'))) {
      
      logger.warn(`Connection error detected: ${error.message}`);
      
      // Try to disconnect cleanly
      try {
        if (client && client.connected) {
          await client.disconnect();
        }
      } catch {}
      
      // Wait before reconnecting
      logger.info('Waiting 5 seconds before reconnecting...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Reconnect
      if (client) {
        logger.info('Reconnecting client...');
        await client.connect();
        logger.info('Client reconnected successfully');
        return true;
      }
    }
    
    // Check for flood wait errors
    if (await handleFloodWait(error)) {
      return true;
    }
    
    return false;
  } catch (handlerError) {
    logger.error(`Error in connection error handler: ${handlerError.message}`);
    return false;
  }
}

/**
 * Enhanced send ping with retry and error handling
 * @param {TelegramClient} client Telegram client
 * @returns {Promise<boolean>} True if ping successful
 */
async function sendPing(client) {
  try {
    if (!client || !client.connected) {
      return false;
    }
    
    // Use the correct API for pinging
    await client.invoke(new Api.Ping({
      pingId: BigInt(Math.floor(Math.random() * 1000000000))
    }));
    
    return true;
  } catch (error) {
    logger.error(`Ping failed: ${error.message}`);
    
    // Try to handle connection error
    const handled = await handleConnectionError(error, client);
    
    if (handled) {
      // Retry ping after error handling
      try {
        await client.invoke(new Api.Ping({
          pingId: BigInt(Math.floor(Math.random() * 1000000000))
        }));
        logger.info('Ping retry successful after error handling');
        return true;
      } catch (retryError) {
        logger.error(`Ping retry failed: ${retryError.message}`);
        return false;
      }
    }
    
    return false;
  }
}

/**
 * Get the appropriate API credentials based on bot type
 * @param {boolean} isPnlBot Whether this is for the PNL bot
 * @returns {Object} API credentials
 */
function getApiCredentials(isPnlBot) {
  if (isPnlBot) {
    // Use PNL-specific credentials if available, otherwise fall back to main credentials
    const apiId = process.env.PNL_TELEGRAM_API_ID 
      ? parseInt(process.env.PNL_TELEGRAM_API_ID) 
      : config.telegram.apiId;
      
    const apiHash = process.env.PNL_TELEGRAM_API_HASH || config.telegram.apiHash;
    
    return { apiId, apiHash };
  } else {
    // Use main credentials
    return {
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash
    };
  }
}

/**
 * Authenticate with Telegram and get a session string
 * @returns {Promise<string>} Session string for reuse
 */
async function authenticateTelegram(isPnlBot = false) {
  try {
    logger.info(`Starting Telegram authentication process${isPnlBot ? ' for PNL Bot' : ''}`);
    
    // Determine which session string to use
    const sessionString = isPnlBot 
      ? process.env.PNL_TELEGRAM_SESSION_STRING || ''
      : config.telegram.sessionString || '';
    
    const stringSession = new StringSession(sessionString);
    
    // Get API credentials based on bot type
    const credentials = getApiCredentials(isPnlBot);
    
    const client = new TelegramClient(
      stringSession,
      credentials.apiId,
      credentials.apiHash,
      {
        connectionRetries: isPnlBot ? 5 : 10, // Less retries for PNL bot
        shouldReconnect: true,
        useWSS: false,
        autoReconnect: true,
        timeout: 60000,
        retryDelay: isPnlBot ? 2000 : 1000, // More delay for PNL bot
        floodSleepThreshold: isPnlBot ? 60 : 20, // Higher threshold for PNL bot
        deviceModel: isPnlBot ? 'PNL Bot' : 'Main Bot', // Different device models
        appVersion: isPnlBot ? '1.0.1' : '1.0.0', // Different versions
      }
    );
      
    // Start the client
    await client.start({
      phoneNumber: async () => await input.text('Please enter your phone number: '),
      password: async () => await input.text('Please enter your password: '),
      phoneCode: async () => await input.text('Please enter the code you received: '),
      onError: (err) => logger.error(`Telegram authentication error: ${err.message}`, { error: err }),
    });
    
    // Test connection with a simple getMe call
    const me = await client.getMe();
    logger.info(`Connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
    
    // Save the session string for future use
    const newSessionString = client.session.save();
    logger.info('Telegram authentication successful');
    logger.info(`Save this session string in your .env file as ${isPnlBot ? 'PNL_TELEGRAM_SESSION_STRING' : 'TELEGRAM_SESSION_STRING'} to avoid re-authentication:`);
    logger.info(newSessionString);
    
    return newSessionString;
  } catch (error) {
    logger.error(`Failed to authenticate with Telegram: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Initialize Telegram client with existing session or new authentication
 * @param {boolean} isPnlBot Whether this client is for the PNL bot
 * @returns {Promise<TelegramClient>} Authenticated Telegram client
 */
async function initializeClient(isPnlBot = false) {
  try {
    // Determine which session string to use
    const sessionString = isPnlBot 
      ? process.env.PNL_TELEGRAM_SESSION_STRING || ''
      : config.telegram.sessionString || '';
    
    // Create a unique session based on isPnlBot
    const stringSession = new StringSession(sessionString);
    
    // Log which client is being initialized
    logger.info(`Initializing ${isPnlBot ? 'PNL' : 'main'} Telegram client`);
    
    // Get appropriate API credentials
    const credentials = getApiCredentials(isPnlBot);
    logger.info(`Using API ID: ${credentials.apiId} for ${isPnlBot ? 'PNL' : 'main'} client`);
    
    // Configure client with appropriate settings
    const client = new TelegramClient(
      stringSession,
      credentials.apiId,
      credentials.apiHash,
      {
        connectionRetries: isPnlBot ? 5 : 10,
        shouldReconnect: true,
        useWSS: false,
        autoReconnect: true,
        timeout: 60000,
        retryDelay: isPnlBot ? 2000 : 1000,
        floodSleepThreshold: isPnlBot ? 60 : 20,
        deviceModel: isPnlBot ? 'PNL Bot' : 'Main Bot',
        appVersion: isPnlBot ? '1.0.1' : '1.0.0',
      }
    );
    
    // Mark the client for easy identification
    client.isPnlBot = isPnlBot;
    
    // Save session directory path for future reference
    const sessionDir = path.join(__dirname, '../tmp/sessions', isPnlBot ? 'pnl_bot' : 'user');
    client.sessionDir = sessionDir;
    
    // If we have a session string, try to connect
    if (sessionString) {
      try {
        logger.info(`Connecting to Telegram with existing ${isPnlBot ? 'PNL' : 'main'} session...`);
        await client.connect();
        
        // Verify connection by getting self info
        const me = await client.getMe();
        logger.info(`Connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
        
        // Check if session is still valid
        if (await client.checkAuthorization()) {
          logger.info(`Successfully connected to Telegram using existing ${isPnlBot ? 'PNL' : 'main'} session`);
          
          // Save the session string to the session directory
          if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
          }
          
          const sessionFilePath = path.join(sessionDir, 'session.txt');
          fs.writeFileSync(sessionFilePath, client.session.save());
          logger.info(`Session saved to ${sessionFilePath}`);
        } else {
          // If not authorized, authenticate again
          logger.info('Session expired, starting new authentication');
          
          const newSessionString = await authenticateTelegram(isPnlBot);
          
          // Reconnect with the new session
          client.session = new StringSession(newSessionString);
          await client.connect();
          
          // Save the new session
          if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
          }
          
          const sessionFilePath = path.join(sessionDir, 'session.txt');
          fs.writeFileSync(sessionFilePath, newSessionString);
          logger.info(`New session saved to ${sessionFilePath}`);
        }
      } catch (error) {
        logger.error(`Error connecting with existing session: ${error.message}`, { error });
        logger.info('Starting new authentication...');
        
        // Try to disconnect and reconnect from scratch
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnection errors
        }
        
        const newSessionString = await authenticateTelegram(isPnlBot);
        
        // Reconnect with the new session
        client.session = new StringSession(newSessionString);
        await client.connect();
        
        // Save the new session
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        const sessionFilePath = path.join(sessionDir, 'session.txt');
        fs.writeFileSync(sessionFilePath, newSessionString);
        logger.info(`New session saved to ${sessionFilePath}`);
      }
    } else {
      // No session string provided, authenticate from scratch
      logger.info('No session string provided, starting new authentication');
      
      const newSessionString = await authenticateTelegram(isPnlBot);
      
      // Connect with the new session
      client.session = new StringSession(newSessionString);
      await client.connect();
      
      // Save the new session
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      const sessionFilePath = path.join(sessionDir, 'session.txt');
      fs.writeFileSync(sessionFilePath, newSessionString);
      logger.info(`New session saved to ${sessionFilePath}`);
    }
    
    // Add connection maintenance handler
    const pingInterval = isPnlBot ? 75000 : 60000; // Different intervals to avoid collisions
    setInterval(async () => {
      try {
        if (client.connected) {
          await sendPing(client);
        } else {
          logger.warn(`${isPnlBot ? 'PNL' : 'Main'} client disconnected, attempting to reconnect...`);
          await client.connect();
          logger.info(`${isPnlBot ? 'PNL' : 'Main'} client reconnected successfully`);
        }
      } catch (error) {
        logger.error(`Error in keep-alive ping for ${isPnlBot ? 'PNL' : 'Main'} client: ${error.message}`, { error });
      }
    }, pingInterval);
    
    return client;
  } catch (error) {
    logger.error(`Failed to initialize ${isPnlBot ? 'PNL' : 'Main'} Telegram client: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  authenticateTelegram,
  initializeClient,
  sendPing
};