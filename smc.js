/**
 * smc.js — Strict Multi-Timeframe Smart Money Concepts Engine
 *
 * Implements:
 * 1. MTF Bridging (HTF Narrative + LTF Execution)
 * 2. Strict Market Structure (BOS / CHoCH)
 * 3. Unmitigated Order Block detection
 * 4. Strict Candle Range Theory (CRT) entry with RR calculation
 *
 * All functions are PURE — no side effects, no external calls.
 * Candle format: { time, open, high, low, close, volume }
 */

// ─────────────────────────────────────────────
// 1. MULTI-TIMEFRAME BRIDGING (The Engine Core)
// ─────────────────────────────────────────────

/**
 * Combined Multi-Timeframe Analysis
 * Takes HTF candles (to find the 'big' move/zone) and LTF candles (to find the precise entry).
 */
function analyzeMarket(htfCandles, ltfCandles) {
  // 1. Get Strict HTF Structure
  const htfStructure = detectStructure(htfCandles);
  if (!htfStructure) return { status: 'No HTF Structure' };

  // 2. Find the HTF Order Block
  const htfOB = findOrderBlock(htfCandles, htfStructure);
  if (!htfOB) return { status: 'No HTF Order Block', bias: htfStructure.bias };

  // 3. Strict Check: Is the HTF Order Block already mitigated?
  // We don't want to trade off a zone that has already been tested and depleted.
  if (isOBMitigated(htfOB, htfCandles, htfOB.index + 1)) {
    return { status: 'HTF Order Block Mitigated', bias: htfStructure.bias };
  }

  // 4. Get the latest LTF price
  const currentPrice = ltfCandles[ltfCandles.length - 1].close;

  // 5. Check if LTF price is inside or near the HTF Order Block
  const inZone = priceNearZone(currentPrice, htfOB, 0.005); // 0.5% tolerance

  if (!inZone) {
    return { 
      status: 'Waiting for Retracement to HTF Zone', 
      bias: htfStructure.bias, 
      zone: htfOB 
    };
  }

  // 6. Look for the STRICT CRT Sweep on the LTF
  // This calculates exact Entry, Stop Loss, and Take Profit.
  const entryTrigger = detectCRT(ltfCandles, htfStructure.bias);

  if (entryTrigger) {
    return {
      status: 'TRADE_SIGNAL',
      signal: entryTrigger,
      htfBias: htfStructure.bias,
      htfZone: htfOB
    };
  }

  return { status: 'In HTF Zone, awaiting Strict LTF Sweep', bias: htfStructure.bias };
}

// ─────────────────────────────────────────────
// 2. SWING DETECTION
// ─────────────────────────────────────────────

function findSwings(candles, lookback = 3) {
  const highs = [];
  const lows  = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow  = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low  <= candles[i].low)  isLow  = false;
    }

    if (isHigh) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
    if (isLow)  lows.push ({ index: i, price: candles[i].low,  time: candles[i].time });
  }

  return { highs, lows };
}

// ─────────────────────────────────────────────
// 3. STRICT MARKET STRUCTURE (BOS + CHoCH)
// ─────────────────────────────────────────────

function detectStructure(candles) {
  const { highs, lows } = findSwings(candles, 3);

  if (highs.length < 2 || lows.length < 2) return null;

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow  = lows[lows.length - 1];
  const prevLow  = lows[lows.length - 2];

  // Check the LAST CLOSED candle to avoid false triggers on wicks mid-candle
  const lastConfirmed = candles[candles.length - 2];

  let bias          = null;
  let bosLevel      = null;
  let bosIndex      = null;
  let structureType = null;

  if (lastConfirmed.close > prevHigh.price) {
    bias     = 'BULLISH';
    bosLevel = prevHigh.price;
    bosIndex = prevHigh.index;

    const makingHL = lastLow.price > prevLow.price;
    structureType  = makingHL ? 'BOS' : 'CHoCH';
  } else if (lastConfirmed.close < prevLow.price) {
    bias     = 'BEARISH';
    bosLevel = prevLow.price;
    bosIndex = prevLow.index;

    const makingLH = lastHigh.price < prevHigh.price;
    structureType  = makingLH ? 'BOS' : 'CHoCH';
  }

  if (!bias) return null;

  return {
    bias,
    bosLevel,
    bosIndex,
    structureType,
    lastHigh,
    lastLow,
    prevHigh,
    prevLow
  };
}

// ─────────────────────────────────────────────
// 4. ORDER BLOCK LOGIC
// ─────────────────────────────────────────────

function findOrderBlock(candles, structure) {
  if (!structure) return null;

  const { bias, bosIndex } = structure;
  const searchFrom = Math.max(0, bosIndex - 1);
  const searchTo   = Math.max(0, bosIndex - 25);

  for (let i = searchFrom; i >= searchTo; i--) {
    const c = candles[i];
    if (!c) continue;

    const isBearish = c.close < c.open;
    const isBullish = c.close > c.open;

    // Strict Rule: Require meaningful body > 20% of the candle range
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0 || body / range < 0.2) continue;

    if (bias === 'BULLISH' && isBearish) {
      return {
        bias:       'BULLISH',
        top:        c.open,          
        bottom:     c.low,           
        bodyTop:    c.open,
        bodyBottom: c.close,
        index:      i,
        time:       c.time,
        mitigated:  false
      };
    }

    if (bias === 'BEARISH' && isBullish) {
      return {
        bias:       'BEARISH',
        top:        c.high,          
        bottom:     c.open,          
        bodyTop:    c.close,
        bodyBottom: c.open,
        index:      i,
        time:       c.time,
        mitigated:  false
      };
    }
  }

  return null;
}

