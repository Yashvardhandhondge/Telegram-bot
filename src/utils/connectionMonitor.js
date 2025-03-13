// Add this to your telegramAuth.js file or create a new utils/connectionMonitor.js

const logger = require('./logger');

// Connection states
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting', 
  CONNECTED: 'connected'
};

// Global connection variables
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL = 5000; // 5 seconds

/**
 * Setup connection monitoring for a Telegram client
 * @param {TelegramClient} client Telegram client instance
 */
function setupConnectionMonitoring(client) {
  // Set up connection state event listeners
  client.addEventHandler((update) => {
    if (update.className === 'UpdateConnectionState') {
      if (update.state.className === 'ConnectionStateDisconnected') {
        logger.warn('Telegram client disconnected');
        handleDisconnect(client);
      } else if (update.state.className === 'ConnectionStateConnecting') {
        logger.info('Telegram client connecting...');
      } else if (update.state.className === 'ConnectionStateConnected') {
        logger.info('Telegram client connected');
        reconnectAttempts = 0; // Reset reconnect counter on successful connection
      }
    }
  });
  
  // Periodic connection check
  setInterval(() => {
    checkConnection(client);
  }, 60000); // Check every minute
  
  logger.info('Connection monitoring set up for Telegram client');
}

/**
 * Check connection status and reconnect if needed
 * @param {TelegramClient} client Telegram client instance
 */
async function checkConnection(client) {
  try {
    if (!client.connected) {
      logger.warn('Client disconnected, attempting to reconnect...');
      await handleDisconnect(client);
    } else {
      // Try a ping to verify the connection is really working
      try {
        const { Api } = require('telegram');
        await client.invoke(new Api.Ping({
          pingId: BigInt(Math.floor(Math.random() * 1000000000))
        }));
        logger.debug('Connection ping successful');
      } catch (pingError) {
        logger.warn(`Ping failed: ${pingError.message}`);
        await handleDisconnect(client);
      }
    }
  } catch (error) {
    logger.error(`Error in connection check: ${error.message}`, { error });
  }
}

/**
 * Handle client disconnection and attempt reconnection
 * @param {TelegramClient} client Telegram client instance
 */
async function handleDisconnect(client) {
  reconnectAttempts++;
  
  // Check if we've exceeded maximum attempts
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    logger.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    logger.info('Recreating client from scratch...');
    
    try {
      // Try a complete client reset
      // First disconnect if needed
      try {
        if (client.connected) {
          await client.disconnect();
        }
      } catch (e) {
        // Ignore disconnection errors
      }
      
      // Create a new session and reconnect
      const { initializeClient } = require('./telegramAuth');
      const newClient = await initializeClient();
      
      // Replace the global client instance
      const listenerModule = require('../listener');
      if (listenerModule && listenerModule.updateClient) {
        listenerModule.updateClient(newClient);
        logger.info('Client replaced with a new instance');
      }
      
      reconnectAttempts = 0;
      return;
    } catch (resetError) {
      logger.error(`Error resetting client: ${resetError.message}`);
      // Continue with normal reconnect attempt as a fallback
    }
  }
  
  logger.info(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
  
  try {
    // First disconnect if needed
    try {
      if (client.connected) {
        await client.disconnect();
      }
    } catch (e) {
      // Ignore disconnection errors
    }
    
    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_INTERVAL));
    
    // Try to reconnect
    logger.info('Attempting to reconnect...');
    await client.connect();
    
    if (client.connected) {
      logger.info('Successfully reconnected');
      reconnectAttempts = 0;
    } else {
      logger.warn('Reconnect failed - client still disconnected');
    }
  } catch (error) {
    logger.error(`Error during reconnect: ${error.message}`, { error });
  }
}

module.exports = {
  setupConnectionMonitoring,
  checkConnection,
  handleDisconnect,
  ConnectionState
};