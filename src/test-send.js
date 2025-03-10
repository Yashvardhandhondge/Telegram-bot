const axios = require('axios');
require('dotenv').config();

// Get bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN not set in environment variables');
  process.exit(1);
}

// Load your channel mapping
const channelMapping = require('./config/mapping.json');

// Extract all destination channels
const destinationChannels = new Set();
for (const user in channelMapping) {
  for (const sourceId in channelMapping[user]) {
    const destinations = channelMapping[user][sourceId];
    destinations.forEach(dest => {
      // Remove any minus sign as Bot API doesn't need it
      destinationChannels.add(dest);
    });
  }
}

// Function to send a test message
async function sendTestMessage(chatId) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const params = {
      chat_id: chatId,
      text: `Test message from Telegram Bot\nTimestamp: ${new Date().toISOString()}`,
      parse_mode: 'HTML'
    };
    
    console.log(`Sending message to chat ${chatId}...`);
    const response = await axios.post(url, params);
    
    if (response.data && response.data.ok) {
      console.log(`✅ SUCCESS: Message sent to ${chatId}`);
      return true;
    } else {
      console.log(`❌ FAILED: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    if (error.response && error.response.data) {
      console.log(`❌ ERROR: ${error.response.data.description}`);
    } else {
      console.log(`❌ ERROR: ${error.message}`);
    }
    return false;
  }
}

// Test sending messages to all destination channels
async function testBotSending() {
  console.log(`Testing bot: ${botToken.split(':')[0]}...`);
  console.log(`Found ${destinationChannels.size} destination channels to test`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const chatId of destinationChannels) {
    const success = await sendTestMessage(chatId);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  console.log(`\nTest results: ${successCount} successful, ${failCount} failed`);
}

// Run the test
testBotSending().catch(console.error);