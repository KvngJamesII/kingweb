const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Telegram Bot Token
const token = '8349196950:AAF6EOlBTaGFEknR-xiY106GZMPRd0dh2HA';
const bot = new TelegramBot(token, { polling: true });

// Binance Futures API
const BINANCE_API = 'https://fapi.binance.com';

// User data storage
const users = new Map();
const userStates = new Map();

const INITIAL_BALANCE = 1000;
const MAX_LEVERAGE = 125;
const QUICK_AMOUNTS = [50, 100, 300, 500, 750];

console.log('🚀 Futures Demo Trading Bot Started!');

// Initialize user account
function initUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      balance: INITIAL_BALANCE,
      positions: [],
      trades: [],
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        bestTrade: 0,
        worstTrade: 0
      }
    });
  }
  return users.get(userId);
}

// Get current price and 24h stats
async function getCoinDetails(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) {
      symbol += 'USDT';
    }

    const [priceRes, statsRes] = await Promise.all([
      axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, { params: { symbol } }),
      axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`, { params: { symbol } })
    ]);

    return {
      symbol: priceRes.data.symbol,
      price: parseFloat(priceRes.data.price),
      priceChange: parseFloat(statsRes.data.priceChange),
      priceChangePercent: parseFloat(statsRes.data.priceChangePercent),
      highPrice: parseFloat(statsRes.data.highPrice),
      lowPrice: parseFloat(statsRes.data.lowPrice),
      volume: parseFloat(statsRes.data.volume),
      quoteVolume: parseFloat(statsRes.data.quoteVolume)
    };
  } catch (error) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
}

// Get trending coins
async function getTrendingCoins() {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`);
    const coins = response.data
      .filter(coin => coin.symbol.endsWith('USDT'))
      .map(coin => ({
        symbol: coin.symbol,
        priceChangePercent: parseFloat(coin.priceChangePercent),
        volume: parseFloat(coin.quoteVolume)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
    return coins;
  } catch (error) {
    throw new Error('Failed to fetch trending coins');
  }
}

// Get new coins (coins with high volume and recent listing - approximation)
async function getNewCoins() {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`);
    const coins = response.data
      .filter(coin => coin.symbol.endsWith('USDT'))
      .map(coin => ({
        symbol: coin.symbol,
        priceChangePercent: parseFloat(coin.priceChangePercent),
        volume: parseFloat(coin.quoteVolume)
      }))
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
      .slice(0, 10);
    return coins;
  } catch (error) {
    throw new Error('Failed to fetch new coins');
  }
}

// Calculate liquidation price
function calculateLiquidationPrice(entryPrice, leverage, type) {
  const maintenanceMarginRate = 0.004;
  
  if (type === 'LONG') {
    return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
  } else {
    return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
  }
}

// Calculate PnL
function calculatePnL(position, currentPrice) {
  const priceDiff = currentPrice - position.entryPrice;
  const multiplier = position.type === 'LONG' ? 1 : -1;
  const pnl = (priceDiff * multiplier * position.amount * position.leverage);
  const roi = (pnl / position.margin) * 100;
  
  return { pnl, roi };
}

// Format number
const formatNumber = (num, decimals = 2) => {
  return parseFloat(num).toFixed(decimals);
};

// Format large numbers
const formatVolume = (num) => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

// Main menu keyboard
function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Positions', callback_data: 'positions' },
        { text: '💼 Balance', callback_data: 'balance' }
      ],
      [
        { text: '🪙 Coins', callback_data: 'coins' },
        { text: '📈 Analysis', callback_data: 'analysis' }
      ],
      [
        { text: '📜 History', callback_data: 'history' },
        { text: '🏆 Leaderboard', callback_data: 'leaderboard' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'settings' },
        { text: '❓ Help', callback_data: 'help' }
      ]
    ]
  };
}

// Get back buttons
function getBackButtons(backTo = 'menu') {
  return {
    inline_keyboard: [
      [
        { text: '🏠 Home', callback_data: 'menu' },
        { text: '🔙 Back', callback_data: backTo }
      ]
    ]
  };
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initUser(chatId);
  
  const welcomeMessage = `
🎯 *Welcome to Futures Demo Trading Bot!*

Practice futures trading with $${INITIAL_BALANCE} demo funds!

━━━━━━━━━━━━━━━━━━━━━━━━

🔍 *Quick Commands:*
• /p <COIN> - View coin details & trade
• /trade <COIN> - Open trade directly
• /menu - Show main menu

━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Example:*
\`/p BTC\`
\`/trade ETH\`

Use the menu below to navigate! 🚀
  `.trim();

  bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
});

// Command: /menu
bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '📱 *Main Menu*', {
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
});

