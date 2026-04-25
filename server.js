const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { Telegraf } = require('telegraf');
const { fetchKlines, getTopSymbols } = require('./binance');
const { detectStructure, findOrderBlock, findFVGs, detectCRT } = require('./smc');

// 1. Setup & Config
const app = express();
app.use(cors());

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // Should be @beetatrades

let engineOutput = {
  lastUpdate: null,
  setups: []
};

// 2. Telegram Bot Interface
bot.start((ctx) => {
    ctx.reply("🚀 TradeBeta Engine is running in the background. Check @beetatrades for live signals.");
});

// Added a status command so you can check health from your phone
bot.command('status', (ctx) => {
    ctx.reply(`✅ Sentinel Status: Online\n🕒 Last Scan: ${engineOutput.lastUpdate || 'Waiting for first run...'}\n📈 Setups in last scan: ${engineOutput.setups.length}`);
});

/**
 * Broadcasts signals directly to the @beetatrades channel
 */
async function broadcastSignals(setups) {
    if (setups.length === 0) return;

    for (const setup of setups) {
        const message = `
🎯 *SMC ALERT: ${setup.symbol}*
━━━━━━━━━━━━━━━━━━
📊 *Bias:* ${setup.bias === 'BULLISH' ? '🟢 BULLISH' : '🔴 BEARISH'}
📉 *Type:* ${setup.structure}
🛡️ *Entry:* ${setup.entry.entry.toFixed(4)}
🛑 *SL:* ${setup.entry.sl.toFixed(4)}
💰 *TP:* ${setup.entry.tp.toFixed(4)}
⚖️ *RR:* 1:${setup.entry.rr}

*CRT Sweep Level:* ${setup.entry.sweepLevel}
*FVG Confluences:* ${setup.fvgCount}
━━━━━━━━━━━━━━━━━━
_TradeBeta v2.0 Engine_
        `;

        try {
            await bot.telegram.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
            console.log(`📡 Broadcasted ${setup.symbol} to channel.`);
        } catch (err) {
            console.error(`❌ Broadcast Failed:`, err.message);
        }
    }
}

// 3. The Core Logic
async function runEngine() {
  console.log("🚀 Starting Market Sweep...");
  const symbols = await getTopSymbols(30);
  const results = [];

  for (const symbol of symbols) {
    try {
      const candles1H = await fetchKlines(symbol, '1h', 100);
      const candles15m = await fetchKlines(symbol, '15m', 100);

      if (!candles1H || !candles15m) continue;

      const structure = detectStructure(candles1H);
      if (!structure) continue;

      const ob = findOrderBlock(candles1H, structure);
      const fvgs = findFVGs(candles1H, structure.bias);
      const entry = detectCRT(candles15m, structure.bias);

      if (entry) {
        results.push({
          symbol,
          bias: structure.bias,
          structure: structure.structureType,
          orderBlock: ob,
          fvgCount: fvgs.length,
          entry: entry,
          time: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`Error scanning ${symbol}:`, err.message);
    }
  }

  engineOutput = {
    lastUpdate: new Date().toLocaleTimeString(),
    setups: results
  };

  // BROADCAST TO THE CHANNEL
  if (results.length > 0) {
    await broadcastSignals(results);
  }
  
  console.log(`✅ Scan Complete. Found ${results.length} setups.`);
}

// 4. Server Lifecycle
app.get('/', (req, res) => res.send("TradeBeta V2 Backend: Online"));
app.get('/scan', (req, res) => res.json(engineOutput));

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`Server listening on ${PORT}`);
  
  // Launch the bot
  bot.launch().then(() => console.log("🤖 Telegram Sentinel: Online"));
  
  // Initial run
  await runEngine();
});

// Cron: Run every 15 minutes
cron.schedule('*/15 * * * *', runEngine);

// Clean exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
