const config = require('./config');
const { normalizeChannelId, findMatchingKey } = require('./utils/chatIdMapper');

// Load mapping
const mapping = config.loadChannelMapping();
console.log('=== LOADED MAPPING ===');
console.log(JSON.stringify(mapping, null, 2));

// Test mapping with actual messages
const testSourceIds = [
  '1837391930', 
  '4721232146', 
  '4667627446', 
  '4742530327',
  // With thread IDs
  '1837391930/4016',
  // With minus signs
  '-1837391930',
  '-4721232146',
];

console.log('\n=== TESTING SOURCE CHANNEL MATCHING ===');
for (const testId of testSourceIds) {
  const normalizedIds = normalizeChannelId(testId);
  
  console.log(`\nTesting source ID: ${testId}`);
  console.log(`Normalized formats: ${JSON.stringify(normalizedIds)}`);
  
  let matched = false;
  
  // Test if any of the normalized IDs match our mapping
  for (const user in mapping) {
    const matchedKey = findMatchingKey(mapping[user], testId);
    
    if (matchedKey) {
      console.log(`✅ MATCHED in user "${user}" with key "${matchedKey}"`);
      console.log(`Destination channels: ${JSON.stringify(mapping[user][matchedKey])}`);
      matched = true;
    }
  }
  
  if (!matched) {
    console.log(`❌ NO MATCH for ${testId} in any user mapping`);
  }
}

console.log('\n=== TESTING DESTINATION CHANNEL FORMATS ===');
// Get all destination channels
const destinationChannels = new Set();
for (const user in mapping) {
  for (const sourceChannel in mapping[user]) {
    const destinations = mapping[user][sourceChannel];
    if (Array.isArray(destinations)) {
      destinations.forEach(dest => destinationChannels.add(dest));
    }
  }
}

console.log(`Found ${destinationChannels.size} unique destination channels`);
for (const channelId of destinationChannels) {
  console.log(`Destination channel: ${channelId}`);
  console.log(`Normalized as: ${JSON.stringify(normalizeChannelId(channelId))}`);
}