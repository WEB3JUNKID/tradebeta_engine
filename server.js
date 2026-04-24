const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(cors());

const WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT'];
let lastScanResults = [];

function analyzeSMC(ohlc, symbol) {
    if (!ohlc || ohlc.length < 20) return null;
    const last = ohlc[ohlc.length - 1];
    const prev = ohlc[ohlc.length - 2];
    const prev3 = ohlc[ohlc.length - 4];

    let signal = { symbol, type: null, confluence: [], score: 0, price: last.close };

    const bullishFVG = prev.low > prev3.high;
    const bearishFVG = prev.high < prev3.low;

    const lookback = ohlc.slice(-15, -1);
    const localHigh = Math.max(...lookback.map(c => c.high));
    const localLow = Math.min(...lookback.map(c => c.low));

    if (last.close > localHigh) {
        signal.type = 'LONG';
        signal.confluence.push('BOS (Bullish)');
        signal.score += 40;
    } else if (last.close < localLow) {
        signal.type = 'SHORT';
        signal.confluence.push('BOS (Bearish)');
        signal.score += 40;
    }

    if (signal.type === 'LONG' && bullishFVG) {
        signal.confluence.push('FVG Detected');
        signal.score += 40;
    } else if (signal.type === 'SHORT' && bearishFVG) {
        signal.confluence.push('FVG Detected');
        signal.score += 40;
    }

    return signal.score >= 40 ? signal : null;
}

async function runScan() {
    console.log("Starting Market Sweep...");
    try {
        let matches = [];
        for (const s of WATCHLIST) {
            const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=15m&limit=50`);
            const data = res.data.map(d => ({ high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]) }));
            const result = analyzeSMC(data, s);
            if (result) matches.push(result);
        }
        lastScanResults = matches;
        console.log(`Sweep finished. Found ${matches.length} setups.`);
    } catch (e) {
        console.error("Scan Error: ", e.message);
    }
}

// Routes
app.get('/', (req, res) => res.send("TradeBeta Engine Active"));
app.get('/scan', (req, res) => res.json(lastScanResults));

// Use the port Render gives us
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    runScan();
});

cron.schedule('*/5 * * * *', runScan);
