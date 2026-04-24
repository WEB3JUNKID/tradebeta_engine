const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(cors());

// Phase 1 Symbols (We'll expand this later)
const WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT'];

/**
 * The Data Pipeline: Fetches raw OHLCV from Binance
 * Interval: 15m (Optimal for day/swing setups)
 */
async function getOHLC(symbol, interval = '15m', limit = 100) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    try {
        const { data } = await axios.get(url);
        // Map Binance's ugly array format into clean, readable objects
        return data.map(d => ({
            time: d[0],
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
        }));
    } catch (error) {
        console.error(`Fetch failed for ${symbol}:`, error.message);
        return null;
    }
}

// Global cache so the frontend gets instant responses
let lastScanResults = [];

/**
 * The Scan Loop: This will eventually house the SMC math.
 */
async function runScan() {
    console.log(`[${new Date().toISOString()}] Initiating sweep...`);
    let results = [];

    for (const symbol of WATCHLIST) {
        const ohlc = await getOHLC(symbol);
        if (!ohlc) continue;

        // Placeholder for the upcoming ICT Engine
        // const signal = analyzeSMC(ohlc); 

        // For now, just verifying the data pipeline is bleeding edge
        const lastCandle = ohlc[ohlc.length - 1];
        results.push({
            symbol,
            currentPrice: lastCandle.close,
            dataPoints: ohlc.length,
            status: "PIPELINE_ACTIVE"
        });
    }

    lastScanResults = results;
    console.log(`[${new Date().toISOString()}] Sweep complete. Valid targets: ${results.length}`);
}

// CRON JOB: Run the scan every 15 minutes automatically
cron.schedule('*/15 * * * *', runScan);

// --- API ENDPOINTS ---

// 1. The Keepalive (For Uptime Robot so Render never sleeps)
app.get('/health', (req, res) => res.status(200).json({ status: 'Terminal Heartbeat: OK' }));

// 2. The Frontend Feed
app.get('/scan', (req, res) => {
    res.json({
        timestamp: Date.now(),
        data: lastScanResults
    });
});

// Boot Sequence
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`TradeBeta Engine live on port ${PORT}.`);
    console.log('Running initial boot scan...');
    await runScan(); // Run once immediately on startup
});

/**
 * The Scan Loop: This will eventually house the SMC math.
 */
async function runScan() {
    console.log(`[${new Date().toISOString()}] Initiating sweep...`);
    let results = [];

    for (const symbol of WATCHLIST) {
        const ohlc = await getOHLC(symbol);
        if (!ohlc) continue;

        // Placeholder for the upcoming ICT Engine
        // const signal = analyzeSMC(ohlc); 

        // For now, just verifying the data pipeline is bleeding edge
        const lastCandle = ohlc[ohlc.length - 1];
        results.push({
            symbol,
            currentPrice: lastCandle.close,
            dataPoints: ohlc.length,
            status: "PIPELINE_ACTIVE"
        });
    }

    lastScanResults = results;
    console.log(`[${new Date().toISOString()}] Sweep complete. Valid targets: ${results.length}`);
}

// CRON JOB: Run the scan every 15 minutes automatically
cron.schedule('*/15 * * * *', runScan);

// --- API ENDPOINTS ---

// 1. The Keepalive (For Uptime Robot so Render never sleeps)
app.get('/health', (req, res) => res.status(200).json({ status: 'Terminal Heartbeat: OK' }));

// 2. The Frontend Feed
app.get('/scan', (req, res) => {
    res.json({
        timestamp: Date.now(),
        data: lastScanResults
    });
});

// Boot Sequence
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`TradeBeta Engine live on port ${PORT}.`);
    console.log('Running initial boot scan...');
    await runScan(); // Run once immediately on startup
});
