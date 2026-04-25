const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { fetchKlines, getTopSymbols } = require('./binance');
const { detectStructure, findOrderBlock, findFVGs, detectCRT } = require('./smc');

const app = express();
app.use(cors());

let engineOutput = {
  lastUpdate: null,
  setups: []
};

async function runEngine() {
  console.log("🚀 Starting TradeBeta SMC Scan...");
  const symbols = await getTopSymbols(30);
  const results = [];

  for (const symbol of symbols) {
    try {
      // Fetch 1H for Structure/OB/FVG and 15m for CRT Entry Trigger
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
          structure: structure.structureType, // BOS or CHoCH
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
  console.log(`✅ Scan Complete. Found ${results.length} high-probability setups.`);
}

// Routes
app.get('/', (req, res) => res.send("TradeBeta V2 Backend: Online"));
app.get('/scan', (req, res) => res.json(engineOutput));

// Port and Init
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  runEngine(); // Run once on boot
});

// Cron: Run every 15 minutes to align with the M15 timeframe
cron.schedule('*/15 * * * *', runEngine);
