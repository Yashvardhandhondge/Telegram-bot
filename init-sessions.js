const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

const apiId = 23744550;
const apiHash = '460193db1293c030a3fd78eb6f4ebef6';

async function generateSession(sessionType) {
  console.log(`Generating new Telegram session for: ${sessionType}`);
  
  const sessionDir = path.join(__dirname, 'tmp', 'sessions', sessionType === 'user' ? 'user' : 'pnl_bot');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  const client = new TelegramClient(
    new StringSession(''), // Start with empty session
    apiId,
    apiHash,
    {
      connectionRetries: 5,
    }
  );
  
  await client.start({
    phoneNumber: async () => await input.text('Enter your phone number: '),
    password: async () => await input.text('Enter your password: '),
    phoneCode: async () => await input.text('Enter the code you received: '),
    onError: (err) => console.error(err),
  });
  
  // Save the session string to file
  const sessionString = client.session.save();
  const sessionFile = path.join(sessionDir, 'session.txt');
  fs.writeFileSync(sessionFile, sessionString);
  
  console.log(`\nSession saved to: ${sessionFile}`);
  console.log('You can now use this session for your application.');
  
  await client.disconnect();
}

// Check which session to generate
const sessionType = process.argv[2];
if (sessionType !== 'user' && sessionType !== 'pnl') {
  console.log('Please specify session type: node init-sessions.js user OR node init-sessions.js pnl');
  process.exit(1);
}

generateSession(sessionType).catch(console.error);