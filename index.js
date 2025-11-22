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
        { text: '📈 Analysis', callback_data: 'analysis' },
        { text: '📜 History', callback_data: 'history' }
      ],
      [
        { text: '🏆 Leaderboard', callback_data: 'leaderboard' },
        { text: '⚙️ Settings', callback_data: 'settings' }
      ],
      [
        { text: '❓ Help', callback_data: 'help' }
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

*🔍 Quick Commands:*
/p <COIN> - View coin details & trade
/trade <COIN> - Open trade directly
/menu - Show main menu

*💡 Example:*
/p BTC
/trade ETH

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

💰 *Price:* $${formatNumber(data.price, 4)}
${changeEmoji} *24h Change:* ${data.priceChangePercent >= 0 ? '+' : ''}${formatNumber(data.priceChangePercent)}%

📊 *24h High:* $${formatNumber(data.highPrice, 4)}
📉 *24h Low:* $${formatNumber(data.lowPrice, 4)}

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
            { text: '🔙 Back to Menu', callback_data: 'menu' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Command: /trade <coin>
bot.onText(/\/trade (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  await showTradeOptions(chatId, coin);
});

// Show trade options - MODIFIED to edit message when called from callback
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

💰 *Current Price:* $${formatNumber(data.price, 4)}
${changeEmoji} *24h Change:* ${data.priceChangePercent >= 0 ? '+' : ''}${formatNumber(data.priceChangePercent)}%

📊 *24h Range:*
   High: $${formatNumber(data.highPrice, 4)}
   Low: $${formatNumber(data.lowPrice, 4)}

Select your position type:
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📈 LONG', callback_data: `long_${data.symbol}` },
            { text: '📉 SHORT', callback_data: `short_${data.symbol}` }
          ],
          [
            { text: '🔙 Back', callback_data: 'menu' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
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
        bot.editMessageText('💵 Enter custom amount in USD:', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
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
        bot.editMessageText(`⚡ Enter custom leverage (1-${MAX_LEVERAGE}):`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
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
      bot.editMessageText('❌ Trade cancelled.', {
        chat_id: chatId,
        message_id: messageId,
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
          '🔄 *Account Reset!*\n\n' +
          `Your balance has been reset to $${INITIAL_BALANCE}.\n` +
          'All positions and history cleared.',
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
          'Use /trade <COIN> to open a new position!\n\n' +
          'Example: /trade BTC',
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
          '🚧 Feature coming soon!\n\n' +
          'You\'ll be able to set automatic TP/SL levels.',
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
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
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
        bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number:');
        return;
      }
      
      if (amount > user.balance) {
        bot.sendMessage(chatId, 
          `❌ Insufficient balance!\n\n` +
          `Available: $${formatNumber(user.balance)}\n\n` +
          'Please enter a lower amount:'
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
        bot.sendMessage(chatId, `❌ Invalid leverage. Enter a number between 1 and ${MAX_LEVERAGE}:`);
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
  const emoji = type === 'long' ? '📈' : '📉';
  
  const buttons = QUICK_AMOUNTS.map(amt => {
    const disabled = amt > user.balance;
    return [{ 
      text: disabled ? `$${amt} ❌` : `$${amt}`, 
      callback_data: disabled ? 'insufficient' : `amount_${amt}` 
    }];
  });
  
  buttons.push([{ text: `💰 MAX ($${formatNumber(user.balance)})`, callback_data: 'amount_max' }]);
  buttons.push([{ text: '✏️ Custom Amount', callback_data: 'amount_custom' }]);
  buttons.push([{ text: '🔙 Back', callback_data: 'menu' }]);

  const message = `
${emoji} *${type.toUpperCase()} ${symbol}*

💼 *Available Balance:* $${formatNumber(user.balance)}

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
  buttons.push([{ text: '🔙 Back', callback_data: 'menu' }]);

  const emoji = state.action === 'long' ? '📈' : '📉';
  const message = `
${emoji} *${state.action.toUpperCase()} ${state.symbol}*

💵 *Margin:* $${formatNumber(state.amount)}

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
    
    const emoji = state.action === 'long' ? '📈' : '📉';
    const color = state.action === 'long' ? '🟢' : '🔴';
    
    const message = `
${color} *CONFIRM ${state.action.toUpperCase()} POSITION*

📊 *Symbol:* ${state.symbol}
💰 *Entry Price:* $${formatNumber(data.price, 4)}
💵 *Margin:* $${formatNumber(state.amount)}
⚡ *Leverage:* ${state.leverage}x
📈 *Position Size:* $${formatNumber(positionSize)}
⚠️ *Liquidation:* $${formatNumber(liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━
*Potential PnL (1% move):*
Profit: +$${formatNumber(positionSize * 0.01)} 💚
Loss: -$${formatNumber(positionSize * 0.01)} ❤️

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
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

// Execute trade - MODIFIED to edit confirmation message
async function executeTrade(chatId, state, messageId = null) {
  try {
    const user = initUser(chatId);
    const data = await getCoinDetails(state.symbol);
    
    const margin = state.amount;
    const leverage = state.leverage;
    const positionSize = margin * leverage;

    if (margin > user.balance) {
      const errorMsg = `❌ Insufficient balance!\n\n` +
        `Required: $${formatNumber(margin)}\n` +
        `Available: $${formatNumber(user.balance)}`;
      
      if (messageId) {
        bot.editMessageText(errorMsg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: getMainMenu()
        });
      } else {
        bot.sendMessage(chatId, errorMsg, { reply_markup: getMainMenu() });
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

📊 *Symbol:* ${position.symbol}
💰 *Entry Price:* $${formatNumber(position.entryPrice, 4)}
💵 *Position Size:* $${formatNumber(positionSize)}
${arrow} *Amount:* ${formatNumber(position.amount, 6)}
🔒 *Margin:* $${formatNumber(margin)}
⚡ *Leverage:* ${leverage}x
⚠️ *Liquidation:* $${formatNumber(liquidationPrice, 4)}

💼 *Remaining Balance:* $${formatNumber(user.balance)}
🆔 *Position ID:* ${position.id}
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

// Show positions - MODIFIED to always use edit when messageId provided
async function showPositions(chatId, messageId = null, isEdit = false) {
  const user = initUser(chatId);
  
  if (user.positions.length === 0) {
    const msg = '📭 No open positions.\n\nUse /trade <COIN> to open a position!';
    if (messageId && isEdit) {
      try {
        bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: getMainMenu()
        });
      } catch (error) {
        console.error('Error editing message:', error.message);
      }
    } else {
      bot.sendMessage(chatId, msg, {
        reply_markup: getMainMenu()
      });
    }
    return;
  }

  const now = new Date();
  let message = `📊 *OPEN POSITIONS*\n🕐 Updated: ${now.toLocaleTimeString()}\n\n`;
  let totalPnL = 0;
  let totalInvested = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      
      totalPnL += pnl;
      totalInvested += position.margin;

      const pnlEmoji = pnl >= 0 ? '📈' : '📉';
      const typeEmoji = position.type === 'LONG' ? '🟢' : '🔴';
      
      const distanceToLiq = position.type === 'LONG' 
        ? ((data.price - position.liquidationPrice) / data.price * 100)
        : ((position.liquidationPrice - data.price) / data.price * 100);
      
      const liqWarning = distanceToLiq < 5 ? '⚠️ ' : '';
      
      const timeInPosition = Math.floor((Date.now() - position.openTime) / 1000 / 60);
      const timeStr = timeInPosition < 60 ? `${timeInPosition}m` : `${Math.floor(timeInPosition / 60)}h ${timeInPosition % 60}m`;

      message += `${typeEmoji} *${position.type} ${position.symbol}* ${position.leverage}x\n`;
      message += `💰 Entry: $${formatNumber(position.entryPrice, 4)} | Current: $${formatNumber(data.price, 4)}\n`;
      message += `${pnlEmoji} PnL: $${formatNumber(pnl)} (${formatNumber(roi)}%)\n`;
      message += `${liqWarning}⚠️ Liq: $${formatNumber(position.liquidationPrice, 4)} (${formatNumber(distanceToLiq)}%)\n`;
      message += `⏱ Time: ${timeStr} | 💵 Margin: $${formatNumber(position.margin)}\n\n`;

      buttons.push([{ 
        text: `${pnl >= 0 ? '✅' : '❌'} Close ${position.symbol} ${position.type} (${formatNumber(roi)}%)`, 
        callback_data: `close_${position.id}` 
      }]);
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '💚' : '❤️';
  const totalRoi = totalInvested > 0 ? (totalPnL / totalInvested * 100) : 0;
  
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `${totalEmoji} *Total PnL: $${formatNumber(totalPnL)} (${formatNumber(totalRoi)}%)*\n`;
  message += `📊 Positions: ${user.positions.length} | 💰 Invested: $${formatNumber(totalInvested)}`;

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
  buttons.push([{ text: '🔙 Back to Menu', callback_data: 'menu
