// Add this to a new file utils/tempDir.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

/**
 * Find a writable temp directory
 * @returns {string} Path to a writable temp directory
 */
function getWritableTempDir() {
  const options = [
    // First try project-specific temp directory
    path.join(process.cwd(), 'temp'),
    // Try OS temp directory with project subfolder
    path.join(os.tmpdir(), 'telegram-forwarder'),
    // Try user home directory with project subfolder
    path.join(os.homedir(), '.telegram-forwarder', 'temp'),
    // Fallback to just OS temp directory
    os.tmpdir()
  ];
  
  for (const dir of options) {
    try {
      // Create the directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Test write access by creating and removing a test file
      const testFile = path.join(dir, `write-test-${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      
      logger.info(`Using temp directory: ${dir}`);
      return dir;
    } catch (error) {
      logger.warn(`Cannot use directory ${dir}: ${error.message}`);
    }
  }
  
  // If all fails, throw error
  throw new Error('Could not find any writable temporary directory');
}

// Export the function
module.exports = getWritableTempDir;