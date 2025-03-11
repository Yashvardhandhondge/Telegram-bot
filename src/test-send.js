/**
 * Test script for media forwarding
 * 
 * This script will send various types of media messages to a source channel
 * to test if they are correctly forwarded to destination channels.
 * 
 * Run this script with: node test-media-forwarding.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SOURCE_CHANNEL = process.env.TEST_SOURCE_CHANNEL; // ID of a source channel the bot is monitoring

// Check required environment variables
if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN not set in environment');
  process.exit(1);
}

if (!SOURCE_CHANNEL) {
  console.error('Error: TEST_SOURCE_CHANNEL not set in environment');
  console.error('Please set the ID of a source channel that your bot is monitoring');
  process.exit(1);
}

// Define test media files - replace with actual file paths or use the sample data
const TEST_FILES = {
  photo: './test-media/test-image.jpg',    // A test image
  document: './test-media/test-doc.pdf',   // A test document
  video: './test-media/test-video.mp4',    // A test video
  audio: './test-media/test-audio.mp3',    // A test audio file
};

// Create test media directory if it doesn't exist
if (!fs.existsSync('./test-media')) {
  fs.mkdirSync('./test-media');
}

// Function to create sample test files if they don't exist
async function createSampleFiles() {
  // Create a simple test image if it doesn't exist
  if (!fs.existsSync(TEST_FILES.photo)) {
    console.log('Creating sample test image...');
    // Download a placeholder image
    try {
      const response = await axios.get('https://picsum.photos/400/300', { responseType: 'arraybuffer' });
      fs.writeFileSync(TEST_FILES.photo, response.data);
      console.log(`Created sample image at ${TEST_FILES.photo}`);
    } catch (error) {
      console.error('Error creating sample image:', error.message);
    }
  }

  // Create a simple PDF document if it doesn't exist
  if (!fs.existsSync(TEST_FILES.document)) {
    console.log('Creating sample test document...');
    // Create a minimal PDF
    const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000102 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF';
    fs.writeFileSync(TEST_FILES.document, pdfContent);
    console.log(`Created sample document at ${TEST_FILES.document}`);
  }

  // For video and audio, we'll just inform the user they need to provide these files
  if (!fs.existsSync(TEST_FILES.video)) {
    console.log(`Test video file not found at ${TEST_FILES.video}`);
    console.log('Please provide your own test video file or modify the script to skip video testing');
  }

  if (!fs.existsSync(TEST_FILES.audio)) {
    console.log(`Test audio file not found at ${TEST_FILES.audio}`);
    console.log('Please provide your own test audio file or modify the script to skip audio testing');
  }
}

// Function to send a text message to a chat
async function sendTextMessage(chatId, text) {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
    });

    if (response.data && response.data.ok) {
      console.log(`Successfully sent text message to ${chatId}`);
      return response.data.result;
    } else {
      console.error('Failed to send text message:', response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error('Error sending text message:', error.response.data);
    } else {
      console.error('Error sending text message:', error.message);
    }
    return null;
  }
}

// Function to send a photo to a chat
async function sendPhoto(chatId, photoPath, caption) {
  try {
    if (!fs.existsSync(photoPath)) {
      console.error(`Photo file not found: ${photoPath}`);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', fs.createReadStream(photoPath));
    
    if (caption) {
      formData.append('caption', caption);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data && response.data.ok) {
      console.log(`Successfully sent photo to ${chatId}`);
      return response.data.result;
    } else {
      console.error('Failed to send photo:', response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error('Error sending photo:', error.response.data);
    } else {
      console.error('Error sending photo:', error.message);
    }
    return null;
  }
}

// Function to send a document to a chat
async function sendDocument(chatId, docPath, caption) {
  try {
    if (!fs.existsSync(docPath)) {
      console.error(`Document file not found: ${docPath}`);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', fs.createReadStream(docPath));
    
    if (caption) {
      formData.append('caption', caption);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data && response.data.ok) {
      console.log(`Successfully sent document to ${chatId}`);
      return response.data.result;
    } else {
      console.error('Failed to send document:', response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error('Error sending document:', error.response.data);
    } else {
      console.error('Error sending document:', error.message);
    }
    return null;
  }
}

// Function to send a video to a chat
async function sendVideo(chatId, videoPath, caption) {
  try {
    if (!fs.existsSync(videoPath)) {
      console.error(`Video file not found: ${videoPath}`);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('video', fs.createReadStream(videoPath));
    
    if (caption) {
      formData.append('caption', caption);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data && response.data.ok) {
      console.log(`Successfully sent video to ${chatId}`);
      return response.data.result;
    } else {
      console.error('Failed to send video:', response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error('Error sending video:', error.response.data);
    } else {
      console.error('Error sending video:', error.message);
    }
    return null;
  }
}

// Function to send an audio file to a chat
async function sendAudio(chatId, audioPath, caption) {
  try {
    if (!fs.existsSync(audioPath)) {
      console.error(`Audio file not found: ${audioPath}`);
      return null;
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', fs.createReadStream(audioPath));
    
    if (caption) {
      formData.append('caption', caption);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );

    if (response.data && response.data.ok) {
      console.log(`Successfully sent audio to ${chatId}`);
      return response.data.result;
    } else {
      console.error('Failed to send audio:', response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error('Error sending audio:', error.response.data);
    } else {
      console.error('Error sending audio:', error.message);
    }
    return null;
  }
}

// Run all tests sequentially
async function runTests() {
  console.log('\n------------------------------------');
  console.log('MEDIA FORWARDING TEST SCRIPT');
  console.log('------------------------------------');
  console.log(`Using source channel: ${SOURCE_CHANNEL}`);
  console.log('Make sure your bot is running and monitoring this channel.');
  console.log('------------------------------------\n');

  try {
    // Create sample test files if needed
    await createSampleFiles();

    // Start with a text message to confirm the bot is running
    console.log('\n[TEST 1] Sending text-only message...');
    await sendTextMessage(
      SOURCE_CHANNEL, 
      'This is a test message for media forwarding. If you see this message in the destination channels, the bot is working correctly for text messages.'
    );
    console.log('Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test photo
    if (fs.existsSync(TEST_FILES.photo)) {
      console.log('\n[TEST 2] Sending photo with caption...');
      await sendPhoto(
        SOURCE_CHANNEL,
        TEST_FILES.photo,
        'This is a test photo with caption. It should be forwarded to destination channels.'
      );
      console.log('Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log('\n[TEST 3] Sending photo without caption...');
      await sendPhoto(SOURCE_CHANNEL, TEST_FILES.photo);
      console.log('Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Test document
    if (fs.existsSync(TEST_FILES.document)) {
      console.log('\n[TEST 4] Sending document with caption...');
      await sendDocument(
        SOURCE_CHANNEL,
        TEST_FILES.document,
        'This is a test document with caption. It should be forwarded to destination channels.'
      );
      console.log('Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Test video if available
    if (fs.existsSync(TEST_FILES.video)) {
      console.log('\n[TEST 5] Sending video with caption...');
      await sendVideo(
        SOURCE_CHANNEL,
        TEST_FILES.video,
        'This is a test video with caption. It should be forwarded to destination channels.'
      );
      console.log('Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log('\n[TEST 5] Skipped - No test video file available');
    }

    // Test audio if available
    if (fs.existsSync(TEST_FILES.audio)) {
      console.log('\n[TEST 6] Sending audio with caption...');
      await sendAudio(
        SOURCE_CHANNEL,
        TEST_FILES.audio,
        'This is a test audio file with caption. It should be forwarded to destination channels.'
      );
      console.log('Waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log('\n[TEST 6] Skipped - No test audio file available');
    }

    console.log('\n------------------------------------');
    console.log('TESTS COMPLETED');
    console.log('------------------------------------');
    console.log('Check your destination channels to see if the messages were forwarded correctly.');
    console.log('If the media messages were not forwarded, check the bot logs for errors.');

  } catch (error) {
    console.error('Error running tests:', error.message);
  }
}

// Run the tests
runTests();