function isOBMitigated(ob, candles, fromIndex) {
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    if (ob.bias === 'BULLISH') {
      if (c.close < ob.bottom) return true;
    } else {
      if (c.close > ob.top) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────
// 5. FAIR VALUE GAP (FVG)
// ─────────────────────────────────────────────

function findFVGs(candles, bias, minGapPercent = 0.001) {
  const fvgs = [];

  for (let i = 0; i < candles.length - 2; i++) {
    const a = candles[i];
    const b = candles[i + 1]; 
    const c = candles[i + 2];

    if (bias === 'BULLISH') {
      const gapBottom = a.high;
      const gapTop    = c.low;

      if (gapTop > gapBottom) {
        const gapSize = (gapTop - gapBottom) / b.close;
        if (gapSize >= minGapPercent) {
          fvgs.push({ top: gapTop, bottom: gapBottom, index: i + 1, time: b.time, bias: 'BULLISH', filled: false });
        }
      }
    } else {
      const gapTop    = a.low;
      const gapBottom = c.high;

      if (gapTop > gapBottom) {
        const gapSize = (gapTop - gapBottom) / b.close;
        if (gapSize >= minGapPercent) {
          fvgs.push({ top: gapTop, bottom: gapBottom, index: i + 1, time: b.time, bias: 'BEARISH', filled: false });
        }
      }
    }
  }

  for (const fvg of fvgs) {
    for (let i = fvg.index + 2; i < candles.length; i++) {
      const c = candles[i];
      if (fvg.bias === 'BULLISH' && c.low <= fvg.bottom) { fvg.filled = true; break; }
      if (fvg.bias === 'BEARISH' && c.high >= fvg.top)   { fvg.filled = true; break; }
    }
  }

  return fvgs.filter(f => !f.filled).slice(-5);
}

function fvgOverlapsOB(fvg, ob) {
  const overlapTop    = Math.min(fvg.top, ob.top);
  const overlapBottom = Math.max(fvg.bottom, ob.bottom);
  if (overlapTop <= overlapBottom) return false;

  const overlapSize = overlapTop - overlapBottom;
  const minSize     = Math.min(fvg.top - fvg.bottom, ob.top - ob.bottom);

  return overlapSize / minSize >= 0.1;
}

// ─────────────────────────────────────────────
// 6. STRICT CANDLE RANGE THEORY (CRT) TRIGGER
// ─────────────────────────────────────────────

function detectCRT(candles, bias) {
  if (candles.length < 3) return null;

  const last = candles[candles.length - 1]; 
  const prev = candles[candles.length - 2]; 

  if (bias === 'BULLISH') {
    const sweptBelow    = last.low < prev.low;          
    const closedAbove   = last.close > prev.low;        
    const strongClose   = last.close > (last.low + last.high) / 2; // Strict Rule: Close in upper 50%

    // Strict Rule: Sweep must not be an aggressive breakdown (> 2%)
    const sweepMagnitude  = (prev.low - last.low) / prev.low;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptBelow && closedAbove && strongClose && reasonableSweep) {
      const sweepWick = last.low;
      const sl        = sweepWick * (1 - 0.0015); // Buffer SL
      const entry     = last.close;
      const risk      = entry - sl;

      if (risk <= 0) return null;

      return {
        type:       'BULLISH_CRT',
        entry,
        sl,
        tp:         entry + (risk * 5),
        tp3:        entry + (risk * 3),
        rr:         5,
        risk,
        candleTime: last.time,
        valid:      true
      };
    }
  }

  if (bias === 'BEARISH') {
    const sweptAbove    = last.high > prev.high;
    const closedBelow   = last.close < prev.high;
    const strongClose   = last.close < (last.low + last.high) / 2; // Strict Rule: Close in lower 50%

    const sweepMagnitude  = (last.high - prev.high) / prev.high;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptAbove && closedBelow && strongClose && reasonableSweep) {
      const sweepWick = last.high;
      const sl        = sweepWick * (1 + 0.0015);
      const entry     = last.close;
      const risk      = sl - entry;

      if (risk <= 0) return null;

      return {
        type:       'BEARISH_CRT',
        entry,
        sl,
        tp:         entry - (risk * 5),
        tp3:        entry - (risk * 3),
        rr:         5,
        risk,
        candleTime: last.time,
        valid:      true
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function priceInZone(price, zone) {
  return price >= zone.bottom && price <= zone.top;
}

function priceNearZone(price, zone, tolerancePct = 0.02) {
  const mid  = (zone.top + zone.bottom) / 2;
  const dist = Math.abs(price - mid) / mid;
  return dist <= tolerancePct || priceInZone(price, zone);
}

module.exports = {
  analyzeMarket, // Multi-timeframe entry point
  findSwings,
  detectStructure,
  findOrderBlock,
  isOBMitigated,
  findFVGs,
  fvgOverlapsOB,
  detectCRT,
  priceInZone,
  priceNearZone
};