// Command: /p <coin>
bot.onText(/\/p (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();

  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Fetching data...');
    const data = await getCoinDetails(coin);
    
    const changeEmoji = data.priceChangePercent >= 0 ? '📈' : '📉';
    const changeColor = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    
    const message = `
${changeColor} *${data.symbol}*

━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Price:* $${formatNumber(data.price, 4)}
${changeEmoji} *24h Change:* ${data.priceChangePercent >= 0 ? '🟢 +' : '🔴 '}${formatNumber(data.priceChangePercent)}%

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h High:* $${formatNumber(data.highPrice, 4)}
📉 *24h Low:* $${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━

📦 *24h Volume:* ${formatVolume(data.volume)} ${coin}
💵 *24h Vol (USDT):* $${formatVolume(data.quoteVolume)}
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 TRADE', callback_data: `trade_${data.symbol}` }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' },
            { text: '🔙 Back', callback_data: 'coins' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
});

// Command: /trade <coin>
bot.onText(/\/trade (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  await showTradeOptions(chatId, coin);
});

// Show trade options
async function showTradeOptions(chatId, symbol, messageId = null) {
  try {
    if (!messageId) {
      const loadingMsg = await bot.sendMessage(chatId, '⏳ Loading trade options...');
      messageId = loadingMsg.message_id;
    }

    const data = await getCoinDetails(symbol);
    
    const changeEmoji = data.priceChangePercent >= 0 ? '📈' : '📉';
    const changeColor = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    
    const message = `
${changeColor} *${data.symbol}* - TRADE

━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Current Price:* $${formatNumber(data.price, 4)}
${changeEmoji} *24h Change:* ${data.priceChangePercent >= 0 ? '🟢 +' : '🔴 '}${formatNumber(data.priceChangePercent)}%

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h Range:*
   High: $${formatNumber(data.highPrice, 4)}
   Low: $${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━

Select your position type:
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 LONG', callback_data: `long_${data.symbol}` },
            { text: '🔴 SHORT', callback_data: `short_${data.symbol}` }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' },
            { text: '🔙 Back', callback_data: 'coins' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Show coins menu
async function showCoinsMenu(chatId, messageId = null) {
  const message = `
🪙 *COIN EXPLORER*

━━━━━━━━━━━━━━━━━━━━━━━━

Select an option to explore coins:

📊 *Trending Coins* - Top 10 by volume
🆕 *New Coins* - Top 10 by price action

━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📊 Trending Coins (24h)', callback_data: 'trending_coins' }
      ],
      [
        { text: '🆕 New Coins (24h)', callback_data: 'new_coins' }
      ],
      [
        { text: '🏠 Home', callback_data: 'menu' }
      ]
    ]
  };

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// Show trending coins
async function showTrendingCoins(chatId, messageId = null) {
  try {
    const loadingText = '⏳ Loading trending coins...';
    if (messageId) {
      await bot.editMessageText(loadingText, {
        chat_id: chatId,
        message_id: messageId
      });
    }

    const coins = await getTrendingCoins();
    
    let message = `
📊 *TRENDING COINS (24h)*
Top 10 by Trading Volume

━━━━━━━━━━━━━━━━━━━━━━━━

`;

    const buttons = [];
    
    coins.forEach((coin, index) => {
      const emoji = coin.priceChangePercent >= 0 ? '🟢' : '🔴';
      const sign = coin.priceChangePercent >= 0 ? '+' : '';
      const coinName = coin.symbol.replace('USDT', '');
      
      message += `${index + 1}. ${emoji} *${coinName}*\n`;
      message += `   ${sign}${formatNumber(coin.priceChangePercent)}% | Vol: $${formatVolume(coin.volume)}\n\n`;
      
      buttons.push([
        { text: `📊 ${coinName}`, callback_data: `coin_details_${coinName}` }
      ]);
    });

    message += `━━━━━━━━━━━━━━━━━━━━━━━━`;

    buttons.push([
      { text: '🏠 Home', callback_data: 'menu' },
      { text: '🔙 Back', callback_data: 'coins' }
    ]);

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Show new coins
async function showNewCoins(chatId, messageId = null) {
  try {
    const loadingText = '⏳ Loading new coins...';
    if (messageId) {
      await bot.editMessageText(loadingText, {
        chat_id: chatId,
        message_id: messageId
      });
    }

    const coins = await getNewCoins();
    
    let message = `
🆕 *NEW COINS (24h)*
Top 10 by Price Movement

━━━━━━━━━━━━━━━━━━━━━━━━

`;

    const buttons = [];
    
    coins.forEach((coin, index) => {
      const emoji = coin.priceChangePercent >= 0 ? '🟢' : '🔴';
      const sign = coin.priceChangePercent >= 0 ? '+' : '';
      const coinName = coin.symbol.replace('USDT', '');
      
      message += `${index + 1}. ${emoji} *${coinName}*\n`;
      message += `   ${sign}${formatNumber(coin.priceChangePercent)}% | Vol: $${formatVolume(coin.volume)}\n\n`;
      
      buttons.push([
        { text: `📊 ${coinName}`, callback_data: `coin_details_${coinName}` }
      ]);
    });

    message += `━━━━━━━━━━━━━━━━━━━━━━━━`;

    buttons.push([
      { text: '🏠 Home', callback_data: 'menu' },
      { text: '🔙 Back', callback_data: 'coins' }
    ]);

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    if (data === 'menu') {
      bot.editMessageText('📱 *Main Menu*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
      return;
    }

    if (data === 'coins') {
      await showCoinsMenu(chatId, messageId);
      return;
    }

    if (data === 'trending_coins') {
      await showTrendingCoins(chatId, messageId);
      return;
    }

    if (data === 'new_coins') {
      await showNewCoins(chatId, messageId);
      return;
    }

    if (data.startsWith('coin_details_')) {
      const coin = data.replace('coin_details_', '');
      try {
        const coinData = await getCoinDetails(coin);
        
        const changeEmoji = coinData.priceChangePercent >= 0 ? '📈' : '📉';
        const changeColor = coinData.priceChangePercent >= 0 ? '🟢' : '🔴';
        
        const message = `
${changeColor} *${coinData.symbol}*

━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Price:* $${formatNumber(coinData.price, 4)}
${changeEmoji} *24h Change:* ${coinData.priceChangePercent >= 0 ? '🟢 +' : '🔴 '}${formatNumber(coinData.priceChangePercent)}%

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h High:* $${formatNumber(coinData.highPrice, 4)}
📉 *24h Low:* $${formatNumber(coinData.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━

📦 *24h Volume:* ${formatVolume(coinData.volume)} ${coin}
💵 *24h Vol (USDT):* $${formatVolume(coinData.quoteVolume)}
        `.trim();

        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🎯 TRADE', callback_data: `trade_${coinData.symbol}` }
              ],
              [
                { text: '🏠 Home', callback_data: 'menu' },
                { text: '🔙 Back', callback_data: 'coins' }
              ]
            ]
          }
        });
      } catch (error) {
        bot.answerCallbackQuery(query.id, { text: `❌ Error: ${error.message}`, show_alert: true });
      }
      return;
    }

    if (data.startsWith('trade_')) {
      const symbol = data.replace('trade_', '');
      await showTradeOptions(chatId, symbol, messageId);
      return;
    }

    if (data.startsWith('long_') || data.startsWith('short_')) {
      const [type, symbol] = data.split('_');
      userStates.set(chatId, { action: type, symbol: symbol, step: 'amount' });
      await showAmountSelection(chatId, messageId, symbol, type);
      return;
    }

    if (data.startsWith('amount_')) {
      const amount = data.replace('amount_', '');
      const state = userStates.get(chatId);
      
      if (amount === 'custom') {
        state.step = 'custom_amount';
        userStates.set(chatId, state);
        bot.editMessageText('💵 *Enter custom amount in USD:*\n\nType the amount you want to use as margin.', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🏠 Home', callback_data: 'menu' },
              { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
            ]]
          }
        });
        return;
      } else if (amount === 'max') {
        const user = initUser(chatId);
        state.amount = user.balance;
      } else {
        state.amount = parseFloat(amount);
      }
      
      state.step = 'leverage';
      userStates.set(chatId, state);
      await showLeverageSelection(chatId, messageId, state);
      return;
    }

    if (data.startsWith('leverage_')) {
      const leverage = data.replace('leverage_', '');
      const state = userStates.get(chatId);
      
      if (leverage === 'custom') {
        state.step = 'custom_leverage';
        userStates.set(chatId, state);
        bot.editMessageText(`⚡ *Enter custom leverage (1-${MAX_LEVERAGE}):*\n\nType your desired leverage.`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🏠 Home', callback_data: 'menu' },
              { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
            ]]
          }
        });
        return;
      } else {
        state.leverage = parseInt(leverage);
        await showTradeConfirmation(chatId, messageId, state);
      }
      return;
    }

    if (data === 'confirm_trade') {
      const state = userStates.get(chatId);
      await executeTrade(chatId, state, messageId);
      userStates.delete(chatId);
      return;
    }

    if (data === 'cancel_trade') {
      userStates.delete(chatId);
      bot.editMessageText('❌ *Trade Cancelled*\n\nNo position was opened.', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
      return;
    }

    switch (data) {
      case 'positions':
        await showPositions(chatId, messageId, true);
        break;
      case 'refresh_positions':
        await showPositions(chatId, messageId, true);
        break;
      case 'balance':
        await showBalance(chatId, messageId, true);
        break;
      case 'refresh_balance':
        await showBalance(chatId, messageId, true);
        break;
      case 'analysis':
        await showAnalysis(chatId, messageId, true);
        break;
      case 'refresh_analysis':
        await showAnalysis(chatId, messageId, true);
        break;
      case 'history':
        await showHistory(chatId, messageId);
        break;
      case 'leaderboard':
        await showLeaderboard(chatId, messageId);
        break;
      case 'settings':
        await showSettings(chatId, messageId);
        break;
      case 'help':
        await showHelp(chatId, messageId);
        break;
      case 'closeall':
        await closeAllPositions(chatId, messageId);
        break;
      case 'reset_confirm':
        users.delete(chatId);
        initUser(chatId);
        userStates.delete(chatId);
        bot.editMessageText(
          '🔄 *Account Reset Successfully!*\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Your balance has been reset to $${INITIAL_BALANCE}.\n` +
          'All positions and history cleared.\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          { 
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getMainMenu()
          }
        );
        break;
      case 'add_position':
        bot.editMessageText(
          '🎯 *Open New Position*\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          'Use /trade <COIN> to open a new position!\n\n' +
          '*Example:*\n' +
          '`/trade BTC`\n' +
          '`/trade ETH`\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          { 
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getMainMenu() 
          }
        );
        break;
      case 'set_tpsl':
        bot.editMessageText(
          '📊 *Take Profit / Stop Loss*\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          '🚧 Feature coming soon!\n\n' +
          'You\'ll be able to set automatic TP/SL levels.\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          { 
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getMainMenu() 
          }
        );
        break;
      default:
        if (data.startsWith('close_')) {
          const positionId = parseInt(data.replace('close_', ''));
          await closePosition(chatId, positionId, messageId);
        }
        break;
    }
  } catch (error) {
    console.error('Callback error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.', {
      reply_markup: getMainMenu()
    });
  }
});

