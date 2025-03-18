const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const input = require('input');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Authenticate with Telegram and get a session string
 * @returns {Promise<string>} Session string for reuse
 */
async function authenticateTelegram() {
  try {
    logger.info('Starting Telegram authentication process');
    
    const stringSession = new StringSession(config.telegram.sessionString || '');
    
    const client = new TelegramClient(
      stringSession,
      config.telegram.apiId,
      config.telegram.apiHash,
      { 
        connectionRetries: 5,
        useWSS: false,
        shouldReconnect: true,
        autoReconnect: true,
        timeout: 60000,

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
    const sessionString = client.session.save();
    logger.info('Telegram authentication successful');
    logger.info('Save this session string in your .env file as TELEGRAM_SESSION_STRING to avoid re-authentication:');
    logger.info(sessionString);
    
    return sessionString;
  } catch (error) {
    logger.error(`Failed to authenticate with Telegram: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Send a ping to verify the connection
 * @param {TelegramClient} client Telegram client
 * @returns {Promise<boolean>} True if ping successful
 */
async function sendPing(client) {
  try {
    if (!client.connected) {
      return false;
    }
    
    // Use the correct API for pinging
    await client.invoke(new Api.Ping({
      pingId: BigInt(Math.floor(Math.random() * 1000000000))
    }));
    
    logger.debug('Ping successful');
    return true;
  } catch (error) {
    logger.error(`Ping failed: ${error.message}`);
    return false;
  }
}

/**
 * Initialize Telegram client with existing session or new authentication
 * @param {boolean} isPnlBot Whether this client is for the PNL bot
 * @returns {Promise<TelegramClient>} Authenticated Telegram client
 */
async function initializeClient(isPnlBot = false) {
  try {
    // Use PNL_TELEGRAM_SESSION_STRING for pnl-bot if available
    const sessionString = isPnlBot && process.env.PNL_TELEGRAM_SESSION_STRING 
      ? process.env.PNL_TELEGRAM_SESSION_STRING 
      : config.telegram.sessionString || '';
    
    if (isPnlBot) {
      logger.info('Initializing Telegram client for PNL Bot');
    }
    
    const stringSession = new StringSession(sessionString);
    
    const client = new TelegramClient(
      stringSession,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 10,
        shouldReconnect: true,
        useWSS: false,
        autoReconnect: true,
        timeout: 60000, // Increase timeout to 60 seconds
        retryDelay: 1000, // Delay between connection retries
        floodSleepThreshold: isPnlBot ? 60 : 20 // Increase threshold for PNL bot to reduce conflicts
      }
    );
    
    // If we have a session string, try to connect directly
    if (sessionString) {
      try {
        logger.info(`Connecting to Telegram with existing session ${isPnlBot ? '(PNL Bot)' : ''}...`);
        await client.connect();
        
        // Verify connection by getting self info
        const me = await client.getMe();
        logger.info(`Connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
        
        // Check if we're still authenticated
        if (await client.checkAuthorization()) {
          logger.info('Successfully connected to Telegram using existing session');
        } else {
          // If not authorized, authenticate again
          logger.info('Session expired, starting new authentication');
          await client.start({
            phoneNumber: async () => await input.text('Please enter your phone number: '),
            password: async () => await input.text('Please enter your password: '),
            phoneCode: async () => await input.text('Please enter the code you received: '),
            onError: (err) => logger.error(`Telegram authentication error: ${err.message}`, { error: err }),
          });
          
          // Save the new session string
          const newSessionString = client.session.save();
          logger.info('New authentication successful');
          logger.info('Update your .env file with this new session string:');
          logger.info(newSessionString);
          
          if (isPnlBot) {
            logger.info('For PNL Bot, add this to your .env as PNL_TELEGRAM_SESSION_STRING');
          } else {
            logger.info('Add this to your .env as TELEGRAM_SESSION_STRING');
          }
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
        
        await client.start({
          phoneNumber: async () => await input.text('Please enter your phone number: '),
          password: async () => await input.text('Please enter your password: '),
          phoneCode: async () => await input.text('Please enter the code you received: '),
          onError: (err) => logger.error(`Telegram authentication error: ${err.message}`, { error: err }),
        });
        
        // Save the new session string
        const newSessionString = client.session.save();
        logger.info('New authentication successful');
        logger.info('Update your .env file with this new session string:');
        logger.info(newSessionString);
        
        if (isPnlBot) {
          logger.info('For PNL Bot, add this to your .env as PNL_TELEGRAM_SESSION_STRING');
        } else {
          logger.info('Add this to your .env as TELEGRAM_SESSION_STRING');
        }
      }
    } else {
      // No session string provided, authenticate from scratch
      logger.info('No session string provided, starting new authentication');
      await authenticateTelegram();
    }
    
    // Tag this client for easier debugging
    client.isPnlBot = isPnlBot;
    
    // Add connection maintenance handler with different intervals to avoid conflicts
    const interval = isPnlBot ? 75000 : 60000; // Different ping intervals
    
    setInterval(async () => {
      try {
        if (client.connected) {
          await sendPing(client);
        } else {
          logger.warn(`Client disconnected${isPnlBot ? ' (PNL Bot)' : ''}, attempting to reconnect...`);
          await client.connect();
          logger.info('Reconnected successfully');
        }
      } catch (error) {
        logger.error(`Error in keep-alive ping: ${error.message}`, { error });
      }
    }, interval);
    
    return client;
  } catch (error) {
    logger.error(`Failed to initialize Telegram client: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  authenticateTelegram,
  initializeClient,
  sendPing
};