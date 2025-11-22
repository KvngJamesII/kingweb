const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Telegram Bot Token
const token = '8349196950:AAF6EOlBTaGFEknR-xiY106GZMPRd0dh2HA';
const bot = new TelegramBot(token, { polling: true });

// Binance Futures API
const BINANCE_API = 'https://fapi.binance.com';

// User data storage (in production, use a database)
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

// Format large numbers (for volume)
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
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);

    const changeEmoji = data.priceChangePercent >= 0 ? '📈' : '📉';
    const changeColor = data.priceChangePercent >= 0 ? '🟢' : '🔴';

    const message = `
${changeColor} *${data.symbol}*

💰 Profit Factor: ${formatNumber(profitFactor)}
💚 Avg Profit: ${formatNumber(avgProfit)}
❤️ Avg Loss: ${formatNumber(avgLoss)}

🏆 Best Trade: ${formatNumber(user.stats.bestTrade)}
💔 Worst Trade: ${formatNumber(user.stats.worstTrade)}

━━━━━━━━━━━━━━━━━━━━━

🔥 *Streaks*

Current: ${currentStreak >= 0 ? '🟢' : '🔴'} ${Math.abs(currentStreak)} ${currentStreak >= 0 ? 'wins' : 'losses'}
Best Win Streak: ${maxWinStreak}
Worst Loss Streak: ${maxLossStreak}
  `.trim();

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show history
async function showHistory(chatId) {
  const user = initUser(chatId);

  if (user.trades.length === 0) {
    bot.sendMessage(chatId, '📭 No trade history yet.\n\nStart trading with /trade <COIN>!', {
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
    message += `   Entry: ${formatNumber(trade.entryPrice, 4)} → Exit: ${formatNumber(trade.exitPrice, 4)}\n`;
    message += `   PnL: ${formatNumber(trade.pnl)} (${formatNumber(trade.roi)}%)\n`;
    message += `   ${trade.status}\n\n`;
  });

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show leaderboard
async function showLeaderboard(chatId) {
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

  let message = '🏆 *LEADERBOARD - Top Traders*\n\n';

  if (leaderboardData.length === 0) {
    message += 'No traders yet. Be the first! 🚀';
  } else {
    leaderboardData.slice(0, 10).forEach((trader, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      const isCurrentUser = trader.userId === chatId;
      const highlight = isCurrentUser ? '👉 ' : '';
      
      message += `${highlight}${medal} User ${trader.userId.toString().slice(-4)}\n`;
      message += `   💰 Balance: ${formatNumber(trader.balance)}\n`;
      message += `   📈 PnL: ${formatNumber(trader.netPnL)} (${trader.roi >= 0 ? '+' : ''}${trader.roi}%)\n`;
      message += `   🎯 Win Rate: ${trader.winRate}%\n`;
      message += `   📊 Trades: ${trader.totalTrades}\n\n`;
    });

    // Show current user's rank if not in top 10
    const userRank = leaderboardData.findIndex(t => t.userId === chatId);
    if (userRank >= 10) {
      const userData = leaderboardData[userRank];
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `👉 Your Rank: #${userRank + 1}\n`;
      message += `   💰 Balance: ${formatNumber(userData.balance)}\n`;
      message += `   📈 PnL: ${formatNumber(userData.netPnL)} (${userData.roi >= 0 ? '+' : ''}${userData.roi}%)\n`;
    }
  }

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show settings
async function showSettings(chatId) {
  const message = `
⚙️ *SETTINGS*

Manage your trading account and preferences.
  `.trim();

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Reset Account', callback_data: 'reset_confirm' }
        ],
        [
          { text: '📊 Export History', callback_data: 'export_history' }
        ],
        [
          { text: '🔙 Back to Menu', callback_data: 'menu' }
        ]
      ]
    }
  });
}

