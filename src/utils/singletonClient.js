// Create a new file called 'singletonClient.js' in your utils directory

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const config = require('../config');
const logger = require('./logger');

/**
 * Singleton Telegram client class
 * Ensures only one client instance is created and shared across the application
 */
class TelegramClientSingleton {
  constructor() {
    this.client = null;
    this.connectionAttempts = 0;
    this.MAX_CONNECTION_ATTEMPTS = 5;
    this.keepAliveInterval = null;
  }

  /**
   * Get a client instance - creates one if it doesn't exist
   * @returns {Promise<TelegramClient>} The Telegram client instance
   */
  async getClient() {
    if (!this.client) {
      await this.createClient();
    } else if (!this.client.connected) {
      await this.reconnect();
    }
    
    return this.client;
  }
  
  /**
   * Create a new Telegram client
   * @returns {Promise<TelegramClient>} The created Telegram client
   */
  async createClient() {
    try {
      const stringSession = new StringSession(config.telegram.sessionString || '');
      
      this.client = new TelegramClient(
        stringSession,
        config.telegram.apiId,
        config.telegram.apiHash,
        {
          connectionRetries: 10,
          shouldReconnect: true,
          useWSS: false,
          timeout: 60000,
          retryDelay: 1000,
          autoReconnect: true,
        }
      );
      
      // Override disconnect method to prevent unwanted disconnections
      const originalDisconnect = this.client.disconnect;
      this.client.disconnect = async function() {
        logger.info('Disconnect requested - ignoring to keep singleton connection alive');
        // We're deliberately not disconnecting to maintain the connection
        return Promise.resolve();
      };
      
      // Connect the client
      await this.connect();
      
      // Start keep-alive mechanism
      this.startKeepAlive();
      
      return this.client;
    } catch (error) {
      logger.error(`Failed to create Telegram client: ${error.message}`, { error });
      throw error;
    }
  }
  
  /**
   * Connect the client
   * @returns {Promise<boolean>} True if connected successfully
   */
  async connect() {
    try {
      this.connectionAttempts++;
      
      if (this.connectionAttempts > this.MAX_CONNECTION_ATTEMPTS) {
        logger.error(`Exceeded maximum connection attempts (${this.MAX_CONNECTION_ATTEMPTS})`);
        throw new Error('Too many connection attempts');
      }
      
      if (!this.client) {
        throw new Error('Cannot connect null client');
      }
      
      if (this.client.connected) {
        logger.debug('Client already connected');
        this.connectionAttempts = 0;
        return true;
      }
      
      logger.info('Connecting to Telegram...');
      await this.client.connect();
      
      // Verify connection with a ping
      await this.ping();
      
      logger.info('Successfully connected to Telegram');
      this.connectionAttempts = 0;
      return true;
    } catch (error) {
      logger.error(`Connection error: ${error.message}`, { error });
      
      // Wait before retry to avoid hammering the server
      const delay = Math.min(1000 * this.connectionAttempts, 10000); // Max 10 seconds
      logger.info(`Will retry connection in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return false;
    }
  }
  
  /**
   * Reconnect the client if disconnected
   * @returns {Promise<boolean>} True if reconnected successfully
   */
  async reconnect() {
    try {
      if (this.client.connected) {
        return true;
      }
      
      logger.info('Reconnecting to Telegram...');
      return await this.connect();
    } catch (error) {
      logger.error(`Reconnection error: ${error.message}`, { error });
      return false;
    }
  }
  
  /**
   * Ping the server to verify connection
   * @returns {Promise<boolean>} True if ping was successful
   */
  async ping() {
    try {
      if (!this.client || !this.client.connected) {
        return false;
      }
      
      await this.client.invoke(new Api.Ping({
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
   * Start keep-alive mechanism with periodic pings
   */
  startKeepAlive() {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    
    // Set new interval
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.client) {
          if (this.client.connected) {
            // Try to ping
            const pingSuccess = await this.ping();
            
            // If ping fails, try to reconnect
            if (!pingSuccess) {
              logger.warn('Keep-alive ping failed, attempting to reconnect...');
              await this.reconnect();
            }
          } else {
            // Client is not connected, try to reconnect
            logger.warn('Client disconnected, attempting to reconnect...');
            await this.reconnect();
          }
        }
      } catch (error) {
        logger.error(`Error in keep-alive: ${error.message}`, { error });
      }
    }, 30000); // Every 30 seconds
    
    logger.info('Started Telegram client keep-alive mechanism');
  }
}

// Export singleton instance
const telegramClientSingleton = new TelegramClientSingleton();
module.exports = telegramClientSingleton;