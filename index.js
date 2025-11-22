const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createCanvas } = require('canvas');
const fs = require('fs');

// Telegram Bot Token
const token = '8349196950:AAF6EOlBTaGFEknR-xiY106GZMPRd0dh2HA';
const bot = new TelegramBot(token, { polling: true });

// Binance Futures API
const BINANCE_API = 'https://fapi.binance.com';

// User data storage (in production, use a database)
const users = new Map(); // Map<userId, {balance, positions, trades, stats}>

const INITIAL_BALANCE = 10000;
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

// Generate trade result image
async function generateTradeImage(trade, pnl, roi) {
  const width = 800;
  const height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const isProfit = pnl >= 0;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  if (isProfit) {
    gradient.addColorStop(0, '#0f2027');
    gradient.addColorStop(0.5, '#203a43');
    gradient.addColorStop(1, '#2c5364');
  } else {
    gradient.addColorStop(0, '#1a0000');
    gradient.addColorStop(0.5, '#2d0a0a');
    gradient.addColorStop(1, '#400a0a');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('POSITION CLOSED', width / 2, 70);

  // Result banner
  ctx.fillStyle = isProfit ? '#00ff88' : '#ff3366';
  ctx.fillRect(50, 100, width - 100, 120);
  
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 72px Arial';
  const resultText = isProfit ? 'PROFIT' : 'LOSS';
  const resultEmoji = isProfit ? '🚀' : '💥';
  ctx.fillText(`${resultEmoji} ${resultText} ${resultEmoji}`, width / 2, 180);

  // PnL Amount
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px Arial';
  const sign = pnl >= 0 ? '+' : '';
  ctx.fillText(`${sign}$${formatNumber(Math.abs(pnl))}`, width / 2, 260);

  // ROI
  ctx.font = 'bold 42px Arial';
  ctx.fillText(`ROI: ${sign}${formatNumber(roi)}%`, width / 2, 320);

  // Trade Details Box
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(50, 350, width - 100, 200);

  ctx.fillStyle = '#ffffff';
  ctx.font = '28px Arial';
  ctx.textAlign = 'left';
  
  const leftX = 80;
  const rightX = width / 2 + 50;
  let y = 390;
  const lineHeight = 40;

  // Left column
  ctx.fillText(`Symbol: ${trade.symbol}`, leftX, y);
  ctx.fillText(`Type: ${trade.type}`, leftX, y + lineHeight);
  ctx.fillText(`Entry: $${formatNumber(trade.entryPrice)}`, leftX, y + lineHeight * 2);
  ctx.fillText(`Amount: ${formatNumber(trade.amount, 4)}`, leftX, y + lineHeight * 3);

  // Right column
  ctx.fillText(`Leverage: ${trade.leverage}x`, rightX, y);
  ctx.fillText(`Exit: $${formatNumber(trade.exitPrice)}`, rightX, y + lineHeight);
  ctx.fillText(`Margin: $${formatNumber(trade.margin)}`, rightX, y + lineHeight * 2);
  
  const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);
  ctx.fillText(`Duration: ${duration}m`, rightX, y + lineHeight * 3);

  // Save image
  const filename = `trade_${Date.now()}.png`;
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  
  return filename;
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initUser(chatId);
  
  const welcomeMessage = `
🎯 *Welcome to Futures Demo Trading!*

Practice futures trading with $${INITIAL_BALANCE} demo funds!

*📊 Trading Commands:*
/long <coin> <amount> <leverage> - Open long
/short <coin> <amount> <leverage> - Open short

*Example:*
/long BTC 100 10 - Long $100 BTC at 10x leverage
/short ETH 50 5 - Short $50 ETH at 5x leverage

*📋 Management:*
/balance - View portfolio & stats
/positions - View open positions
/close <id> - Close specific position
/closeall - Close all positions
/history - View trade history
/reset - Reset account

*💡 Features:*
• Real-time Binance prices
• Leverage up to ${MAX_LEVERAGE}x
• Automatic liquidation
• PnL tracking
• Trade history with images
• Win rate statistics

Start trading now! 🚀
  `.trim();

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Command: /balance
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId);

  const totalMargin = user.positions.reduce((sum, p) => sum + p.margin, 0);
  const availableBalance = user.balance - totalMargin;
  const winRate = user.stats.totalTrades > 0 
    ? (user.stats.winningTrades / user.stats.totalTrades * 100).toFixed(2)
    : 0;

  const message = `
💼 *PORTFOLIO SUMMARY*

💰 *Total Balance:* $${formatNumber(user.balance)}
💵 *Available:* $${formatNumber(availableBalance)}
🔒 *In Positions:* $${formatNumber(totalMargin)}

📊 *TRADING STATS*
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

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command: /long
bot.onText(/\/long (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const params = match[1].trim().split(/\s+/);

  if (params.length !== 3) {
    bot.sendMessage(chatId, 
      '❌ *Invalid format!*\n\n' +
      'Usage: /long <coin> <amount> <leverage>\n\n' +
      'Example: /long BTC 100 10',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [coin, amountStr, leverageStr] = params;
  const amount = parseFloat(amountStr);
  const leverage = parseInt(leverageStr);

  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(chatId, '❌ Invalid amount. Must be greater than 0.');
    return;
  }

  if (isNaN(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
    bot.sendMessage(chatId, `❌ Invalid leverage. Must be between 1 and ${MAX_LEVERAGE}.`);
    return;
  }

  try {
    const user = initUser(chatId);
    const priceData = await getCurrentPrice(coin);
    const margin = amount; // The amount IS the margin (collateral)
    const positionSize = amount * leverage;

    if (margin > user.balance) {
      bot.sendMessage(chatId, 
        `❌ Insufficient balance!\n\n` +
        `Required: $${formatNumber(margin)}\n` +
        `Available: $${formatNumber(user.balance)}`
      );
      return;
    }

    const liquidationPrice = calculateLiquidationPrice(priceData.price, leverage, 'LONG');

    const position = {
      id: Date.now(),
      symbol: priceData.symbol,
      type: 'LONG',
      entryPrice: priceData.price,
      amount: positionSize / priceData.price, // Amount in coins
      margin: margin,
      leverage: leverage,
      liquidationPrice: liquidationPrice,
      openTime: Date.now()
    };

    user.positions.push(position);
    user.balance -= margin;

    const message = `