// Handle text messages for custom input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state) return;

  try {
    if (state.step === 'custom_amount') {
      const amount = parseFloat(text);
      const user = initUser(chatId);
      
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number:', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🏠 Home', callback_data: 'menu' },
              { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
            ]]
          }
        });
        return;
      }
      
      if (amount > user.balance) {
        bot.sendMessage(chatId, 
          `❌ *Insufficient Balance!*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Available: ${formatNumber(user.balance)}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          'Please enter a lower amount:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🏠 Home', callback_data: 'menu' },
                { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
              ]]
            }
          }
        );
        return;
      }
      
      state.amount = amount;
      state.step = 'leverage';
      userStates.set(chatId, state);
      
      const sentMsg = await bot.sendMessage(chatId, '⏳ Loading...');
      await showLeverageSelection(chatId, sentMsg.message_id, state);
      
    } else if (state.step === 'custom_leverage') {
      const leverage = parseInt(text);
      
      if (isNaN(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
        bot.sendMessage(chatId, `❌ Invalid leverage. Enter a number between 1 and ${MAX_LEVERAGE}:`, {
          reply_markup: {
            inline_keyboard: [[
              { text: '🏠 Home', callback_data: 'menu' },
              { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
            ]]
          }
        });
        return;
      }
      
      state.leverage = leverage;
      userStates.set(chatId, state);
      
      const sentMsg = await bot.sendMessage(chatId, '⏳ Loading...');
      await showTradeConfirmation(chatId, sentMsg.message_id, state);
    }
  } catch (error) {
    console.error('Message handling error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.', {
      reply_markup: getMainMenu()
    });
    userStates.delete(chatId);
  }
});

// Show amount selection
async function showAmountSelection(chatId, messageId, symbol, type) {
  const user = initUser(chatId);
  const emoji = type === 'long' ? '🟢' : '🔴';
  
  const buttons = QUICK_AMOUNTS.map(amt => {
    const disabled = amt > user.balance;
    return [{ 
      text: disabled ? `${amt} ❌` : `${amt}`, 
      callback_data: disabled ? 'insufficient' : `amount_${amt}` 
    }];
  });
  
  buttons.push([{ text: `💰 MAX (${formatNumber(user.balance)})`, callback_data: 'amount_max' }]);
  buttons.push([{ text: '✏️ Custom Amount', callback_data: 'amount_custom' }]);
  buttons.push([
    { text: '🏠 Home', callback_data: 'menu' },
    { text: '🔙 Back', callback_data: `trade_${symbol}` }
  ]);

  const message = `
${emoji} *${type.toUpperCase()} ${symbol}*

━━━━━━━━━━━━━━━━━━━━━━━━

💼 *Available Balance:* ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━

Select margin amount:
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Show leverage selection
async function showLeverageSelection(chatId, messageId, state) {
  const leverages = [2, 5, 10, 25, 50, 75, 100, 125];
  const buttons = [];
  
  for (let i = 0; i < leverages.length; i += 2) {
    buttons.push([
      { text: `${leverages[i]}x`, callback_data: `leverage_${leverages[i]}` },
      { text: `${leverages[i + 1]}x`, callback_data: `leverage_${leverages[i + 1]}` }
    ]);
  }
  
  buttons.push([{ text: '✏️ Custom Leverage', callback_data: 'leverage_custom' }]);
  buttons.push([
    { text: '🏠 Home', callback_data: 'menu' },
    { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
  ]);

  const emoji = state.action === 'long' ? '🟢' : '🔴';
  const message = `
${emoji} *${state.action.toUpperCase()} ${state.symbol}*

━━━━━━━━━━━━━━━━━━━━━━━━

💵 *Margin:* ${formatNumber(state.amount)}

━━━━━━━━━━━━━━━━━━━━━━━━

Select leverage:
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Show trade confirmation
async function showTradeConfirmation(chatId, messageId, state) {
  try {
    const data = await getCoinDetails(state.symbol);
    const positionSize = state.amount * state.leverage;
    const liquidationPrice = calculateLiquidationPrice(data.price, state.leverage, state.action.toUpperCase());
    
    const emoji = state.action === 'long' ? '🟢' : '🔴';
    
    const message = `
${emoji} *CONFIRM ${state.action.toUpperCase()} POSITION*

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Symbol:* ${state.symbol}
💰 *Entry Price:* ${formatNumber(data.price, 4)}
💵 *Margin:* ${formatNumber(state.amount)}
⚡ *Leverage:* ${state.leverage}x
📈 *Position Size:* ${formatNumber(positionSize)}

━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *Liquidation:* ${formatNumber(liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━

*Potential PnL (1% move):*
🟢 Profit: +${formatNumber(positionSize * 0.01)}
🔴 Loss: -${formatNumber(positionSize * 0.01)}

━━━━━━━━━━━━━━━━━━━━━━━━

Confirm this trade?
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ CONFIRM', callback_data: 'confirm_trade' },
            { text: '❌ CANCEL', callback_data: 'cancel_trade' }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Execute trade
async function executeTrade(chatId, state, messageId = null) {
  try {
    const user = initUser(chatId);
    const data = await getCoinDetails(state.symbol);
    
    const margin = state.amount;
    const leverage = state.leverage;
    const positionSize = margin * leverage;

    if (margin > user.balance) {
      const errorMsg = `❌ *Insufficient Balance!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Required: ${formatNumber(margin)}\n` +
        `Available: ${formatNumber(user.balance)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━`;
      
      if (messageId) {
        bot.editMessageText(errorMsg, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMainMenu()
        });
      } else {
        bot.sendMessage(chatId, errorMsg, { 
          parse_mode: 'Markdown',
          reply_markup: getMainMenu() 
        });
      }
      return;
    }

    const liquidationPrice = calculateLiquidationPrice(data.price, leverage, state.action.toUpperCase());

    const position = {
      id: Date.now(),
      symbol: data.symbol,
      type: state.action.toUpperCase(),
      entryPrice: data.price,
      amount: positionSize / data.price,
      margin: margin,
      leverage: leverage,
      liquidationPrice: liquidationPrice,
      openTime: Date.now()
    };

    user.positions.push(position);
    user.balance -= margin;

    const emoji = state.action === 'long' ? '🟢' : '🔴';
    const arrow = state.action === 'long' ? '📈' : '📉';
    
    const message = `
${emoji} *${state.action.toUpperCase()} POSITION OPENED*

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Symbol:* ${position.symbol}
${arrow} *Type:* ${position.type}
💰 *Entry Price:* ${formatNumber(position.entryPrice, 4)}
💵 *Position Size:* ${formatNumber(positionSize)}
📈 *Amount:* ${formatNumber(position.amount, 6)}

━━━━━━━━━━━━━━━━━━━━━━━━

🔒 *Margin:* ${formatNumber(margin)}
⚡ *Leverage:* ${leverage}x
⚠️ *Liquidation:* ${formatNumber(liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━

💼 *Remaining Balance:* ${formatNumber(user.balance)}
🆔 *Position ID:* ${position.id}

━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    if (messageId) {
      bot.editMessageText(message, { 
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    } else {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Show positions
async function showPositions(chatId, messageId = null, isEdit = false) {
  const user = initUser(chatId);
  
  if (user.positions.length === 0) {
    const msg = `📭 *No Open Positions*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nUse /trade <COIN> to open a position!\n\n━━━━━━━━━━━━━━━━━━━━━━━━`;
    if (messageId && isEdit) {
      try {
        bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMainMenu()
        });
      } catch (error) {
        console.error('Error editing message:', error.message);
      }
    } else {
      bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  const now = new Date();
  let message = `📊 *OPEN POSITIONS*\n🕐 Updated: ${now.toLocaleTimeString()}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  let totalPnL = 0;
  let totalInvested = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      
      totalPnL += pnl;
      totalInvested += position.margin;

      const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
      const typeEmoji = position.type === 'LONG' ? '🟢' : '🔴';
      
      const distanceToLiq = position.type === 'LONG' 
        ? ((data.price - position.liquidationPrice) / data.price * 100)
        : ((position.liquidationPrice - data.price) / data.price * 100);
      
      const liqWarning = distanceToLiq < 5 ? '⚠️ ' : '';
      
      const timeInPosition = Math.floor((Date.now() - position.openTime) / 1000 / 60);
      const timeStr = timeInPosition < 60 ? `${timeInPosition}m` : `${Math.floor(timeInPosition / 60)}h ${timeInPosition % 60}m`;

      message += `${typeEmoji} *${position.type} ${position.symbol}* ⚡${position.leverage}x\n\n`;
      message += `💰 Entry: ${formatNumber(position.entryPrice, 4)}\n`;
      message += `📊 Current: ${formatNumber(data.price, 4)}\n\n`;
      message += `${pnlEmoji} *PnL:* ${pnl >= 0 ? '+' : ''}${formatNumber(pnl)} (${roi >= 0 ? '+' : ''}${formatNumber(roi)}%)\n\n`;
      message += `${liqWarning}⚠️ Liq: ${formatNumber(position.liquidationPrice, 4)} (${formatNumber(distanceToLiq)}%)\n`;
      message += `⏱ Time: ${timeStr} | 💵 Margin: ${formatNumber(position.margin)}\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const btnEmoji = pnl >= 0 ? '🟢' : '🔴';
      buttons.push([{ 
        text: `${btnEmoji} Close ${position.symbol} ${position.type} (${formatNumber(roi)}%)`, 
        callback_data: `close_${position.id}` 
      }]);
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '🟢' : '🔴';
  const totalRoi = totalInvested > 0 ? (totalPnL / totalInvested * 100) : 0;
  
  message += `${totalEmoji} *Total PnL: ${totalPnL >= 0 ? '+' : ''}${formatNumber(totalPnL)} (${totalRoi >= 0 ? '+' : ''}${formatNumber(totalRoi)}%)*\n\n`;
  message += `📊 Positions: ${user.positions.length} | 💰 Invested: ${formatNumber(totalInvested)}\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━`;

  const actionButtons = [];
  if (user.positions.length > 1) {
    actionButtons.push({ text: '🔴 Close All', callback_data: 'closeall' });
  }
  actionButtons.push({ text: '🔄 Refresh', callback_data: 'refresh_positions' });
  
  if (actionButtons.length > 0) {
    buttons.push(actionButtons);
  }
  
  buttons.push([
    { text: '📊 Set TP/SL', callback_data: 'set_tpsl' },
    { text: '📈 Add Position', callback_data: 'add_position' }
  ]);
  buttons.push([
    { text: '🏠 Home', callback_data: 'menu' }
  ]);

  if (messageId && isEdit) {
    try {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (error) {
      if (error && error.message && !error.message.includes('message is not modified')) {
        console.error('Error editing message:', error.message);
      }
    }
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// Show balance
async function showBalance(chatId, messageId = null, isEdit = false) {
  const user = initUser(chatId);
  
  const totalMargin = user.positions.reduce((sum, p) => sum + p.margin, 0);
  const availableBalance = user.balance - totalMargin;
  
  const winRate = user.stats.totalTrades > 0 
    ? (user.stats.winningTrades / user.stats.totalTrades * 100).toFixed(2)
    : 0;
  
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const roi = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);

  let unrealizedPnL = 0;
  for (const position of user.positions) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl } = calculatePnL(position, data.price);
      unrealizedPnL += pnl;
    } catch (error) {
      console.error('Error calculating unrealized PnL:', error.message);
    }
  }

  const totalEquity = user.balance + unrealizedPnL;
  const now = new Date();
  
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  const pnlEmoji = netPnL >= 0 ? '🟢' : '🔴';
  const unrealizedEmoji = unrealizedPnL >= 0 ? '🟢' : '🔴';
  
  const message = `
💼 *PORTFOLIO SUMMARY*
🕐 Updated: ${now.toLocaleTimeString()}

━━━━━━━━━━━━━━━━━━━━━━━━

${equityEmoji} *Total Equity:* ${formatNumber(totalEquity)}
💵 *Available:* ${formatNumber(availableBalance)}
🔒 *In Positions:* ${formatNumber(totalMargin)}
${unrealizedEmoji} *Unrealized PnL:* ${unrealizedPnL >= 0 ? '+' : ''}${formatNumber(unrealizedPnL)}

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *TRADING STATISTICS*

━━━━━━━━━━━━━━━━━━━━━━━━

${pnlEmoji} *Net PnL:* ${netPnL >= 0 ? '+' : ''}${formatNumber(netPnL)} (${roi >= 0 ? '+' : ''}${roi}%)

📈 *Total Trades:* ${user.stats.totalTrades}
🟢 *Winning:* ${user.stats.winningTrades}
🔴 *Losing:* ${user.stats.losingTrades}
🎯 *Win Rate:* ${winRate}%

━━━━━━━━━━━━━━━━━━━━━━━━

🟢 *Total Profit:* +${formatNumber(user.stats.totalProfit)}
🔴 *Total Loss:* -${formatNumber(Math.abs(user.stats.totalLoss))}

━━━━━━━━━━━━━━━━━━━━━━━━

🏆 *Best Trade:* +${formatNumber(user.stats.bestTrade)}
💔 *Worst Trade:* ${formatNumber(user.stats.worstTrade)}

🔢 *Open Positions:* ${user.positions.length}

━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const buttons = [
    [
      { text: '🔄 Refresh', callback_data: 'refresh_balance' },
      { text: '📊 Analysis', callback_data: 'analysis' }
    ],
    [
      { text: '🏠 Home', callback_data: 'menu' }
    ]
  ];

  if (messageId && isEdit) {
    try {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (error) {
      if (error && error.message && !error.message.includes('message is not modified')) {
        console.error('Error editing message:', error.message);
      }
    }
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// Get performance rating
function getPerformanceRating(winRate, profitFactor, roi) {
  let rating = '';
  if (winRate >= 60 && profitFactor >= 2 && parseFloat(roi) > 50) {
    rating = '🌟🌟🌟🌟🌟 Exceptional!';
  } else if (winRate >= 55 && profitFactor >= 1.5 && parseFloat(roi) > 30) {
    rating = '⭐⭐⭐⭐ Excellent!';
  } else if (winRate >= 50 && profitFactor >= 1.2 && parseFloat(roi) > 10) {
    rating = '⭐⭐⭐ Good!';
  } else if (winRate >= 45 && profitFactor >= 1 && parseFloat(roi) > 0) {
    rating = '⭐⭐ Developing';
  } else {
    rating = '⭐ Keep Learning';
  }
  return rating;
}

// Show analysis
async function showAnalysis(chatId, messageId = null, isEdit = false) {
  const user = initUser(chatId);
  
  if (user.trades.length === 0) {
    const msg = '📊 *No Trading Data Yet*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nStart trading to see your performance!\n\n━━━━━━━━━━━━━━━━━━━━━━━━';
    if (messageId && isEdit) {
      try {
        bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getMainMenu()
        });
      } catch (error) {
        console.error('Error editing message:', error.message);
      }
    } else {
      bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  const totalTrades = user.stats.totalTrades;
  const winRate = (user.stats.winningTrades / totalTrades * 100).toFixed(2);
  const avgProfit = user.stats.winningTrades > 0 ? (user.stats.totalProfit / user.stats.winningTrades) : 0;
  const avgLoss = user.stats.losingTrades > 0 ? (user.stats.totalLoss / user.stats.losingTrades) : 0;
  const profitFactor = user.stats.totalLoss !== 0 ? Math.abs(user.stats.totalProfit / user.stats.totalLoss) : 0;
  
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const roi = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);

  let unrealizedPnL = 0;
  for (const position of user.positions) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl } = calculatePnL(position, data.price);
      unrealizedPnL += pnl;
    } catch (error) {
      console.error('Error calculating unrealized PnL:', error.message);
    }
  }

  const totalEquity = user.balance + unrealizedPnL;

  let currentStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let tempWinStreak = 0;
  let tempLossStreak = 0;

  for (const trade of user.trades.slice().reverse()) {
    if (trade.pnl >= 0) {
      tempWinStreak++;
      tempLossStreak = 0;
      if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
    } else {
      tempLossStreak++;
      tempWinStreak = 0;
      if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
    }
  }

  const lastTrade = user.trades[user.trades.length - 1];
  currentStreak = lastTrade.pnl >= 0 ? tempWinStreak : -tempLossStreak;

  const avgRR = avgLoss !== 0 ? (avgProfit / Math.abs(avgLoss)) : 0;

  let peak = INITIAL_BALANCE;
  let maxDrawdown = 0;
  let currentBalance = INITIAL_BALANCE;

  for (const trade of user.trades) {
    currentBalance += trade.pnl;
    if (currentBalance > peak) {
      peak = currentBalance;
    }
    const drawdown = ((peak - currentBalance) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const now = new Date();
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  const roiEmoji = roi >= 0 ? '🟢' : '🔴';
  const unrealizedEmoji = unrealizedPnL >= 0 ? '🟢' : '🔴';
  
  const message = `
📈 *TRADING ANALYSIS*
🕐 Updated: ${now.toLocaleTimeString()}

━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT PERFORMANCE*

━━━━━━━━━━━━━━━━━━━━━━━━

Starting Balance: ${INITIAL_BALANCE}
${equityEmoji} Current Equity: ${formatNumber(totalEquity)}
${roiEmoji} Total ROI: ${roi >= 0 ? '+' : ''}${roi}%

━━━━━━━━━━━━━━━━━━━━━━━━

🟢 Realized PnL: ${netPnL >= 0 ? '+' : ''}${formatNumber(netPnL)}
${unrealizedEmoji} Unrealized PnL: ${unrealizedPnL >= 0 ? '+' : ''}${formatNumber(unrealizedPnL)}
🔴 Max Drawdown: ${formatNumber(maxDrawdown)}%

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *TRADING METRICS*

━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Win Rate: ${winRate}%
📈 Total Trades: ${totalTrades}
🟢 Winning Trades: ${user.stats.winningTrades}
🔴 Losing Trades: ${user.stats.losingTrades}

━━━━━━━━━━━━━━━━━━━━━━━━

💰 Profit Factor: ${formatNumber(profitFactor)}
🟢 Avg Profit: +${formatNumber(avgProfit)}
🔴 Avg Loss: ${formatNumber(avgLoss)}
⚖️ Risk/Reward: ${formatNumber(avgRR)}

━━━━━━━━━━━━━━━━━━━━━━━━

🏆 Best Trade: +${formatNumber(user.stats.bestTrade)}
💔 Worst Trade: ${formatNumber(user.stats.worstTrade)}

━━━━━━━━━━━━━━━━━━━━━━━━

🔥 *STREAKS*

━━━━━━━━━━━━━━━━━━━━━━━━

Current: ${currentStreak >= 0 ? '🟢' : '🔴'} ${Math.abs(currentStreak)} ${currentStreak >= 0 ? 'wins' : 'losses'}
Best Win Streak: 🟢 ${maxWinStreak}
Worst Loss Streak: 🔴 ${maxLossStreak}

━━━━━━━━━━━━━━━━━━━━━━━━

💡 *PERFORMANCE RATING*

${getPerformanceRating(winRate, profitFactor, roi)}

━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const buttons = [
    [
      { text: '🔄 Refresh', callback_data: 'refresh_analysis' },
      { text: '📊 Positions', callback_data: 'positions' }
    ],
    [
      { text: '🏠 Home', callback_data: 'menu' }
    ]
  ];

  if (messageId && isEdit) {
    try {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (error) {
      if (error && error.message && !error.message.includes('message is not modified')) {
        console.error('Error editing message:', error.message);
      }
    }
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// Show history
async function showHistory(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.trades.length === 0) {
    const msg = '📭 *No Trade History*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nStart trading with /trade <COIN>!\n\n━━━━━━━━━━━━━━━━━━━━━━━━';
    if (messageId) {
      bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    } else {
      bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  const recentTrades = user.trades.slice(-10).reverse();
  let message = '📜 *TRADE HISTORY* (Last 10)\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  recentTrades.forEach((trade, index) => {
    const emoji = trade.pnl >= 0 ? '🟢' : '🔴';
    const typeEmoji = trade.type === 'LONG' ? '🟢' : '🔴';
    
    message += `${emoji} ${typeEmoji} *${trade.symbol}* ⚡${trade.leverage}x\n\n`;
    message += `Entry: ${formatNumber(trade.entryPrice, 4)}\n`;
    message += `Exit: ${formatNumber(trade.exitPrice, 4)}\n\n`;
    message += `${emoji} PnL: ${trade.pnl >= 0 ? '+' : ''}${formatNumber(trade.pnl)} (${trade.roi >= 0 ? '+' : ''}${formatNumber(trade.roi)}%)\n`;
    message += `Status: ${trade.status}\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  });

  if (messageId) {
    bot.editMessageText(message, { 
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// Show leaderboard
async function showLeaderboard(chatId, messageId = null) {
  const leaderboardData = [];
  
  for (const [userId, userData] of users.entries()) {
    const netPnL = userData.stats.totalProfit + userData.stats.totalLoss;
    const roi = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);
    const winRate = userData.stats.totalTrades > 0 
      ? (userData.stats.winningTrades / userData.stats.totalTrades * 100).toFixed(2)
      : 0;
    
    leaderboardData.push({
      userId,
      balance: userData.balance,
      netPnL,
      roi,
      winRate,
      totalTrades: userData.stats.totalTrades
    });
  }

  leaderboardData.sort((a, b) => b.netPnL - a.netPnL);

  let message = '🏆 *LEADERBOARD - Top Traders*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  if (leaderboardData.length === 0) {
    message += 'No traders yet. Be the first! 🚀\n\n━━━━━━━━━━━━━━━━━━━━━━━━';
  } else {
    leaderboardData.slice(0, 10).forEach((trader, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      const isCurrentUser = trader.userId === chatId;
      const highlight = isCurrentUser ? '👉 ' : '';
      const emoji = trader.netPnL >= 0 ? '🟢' : '🔴';
      
      message += `${highlight}${medal} *User ${trader.userId.toString().slice(-4)}*\n\n`;
      message += `💰 Balance: ${formatNumber(trader.balance)}\n`;
      message += `${emoji} PnL: ${trader.netPnL >= 0 ? '+' : ''}${formatNumber(trader.netPnL)} (${trader.roi >= 0 ? '+' : ''}${trader.roi}%)\n`;
      message += `🎯 Win Rate: ${trader.winRate}%\n`;
      message += `📊 Trades: ${trader.totalTrades}\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    });

    const userRank = leaderboardData.findIndex(t => t.userId === chatId);
    if (userRank >= 10) {
      const userData = leaderboardData[userRank];
      const emoji = userData.netPnL >= 0 ? '🟢' : '🔴';
      message += `👉 *Your Rank: #${userRank + 1}*\n\n`;
      message += `💰 Balance: ${formatNumber(userData.balance)}\n`;
      message += `${emoji} PnL: ${userData.netPnL >= 0 ? '+' : ''}${formatNumber(userData.netPnL)} (${userData.roi >= 0 ? '+' : ''}${userData.roi}%)\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━`;
    }
  }

  if (messageId) {
    bot.editMessageText(message, { 
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// Show settings
async function showSettings(chatId, messageId = null) {
  const message = `
⚙️ *SETTINGS*

━━━━━━━━━━━━━━━━━━━━━━━━

Manage your trading account and preferences.

━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Reset Account', callback_data: 'reset_confirm' }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' }
          ]
        ]
      }
    });
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Reset Account', callback_data: 'reset_confirm' }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' }
          ]
        ]
      }
    });
  }
}

// Show help
async function showHelp(chatId, messageId = null) {
  const message = `
❓ *HELP & COMMANDS*

━━━━━━━━━━━━━━━━━━━━━━━━

🔍 *Quick Commands:*
• /p <COIN> - View coin details & trade
• /trade <COIN> - Open trade directly
• /menu - Show main menu

━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Examples:*
\`/p BTC\`
\`/trade ETH\`
\`/p SOL\`

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Menu Options:*

• *Positions* - View & manage open positions
• *Balance* - View portfolio & stats
• *Coins* - Explore trending & new coins
• *Analysis* - Detailed performance metrics
• *History* - View past trades
• *Leaderboard* - Top traders ranking
• *Settings* - Account management

━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *How to Trade:*

1. Use /p <COIN> or /trade <COIN>
2. Select LONG or SHORT
3. Choose your margin amount
4. Select leverage (1-${MAX_LEVERAGE}x)
5. Confirm and trade!

━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *Risk Management:*

• Higher leverage = Higher risk
• Always monitor liquidation price
• Start with lower leverage
• Practice risk management

━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Tips:*

• Check 24h change before trading
• Set realistic profit targets
• Don't risk more than you can afford
• Use the analysis tool to improve

━━━━━━━━━━━━━━━━━━━━━━━━

Need more help? Contact support! 📧
  `.trim();

  if (messageId) {
    bot.editMessageText(message, { 
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// Close position
async function closePosition(chatId, positionId, messageId = null) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    const msg = '❌ *Position Not Found*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nPosition not found or already closed.\n\n━━━━━━━━━━━━━━━━━━━━━━━━';
    if (messageId) {
      bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    } else {
      bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  try {
    if (messageId) {
      await bot.editMessageText('⏳ Closing position...', {
        chat_id: chatId,
        message_id: messageId
      });
    }
    
    const data = await getCoinDetails(position.symbol);
    const { pnl, roi } = calculatePnL(position, data.price);

    user.balance += position.margin + pnl;

    user.stats.totalTrades++;
    if (pnl >= 0) {
      user.stats.winningTrades++;
      user.stats.totalProfit += pnl;
      if (pnl > user.stats.bestTrade) {
        user.stats.bestTrade = pnl;
      }
    } else {
      user.stats.losingTrades++;
      user.stats.totalLoss += pnl;
      if (pnl < user.stats.worstTrade) {
        user.stats.worstTrade = pnl;
      }
    }

    const trade = {
      ...position,
      exitPrice: data.price,
      closeTime: Date.now(),
      pnl: pnl,
      roi: roi,
      status: 'CLOSED'
    };

    user.trades.push(trade);

    const index = user.positions.indexOf(position);
    user.positions.splice(index, 1);

    const isProfit = pnl >= 0;
    const resultEmoji = isProfit ? '🟢' : '🔴';
    const result = isProfit ? '✅ PROFIT' : '❌ LOSS';
    const sign = pnl >= 0 ? '+' : '';
    const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);
    const typeEmoji = trade.type === 'LONG' ? '🟢' : '🔴';
    
    const message = `
${resultEmoji} *POSITION CLOSED*

${result}
${resultEmoji} ${sign}${formatNumber(Math.abs(pnl))} (${sign}${formatNumber(roi)}%)

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *TRADE DETAILS*

━━━━━━━━━━━━━━━━━━━━━━━━

🪙 Symbol: *${trade.symbol}*
${typeEmoji} Type: *${trade.type}*
⚡ Leverage: ${trade.leverage}x

━━━━━━━━━━━━━━━━━━━━━━━━

💰 Entry Price: ${formatNumber(trade.entryPrice, 4)}
🎯 Exit Price: ${formatNumber(trade.exitPrice, 4)}
📊 Price Change: ${formatNumber(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100)}%

━━━━━━━━━━━━━━━━━━━━━━━━

💵 Position Size: ${formatNumber(trade.amount, 6)}
🔒 Margin Used: ${formatNumber(trade.margin)}
⏱ Duration: ${duration} minutes

━━━━━━━━━━━━━━━━━━━━━━━━

💼 *New Balance:* ${formatNumber(user.balance)}
📊 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%

━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    if (messageId) {
      await bot.editMessageText(message, { 
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    } else {
      await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Close all positions
async function closeAllPositions(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.positions.length === 0) {
    const msg = '📭 *No Open Positions*\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nNo open positions to close.\n\n━━━━━━━━━━━━━━━━━━━━━━━━';
    if (messageId) {
      bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    } else {
      bot.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  if (messageId) {
    await bot.editMessageText('⏳ Closing all positions...', {
      chat_id: chatId,
      message_id: messageId
    });
  }
  
  let totalPnL = 0;
  const closedCount = user.positions.length;

  for (const position of [...user.positions]) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      
      totalPnL += pnl;
      user.balance += position.margin + pnl;

      user.stats.totalTrades++;
      if (pnl >= 0) {
        user.stats.winningTrades++;
        user.stats.totalProfit += pnl;
        if (pnl > user.stats.bestTrade) {
          user.stats.bestTrade = pnl;
        }
      } else {
        user.stats.losingTrades++;
        user.stats.totalLoss += pnl;
        if (pnl < user.stats.worstTrade) {
          user.stats.worstTrade = pnl;
        }
      }

      const trade = {
        ...position,
        exitPrice: data.price,
        closeTime: Date.now(),
        pnl: pnl,
        roi: roi,
        status: 'CLOSED'
      };

      user.trades.push(trade);
    } catch (error) {
      console.error('Error closing position:', error.message);
    }
  }

  user.positions = [];

  const emoji = totalPnL >= 0 ? '🟢' : '🔴';
  const message = `
${emoji} *ALL POSITIONS CLOSED*

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *Closed:* ${closedCount} position(s)
${emoji} *Total PnL:* ${totalPnL >= 0 ? '+' : ''}${formatNumber(totalPnL)}

━━━━━━━━━━━━━━━━━━━━━━━━

💼 *New Balance:* ${formatNumber(user.balance)}
📈 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%

━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  if (messageId) {
    bot.editMessageText(message, { 
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

// Auto-check for liquidations every 30 seconds
setInterval(async () => {
  for (const [userId, user] of users.entries()) {
    for (const position of [...user.positions]) {
      try {
        const data = await getCoinDetails(position.symbol);
        
        if ((position.type === 'LONG' && data.price <= position.liquidationPrice) ||
            (position.type === 'SHORT' && data.price >= position.liquidationPrice)) {
          
          const index = user.positions.indexOf(position);
          user.positions.splice(index, 1);
          
          user.stats.totalTrades++;
          user.stats.losingTrades++;
          user.stats.totalLoss -= position.margin;
          if (-position.margin < user.stats.worstTrade) {
            user.stats.worstTrade = -position.margin;
          }

          const trade = {
            ...position,
            exitPrice: data.price,
            closeTime: Date.now(),
            pnl: -position.margin,
            roi: -100,
            status: 'LIQUIDATED'
          };

          user.trades.push(trade);

          bot.sendMessage(userId,
            `💥 *POSITION LIQUIDATED!*\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🔴 ${position.type} ${position.symbol} ⚡${position.leverage}x\n\n` +
            `Entry: ${formatNumber(position.entryPrice, 4)}\n` +
            `Liquidation: ${formatNumber(data.price, 4)}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🔴 Loss: -${formatNumber(position.margin)}\n\n` +
            `💼 Balance: ${formatNumber(user.balance)}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━`,
            { 
              parse_mode: 'Markdown',
              reply_markup: getMainMenu()
            }
          );
        }
      } catch (error) {
        console.error('Error checking liquidation:', error.message);
      }
    }
  }
}, 30000);

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});
