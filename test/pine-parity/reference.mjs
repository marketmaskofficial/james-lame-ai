// Independent reference implementations of common indicator math.
//
// These exist so fixtures can assert against real formulas computed here in
// plain JS, NOT against whatever the AI translation happens to produce.
// Comparing the pipeline's output only to itself would prove nothing.

export function sma(values, len) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= len) sum -= values[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function ema(values, len) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (i === len - 1) {
      prev = sma(values, len)[i];
      out[i] = prev;
    } else if (i >= len) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rma(values, len) {
  // Wilder's smoothing, used by Pine's ta.rsi/ta.atr internally.
  const out = new Array(values.length).fill(NaN);
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (i === len - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += values[j];
      prev = sum / len;
      out[i] = prev;
    } else if (i >= len) {
      prev = (prev * (len - 1) + values[i]) / len;
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes, len = 14) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const avgGain = rma(gains, len);
  const avgLoss = rma(losses, len);
  return closes.map((_, i) => {
    if (Number.isNaN(avgGain[i]) || Number.isNaN(avgLoss[i])) return NaN;
    if (avgLoss[i] === 0) return 100;
    const rs = avgGain[i] / avgLoss[i];
    return 100 - 100 / (1 + rs);
  });
}

export function macd(closes, fast = 12, slow = 26, signalLen = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const validTail = line.slice(firstValid).map((v) => (Number.isNaN(v) ? 0 : v));
  const signalTail = ema(validTail, signalLen);
  const signal = new Array(closes.length).fill(NaN);
  for (let i = 0; i < signalTail.length; i++) signal[firstValid + i] = signalTail[i];
  const hist = closes.map((_, i) => line[i] - signal[i]);
  return { line, signal, hist };
}

export function trueRange(bars) {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prevClose = bars[i - 1].close;
    return Math.max(
      b.high - b.low,
      Math.abs(b.high - prevClose),
      Math.abs(b.low - prevClose),
    );
  });
}

export function atr(bars, len = 14) {
  return rma(trueRange(bars), len);
}

export function stdev(values, len) {
  const out = new Array(values.length).fill(NaN);
  for (let i = len - 1; i < values.length; i++) {
    const window = values.slice(i - len + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / len;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / len;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

export function bollinger(closes, len = 20, mult = 2) {
  const basis = sma(closes, len);
  const dev = stdev(closes, len);
  const upper = basis.map((b, i) => b + dev[i] * mult);
  const lower = basis.map((b, i) => b - dev[i] * mult);
  return { basis, upper, lower };
}

export function stochastic(bars, kLen = 14, dLen = 3, smooth = 3) {
  const rawK = bars.map((_, i) => {
    if (i < kLen - 1) return NaN;
    const window = bars.slice(i - kLen + 1, i + 1);
    const hh = Math.max(...window.map((b) => b.high));
    const ll = Math.min(...window.map((b) => b.low));
    return hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
  });
  const validTail = rawK.map((v) => (Number.isNaN(v) ? 0 : v));
  const kSmoothed = sma(validTail, smooth).map((v, i) => (i < kLen - 1 ? NaN : v));
  const dValidTail = kSmoothed.map((v) => (Number.isNaN(v) ? 0 : v));
  const d = sma(dValidTail, dLen).map((v, i) => (Number.isNaN(kSmoothed[i]) ? NaN : v));
  return { k: kSmoothed, d };
}

export function obv(bars) {
  const out = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = out[i - 1];
    if (bars[i].close > bars[i - 1].close) out.push(prev + bars[i].volume);
    else if (bars[i].close < bars[i - 1].close) out.push(prev - bars[i].volume);
    else out.push(prev);
  }
  return out;
}

export function vwap(bars) {
  // Anchored from bar 0 (session-less approximation, matches how the test
  // fixtures anchor it — no session-reset logic needed for parity purposes).
  const out = new Array(bars.length).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const typical = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += typical * bars[i].volume;
    cumV += bars[i].volume;
    out[i] = cumV === 0 ? NaN : cumPV / cumV;
  }
  return out;
}

/** Bars where low[i] > high[i-2] (bullish FVG) or high[i] < low[i-2] (bearish FVG). */
export function fairValueGaps(bars) {
  const gaps = [];
  for (let i = 2; i < bars.length; i++) {
    if (bars[i].low > bars[i - 2].high) {
      gaps.push({ index: i, side: "bull", top: bars[i].low, bottom: bars[i - 2].high });
    } else if (bars[i].high < bars[i - 2].low) {
      gaps.push({ index: i, side: "bear", top: bars[i - 2].low, bottom: bars[i].high });
    }
  }
  return gaps;
}

/** Finds indices i in [lookback, len-lookback) where close[i] is the max/min of its window (simple pivot). */
export function pivots(values, lookback = 5) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    const window = values.slice(i - lookback, i + lookback + 1);
    if (values[i] === Math.max(...window)) highs.push(i);
    if (values[i] === Math.min(...window)) lows.push(i);
  }
  return { highs, lows };
}

export function approxEqual(a, b, tolerancePct = 0.5) {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) === Number.isNaN(b);
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom * 100 <= tolerancePct;
}
