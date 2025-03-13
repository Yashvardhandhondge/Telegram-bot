// Add this to a new file: utils/connectionManager.js

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const config = require('../config');
const logger = require('./logger');

class ConnectionManager {
  constructor() {
    this.mainClient = null;
    this.mediaClient = null;
    this.lastMessageTimestamp = Date.now();
    this.watchdogInterval = null;
  }

  /**
   * Initialize the connection manager
   */
  async initialize() {
    // Start the main client
    this.mainClient = await this.createClient('Main client');
    
    // Initialize the watchdog
    this.startWatchdog();
    
    return this.mainClient;
  }
  
  /**
   * Create a Telegram client
   * @param {string} name Identifier for this client
   * @returns {Promise<TelegramClient>} The Telegram client
   */
  async createClient(name) {
    try {
      logger.info(`Creating new Telegram client: ${name}`);
      
      const stringSession = new StringSession(config.telegram.sessionString || '');
      
      const client = new TelegramClient(
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
      
      // Connect the client
      logger.info(`Connecting ${name} to Telegram...`);
      await client.connect();
      
      // Verify connection
      const me = await client.getMe();
      logger.info(`${name} connected as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
      
      // Set client name property for logging
      client.clientName = name;
      
      return client;
    } catch (error) {
      logger.error(`Failed to create Telegram client ${name}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a client specifically for media operations
   * @returns {Promise<TelegramClient>} Telegram client for media
   */
  async getMediaClient() {
    try {
      // Create a new media client if needed or reconnect existing one
      if (!this.mediaClient || !this.mediaClient.connected) {
        if (this.mediaClient) {
          try {
            await this.mediaClient.disconnect();
          } catch (e) {
            // Ignore disconnection errors
          }
        }
        
        this.mediaClient = await this.createClient('Media client');
      }
      
      return this.mediaClient;
    } catch (error) {
      logger.error(`Error getting media client: ${error.message}`);
      
      // If we can't create a media client, try using the main client
      if (this.mainClient && this.mainClient.connected) {
        logger.info('Using main client as fallback for media operations');
        return this.mainClient;
      }
      
      throw error;
    }
  }
  
  /**
   * Record a message received event
   */
  recordMessageReceived() {
    this.lastMessageTimestamp = Date.now();
  }
  
  /**
   * Start the watchdog to monitor client health
   */
  startWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }
    
    this.watchdogInterval = setInterval(async () => {
      try {
        // Check if we've received messages recently
        const timeSinceLastMessage = Date.now() - this.lastMessageTimestamp;
        const maxSilentPeriod = 10 * 60 * 1000; // 10 minutes
        
        if (timeSinceLastMessage > maxSilentPeriod) {
          logger.warn(`No messages received for ${timeSinceLastMessage / 1000} seconds, checking client health...`);
          
          // Check if client is truly connected by making an API call
          let clientHealthy = false;
          
          if (this.mainClient && this.mainClient.connected) {
            try {
              // Try to get dialogs as a test
              await this.mainClient.getDialogs({ limit: 1 });
              clientHealthy = true;
              logger.info('Main client is healthy');
            } catch (e) {
              logger.error(`Main client health check failed: ${e.message}`);
            }
          }
          
          if (!clientHealthy) {
            logger.warn('Client appears unhealthy, forcing reconnection');
            await this.forceReconnect();
          }
        }
        
        // Also check main client connection state
        if (this.mainClient && !this.mainClient.connected) {
          logger.warn('Main client disconnected, reconnecting...');
          try {
            await this.mainClient.connect();
            logger.info('Main client reconnected');
          } catch (e) {
            logger.error(`Failed to reconnect main client: ${e.message}`);
          }
        }
      } catch (error) {
        logger.error(`Error in watchdog: ${error.message}`);
      }
    }, 60000); // Check every minute
    
    logger.info('Telegram connection watchdog started');
  }
  
  /**
   * Force a complete reconnection of the main client
   */
  async forceReconnect() {
    try {
      logger.info('Forcing complete client reconnection');
      
      // Clean up existing client
      if (this.mainClient) {
        try {
          await this.mainClient.disconnect();
        } catch (e) {
          // Ignore disconnection errors
        }
      }
      
      // Create a fresh client
      this.mainClient = await this.createClient('Reconnected main client');
      
      // Notify the application
      logger.info('Client successfully reconnected');
      
      // Return the new client
      return this.mainClient;
    } catch (error) {
      logger.error(`Force reconnect failed: ${error.message}`);
      throw error;
    }
  }
}

// Export singleton instance
const connectionManager = new ConnectionManager();
module.exports = connectionManager;