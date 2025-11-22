const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Telegram Bot Token
const token = '8349196950:AAF6EOlBTaGFEknR-xiY106GZMPRd0dh2HA';
const bot = new TelegramBot(token, { polling: true });

// Binance Futures API
const BINANCE_API = 'https://fapi.binance.com';

// User data storage (in production, use a database)
const users = new Map(); // Map<userId, {balance, positions, trades, stats}>
const userStates = new Map(); // Track user input states

const INITIAL_BALANCE = 1000;
const MAX_LEVERAGE = 125;

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

// Get current price
async function getCurrentPrice(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) {
      symbol += 'USDT';
    }

    const res = await axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, {
      params: { symbol }
    });

    return {
      symbol: res.data.symbol,
      price: parseFloat(res.data.price)
    };
  } catch (error) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
}

// Calculate liquidation price
function calculateLiquidationPrice(entryPrice, leverage, type) {
  const maintenanceMarginRate = 0.004; // 0.4% for most pairs
  
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

// Generate text-based trade summary
function generateTradeSummary(trade, pnl, roi) {
  const isProfit = pnl >= 0;
  const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);
  
  const border = isProfit ? '🟢' : '🔴';
  const result = isProfit ? '✅ PROFIT' : '❌ LOSS';
  const sign = pnl >= 0 ? '+' : '';
  
  return `
${border.repeat(20)}

${result}
${sign}$${formatNumber(Math.abs(pnl))} (${sign}${formatNumber(roi)}%)

${border.repeat(20)}

📊 TRADE DETAILS

🪙 Symbol: ${trade.symbol}
${trade.type === 'LONG' ? '📈' : '📉'} Type: ${trade.type}
⚡ Leverage: ${trade.leverage}x

💰 Entry Price: $${formatNumber(trade.entryPrice)}
🎯 Exit Price: $${formatNumber(trade.exitPrice)}
📊 Price Change: ${formatNumber(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100)}%

💵 Position Size: ${formatNumber(trade.amount, 6)} ${trade.symbol.replace('USDT', '')}
🔒 Margin Used: $${formatNumber(trade.margin)}

⏱ Duration: ${duration} minutes
📅 Closed: ${new Date(trade.closeTime).toLocaleString()}

${border.repeat(20)}
  `.trim();
}

// Main menu keyboard
function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '📈 Open Long', callback_data: 'open_long' },
        { text: '📉 Open Short', callback_data: 'open_short' }
      ],
      [
        { text: '💼 Portfolio', callback_data: 'balance' },
        { text: '📊 Positions', callback_data: 'positions' }
      ],
      [
        { text: '📜 History', callback_data: 'history' },
        { text: '🔄 Reset', callback_data: 'reset' }
      ]
    ]
  };
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initUser(chatId);
  
  const welcomeMessage = `
🎯 *Welcome to Futures Demo Trading!*

Practice futures trading with $${INITIAL_BALANCE} demo funds!

*💡 Features:*
• Real-time Binance prices
• Leverage up to ${MAX_LEVERAGE}x
• Automatic liquidation
• PnL tracking
• Detailed trade summaries
• Win rate statistics

Use the buttons below to start trading! 🚀
  `.trim();

  bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
});

// Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    switch (data) {
      case 'open_long':
        userStates.set(chatId, { action: 'long', step: 'coin' });
        bot.sendMessage(chatId, 
          '📈 *Opening Long Position*\n\n' +
          'Enter the coin symbol (e.g., BTC, ETH, SOL):',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'open_short':
        userStates.set(chatId, { action: 'short', step: 'coin' });
        bot.sendMessage(chatId, 
          '📉 *Opening Short Position*\n\n' +
          'Enter the coin symbol (e.g., BTC, ETH, SOL):',
          { parse_mode: 'Markdown' }
        );
        break;

      case 'balance':
        await showBalance(chatId);
        break;

      case 'positions':
        await showPositions(chatId);
        break;

      case 'history':
        await showHistory(chatId);
        break;

      case 'reset':
        bot.sendMessage(chatId, 
          '⚠️ *Confirm Reset*\n\n' +
          'This will reset your account to $' + INITIAL_BALANCE + ' and clear all positions and history.\n\n' +
          'Are you sure?',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Yes, Reset', callback_data: 'confirm_reset' },
                  { text: '❌ Cancel', callback_data: 'cancel' }
                ]
              ]
            }
          }
        );
        break;

      case 'confirm_reset':
        users.delete(chatId);
        initUser(chatId);
        userStates.delete(chatId);
        bot.sendMessage(chatId, 
          '🔄 *Account Reset!*\n\n' +
          `Your balance has been reset to $${INITIAL_BALANCE}.\n` +
          'All positions and history cleared.\n\n' +
          'Ready to start fresh! 🚀',
          { 
            parse_mode: 'Markdown',
            reply_markup: getMainMenu()
          }
        );
        break;

      case 'cancel':
        bot.sendMessage(chatId, '❌ Cancelled.', { reply_markup: getMainMenu() });
        break;

      case 'closeall':
        await closeAllPositions(chatId);
        break;

      default:
        // Handle close_<id> callbacks
        if (data.startsWith('close_')) {
          const positionId = parseInt(data.replace('close_', ''));
          await closePosition(chatId, positionId);
        }
        break;
    }
  } catch (error) {
    console.error('Callback error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
  }
});

