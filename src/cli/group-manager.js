#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { Api } = require('telegram');
const logger = require('../utils/logger');
const groupAiService = require('../services/groupAiService');
const channelAuth = require('./channel-auth-manager');
require('dotenv').config();

/**
 * Create or update Telegram groups based on configuration
 * @param {string} configPath Path to the configuration file
 * @returns {Promise<void>}
 */
async function createOrUpdateGroups(configPath) {
  try {
    logger.info(`Starting group management with config: ${configPath}`);
    
    // Read and parse config file
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    if (!Array.isArray(config)) {
      throw new Error('Config must be an array of group configurations');
    }
    
    // Initialize Telegram client using phone number authentication
    // This always creates a new session separate from the main app
    const { client, phoneNumber } = await channelAuth.authenticateForChannelCreation();
    
    // Process each group in the config
    const groupMapping = {};
    
    for (const groupConfig of config) {
      try {
        const groupResult = await processGroup(client, groupConfig);
        groupMapping[groupResult.name] = groupResult.id;
        logger.info(`Processed group: ${groupResult.name} with ID: ${groupResult.id}`);
      } catch (groupError) {
        logger.error(`Error processing group ${groupConfig.name || 'unnamed'}: ${groupError.message}`);
      }
    }
    
    // Write the output mapping file
    const outputPath = path.join(process.cwd(), 'group-mapping.json');
    fs.writeFileSync(outputPath, JSON.stringify(groupMapping, null, 2));
    logger.info(`Group mapping saved to: ${outputPath}`);
    
    // Disconnect the client when done
    await client.disconnect();
    logger.info('Disconnected from Telegram');
    
    return groupMapping;
  } catch (error) {
    logger.error(`Error managing groups: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Process a single group configuration (create or update)
 * @param {TelegramClient} client Telegram client
 * @param {Object} groupConfig Group configuration
 * @returns {Promise<Object>} Object with group name and ID
 */
async function processGroup(client, groupConfig) {
  let group;
  
  try {
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate name and description using AI if not provided
    const groupName = groupConfig.name || await generateGroupName(groupConfig);
    const groupDescription = groupConfig.description || await generateGroupDescription(groupConfig);
    
    logger.info(`Processing group: ${groupName}`);
    
    try {
      // Create or update group
      if (groupConfig.id) {
        group = await updateGroup(client, groupConfig.id, {
          title: groupName,
          description: groupDescription,
          ...groupConfig
        });
      } else {
        group = await createGroup(client, {
          title: groupName,
          description: groupDescription,
          ...groupConfig
        });
      }

      // Process settings only if group creation/update succeeded  
      if (group) {
        // Wait before applying settings
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          await configureGroupSettings(client, group, groupConfig);
        } catch (settingsError) {
          logger.warn(`Error configuring settings for ${groupName}: ${settingsError.message}`);
        }

        if (groupConfig.admins?.length) {
          try {
            await addGroupAdmins(client, group, groupConfig.admins);
          } catch (adminsError) {
            logger.warn(`Error adding admins for ${groupName}: ${adminsError.message}`);
          }
        }

        if (groupConfig.permissions) {
          try {
            await configureGroupPermissions(client, group, groupConfig.permissions);
          } catch (permissionsError) {
            logger.warn(`Error configuring permissions for ${groupName}: ${permissionsError.message}`);
          }
        }

        if (groupConfig.topics?.length) {
          try {
            await createGroupTopics(client, group, groupConfig.topics);
          } catch (topicsError) {
            logger.warn(`Error creating topics for ${groupName}: ${topicsError.message}`);
          }
        }
      }

      return {
        name: groupName,
        id: group.id.toString()
      };
    } catch (error) {
      throw error;
    }
  } catch (error) {
    logger.error(`Error processing group: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Create a new Telegram group
 * @param {TelegramClient} client Telegram client
 * @param {Object} options Group creation options
 * @returns {Promise<Object>} Created group entity
 */
async function createGroup(client, options) {
  try {
    logger.info(`Creating new group: ${options.title}`);
    
    // Create group
    const result = await client.invoke(new Api.channels.CreateChannel({
      title: options.title,
      about: options.description || '',
      broadcast: false,
      megagroup: true // Always create as supergroup for better features
    }));

    if (!result?.chats?.[0]) {
      throw new Error('Failed to create group: Invalid response');
    }

    const createdGroup = result.chats[0];
    logger.info(`Group created: ${options.title} with ID: ${createdGroup.id}`);

    // Wait before applying settings
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Set privacy settings
    if (options.type === 'private') {
      try {
        // First try to set a temporary username (if needed)
        const tempUsername = `group${Math.floor(Math.random() * 1000000)}`;
        await client.invoke(new Api.channels.UpdateUsername({
          channel: createdGroup,
          username: tempUsername
        }));
        
        // Then remove the username to make it private
        await client.invoke(new Api.channels.UpdateUsername({
          channel: createdGroup,
          username: ''
        }));
        
        logger.info(`Set group ${options.title} to private`);
      } catch (privacyError) {
        if (!privacyError.message.includes('USERNAME_NOT_MODIFIED')) {
          logger.warn(`Could not set privacy for group ${options.title}: ${privacyError.message}`);
        }
      }
    }

    return createdGroup;
  } catch (error) {
    if (error.message.includes('flood')) {
      // Handle flood wait
      const waitTime = 3000; // 3 seconds
      logger.info(`Rate limited, waiting ${waitTime}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return await createGroup(client, options); // Retry
    }
    logger.error(`Error creating group ${options.title}: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Update an existing Telegram group
 * @param {TelegramClient} client Telegram client
 * @param {string} groupId Group ID to update
 * @param {Object} options Group update options
 * @returns {Promise<Object>} Updated group entity
 */
async function updateGroup(client, groupId, options) {
  try {
    logger.info(`Updating group ${groupId}: ${options.title}`);
    
    // First get the existing group to verify it exists
    const entity = await client.getEntity(groupId);
    
    // Update title and about
    await client.invoke(new Api.channels.EditTitle({
      channel: entity,
      title: options.title
    }));
    
    await client.invoke(new Api.channels.EditAbout({
      channel: entity,
      about: options.description || ''
    }));
    
    logger.info(`Group ${groupId} updated`);
    return entity;
  } catch (error) {
    logger.error(`Error updating group ${groupId}: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Configure group settings
 * @param {TelegramClient} client Telegram client
 * @param {Object} group Group entity
 * @param {Object} config Group configuration
 * @returns {Promise<void>}
 */
async function configureGroupSettings(client, group, config) {
  try {
    logger.info(`Configuring settings for group: ${group.id}`);
    
    // Get self user info
    const me = await client.getMe();
    
    // Only try to set admin rights if we're not already the creator
    try {
      const fullChannel = await client.invoke(new Api.channels.GetFullChannel({
        channel: group
      }));
      
      if (fullChannel?.full_chat?.creator) {
        await client.invoke(new Api.channels.EditAdmin({
          channel: group,
          userId: new Api.InputUser({
            userId: me.id,
            accessHash: me.accessHash || 0
          }),
          adminRights: new Api.ChatAdminRights({
            changeInfo: true,
            postMessages: true,
            editMessages: true,
            deleteMessages: true,
            banUsers: true,
            inviteUsers: true,
            pinMessages: true,
            addAdmins: true,
            anonymous: false,
            manageCall: true,
            other: true,
            manageTopics: true,
          }),
          rank: 'Owner'
        }));
      }
    } catch (adminError) {
      logger.warn(`Could not set admin rights: ${adminError.message}`);
    }
    
    // Configure privacy settings
    const isPrivate = config.type !== 'public';
    const historyVisible = config.visibleHistoryForNewMember !== false;
    const restrictSavingContent = config.restrictSavingContent !== false;
    
    try {
      // Set history visibility only if we can get current settings
      const currentSettings = await client.invoke(new Api.channels.GetFullChannel({
        channel: group
      }));
      
      // Only proceed if we have valid settings
      if (currentSettings?.full_chat) {
        const needsHistoryUpdate = currentSettings.full_chat.hidden_prehistory !== !historyVisible;
        
        if (needsHistoryUpdate) {
          await client.invoke(new Api.channels.TogglePreHistoryHidden({
            channel: group,
            enabled: !historyVisible
          }));
          logger.info(`Updated history visibility for group ${group.id}`);
        }
      }
    } catch (historyError) {
      logger.warn(`Could not update history visibility: ${historyError.message}`);
    }
    
    // Set content protection
    try {
      await client.invoke(new Api.messages.ToggleNoForwards({
        peer: group,
        enabled: restrictSavingContent
      }));
    } catch (protectionError) {
      logger.warn(`Could not set content protection: ${protectionError.message}`);
    }
    
    logger.info(`Group settings configured for: ${group.id}`);
  } catch (error) {
    logger.error(`Error configuring group settings for ${group.id}: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Add admins to a group
 * @param {TelegramClient} client Telegram client
 * @param {Object} group Group entity
 * @param {string[]} admins Array of admin usernames or IDs
 * @returns {Promise<void>}
 */
async function addGroupAdmins(client, group, admins) {
  try {
    logger.info(`Adding ${admins.length} admins to group ${group.id}`);
    
    for (const admin of admins) {
      try {
        // Get entity for admin
        const adminEntity = await client.getEntity(admin);
        
        // Add as admin
        await client.invoke(new Api.channels.EditAdmin({
          channel: group,
          userId: adminEntity,
          adminRights: new Api.ChatAdminRights({
            changeInfo: true,
            postMessages: true,
            editMessages: true,
            deleteMessages: true,
            banUsers: true,
            inviteUsers: true,
            pinMessages: true,
            addAdmins: false,
            anonymous: false,
            manageCall: true,
            other: true,
            manageTopics: true,
          }),
          rank: 'Admin'
        }));
        
        logger.info(`Added ${admin} as admin to group ${group.id}`);
      } catch (error) {
        logger.error(`Error adding admin ${admin}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error adding admins to group ${group.id}: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Configure group permissions
 * @param {TelegramClient} client Telegram client
 * @param {Object} group Group entity
 * @param {Object} permissions Permission configuration
 * @returns {Promise<void>}
 */
async function configureGroupPermissions(client, group, permissions) {
  try {
    logger.info(`Configuring permissions for group ${group.id}`);
    
    // Set default permissions
    const defaultActions = permissions.actions || {
      sendMessages: false,
      sendMedia: false,
      addMembers: false,
      pinMessages: false,
      createTopics: false,
      changeGroupInfo: false
    };

    await setGroupDefaultPermissions(client, group, defaultActions);
    
    // Process exceptions
    if (permissions.exceptions && typeof permissions.exceptions === 'object') {
      for (const username in permissions.exceptions) {
        try {
          await setUserPermissions(client, group, username, permissions.exceptions[username]);
        } catch (error) {
          logger.warn(`Error setting permissions for ${username}: ${error.message}`);
        }
      }
    }
    
    logger.info(`Permissions configured for group ${group.id}`);
  } catch (error) {
    logger.error(`Error configuring permissions for group ${group.id}: ${error.message}`);
    throw error;
  }
}

async function setGroupDefaultPermissions(client, group, defaultActions) {
  try {
    // Create ChatBannedRights object
    const bannedRights = new Api.ChatBannedRights({
      untilDate: 0,
      viewMessages: false,
      sendMessages: !defaultActions.sendMessages,
      sendMedia: !defaultActions.sendMedia,
      sendStickers: !defaultActions.sendMedia,
      sendGifs: !defaultActions.sendMedia,
      sendGames: !defaultActions.sendMedia,
      sendInline: !defaultActions.sendMedia,
      embedLinks: !defaultActions.sendMedia,
      sendPolls: !defaultActions.sendMessages,
      changeInfo: !defaultActions.changeGroupInfo,
      inviteUsers: !defaultActions.addMembers,
      pinMessages: !defaultActions.pinMessages,
      manageTopics: !defaultActions.createTopics,
    });

    // Try multiple methods to set permissions
    try {
      await client.invoke(new Api.messages.EditChatDefaultBannedRights({
        peer: group,
        bannedRights
      }));
      logger.info(`Set default permissions using messages.EditChatDefaultBannedRights`);
      return;
    } catch (err1) {
      logger.warn(`First permission method failed: ${err1.message}`);
      try {
        const inputChannel = await client.getInputEntity(group);
        await client.invoke(new Api.channels.EditBanned({
          channel: inputChannel,
          participant: new Api.InputPeerEmpty(),
          bannedRights
        }));
        logger.info(`Set default permissions using channels.EditBanned`);
      } catch (err2) {
        logger.error(`All permission methods failed: ${err2.message}`);
        throw err2;
      }
    }
  } catch (error) {
    throw error;
  }
}

async function setUserPermissions(client, group, username, permissions) {
  try {
    // Get user entity
    const userEntity = await client.getEntity(username);
    if (!userEntity) {
      throw new Error(`Could not find user ${username}`);
    }

    // Get proper input formats
    const inputChannel = await client.getInputEntity(group);
    const inputUser = await client.getInputEntity(userEntity);

    // Convert permissions to banned rights (inverse logic)
    const bannedRights = new Api.ChatBannedRights({
      untilDate: 0,
      viewMessages: false,
      sendMessages: !permissions.sendMessages,
      sendMedia: !permissions.sendMedia,
      sendStickers: !permissions.sendMedia,
      sendGifs: !permissions.sendMedia,
      sendGames: !permissions.sendMedia,
      sendInline: !permissions.sendMedia,
      embedLinks: !permissions.sendMedia,
      sendPolls: !permissions.sendMessages,
      changeInfo: !permissions.changeGroupInfo,
      inviteUsers: !permissions.addMembers,
      pinMessages: !permissions.pinMessages,
      manageTopics: !permissions.createTopics,
    });

    // Set permissions for the user
    await client.invoke(new Api.channels.EditBanned({
      channel: inputChannel,
      participant: inputUser,
      bannedRights
    }));

    logger.info(`Successfully set permissions for ${username} in group ${group.id}`);
  } catch (error) {
    throw error;
  }
}

/**
 * Create topics in a supergroup
 * @param {TelegramClient} client Telegram client
 * @param {Object} group Group entity
 * @param {Array} topics Array of topic configurations
 * @returns {Promise<void>}
 */
async function createGroupTopics(client, group, topics) {
  try {
    logger.info(`Creating ${topics.length} topics in group ${group.id}`);
    
    // First make sure forum topics are enabled
    await client.invoke(new Api.channels.ToggleForum({
      channel: group,
      enabled: true
    }));
    
    // Create each topic
    for (const topic of topics) {
      try {
        // Generate topic name if not provided
        if (!topic.name) {
          topic.name = await groupAiService.generateTopicName();
          logger.info(`Generated topic name: ${topic.name}`);
        }
        
        // Generate topic description if not provided
        if (!topic.description) {
          topic.description = await groupAiService.generateTopicDescription(topic.name);
          logger.info(`Generated description for topic ${topic.name}: ${topic.description}`);
        }
        
        // Create the topic
        await client.invoke(new Api.channels.CreateForumTopic({
          channel: group,
          title: topic.name,
          iconColor: getRandomColor(),
          iconEmojiId: 0, // Would need emoji object handling for custom icons
          sendAs: null,  // Send as self
          random_id: Math.floor(Math.random() * 1000000),
        }));
        
        logger.info(`Created topic "${topic.name}" in group ${group.id}`);
        
        // Optional: You could also send a first message with the topic description
        // This helps users understand the purpose of the topic
        if (topic.description) {
          try {
            // Get the topic we just created
            const forumTopics = await client.invoke(new Api.channels.GetForumTopics({
              channel: group,
              limit: 10
            }));
            
            // Find our topic by name
            const createdTopic = forumTopics.topics.find(t => t.title === topic.name);
            
            if (createdTopic) {
              // Send the description as the first message
              await client.sendMessage(group, {
                message: `📝 ${topic.description}`,
                replyToMsgId: createdTopic.id
              });
              
              logger.info(`Added description to topic "${topic.name}"`);
            }
          } catch (descError) {
            logger.error(`Error adding description to topic "${topic.name}": ${descError.message}`);
          }
        }
      } catch (error) {
        logger.error(`Error creating topic "${topic.name}": ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error creating topics for group ${group.id}: ${error.message}`);
    throw error;
  }
}

/**
 * Generate a group name using AI
 * @param {Object} groupConfig Group configuration
 * @returns {Promise<string>} Generated group name
 */
async function generateGroupName(groupConfig) {
  return await groupAiService.generateGroupName();
}

/**
 * Generate a group description using AI
 * @param {Object} groupConfig Group configuration
 * @returns {Promise<string>} Generated group description
 */
async function generateGroupDescription(groupConfig) {
  return await groupAiService.generateGroupDescription();
}

/**
 * Get a random color for topic icons
 * @returns {number} Random color value
 */
function getRandomColor() {
  // These correspond to Telegram's color palette
  const colors = [
    0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 
    0xFF93B2, 0xFB6F5F, 0x777FFF, 0x82D6FC
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Parse command line arguments
program
  .name('tg')
  .description('Telegram group manager')
  .option('-a, --action <action>', 'Action to perform')
  .option('-c, --config <config>', 'Config file path')
  .parse(process.argv);

const options = program.opts();

// Execute if run directly (not imported)
if (require.main === module) {
  if (options.action === 'groups' && options.config) {
    createOrUpdateGroups(options.config)
      .then(() => {
        logger.info('Group management completed');
        process.exit(0);
      })
      .catch(error => {
        logger.error(`Failed to manage groups: ${error.message}`);
        process.exit(1);
      });
  } else {
    console.error('Invalid arguments. Usage: ./tg -a groups -c ./config.json');
    program.help();
  }
}

module.exports = {
  createOrUpdateGroups
};