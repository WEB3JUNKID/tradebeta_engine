/**
 * binance.js
 * Binance USDT-M Futures public API wrapper.
 * No API key required. Weight-aware with retry logic.
 */

const axios = require('axios');

const BASE = 'https://fapi.binance.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Axios instance with timeout
const client = axios.create({
  baseURL: BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * Fetch klines (OHLCV) from Binance Futures
 * @param {string} symbol  e.g. 'BTCUSDT'
 * @param {string} interval  '4h' | '1h' | '15m' | '5m'
 * @param {number} limit  max 1500
 * @returns {Array<{time,open,high,low,close,volume}>}
 */
async function fetchKlines(symbol, interval, limit = 200, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await client.get('/fapi/v1/klines', {
        params: { symbol, interval, limit }
      });

      return data.map(k => ({
        time:   k[0],
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 || status === 418) {
        // Rate limited — exponential backoff
        const wait = attempt * 2000;
        console.warn(`[Binance] Rate limit hit for ${symbol}. Waiting ${wait}ms...`);
        await sleep(wait);
      } else if (attempt === retries) {
        console.error(`[Binance] Failed to fetch ${symbol} ${interval}: ${err.message}`);
        return null;
      } else {
        await sleep(500 * attempt);
      }
    }
  }
  return null;
}

/**
 * Get top N USDT perpetual futures symbols by 24h quote volume.
 * Excludes stablecoins and low-volatility assets.
 * @param {number} n
 * @returns {string[]}
 */
async function getTopSymbols(n = 30) {
  const EXCLUDE = ['USDC', 'BUSD', 'TUSD', 'USDT', 'DAI', 'USDP', 'FRAX'];

  try {
    const { data } = await client.get('/fapi/v1/ticker/24hr');

    return data
      .filter(t => {
        const sym = t.symbol;
        if (!sym.endsWith('USDT')) return false;
        if (EXCLUDE.some(s => sym.includes(s) && sym !== 'BTCUSDT')) return false;
        if (parseFloat(t.quoteVolume) < 50_000_000) return false; // Min $50M daily volume
        if (Math.abs(parseFloat(t.priceChangePercent)) < 0.5) return false; // Skip dead coins
        return true;
      })
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, n)
      .map(t => t.symbol);
  } catch (err) {
    console.error('[Binance] Failed to fetch top symbols:', err.message);
    // Fallback to manual list
    return [
      'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
      'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
      'MATICUSDT','LTCUSDT','NEARUSDT','ATOMUSDT','UNIUSDT',
      'APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT'
    ];
  }
}

/**
 * Get current mark price for a symbol
 */
async function getMarkPrice(symbol) {
  try {
    const { data } = await client.get('/fapi/v1/premiumIndex', { params: { symbol } });
    return parseFloat(data.markPrice);
  } catch {
    return null;
  }
}

module.exports = { fetchKlines, getTopSymbols, getMarkPrice };