// Show help
async function showHelp(chatId) {
  const message = `
❓ *HELP & COMMANDS*

*🔍 Quick Commands:*
/p <COIN> - View coin details & trade
/trade <COIN> - Open trade directly
/menu - Show main menu

*💡 Examples:*
/p BTC
/trade ETH
/p SOL

*📊 Menu Options:*
• *Positions* - View & manage open positions
• *Balance* - View portfolio & stats
• *Analysis* - Detailed performance metrics
• *History* - View past trades
• *Leaderboard* - Top traders ranking
• *Settings* - Account management

*🎯 How to Trade:*
1. Use /p <COIN> or /trade <COIN>
2. Select LONG or SHORT
3. Choose your margin amount
4. Select leverage (1-${MAX_LEVERAGE}x)
5. Confirm and trade!

*⚠️ Risk Management:*
• Higher leverage = Higher risk
• Always monitor liquidation price
• Start with lower leverage
• Practice risk management

*💡 Tips:*
• Check 24h change before trading
• Set realistic profit targets
• Don't risk more than you can afford
• Use the analysis tool to improve

Need more help? Contact support! 📧
  `.trim();

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Close position
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

    await bot.deleteMessage(chatId, loadingMsg.message_id);

    const isProfit = pnl >= 0;
    const border = isProfit ? '🟢' : '🔴';
    const result = isProfit ? '✅ PROFIT' : '❌ LOSS';
    const sign = pnl >= 0 ? '+' : '';
    const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);

    const summary = `
${border.repeat(20)}

${result}
${sign}${formatNumber(Math.abs(pnl))} (${sign}${formatNumber(roi)}%)

${border.repeat(20)}

📊 TRADE DETAILS

🪙 Symbol: ${trade.symbol}
${trade.type === 'LONG' ? '📈' : '📉'} Type: ${trade.type}
⚡ Leverage: ${trade.leverage}x

💰 Entry Price: ${formatNumber(trade.entryPrice, 4)}
🎯 Exit Price: ${formatNumber(trade.exitPrice, 4)}
📊 Price Change: ${formatNumber(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100)}%

💵 Position Size: ${formatNumber(trade.amount, 6)}
🔒 Margin Used: ${formatNumber(trade.margin)}

⏱ Duration: ${duration} minutes

${border.repeat(20)}
    `.trim();

    await bot.sendMessage(chatId, 
      `\`\`\`\n${summary}\n\`\`\`\n` +
      `💼 *New Balance:* ${formatNumber(user.balance)}\n` +
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

// Close all positions
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

  await bot.deleteMessage(chatId, loadingMsg.message_id);

  const emoji = totalPnL >= 0 ? '✅' : '❌';
  const message = `
${emoji} *ALL POSITIONS CLOSED*

📊 *Closed:* ${closedCount} position(s)
💰 *Total PnL:* ${formatNumber(totalPnL)}
💼 *New Balance:* ${formatNumber(user.balance)}
📈 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%
  `.trim();

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
            `${position.type} ${position.symbol} ${position.leverage}x\n` +
            `Entry: ${formatNumber(position.entryPrice, 4)}\n` +
            `Liquidation: ${formatNumber(data.price, 4)}\n` +
            `Loss: -${formatNumber(position.margin)}\n\n` +
            `💼 Balance: ${formatNumber(user.balance)}`,
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
*Price:* $${formatNumber(data.price, 4)}
${changeEmoji} *24h Change:* ${data.priceChangePercent >= 0 ? '+' : ''}${formatNumber(data.priceChangePercent)}%
📊 *24h High:* $${formatNumber(data.highPrice, 4)}
📉 *24h Low:* $${formatNumber(data.lowPrice, 4)}
📦 *24h Volume:* ${formatVolume(data.volume)} ${coin}
💵 *24h Vol (USDT):* $${formatVolume(data.quoteVolume)}
    `.trim();

    bot.sendMessage(chatId, message, {
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

// Show trade options
async function showTradeOptions(chatId, symbol) {
  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Loading trade options...');
    const data = await getCoinDetails(symbol);
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);

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

    bot.sendMessage(chatId, message, {
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

    // Menu navigation
    if (data === 'menu') {
      bot.editMessageText('📱 *Main Menu*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
      return;
    }

    // Trade coin
    if (data.startsWith('trade_')) {
      const symbol = data.replace('trade_', '');
      await showTradeOptions(chatId, symbol);
      return;
    }

    // Long/Short selection
    if (data.startsWith('long_') || data.startsWith('short_')) {
      const [type, symbol] = data.split('_');
      userStates.set(chatId, { action: type, symbol: symbol, step: 'amount' });
      await showAmountSelection(chatId, messageId, symbol, type);
      return;
    }

    // Amount selection
    if (data.startsWith('amount_')) {
      const amount = data.replace('amount_', '');
      const state = userStates.get(chatId);
      
      if (amount === 'custom') {
        state.step = 'custom_amount';
        userStates.set(chatId, state);
        bot.sendMessage(chatId, '💵 Enter custom amount in USD:');
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

    // Leverage selection
    if (data.startsWith('leverage_')) {
      const leverage = data.replace('leverage_', '');
      const state = userStates.get(chatId);
      
      if (leverage === 'custom') {
        state.step = 'custom_leverage';
        userStates.set(chatId, state);
        bot.sendMessage(chatId, `⚡ Enter custom leverage (1-${MAX_LEVERAGE}):`);
        return;
      } else {
        state.leverage = parseInt(leverage);
        await showTradeConfirmation(chatId, messageId, state);
      }
      return;
    }

    // Confirm trade
    if (data === 'confirm_trade') {
      const state = userStates.get(chatId);
      await executeTrade(chatId, state);
      userStates.delete(chatId);
      return;
    }

    // Cancel trade
    if (data === 'cancel_trade') {
      userStates.delete(chatId);
      bot.editMessageText('❌ Trade cancelled.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getMainMenu()
      });
      return;
    }

    // Main menu options
    switch (data) {
      case 'positions':
        await showPositions(chatId);
        break;
      case 'balance':
        await showBalance(chatId);
        break;
      case 'analysis':
        await showAnalysis(chatId);
        break;
      case 'history':
        await showHistory(chatId);
        break;
      case 'leaderboard':
        await showLeaderboard(chatId);
        break;
      case 'settings':
        await showSettings(chatId);
        break;
      case 'help':
        await showHelp(chatId);
        break;
      case 'closeall':
        await closeAllPositions(chatId);
        break;
      case 'reset_confirm':
        users.delete(chatId);
        initUser(chatId);
        userStates.delete(chatId);
        bot.sendMessage(chatId, 
          '🔄 *Account Reset!*\n\n' +
          `Your balance has been reset to $${INITIAL_BALANCE}.\n` +
          'All positions and history cleared.',
          { 
            parse_mode: 'Markdown',
            reply_markup: getMainMenu()
          }
        );
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

// Execute trade
async function executeTrade(chatId, state) {
  try {
    const user = initUser(chatId);
    const data = await getCoinDetails(state.symbol);
    const margin = state.amount;
    const leverage = state.leverage;
    const positionSize = margin * leverage;

    if (margin > user.balance) {
      bot.sendMessage(chatId, 
        `❌ Insufficient balance!\n\n` +
        `Required: $${formatNumber(margin)}\n` +
        `Available: $${formatNumber(user.balance)}`,
        { reply_markup: getMainMenu() }
      );
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
        bot.sendMessage(chatId, `❌ Invalid leverage. Please enter a number between 1 and ${MAX_LEVERAGE}:`);
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

// Show positions
async function showPositions(chatId) {
  const user = initUser(chatId);

  if (user.positions.length === 0) {
    bot.sendMessage(chatId, '📭 No open positions.\n\nUse /trade <COIN> to open a position!', {
      reply_markup: getMainMenu()
    });
    return;
  }

  let message = '📊 *OPEN POSITIONS*\n\n';
  let totalPnL = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const data = await getCoinDetails(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      totalPnL += pnl;

      const pnlEmoji = pnl >= 0 ? '📈' : '📉';
      const typeEmoji = position.type === 'LONG' ? '🟢' : '🔴';

      message += `${typeEmoji} *${position.type} ${position.symbol}* ${position.leverage}x\n`;
      message += `💰 Entry: $${formatNumber(position.entryPrice, 4)}\n`;
      message += `📊 Current: $${formatNumber(data.price, 4)}\n`;
      message += `${pnlEmoji} PnL: $${formatNumber(pnl)} (${formatNumber(roi)}%)\n`;
      message += `⚠️ Liq: $${formatNumber(position.liquidationPrice, 4)}\n\n`;

      buttons.push([{ 
        text: `Close ${position.symbol} ${position.type}`, 
        callback_data: `close_${position.id}` 
      }]);
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '💚' : '❤️';
  message += `━━━━━━━━━━━━━━━━━━━━━\n${totalEmoji} *Total PnL: $${formatNumber(totalPnL)}*`;

  if (user.positions.length > 1) {
    buttons.push([{ text: '🔴 Close All Positions', callback_data: 'closeall' }]);
  }
  buttons.push([{ text: '🔙 Back to Menu', callback_data: 'menu' }]);

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Show balance
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
  `.trim();

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
}

