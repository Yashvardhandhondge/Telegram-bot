/**
 * AI service for generating group names and descriptions
 */
const logger = require('../utils/logger');
const config = require('../config');
const axios = require('axios');

/**
 * Prompts for AI to generate group names and descriptions
 */
const prompts = {
  groupName: `
    Generate a concise, professional name for a Telegram cryptocurrency group.
    The name should be short (max 4-5 words), memorable, and relevant to cryptocurrency trading.
    Only respond with the name, no explanations or additional text.
  `,
  
  groupDescription: `
    Generate a concise description for a Telegram cryptocurrency group.
    The description should be professional, under 100 characters, and explain the purpose of the group.
    It should mention cryptocurrency trading, signals, or market analysis.
    Only respond with the description, no explanations or additional text.
  `,
  
  topicName: `
    Generate a concise, professional name for a topic in a cryptocurrency Telegram group.
    The name should be short (1-3 words), clear, and describe a specific aspect of cryptocurrency trading or information.
    Only respond with the name, no explanations or additional text.
  `,
  
  topicDescription: `
    Generate a brief description for a topic in a cryptocurrency Telegram group.
    The description should be under 50 characters and explain what content will be posted in this topic.
    Only respond with the description, no explanations or additional text.
  `
};

/**
 * Generate a name for a cryptocurrency group using AI
 * @returns {Promise<string>} Generated group name
 */
async function generateGroupName() {
  try {
    // If AI service is available, use it
    if (config.ai && config.ai.apiKey) {
      const name = await aiService.generateText(prompts.groupName);
      return name.trim();
    } else {
      // Fallback to a template name
      return `Crypto Group ${Math.floor(Math.random() * 10000)}`;
    }
  } catch (error) {
    logger.error(`Error generating group name: ${error.message}`, { error });
    return `Crypto Group ${Math.floor(Math.random() * 10000)}`;
  }
}

/**
 * Generate a description for a cryptocurrency group using AI
 * @returns {Promise<string>} Generated group description
 */
async function generateGroupDescription() {
  try {
    // If AI service is available, use it
    if (config.ai && config.ai.apiKey) {
      const description = await aiService.generateText(prompts.groupDescription);
      return description.trim();
    } else {
      // Fallback to a template description
      return `Cryptocurrency group for trading signals and market analysis. Created on ${new Date().toISOString().split('T')[0]}.`;
    }
  } catch (error) {
    logger.error(`Error generating group description: ${error.message}`, { error });
    return `Cryptocurrency group for trading signals and market analysis. Created on ${new Date().toISOString().split('T')[0]}.`;
  }
}

/**
 * Generate a name for a topic in a cryptocurrency group using AI
 * @returns {Promise<string>} Generated topic name
 */
async function generateTopicName() {
  try {
    // If AI service is available, use it
    if (config.ai && config.ai.apiKey) {
      const name = await aiService.generateText(prompts.topicName);
      return name.trim();
    } else {
      // Fallback to template topics
      const templates = ['General', 'Signals', 'News', 'Analysis', 'Discussion'];
      return templates[Math.floor(Math.random() * templates.length)];
    }
  } catch (error) {
    logger.error(`Error generating topic name: ${error.message}`, { error });
    return 'General';
  }
}

/**
 * Generate a description for a topic in a cryptocurrency group using AI
 * @param {string} topicName Name of the topic
 * @returns {Promise<string>} Generated topic description
 */
async function generateTopicDescription(topicName) {
  try {
    // If AI service is available, use it
    if (config.ai && config.ai.apiKey) {
      const customPrompt = prompts.topicDescription + `\nThe topic name is: ${topicName}`;
      const description = await aiService.generateText(customPrompt);
      return description.trim();
    } else {
      // Fallback to a template description
      return `Discussion about ${topicName.toLowerCase()} in cryptocurrency.`;
    }
  } catch (error) {
    logger.error(`Error generating topic description: ${error.message}`, { error });
    return `Discussion about ${topicName.toLowerCase()} in cryptocurrency.`;
  }
}

/**
 * Generate text using the configured AI provider
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Generated text
 */
async function generateText(prompt) {
  try {
    // If no API key, return null and let the caller handle the fallback
    if (!config.ai.apiKey) {
      logger.warn('No AI API key provided, skipping text generation');
      return null;
    }
    
    // Use the appropriate AI provider
    if (config.ai.provider.toLowerCase() === 'gemini') {
      return await generateWithGemini(prompt);
    } else if (config.ai.provider.toLowerCase() === 'openai') {
      return await generateWithOpenAI(prompt);
    } else {
      logger.error(`Unknown AI provider: ${config.ai.provider}`);
      throw new Error(`Unknown AI provider: ${config.ai.provider}`);
    }
  } catch (error) {
    logger.error(`Error generating text: ${error.message}`, { error });
    throw error;
  }
}

module.exports = {
  generateGroupName,
  generateGroupDescription,
  generateTopicName,
  generateTopicDescription,
  generateText
};

/**
 * Generate text using OpenAI
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Generated text
 */
async function generateWithOpenAI(prompt) {
  try {
    const { OpenAI } = require('openai');
    
    const openai = new OpenAI({
      apiKey: config.ai.apiKey
    });
    
    const response = await openai.chat.completions.create({
      model: config.ai.model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates concise, professional content for cryptocurrency groups.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 150,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error with OpenAI text generation: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Generate text using Google's Gemini
 * @param {string} prompt Prompt for AI
 * @returns {Promise<string>} Generated text
 */
async function generateWithGemini(prompt) {
  try {
    // Prepare request to Gemini API
    const url = `https://generativelanguage.googleapis.com/v1/models/${config.ai.model || 'gemini-pro'}:generateContent`;
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.ai.apiKey
    };
    const data = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 150,
      }
    };
    
    // Call Gemini API
    const response = await axios.post(url, data, { headers });
    
    // Extract result from response
    if (response.data && 
        response.data.candidates && 
        response.data.candidates[0] && 
        response.data.candidates[0].content &&
        response.data.candidates[0].content.parts &&
        response.data.candidates[0].content.parts[0]) {
      
      return response.data.candidates[0].content.parts[0].text.trim();
    } else {
      logger.error('Unexpected response format from Gemini API');
      throw new Error('Unexpected response format from Gemini API');
    }
  } catch (error) {
    logger.error(`Error with Gemini text generation: ${error.message}`, { error });
    throw error;
  }
}