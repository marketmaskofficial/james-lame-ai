// Deterministic synthetic OHLCV bar generator shared by every fixture.
//
// Same seed -> byte-identical bars every run, on every machine. That's the
// whole point: numeric assertions in fixtures compare against reference math
// run over this exact series, so a failure means the interpreter is wrong,
// not that the data changed under it.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates `count` daily bars starting at a fixed UTC date, walking price
 * through alternating trend/chop/reversal regimes so indicators that need a
 * real uptrend, downtrend, and ranging period (crossovers, RSI extremes,
 * MACD flips, breakouts) all get genuine opportunities to fire — not just
 * pure random noise, which under- or over-fires most indicators.
 */
export function generateBars(count = 300, seed = 42) {
  const rand = mulberry32(seed);
  const bars = [];
  let price = 100;
  const start = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
  const dayMs = 86400;

  // Regime schedule: [length, drift-per-bar, volatility].
  const regimes = [
    { len: 40, drift: 0.35, vol: 0.8 }, // uptrend
    { len: 25, drift: 0, vol: 0.6 }, // chop
    { len: 35, drift: -0.4, vol: 0.9 }, // downtrend
    { len: 20, drift: 0, vol: 1.4 }, // volatile chop
    { len: 45, drift: 0.5, vol: 0.7 }, // strong uptrend
    { len: 30, drift: -0.25, vol: 0.5 }, // gentle pullback
    { len: 25, drift: 0, vol: 0.4 }, // tight range
    { len: 40, drift: 0.2, vol: 1.1 }, // choppy grind up
    { len: 40, drift: -0.45, vol: 1.0 }, // downtrend into the close
  ];

  let i = 0;
  let regimeIdx = 0;
  let regimeLeft = regimes[0].len;

  while (i < count) {
    if (regimeLeft <= 0 && regimeIdx < regimes.length - 1) {
      regimeIdx++;
      regimeLeft = regimes[regimeIdx].len;
    }
    const { drift, vol } = regimes[regimeIdx];
    regimeLeft--;

    const open = price;
    const noise = (rand() - 0.5) * 2 * vol;
    const close = Math.max(1, open + drift + noise);
    const wick = Math.abs(rand()) * vol * 0.6;
    const high = Math.max(open, close) + wick * rand();
    const low = Math.max(0.5, Math.min(open, close) - wick * rand());
    const volume = Math.round(50000 + rand() * 150000 + Math.abs(close - open) * 20000);

    bars.push({
      time: start + i * dayMs,
      open: round4(open),
      high: round4(high),
      low: round4(low),
      close: round4(close),
      volume,
    });
    price = close;
    i++;
  }
  return bars;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
