/**
 * smc.js — Smart Money Concepts Engine
 *
 * Implements:
 *  1. Swing High / Low detection
 *  2. Market Structure: BOS (Break of Structure) + CHoCH (Change of Character)
 *  3. Order Block identification (last opposing candle before structural break)
 *  4. Fair Value Gap (FVG) — true 3-candle gap logic
 *  5. Candle Range Theory (CRT) — liquidity sweep + reversal entry
 *
 * All functions are PURE — no side effects, no external calls.
 * Candle format: { time, open, high, low, close, volume }
 */

// ─────────────────────────────────────────────
// 1. SWING DETECTION
// ─────────────────────────────────────────────

/**
 * Identifies swing highs and lows using a fractal-based lookback.
 * A swing high is the highest point in a window of (lookback) candles on each side.
 * @param {Array} candles
 * @param {number} lookback  Number of candles on each side to confirm the swing
 */
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
// 2. MARKET STRUCTURE: BOS + CHoCH
// ─────────────────────────────────────────────

/**
 * Detects the most recent structural break and establishes bias.
 *
 * BOS  = Break of Structure — trend continuation (e.g. bullish impulse breaks prior high)
 * CHoCH = Change of Character — potential reversal (e.g. bearish price breaks a prior low
 *         while the prior trend was bullish)
 *
 * Returns null if no clear structure found.
 */
function detectStructure(candles) {
  const { highs, lows } = findSwings(candles, 3);

  if (highs.length < 2 || lows.length < 2) return null;

  // Last two confirmed swing highs/lows
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow  = lows[lows.length - 1];
  const prevLow  = lows[lows.length - 2];

  // We check the LAST CLOSED candle (not live) for structure breaks
  // to avoid false triggers on wicks mid-candle.
  const lastConfirmed = candles[candles.length - 2];
  const currentCandle = candles[candles.length - 1];

  let bias          = null;
  let bosLevel      = null;
  let bosIndex      = null;
  let structureType = null;

  // ── Bullish: Closed candle broke above a prior confirmed swing high ──
  if (lastConfirmed.close > prevHigh.price) {
    bias     = 'BULLISH';
    bosLevel = prevHigh.price;
    bosIndex = prevHigh.index;

    // BOS if we're making HH + HL (continuation)
    // CHoCH if prior structure was bearish (LL/LH) — reversal signal
    const makingHL = lastLow.price > prevLow.price;
    structureType  = makingHL ? 'BOS' : 'CHoCH';
  }

  // ── Bearish: Closed candle broke below a prior confirmed swing low ──
  else if (lastConfirmed.close < prevLow.price) {
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
    swingHighs: highs,
    swingLows:  lows,
    lastHigh,
    lastLow,
    prevHigh,
    prevLow
  };
}

// ─────────────────────────────────────────────
// 3. ORDER BLOCK
// ─────────────────────────────────────────────

/**
 * The Order Block is the LAST OPPOSING candle directly before the impulse
 * that caused the structural break (BOS/CHoCH).
 *
 * Bullish OB = last BEARISH (red) candle before the bullish impulse
 * Bearish OB = last BULLISH (green) candle before the bearish impulse
 *
 * OB zone:
 *   Bullish: from the OB candle's LOW to its OPEN (body top)
 *   Bearish: from its OPEN (body bottom) to its HIGH
 *
 * Returns null if no valid OB found.
 */