// Handle text messages for multi-step input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands
  if (text && text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state) return;

  try {
    if (state.step === 'coin') {
      // Validate coin symbol
      try {
        const priceData = await getCurrentPrice(text);
        state.coin = text.toUpperCase();
        state.symbol = priceData.symbol;
        state.step = 'amount';
        userStates.set(chatId, state);
        
        bot.sendMessage(chatId, 
          `✅ ${state.symbol} selected (Current: $${formatNumber(priceData.price)})\n\n` +
          '💵 Enter margin amount in USD (e.g., 100):',
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        bot.sendMessage(chatId, 
          '❌ Invalid coin symbol. Please try again.\n\n' +
          'Enter a valid coin symbol (e.g., BTC, ETH, SOL):',
          { parse_mode: 'Markdown' }
        );
      }
    } else if (state.step === 'amount') {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, 
          '❌ Invalid amount. Please enter a number greater than 0:',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const user = initUser(chatId);
      if (amount > user.balance) {
        bot.sendMessage(chatId, 
          `❌ Insufficient balance!\n\n` +
          `Required: $${formatNumber(amount)}\n` +
          `Available: $${formatNumber(user.balance)}\n\n` +
          'Please enter a lower amount:',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      state.amount = amount;
      state.step = 'leverage';
      userStates.set(chatId, state);

      bot.sendMessage(chatId, 
        `💵 Margin: $${formatNumber(amount)}\n\n` +
        `⚡ Enter leverage (1-${MAX_LEVERAGE}):`,
        { parse_mode: 'Markdown' }
      );
    } else if (state.step === 'leverage') {
      const leverage = parseInt(text);
      if (isNaN(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
        bot.sendMessage(chatId, 
          `❌ Invalid leverage. Please enter a number between 1 and ${MAX_LEVERAGE}:`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      state.leverage = leverage;
      await openPosition(chatId, state);
      userStates.delete(chatId);
    }
  } catch (error) {
    console.error('Message handling error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.', {
      reply_markup: getMainMenu()
    });
    userStates.delete(chatId);
  }
});

// Open position function
async function openPosition(chatId, state) {
  try {
    const user = initUser(chatId);
    const priceData = await getCurrentPrice(state.coin);
    const margin = state.amount;
    const leverage = state.leverage;
    const positionSize = margin * leverage;

    const liquidationPrice = calculateLiquidationPrice(
      priceData.price, 
      leverage, 
      state.action.toUpperCase()
    );

    const position = {
      id: Date.now(),
      symbol: priceData.symbol,
      type: state.action.toUpperCase(),
      entryPrice: priceData.price,
      amount: positionSize / priceData.price,
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
💰 *Entry Price:* $${formatNumber(position.entryPrice)}
💵 *Position Size:* $${formatNumber(positionSize)}
${arrow} *Amount:* ${formatNumber(position.amount, 6)} ${state.coin}
🔒 *Margin:* $${formatNumber(margin)}
⚡ *Leverage:* ${leverage}x
⚠️ *Liquidation:* $${formatNumber(liquidationPrice)}

💼 *Remaining Balance:* $${formatNumber(user.balance)}
🆔 *Position ID:* ${position.id}
    `.trim();

    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Show balance function
async function showBalance(chatId) {
  const user = initUser(chatId);

  const totalMargin = user.positions.reduce((sum, p) => sum + p.margin, 0);
  const availableBalance = user.balance - totalMargin;
  const winRate = user.stats.totalTrades > 0 
    ? (user.stats.winningTrades / user.stats.totalTrades * 100).toFixed(2)
    : 0;
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;

  const message = `
💼 *PORTFOLIO SUMMARY*

💰 *Total Balance:* $${formatNumber(user.balance)}
💵 *Available:* $${formatNumber(availableBalance)}
🔒 *In Positions:* $${formatNumber(totalMargin)}
${netPnL >= 0 ? '📈' : '📉'} *Net PnL:* $${formatNumber(netPnL)}

━━━━━━━━━━━━━━━━━━━━━

📊 *TRADING STATISTICS*

📈 *Total Trades:* ${user.stats.totalTrades}
✅ *Winning:* ${user.stats.winningTrades}
❌ *Losing:* ${user.stats.losingTrades}
🎯 *Win Rate:* ${winRate}%

💚 *Total Profit:* $${formatNumber(user.stats.totalProfit)}
❤️ *Total Loss:* $${formatNumber(Math.abs(user.stats.totalLoss))}
🏆 *Best Trade:* $${formatNumber(user.stats.bestTrade)}
💔 *Worst Trade:* $${formatNumber(user.stats.worstTrade)}

🔢 *Open Positions:* ${user.positions.length}
  `.trim();

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show positions function
async function showPositions(chatId) {
  const user = initUser(chatId);

  if (user.positions.length === 0) {
    bot.sendMessage(chatId, '📭 No open positions.\n\nUse the buttons to open a position!', {
      reply_markup: getMainMenu()
    });
    return;
  }

  let message = '📊 *OPEN POSITIONS*\n\n';
  let totalPnL = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const priceData = await getCurrentPrice(position.symbol);
      const { pnl, roi } = calculatePnL(position, priceData.price);
      totalPnL += pnl;

      const pnlEmoji = pnl >= 0 ? '📈' : '📉';
      const typeEmoji = position.type === 'LONG' ? '🟢' : '🔴';

      message += `${typeEmoji} *${position.type} ${position.symbol}*\n`;
      message += `🆔 ID: ${position.id}\n`;
      message += `💰 Entry: $${formatNumber(position.entryPrice)}\n`;
      message += `📊 Current: $${formatNumber(priceData.price)}\n`;
      message += `⚡ Leverage: ${position.leverage}x\n`;
      message += `${pnlEmoji} PnL: $${formatNumber(pnl)} (${formatNumber(roi)}%)\n`;
      message += `⚠️ Liq: $${formatNumber(position.liquidationPrice)}\n\n`;

      // Add close button for this position
      buttons.push([{ 
        text: `Close ${position.symbol} ${position.type}`, 
        callback_data: `close_${position.id}` 
      }]);

      // Check for liquidation
      if ((position.type === 'LONG' && priceData.price <= position.liquidationPrice) ||
          (position.type === 'SHORT' && priceData.price >= position.liquidationPrice)) {
        message += `💥 *LIQUIDATED!*\n\n`;
        
        const index = user.positions.indexOf(position);
        user.positions.splice(index, 1);
        
        user.stats.totalTrades++;
        user.stats.losingTrades++;
        user.stats.totalLoss += position.margin;
        if (-position.margin < user.stats.worstTrade) {
          user.stats.worstTrade = -position.margin;
        }

        const trade = {
          ...position,
          exitPrice: priceData.price,
          closeTime: Date.now(),
          pnl: -position.margin,
          roi: -100,
          status: 'LIQUIDATED'
        };
        user.trades.push(trade);
      }
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '💚' : '❤️';
  message += `━━━━━━━━━━━━━━━━━━━━━\n${totalEmoji} *Total Unrealized PnL: $${formatNumber(totalPnL)}*`;

  // Add close all button if there are positions
  if (user.positions.length > 0) {
    buttons.push([{ text: '🔴 Close All Positions', callback_data: 'closeall' }]);
  }
  
  buttons.push([{ text: '🔙 Back to Menu', callback_data: 'cancel' }]);

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Close position function
async function closePosition(chatId, positionId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);

  if (!position) {
    bot.sendMessage(chatId, '❌ Position not found or already closed.', {
      reply_markup: getMainMenu()
    });
    return;
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Closing position...');
    
    const priceData = await getCurrentPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, priceData.price);

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
      exitPrice: priceData.price,
      closeTime: Date.now(),
      pnl: pnl,
      roi: roi,
      status: 'CLOSED'
    };
    user.trades.push(trade);

    const index = user.positions.indexOf(position);
    user.positions.splice(index, 1);

    await bot.deleteMessage(chatId, loadingMsg.message_id);

    const summary = generateTradeSummary(trade, pnl, roi);

    await bot.sendMessage(chatId, 
      `\`\`\`\n${summary}\n\`\`\`\n` +
      `💼 *New Balance:* $${formatNumber(user.balance)}\n` +
      `📊 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%`,
      { 
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      }
    );

  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, {
      reply_markup: getMainMenu()
    });
  }
}

// Close all positions function
async function closeAllPositions(chatId) {
  const user = initUser(chatId);

  if (user.positions.length === 0) {
    bot.sendMessage(chatId, '📭 No open positions to close.', {
      reply_markup: getMainMenu()
    });
    return;
  }

  const loadingMsg = await bot.sendMessage(chatId, '⏳ Closing all positions...');
  
  let totalPnL = 0;
  const closedCount = user.positions.length;

  for (const position of [...user.positions]) {
    try {
      const priceData = await getCurrentPrice(position.symbol);
      const { pnl, roi } = calculatePnL(position, priceData.price);

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
        exitPrice: priceData.price,
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

  await bot.deleteMessage(chatId, loadingMsg.message_id);

  const emoji = totalPnL >= 0 ? '✅' : '❌';
  const message = `
${emoji} *ALL POSITIONS CLOSED*

📊 *Closed:* ${closedCount} position(s)
💰 *Total PnL:* $${formatNumber(totalPnL)}
💼 *New Balance:* $${formatNumber(user.balance)}
📈 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%
  `.trim();

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show history function
async function showHistory(chatId) {
  const user = initUser(chatId);

  if (user.trades.length === 0) {
    bot.sendMessage(chatId, '📭 No trade history yet.\n\nStart trading with the buttons below!', {
      reply_markup: getMainMenu()
    });
    return;
  }

  const recentTrades = user.trades.slice(-10).reverse();
  let message = '📜 *TRADE HISTORY* (Last 10)\n\n';

  recentTrades.forEach((trade) => {
    const emoji = trade.pnl >= 0 ? '✅' : '❌';
    const typeEmoji = trade.type === 'LONG' ? '🟢' : '🔴';
    
    message += `${emoji} ${typeEmoji} *${trade.symbol} ${trade.leverage}x*\n`;
    message += `   Entry: $${formatNumber(trade.entryPrice)} → Exit: $${formatNumber(trade.exitPrice)}\n`;
    message += `   PnL: $${formatNumber(trade.pnl)} (${formatNumber(trade.roi)}%)\n`;
    message += `   ${trade.status}\n\n`;
  });

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
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
        const priceData = await getCurrentPrice(position.symbol);
        
        if ((position.type === 'LONG' && priceData.price <= position.liquidationPrice) ||
            (position.type === 'SHORT' && priceData.price >= position.liquidationPrice)) {
          
          const index = user.positions.indexOf(position);
          user.positions.splice(index, 1);
          
          user.stats.totalTrades++;
          user.stats.losingTrades++;
          user.stats.totalLoss += position.margin;
          if (-position.margin < user.stats.worstTrade) {
            user.stats.worstTrade = -position.margin;
          }

          const trade = {
            ...position,
            exitPrice: priceData.price,
            closeTime: Date.now(),
            pnl: -position.margin,
            roi: -100,
            status: 'LIQUIDATED'
          };
          user.trades.push(trade);

          bot.sendMessage(userId,
            `💥 *POSITION LIQUIDATED!*\n\n` +
            `${position.type} ${position.symbol} ${position.leverage}x\n` +
            `Entry: $${formatNumber(position.entryPrice)}\n` +
            `Liquidation: $${formatNumber(priceData.price)}\n` +
            `Loss: -$${formatNumber(position.margin)}\n\n` +
            `💼 Balance: $${formatNumber(user.balance)}`,
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
