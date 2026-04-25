/**
 * smc.js — Strict Multi-Timeframe Smart Money Concepts Engine (V1 + FVG Integration)
 *
 * Implements:
 * 1. MTF Bridging (HTF Narrative + LTF Execution)
 * 2. Strict Market Structure (BOS / CHoCH)
 * 3. Unmitigated Order Block & FVG detection
 * 4. FVG + OB Overlap Logic (Silver Bullet setups)
 * 5. CRT Entry with Dynamic HTF Targeting & Strict RR >= 3 filter
 *
 * All functions are PURE — no side effects, no external calls.
 * Candle format: { time, open, high, low, close, volume }
 */

// ─────────────────────────────────────────────
// 1. MULTI-TIMEFRAME BRIDGING (The Engine Core)
// ─────────────────────────────────────────────

function analyzeMarket(htfCandles, ltfCandles) {
  const htfStructure = detectStructure(htfCandles);
  if (!htfStructure) return { status: 'No HTF Structure' };

  const htfOB = findOrderBlock(htfCandles, htfStructure);
  const htfFVGs = findFVGs(htfCandles, htfStructure.bias);
  
  // FVG + OB Confluence Check ("Silver Bullet" zone)
  let overlappingFVG = null;
  if (htfOB && htfFVGs.length > 0) {
    overlappingFVG = htfFVGs.find(fvg => fvgOverlapsOB(fvg, htfOB));
  }

  const currentPrice = ltfCandles[ltfCandles.length - 1].close;

  // 1. Look for the STRICT CRT Sweep (Passes HTF Structure for Dynamic Targets)
  const entryTrigger = detectCRT(ltfCandles, htfStructure.bias, htfStructure);

  if (entryTrigger) {
    return {
      status: 'TRADE_SIGNAL',
      signal: entryTrigger,
      htfBias: htfStructure.bias,
      htfZone: htfOB || 'No OB - Structural Sweep',
      confluence: overlappingFVG ? 'OB + FVG Overlap' : 'Standard',
      fvgData: overlappingFVG || null
    };
  }

  // 2. Check OB Mitigation & Confluence status if no immediate sweep is found
  if (htfOB) {
    if (isOBMitigated(htfOB, htfCandles, htfOB.index + 1)) {
      return { status: 'HTF Order Block Mitigated', bias: htfStructure.bias };
    }

    // If we have an overlapping FVG, we treat the combination as a broader target zone
    const targetZone = overlappingFVG 
      ? { top: Math.max(htfOB.top, overlappingFVG.top), bottom: Math.min(htfOB.bottom, overlappingFVG.bottom) } 
      : htfOB;

    const inZone = priceNearZone(currentPrice, targetZone, 0.005);
    if (!inZone) {
      return { 
        status: 'Waiting for Retracement to HTF Zone or Level Sweep', 
        bias: htfStructure.bias, 
        zone: htfOB,
        hasFvgConfluence: !!overlappingFVG
      };
    }
  } else if (htfFVGs.length > 0) {
    // Fallback: If no OB is found but an unmitigated FVG exists
    const latestFVG = htfFVGs[htfFVGs.length - 1];
    const inFvg = priceNearZone(currentPrice, latestFVG, 0.005);
    if (!inFvg) {
      return {
        status: 'Waiting for Retracement to HTF FVG',
        bias: htfStructure.bias,
        zone: latestFVG
      };
    }
  }

  return { 
    status: 'In HTF Zone, awaiting Strict LTF Sweep', 
    bias: htfStructure.bias,
    hasFvgConfluence: !!overlappingFVG 
  };
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

  return { bias, bosLevel, bosIndex, structureType, lastHigh, lastLow, prevHigh, prevLow };
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

    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0 || body / range < 0.2) continue;

    if (bias === 'BULLISH' && isBearish) {
      return { bias: 'BULLISH', top: c.open, bottom: c.low, bodyTop: c.open, bodyBottom: c.close, index: i, time: c.time, mitigated: false };
    }

    if (bias === 'BEARISH' && isBullish) {
      return { bias: 'BEARISH', top: c.high, bottom: c.open, bodyTop: c.close, bodyBottom: c.open, index: i, time: c.time, mitigated: false };
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
// 5. FAIR VALUE GAP (FVG) LOGIC (Ported from V2)
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

  // Check if filled by subsequent price action
  for (const fvg of fvgs) {
    for (let i = fvg.index + 2; i < candles.length; i++) {
      const c = candles[i];
      if (fvg.bias === 'BULLISH' && c.low <= fvg.bottom) { fvg.filled = true; break; }
      if (fvg.bias === 'BEARISH' && c.high >= fvg.top)   { fvg.filled = true; break; }
    }
  }

  // Return the last 5 unmitigated FVGs
  return fvgs.filter(f => !f.filled).slice(-5);
}

