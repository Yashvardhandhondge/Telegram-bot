const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const config = require('../config');
const logger = require('./logger');

/**
 * Authenticate with Telegram and get a session string
 * @returns {Promise<string>} Session string for reuse
 */
async function authenticateTelegram() {
  try {
    logger.info('Starting Telegram authentication process');

    const stringSession = new StringSession(config.telegram.sessionString || '');

    const client = new TelegramClient(stringSession, config.telegram.apiId, config.telegram.apiHash, {
      connectionRetries: 5,
    });

    // Start the client
    await client.start({
      phoneNumber: async () => await input.text('Please enter your phone number: '),
      password: async () => await input.text('Please enter your password: '),
      phoneCode: async () => await input.text('Please enter the code you received: '),
      onError: (err) => logger.error(`Telegram authentication error: ${err.message}`, { error: err }),
    });

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
 * Initialize Telegram client with existing session or new authentication
 * @returns {Promise<TelegramClient>} Authenticated Telegram client
 */
async function initializeClient() {
  try {
    const stringSession = new StringSession(config.telegram.sessionString || '');

    const client = new TelegramClient(stringSession, config.telegram.apiId, config.telegram.apiHash, {
      connectionRetries: 5,
      baseLogger: console, // Basic logging
    });

    // If we have a session string, try to connect directly
    if (config.telegram.sessionString) {
      await client.connect();

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
      }
    } else {
      // No session string provided, authenticate from scratch
      logger.info('No session string provided, starting new authentication');
      await authenticateTelegram();
    }

    return client;
  } catch (error) {
    logger.error(`Failed to initialize Telegram client: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  authenticateTelegram,
  initializeClient,
};
