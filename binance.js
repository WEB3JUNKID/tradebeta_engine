const axios = require('axios');

// api.bytick.com is Bybit's global routing mirror, much friendlier to US Cloud IPs
const BASE = 'https://api.bytick.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Industrial Grade: Mimic a real browser to bypass Cloudflare's "Bot Fight Mode"
const client = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive'
  }
});

/**
 * Industrial Grade Retry Logic (Exponential Backoff)
 * Prevents the entire scanner from crashing if one request gets rate-limited.
 */
async function requestWithRetry(endpoint, params, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      const status = error.response ? error.response.status : 'NETWORK_ERROR';
      const msg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
      
      console.warn(`[API Attempt ${attempt}/${retries}] Failed: ${status} | ${msg}`);

      if (attempt === retries) throw error; // Give up after max retries

      // Exponential backoff: Wait 1s, then 2s, then 3s...
      await sleep(attempt * 1000);
    }
  }
}

/**
 * Fetch klines (OHLCV) from Bybit USDT Perpetuals
 */
async function fetchKlines(symbol, interval, limit = 200) {
    try {
        const intervalMap = { '1h': '60', '15m': '15', '5m': '5', '4h': '240' };
        const bybitInterval = intervalMap[interval] || interval;

        const data = await requestWithRetry('/v5/market/kline', {
            category: 'linear',
            symbol: symbol,
            interval: bybitInterval,
            limit: limit
        });

        // Ensure data exists before mapping to avoid undefined crashes
        if (!data || !data.result || !data.result.list) return null;

        return data.result.list.map(k => ({
            time:   parseInt(k[0]),
            open:   parseFloat(k[1]),
            high:   parseFloat(k[2]),
            low:    parseFloat(k[3]),
            close:  parseFloat(k[4]),
            volume: parseFloat(k[5])
        })).reverse(); // Standardize to chronological order
    } catch (err) {
        console.error(`[Data Fetch] Critical failure for ${symbol}: ${err.message}`);
        return null;
    }
}

/**
 * Get top N USDT perpetual futures symbols by 24h turnover.
 */
async function getTopSymbols(n = 30) {
    try {
        const data = await requestWithRetry('/v5/market/tickers', {
            category: 'linear'
        });

        if (!data || !data.result || !data.result.list) throw new Error("Invalid payload structure from API");

        return data.result.list
            .filter(t => t.symbol.endsWith('USDT'))
            .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
            .slice(0, n)
            .map(t => t.symbol);
    } catch (err) {
        console.error('[Ticker Fetch] Critical failure, using fallback list:', err.message);
        // Fallback list ensures the engine keeps running even if the ticker endpoint fails
        return [
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
            'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT'
        ];
    }
}

module.exports = { fetchKlines, getTopSymbols };
