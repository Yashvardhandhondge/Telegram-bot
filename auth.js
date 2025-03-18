const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const apiId = 23744550;
const apiHash = '460193db1293c030a3fd78eb6f4ebef6';

async function generateSession() {
  console.log('Generating new Telegram session string...');
  
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
  
  // Save the session string
  const sessionString = client.session.save();
  console.log('\nHere is your session string:');
  console.log(sessionString);
  console.log('\nAdd this to your .env.pnl file as TELEGRAM_SESSION_STRING');
  
  await client.disconnect();
  process.exit(0);
}

generateSession().catch(console.error);