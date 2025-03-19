#!/usr/bin/env node

/**
 * Utility script to manage PNL channel mappings
 */
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Path to the mapping file
const mappingPath = path.join(__dirname, '../config/pnl-mapping.json');

/**
 * Load the current mapping
 * @returns {Object} Mapping object
 */
function loadMapping() {
  try {
    if (fs.existsSync(mappingPath)) {
      const data = fs.readFileSync(mappingPath, 'utf8');
      return JSON.parse(data);
    } else {
      return { signalSources: {} };
    }
  } catch (error) {
    console.error(`Error loading mapping: ${error.message}`);
    return { signalSources: {} };
  }
}

/**
 * Save mapping to file
 * @param {Object} mapping Mapping object
 */
function saveMapping(mapping) {
  try {
    const dir = path.dirname(mappingPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
    console.log(`PNL mapping saved to ${mappingPath}`);
  } catch (error) {
    console.error(`Error saving mapping: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Add a new channel mapping
 * @param {string} sourceChannel Source channel ID
 * @param {string} destinationChannel Destination channel ID
 */
function addMapping(sourceChannel, destinationChannel) {
  try {
    const mapping = loadMapping();
    
    // Add the mapping
    mapping.signalSources[sourceChannel] = destinationChannel;
    
    // Save updated mapping
    saveMapping(mapping);
    
    console.log(`Added mapping: ${sourceChannel} -> ${destinationChannel}`);
  } catch (error) {
    console.error(`Error adding mapping: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Remove a channel mapping
 * @param {string} sourceChannel Source channel ID to remove
 */
function removeMapping(sourceChannel) {
  try {
    const mapping = loadMapping();
    
    // Check if the mapping exists
    if (mapping.signalSources[sourceChannel]) {
      // Remove the mapping
      delete mapping.signalSources[sourceChannel];
      
      // Save updated mapping
      saveMapping(mapping);
      
      console.log(`Removed mapping for source channel: ${sourceChannel}`);
    } else {
      console.error(`No mapping found for source channel: ${sourceChannel}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error removing mapping: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all current mappings
 */
function listMappings() {
  try {
    const mapping = loadMapping();
    const sources = Object.keys(mapping.signalSources);
    
    if (sources.length === 0) {
      console.log('No channel mappings configured');
      return;
    }
    
    console.log('Current PNL channel mappings:');
    console.log('---------------------------');
    
    for (const source in mapping.signalSources) {
      console.log(`${source} -> ${mapping.signalSources[source]}`);
    }
  } catch (error) {
    console.error(`Error listing mappings: ${error.message}`);
    process.exit(1);
  }
}

// Set up command-line program
program
  .name('pnl-mapping')
  .description('Manage PNL channel mappings');

program
  .command('list')
  .description('List all channel mappings')
  .action(() => {
    listMappings();
  });

program
  .command('add')
  .description('Add a new channel mapping')
  .argument('<sourceChannel>', 'Source channel ID')
  .argument('<destinationChannel>', 'Destination channel ID')
  .action((sourceChannel, destinationChannel) => {
    addMapping(sourceChannel, destinationChannel);
  });

program
  .command('remove')
  .description('Remove a channel mapping')
  .argument('<sourceChannel>', 'Source channel ID to remove')
  .action((sourceChannel) => {
    removeMapping(sourceChannel);
  });

program
  .command('create-default')
  .description('Create a default mapping file')
  .action(() => {
    const defaultMapping = {
      signalSources: {
        "-1002404846297/5": "-1002404846297/178"
      }
    };
    
    saveMapping(defaultMapping);
    console.log('Default mapping file created');
  });

// Parse command line arguments
program.parse(process.argv);

// Display help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}