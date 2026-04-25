require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { Telegraf } = require('telegraf');

// Make sure you have these files in your directory!
const { fetchKlines, getTopSymbols } = require('./binance');
const { detectStructure, findOrderBlock, findFVGs, detectCRT } = require('./smc');

// 1. Setup & Config
const app = express();
app.use(cors());

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

let engineOutput = {
  lastUpdate: null,
  setups: []
};

// 2. Telegram Bot Interface
bot.start((ctx) => {
    ctx.reply("🚀 TradeBeta Engine is running in the background. Check your channel for live signals.");
});

bot.command('status', (ctx) => {
    ctx.reply(`✅ Sentinel Status: Online\n🕒 Last Scan: ${engineOutput.lastUpdate || 'Waiting for first run...'}\n📈 Setups in last scan: ${engineOutput.setups.length}`);
});

/**
 * Broadcasts signals directly to the channel
 */
async function broadcastSignals(setups) {
    if (setups.length === 0) return;

    for (const setup of setups) {
        const message = `🎯 <b>SMC ALERT: ${setup.symbol}</b>
━━━━━━━━━━━━━━━━━━
📊 <b>Bias:</b> ${setup.bias === 'BULLISH' ? '🟢 BULLISH' : '🔴 BEARISH'}
📉 <b>Type:</b> ${setup.structure}
🛡️ <b>Entry:</b> ${setup.entry.entry.toFixed(4)}
🛑 <b>SL:</b> ${setup.entry.sl.toFixed(4)}
💰 <b>TP:</b> ${setup.entry.tp.toFixed(4)}
⚖️ <b>RR:</b> 1:${setup.entry.rr}

<b>CRT Sweep Level:</b> ${setup.entry.sweepLevel}
<b>FVG Confluences:</b> ${setup.fvgCount}
━━━━━━━━━━━━━━━━━━
<i>TradeBeta v2.0 Engine</i>`;

        try {
            await bot.telegram.sendMessage(CHANNEL_ID, message, { parse_mode: 'HTML' });
            console.log(`📡 Broadcasted ${setup.symbol} to channel.`);
        } catch (err) {
            console.error(`❌ Broadcast Failed for ${setup.symbol}:`, err.message);
        }
    }
}

// 3. The Core Logic
async function runEngine() {
  console.log("🚀 Starting Market Sweep...");
  
  try {
    const symbols = await getTopSymbols(30);
    const results = [];

    if (!symbols || symbols.length === 0) {
      console.log("⚠️ No symbols fetched. Skipping scan.");
      return;
    }

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
            fvgCount: fvgs ? fvgs.length : 0,
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
  } catch (globalErr) {
    console.error("❌ Global Engine Error:", globalErr.message);
  }
}

// 4. Server Lifecycle
app.get('/', (req, res) => res.send("TradeBeta V2 Backend: Online"));
app.get('/scan', (req, res) => res.json(engineOutput));

const PORT = process.env.PORT || 10000;

// Render-safe port binding ('0.0.0.0')
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  
  // Launch the bot safely
  bot.launch()
    .then(() => console.log("🤖 Telegram Sentinel: Online"))
    .catch((err) => console.error("❌ Bot Launch Failed:", err));
  
  // Wait 5 seconds before running the first scan to ensure Render marks the port as "Live"
  setTimeout(() => {
    runEngine();
  }, 5000);
});

// Cron: Run every 15 minutes
cron.schedule('*/15 * * * *', runEngine);

// Clean exit
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
