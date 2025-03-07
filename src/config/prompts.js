/**
 * AI prompt templates for classifying and formatting messages
 */
const prompts = {
    // Classification prompt
    classification: `
      You are an AI assistant specialized in crypto trading. Your task is to classify the following message from a Telegram crypto group.
      Classify the message as ONE of the following categories:
      1. 'crypto_signal' - if it contains trading signals like buy/sell recommendations, price targets, entry/exit points, stop loss levels, or technical analysis
      2. 'crypto_news' - if it reports news about cryptocurrencies, blockchain projects, or the crypto market
      3. 'alert' - if it's an urgent message about market warnings, security incidents, regulatory updates, or important events requiring immediate attention
      4. 'noise' - if it's unrelated to the above categories or is just casual conversation
  
      The message is delimited by triple quotes:
      """
      {message}
      """
  
      Only respond with one of the category names: 'crypto_signal', 'crypto_news', 'alert', or 'noise'. Do not include any explanations.
    `,
    
    // Formatting prompts for each message type
    formatting: {
      // Crypto signal formatting
      crypto_signal: `
        Format the following crypto trading signal into a clean, standardized format.
        Include the following information if available:
        - Coin/token name and trading pair
        - Action (buy/sell)
        - Entry price or price range
        - Stop loss level
        - Take profit targets
        - Any relevant timeframe or chart information
        
        Original message:
        """
        {message}
        """
        
        Format as a concise, professional trading signal with emoji indicators.
        - Use 📈 for buy/long signals
        - Use 📉 for sell/short signals
        - Use 🎯 for targets
        - Use 🛑 for stop loss
        - Use ⏰ for timeframes
        - Use 📊 for chart patterns
        
        Do not include any personal commentary or conversation outside the signal details.
        Add "#Signal" at the beginning of the message.
      `,
      
      // Crypto news formatting
      crypto_news: `
        Format the following crypto news item into a clear, concise summary.
        
        Original message:
        """
        {message}
        """
        
        Format as follows:
        1. Short headline (one line) with an appropriate emoji
        2. Brief summary (2-3 sentences)
        3. Main points in 2-3 bullet points
        4. Source attribution if available
        
        Make it informative and factual, suitable for traders. Use appropriate emojis for different types of news:
        - 📰 for general news
        - 📈 for positive market news
        - 📉 for negative market news
        - 🚀 for launches and releases
        - 🤝 for partnerships and collaborations
        - 💼 for business and regulatory news
        
        Add "#News" at the beginning of the message.
      `,
      
      // Alert formatting
      alert: `
        Format this alert message to highlight its urgency and key information.
        
        Original message:
        """
        {message}
        """
        
        Format as follows:
        1. Begin with "🚨 ALERT 🚨" followed by a brief headline
        2. Provide key details in a clear, organized manner
        3. Include any action items or recommendations
        4. Add source or verification information if available
        
        Use appropriate formatting to emphasize important information. Make sure the urgency is clearly communicated.
        
        Add "#Alert" at the beginning of the message.
      `
    }
  };
  
  module.exports = prompts;