🟢 *LONG POSITION OPENED*

📊 *Symbol:* ${position.symbol}
💰 *Entry Price:* $${formatNumber(position.entryPrice)}
💵 *Position Size:* $${formatNumber(positionSize)}
📈 *Amount:* ${formatNumber(position.amount, 6)} ${coin.toUpperCase()}
🔒 *Margin:* $${formatNumber(margin)}
⚡ *Leverage:* ${leverage}x
⚠️ *Liquidation:* $${formatNumber(liquidationPrice)}

💼 *Remaining Balance:* $${formatNumber(user.balance)}
🆔 *Position ID:* ${position.id}

Use /positions to track your PnL!
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Command: /short
bot.onText(/\/short (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const params = match[1].trim().split(/\s+/);

  if (params.length !== 3) {
    bot.sendMessage(chatId, 
      '❌ *Invalid format!*\n\n' +
      'Usage: /short <coin> <amount> <leverage>\n\n' +
      'Example: /short BTC 100 10',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [coin, amountStr, leverageStr] = params;
  const amount = parseFloat(amountStr);
  const leverage = parseInt(leverageStr);

  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(chatId, '❌ Invalid amount. Must be greater than 0.');
    return;
  }

  if (isNaN(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
    bot.sendMessage(chatId, `❌ Invalid leverage. Must be between 1 and ${MAX_LEVERAGE}.`);
    return;
  }

  try {
    const user = initUser(chatId);
    const priceData = await getCurrentPrice(coin);
    const margin = amount;
    const positionSize = amount * leverage;

    if (margin > user.balance) {
      bot.sendMessage(chatId, 
        `❌ Insufficient balance!\n\n` +
        `Required: $${formatNumber(margin)}\n` +
        `Available: $${formatNumber(user.balance)}`
      );
      return;
    }

    const liquidationPrice = calculateLiquidationPrice(priceData.price, leverage, 'SHORT');

    const position = {
      id: Date.now(),
      symbol: priceData.symbol,
      type: 'SHORT',
      entryPrice: priceData.price,
      amount: positionSize / priceData.price,
      margin: margin,
      leverage: leverage,
      liquidationPrice: liquidationPrice,
      openTime: Date.now()
    };

    user.positions.push(position);
    user.balance -= margin;

    const message = `
🔴 *SHORT POSITION OPENED*

📊 *Symbol:* ${position.symbol}
💰 *Entry Price:* $${formatNumber(position.entryPrice)}
💵 *Position Size:* $${formatNumber(positionSize)}
📉 *Amount:* ${formatNumber(position.amount, 6)} ${coin.toUpperCase()}
🔒 *Margin:* $${formatNumber(margin)}
⚡ *Leverage:* ${leverage}x
⚠️ *Liquidation:* $${formatNumber(liquidationPrice)}

💼 *Remaining Balance:* $${formatNumber(user.balance)}
🆔 *Position ID:* ${position.id}

Use /positions to track your PnL!
    `.trim();

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Command: /positions
bot.onText(/\/positions/, async (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId);

  if (user.positions.length === 0) {
    bot.sendMessage(chatId, '📭 No open positions.\n\nUse /long or /short to open a position!');
    return;
  }

  let message = '📊 *OPEN POSITIONS*\n\n';
  let totalPnL = 0;

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

      // Check for liquidation
      if ((position.type === 'LONG' && priceData.price <= position.liquidationPrice) ||
          (position.type === 'SHORT' && priceData.price >= position.liquidationPrice)) {
        message += `💥 *LIQUIDATED!*\n\n`;
        
        // Remove position
        const index = user.positions.indexOf(position);
        user.positions.splice(index, 1);
        
        // Record trade
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
  message += `${totalEmoji} *Total Unrealized PnL: $${formatNumber(totalPnL)}*\n\n`;
  message += `Use /close <id> to close a position`;

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command: /close <id>
bot.onText(/\/close (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const positionId = parseInt(match[1].trim());
  const user = initUser(chatId);

  const position = user.positions.find(p => p.id === positionId);

  if (!position) {
    bot.sendMessage(chatId, '❌ Position not found. Use /positions to see your open positions.');
    return;
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Closing position...');
    
    const priceData = await getCurrentPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, priceData.price);

    // Update balance
    user.balance += position.margin + pnl;

    // Update stats
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

    // Record trade
    const trade = {
      ...position,
      exitPrice: priceData.price,
      closeTime: Date.now(),
      pnl: pnl,
      roi: roi,
      status: 'CLOSED'
    };
    user.trades.push(trade);

    // Remove position
    const index = user.positions.indexOf(position);
    user.positions.splice(index, 1);

    await bot.deleteMessage(chatId, loadingMsg.message_id);

    // Generate image
    const imagePath = await generateTradeImage(trade, pnl, roi);

    // Send image
    await bot.sendPhoto(chatId, imagePath, {
      caption: `
${pnl >= 0 ? '✅' : '❌'} *POSITION CLOSED*

💼 *New Balance:* $${formatNumber(user.balance)}
📊 *Win Rate:* ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(2) : 0}%
      `.trim(),
      parse_mode: 'Markdown'
    });

    // Delete image file
    fs.unlinkSync(imagePath);

  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Command: /closeall
bot.onText(/\/closeall/, async (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId);

  if (user.positions.length === 0) {
    bot.sendMessage(chatId, '📭 No open positions to close.');
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
  `.trim();

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command: /history
bot.onText(/\/history/, (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId);

  if (user.trades.length === 0) {
    bot.sendMessage(chatId, '📭 No trade history yet.\n\nStart trading with /long or /short!');
    return;
  }

  const recentTrades = user.trades.slice(-10).reverse();
  let message = '📜 *TRADE HISTORY* (Last 10)\n\n';

  recentTrades.forEach((trade, index) => {
    const emoji = trade.pnl >= 0 ? '✅' : '❌';
    const typeEmoji = trade.type === 'LONG' ? '🟢' : '🔴';
    
    message += `${emoji} ${typeEmoji} *${trade.symbol} ${trade.leverage}x*\n`;
    message += `   Entry: $${formatNumber(trade.entryPrice)} → Exit: $${formatNumber(trade.exitPrice)}\n`;
    message += `   PnL: $${formatNumber(trade.pnl)} (${formatNumber(trade.roi)}%)\n\n`;
  });

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command: /reset
bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  
  users.delete(chatId);
  initUser(chatId);

  bot.sendMessage(chatId, 
    '🔄 *Account Reset!*\n\n' +
    `Your balance has been reset to $${INITIAL_BALANCE}.\n` +
    'All positions and history cleared.\n\n' +
    'Ready to start fresh! 🚀',
    { parse_mode: 'Markdown' }
  );
});

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
          
          // Liquidate position
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
            { parse_mode: 'Markdown' }
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
