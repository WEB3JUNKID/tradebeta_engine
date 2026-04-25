const axios = require('axios');

// Bybit is much more cloud-friendly than Binance
const BASE = 'https://api.bybit.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const client = axios.create({
  baseURL: BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

async function fetchKlines(symbol, interval, limit = 200) {
    try {
        // Bybit mapping for intervals
        const intervalMap = { '1h': '60', '15m': '15', '5m': '5', '4h': '240' };
        const bybitInterval = intervalMap[interval] || interval;

        const { data } = await client.get('/v5/market/kline', {
            params: { 
                category: 'linear', 
                symbol: symbol, 
                interval: bybitInterval, 
                limit: limit 
            }
        });

        // Bybit returns [startTime, open, high, low, close, volume, turnover]
        return data.result.list.map(k => ({
            time:   parseInt(k[0]),
            open:   parseFloat(k[1]),
            high:   parseFloat(k[2]),
            low:    parseFloat(k[3]),
            close:  parseFloat(k[4]),
            volume: parseFloat(k[5])
        })).reverse(); // Bybit returns newest first, we need chronological
    } catch (err) {
        console.error(`[Bybit] Error fetching ${symbol}: ${err.message}`);
        return null;
    }
}

async function getTopSymbols(n = 30) {
    try {
        const { data } = await client.get('/v5/market/tickers', {
            params: { category: 'linear' }
        });
        
        return data.result.list
            .filter(t => t.symbol.endsWith('USDT'))
            .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
            .slice(0, n)
            .map(t => t.symbol);
    } catch (err) {
        console.error('[Bybit] Failed to fetch symbols:', err.message);
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT'];
    }
}

module.exports = { fetchKlines, getTopSymbols };