function findOrderBlock(candles, structure) {
  if (!structure) return null;

  const { bias, bosIndex } = structure;

  // Search backwards from the BOS candle (max 20 candles back)
  const searchFrom = Math.max(0, bosIndex - 1);
  const searchTo   = Math.max(0, bosIndex - 25);

  for (let i = searchFrom; i >= searchTo; i--) {
    const c = candles[i];
    if (!c) continue;

    const isBearish = c.close < c.open;
    const isBullish = c.close > c.open;

    // Require meaningful body (not a doji) — body must be > 20% of the candle range
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0 || body / range < 0.2) continue;

    if (bias === 'BULLISH' && isBearish) {
      return {
        bias:       'BULLISH',
        top:        c.open,          // Body top of bearish candle
        bottom:     c.low,           // Full candle low (includes wick)
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
        top:        c.high,          // Full candle high
        bottom:     c.open,          // Body bottom of bullish candle
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

/**
 * Check if an OB has been mitigated (price has traded through its body)
 * A mitigated OB is no longer valid for entries.
 */
function isOBMitigated(ob, candles, fromIndex) {
  for (let i = fromIndex; i < candles.length; i++) {
    const c = candles[i];
    if (ob.bias === 'BULLISH') {
      // Mitigated if a candle CLOSED below the OB bottom
      if (c.close < ob.bottom) return true;
    } else {
      // Mitigated if a candle CLOSED above the OB top
      if (c.close > ob.top) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────
// 4. FAIR VALUE GAP (FVG)
// ─────────────────────────────────────────────

/**
 * TRUE FVG Detection — 3-candle logic:
 *
 * Bullish FVG: Candle[i].HIGH < Candle[i+2].LOW
 *   The gap between A's high wick and C's low wick is imbalanced price.
 *   Bullish impulse (candle B) was so strong no trade occurred in that range.
 *
 * Bearish FVG: Candle[i].LOW > Candle[i+2].HIGH
 *   Same logic, inverted.
 *
 * @param {Array}  candles
 * @param {string} bias  'BULLISH' | 'BEARISH'
 * @param {number} minGapPercent  Minimum gap size as % of mid candle range (default 0.1%)
 * @returns {Array} List of FVGs, most recent last
 */
function findFVGs(candles, bias, minGapPercent = 0.001) {
  const fvgs = [];

  for (let i = 0; i < candles.length - 2; i++) {
    const a = candles[i];
    const b = candles[i + 1]; // Impulse candle
    const c = candles[i + 2];

    if (bias === 'BULLISH') {
      const gapBottom = a.high;
      const gapTop    = c.low;

      if (gapTop > gapBottom) {
        const gapSize = (gapTop - gapBottom) / b.close;
        if (gapSize >= minGapPercent) {
          fvgs.push({
            top:       gapTop,
            bottom:    gapBottom,
            midpoint:  (gapTop + gapBottom) / 2,
            size:      gapSize,
            index:     i + 1,
            time:      b.time,
            bias:      'BULLISH',
            filled:    false
          });
        }
      }
    } else {
      const gapTop    = a.low;
      const gapBottom = c.high;

      if (gapTop > gapBottom) {
        const gapSize = (gapTop - gapBottom) / b.close;
        if (gapSize >= minGapPercent) {
          fvgs.push({
            top:       gapTop,
            bottom:    gapBottom,
            midpoint:  (gapTop + gapBottom) / 2,
            size:      gapSize,
            index:     i + 1,
            time:      b.time,
            bias:      'BEARISH',
            filled:    false
          });
        }
      }
    }
  }

  // Mark filled FVGs (price has traded through them)
  for (const fvg of fvgs) {
    for (let i = fvg.index + 2; i < candles.length; i++) {
      const c = candles[i];
      if (fvg.bias === 'BULLISH' && c.low <= fvg.bottom) { fvg.filled = true; break; }
      if (fvg.bias === 'BEARISH' && c.high >= fvg.top)   { fvg.filled = true; break; }
    }
  }

  // Return only unfilled FVGs, most recent 5
  return fvgs.filter(f => !f.filled).slice(-5);
}

/**
 * Returns true if an FVG zone overlaps with an Order Block zone.
 * Overlap = they share at least 10% of the smaller zone's height.
 */
function fvgOverlapsOB(fvg, ob) {
  const overlapTop    = Math.min(fvg.top, ob.top);
  const overlapBottom = Math.max(fvg.bottom, ob.bottom);
  if (overlapTop <= overlapBottom) return false;

  const overlapSize = overlapTop - overlapBottom;
  const fvgSize     = fvg.top - fvg.bottom;
  const obSize      = ob.top - ob.bottom;
  const minSize     = Math.min(fvgSize, obSize);

  return overlapSize / minSize >= 0.1;
}

// ─────────────────────────────────────────────
// 5. CANDLE RANGE THEORY (CRT) — Entry Trigger
// ─────────────────────────────────────────────

/**
 * CRT Entry Logic:
 *
 * A "range candle" establishes a High and Low.
 * The next candle sweeps beyond that range (liquidity grab),
 * then closes BACK INSIDE the range — confirming a reversal.
 *
 * Bullish CRT:
 *  - Previous candle created a range
 *  - Current candle's LOW went below prev candle LOW (swept sell-side liquidity)
 *  - Current candle CLOSED above prev candle LOW (rejected the sweep)
 *  - Close is in the upper half of the current candle's range (bullish body)
 *
 * Bearish CRT (mirror):
 *  - Swept above prev HIGH
 *  - Closed back below prev HIGH
 *  - Close in lower half of candle
 *
 * Entry: Close of CRT candle
 * SL: Just beyond the sweep wick (with small buffer)
 * TP: Entry ± (risk × 5) for minimum 1:5 RR
 *
 * @param {Array}  candles  — Entry timeframe (5M or 15M)
 * @param {string} bias
 * @returns {Object|null}
 */
function detectCRT(candles, bias) {
  if (candles.length < 3) return null;

  const last = candles[candles.length - 1]; // CRT trigger candle
  const prev = candles[candles.length - 2]; // Range candle

  if (bias === 'BULLISH') {
    const sweptBelow    = last.low < prev.low;          // Wick below prev low
    const closedAbove   = last.close > prev.low;        // Body above prev low
    const bullishBody   = last.close > last.open;       // Green candle
    const strongClose   = last.close > (last.low + last.high) / 2; // Close in upper 50%

    // Also check: the sweep shouldn't be more than 2% — too large means it's a real breakdown
    const sweepMagnitude = (prev.low - last.low) / prev.low;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptBelow && closedAbove && strongClose && reasonableSweep) {
      const sweepWick = last.low;
      const sl        = sweepWick * (1 - 0.0015); // 0.15% below wick
      const entry     = last.close;
      const risk      = entry - sl;

      if (risk <= 0) return null;

      const tp  = entry + (risk * 5);
      const tp3 = entry + (risk * 3); // Partial TP at 1:3

      return {
        type:            'BULLISH_CRT',
        entry,
        sl,
        tp,
        tp3,
        rr:              5,
        sweepLevel:      prev.low,
        sweepWick,
        sweepMagnitudePct: (sweepMagnitude * 100).toFixed(3),
        risk,
        candleTime:      last.time,
        valid:           true
      };
    }
  }

  if (bias === 'BEARISH') {
    const sweptAbove    = last.high > prev.high;
    const closedBelow   = last.close < prev.high;
    const bearishBody   = last.close < last.open;
    const strongClose   = last.close < (last.low + last.high) / 2;

    const sweepMagnitude  = (last.high - prev.high) / prev.high;
    const reasonableSweep = sweepMagnitude < 0.02;

    if (sweptAbove && closedBelow && strongClose && reasonableSweep) {
      const sweepWick = last.high;
      const sl        = sweepWick * (1 + 0.0015);
      const entry     = last.close;
      const risk      = sl - entry;

      if (risk <= 0) return null;

      const tp  = entry - (risk * 5);
      const tp3 = entry - (risk * 3);

      return {
        type:            'BEARISH_CRT',
        entry,
        sl,
        tp,
        tp3,
        rr:              5,
        sweepLevel:      prev.high,
        sweepWick,
        sweepMagnitudePct: (sweepMagnitude * 100).toFixed(3),
        risk,
        candleTime:      last.time,
        valid:           true
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
