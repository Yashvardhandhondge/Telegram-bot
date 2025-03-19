/**
 * Script to generate a new Telegram session string for the PNL bot
 * This should be run after you've obtained PNL_TELEGRAM_API_ID and PNL_TELEGRAM_API_HASH
 */
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

async function generatePnlSession() {
  try {
    // Check if we have PNL API credentials
    if (!process.env.PNL_TELEGRAM_API_ID || !process.env.PNL_TELEGRAM_API_HASH) {
      console.error('ERROR: PNL_TELEGRAM_API_ID and PNL_TELEGRAM_API_HASH must be set in your .env file');
      console.error('Please create API credentials at https://my.telegram.org/apps first');
      process.exit(1);
    }
    
    console.log('Starting PNL bot session generation...');
    
    // Create client with PNL credentials
    const apiId = parseInt(process.env.PNL_TELEGRAM_API_ID);
    const apiHash = process.env.PNL_TELEGRAM_API_HASH;
    
    const client = new TelegramClient(
      new StringSession(''), // Empty session to start fresh
      apiId,
      apiHash,
      {
        deviceModel: 'PNL Bot',
        appVersion: '1.0.0',
      }
    );
    
    // Start authentication
    console.log('Please follow the prompts to authenticate with Telegram');
    await client.start({
      phoneNumber: async () => await input.text('Phone number: '),
      password: async () => await input.text('Password (if needed): '),
      phoneCode: async () => await input.text('Verification code: '),
      onError: (err) => console.error('Authentication error:', err),
    });
    
    // Get the session string
    const sessionString = client.session.save();
    
    console.log('\n================ PNL BOT SESSION STRING ================');
    console.log(sessionString);
    console.log('=========================================================');
    console.log('\nAdd this to your .env file as PNL_TELEGRAM_SESSION_STRING');
    
    // Disconnect the client
    await client.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error generating session:', error.message);
    process.exit(1);
  }
}

// Run the script
generatePnlSession();