// Show analysis
async function showAnalysis(chatId) {
  const user = initUser(chatId);

  if (user.trades.length === 0) {
    bot.sendMessage(chatId, '📊 No trading data yet to analyze.\n\nStart trading to see your performance!', {
      reply_markup: getMainMenu()
    });
    return;
  }

  const totalTrades = user.stats.totalTrades;
  const winRate = (user.stats.winningTrades / totalTrades * 100).toFixed(2);
  const avgProfit = user.stats.winningTrades > 0 ? (user.stats.totalProfit / user.stats.winningTrades) : 0;
  const avgLoss = user.stats.losingTrades > 0 ? (user.stats.totalLoss / user.stats.losingTrades) : 0;
  const profitFactor = user.stats.totalLoss !== 0 ? Math.abs(user.stats.totalProfit / user.stats.totalLoss) : 0;
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const roi = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);

  // Calculate streak
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

  const message = `
📈 *TRADING ANALYSIS*

💼 *Account Performance*
Starting Balance: $${INITIAL_BALANCE}
Current Balance: $${formatNumber(user.balance)}
Net PnL: $${formatNumber(netPnL)}
ROI: ${roi >= 0 ? '+' : ''}${roi}%

━━━━━━━━━━━━━━━━━━━━━

📊 *Trading Metrics*

🎯 Win Rate: ${winRate}%
📈 Total Trades: ${totalTrades}
✅ Winning Trades: ${user.stats.winningTrades}
❌ Losing Trades: ${user.stats.losingTrades}

💰