function fvgOverlapsOB(fvg, ob) {
  if (!fvg || !ob) return false;
  
  const overlapTop    = Math.min(fvg.top, ob.top);
  const overlapBottom = Math.max(fvg.bottom, ob.bottom);
  if (overlapTop <= overlapBottom) return false;

  const overlapSize = overlapTop - overlapBottom;
  const minSize     = Math.min(fvg.top - fvg.bottom, ob.top - ob.bottom);

  return overlapSize / minSize >= 0.1; // Requires at least 10% overlap
}

// ─────────────────────────────────────────────
// 6. STRICT CANDLE RANGE THEORY (CRT) TRIGGER
// ─────────────────────────────────────────────

function detectCRT(candles, bias, htfStructure = null) {
  if (candles.length < 3) return null;

  const last = candles[candles.length - 1]; 
  const prev = candles[candles.length - 2]; 

  if (bias === 'BULLISH') {
    const htfLowPrice = (htfStructure && htfStructure.lastLow) ? htfStructure.lastLow.price : null;
    
    const sweptHtf    = htfLowPrice && (last.low < htfLowPrice && last.close > htfLowPrice);
    const sweptLtf    = last.low < prev.low && last.close > prev.low;
    
    const sweptBelow  = sweptHtf || sweptLtf;
    const sweepLevel  = sweptHtf ? htfLowPrice : prev.low;
    
    const strongClose = last.close > (last.low + last.high) / 2;
    const sweepMagnitude = (sweepLevel - last.low) / sweepLevel;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptBelow && strongClose && reasonableSweep) {
      const sweepWick = last.low;
      const sl        = sweepWick * (1 - 0.001); // Using V1's tighter SL buffer
      const entry     = last.close;
      const risk      = entry - sl;

      if (risk <= 0) return null;

      let target, rr;
      
      // Dynamic Targeting: Target the HTF Last High
      if (htfStructure && htfStructure.lastHigh) {
        target = htfStructure.lastHigh.price;
        rr = (target - entry) / risk;
        
        if (rr < 3) return null; // STRICT FILTER
      } else {
        target = entry + (risk * 5);
        rr = 5;
      }

      return {
        type:       'BULLISH_CRT',
        signal:     'CRT',
        entry:      entry,
        sl:         sl,
        tp:         target,
        rr:         Number(rr.toFixed(2)),
        risk:       risk,
        sweepLevel: sweepLevel,
        isHtfSweep: sweptHtf,
        candleTime: last.time,
        valid:      true
      };
    }
  }

  if (bias === 'BEARISH') {
    const htfHighPrice = (htfStructure && htfStructure.lastHigh) ? htfStructure.lastHigh.price : null;
    
    const sweptHtf    = htfHighPrice && (last.high > htfHighPrice && last.close < htfHighPrice);
    const sweptLtf    = last.high > prev.high && last.close < prev.high;
    
    const sweptAbove  = sweptHtf || sweptLtf;
    const sweepLevel  = sweptHtf ? htfHighPrice : prev.high;
    
    const strongClose = last.close < (last.low + last.high) / 2;
    const sweepMagnitude = (last.high - sweepLevel) / sweepLevel;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptAbove && strongClose && reasonableSweep) {
      const sweepWick = last.high;
      const sl        = sweepWick * (1 + 0.001); 
      const entry     = last.close;
      const risk      = sl - entry;

      if (risk <= 0) return null;

      let target, rr;
      
      // Dynamic Targeting: Target the HTF Last Low
      if (htfStructure && htfStructure.lastLow) {
        target = htfStructure.lastLow.price;
        rr = (entry - target) / risk;
        
        if (rr < 3) return null; // STRICT FILTER
      } else {
        target = entry - (risk * 5);
        rr = 5;
      }

      return {
        type:       'BEARISH_CRT',
        signal:     'CRT',
        entry:      entry,
        sl:         sl,
        tp:         target,
        rr:         Number(rr.toFixed(2)),
        risk:       risk,
        sweepLevel: sweepLevel,
        isHtfSweep: sweptHtf,
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
  analyzeMarket,
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
    
