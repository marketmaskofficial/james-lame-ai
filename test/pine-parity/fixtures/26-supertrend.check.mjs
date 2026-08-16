import { bestMatchingPlot } from "../helpers.mjs";

export const category = "language-features";
export const description = "Stateful trend-flip line using var + := persistence across bars (a simplified Supertrend: bands from hl2 +/- mult*ATR, trend flips when close crosses the prior band)";
export const settings = { "ATR Length": 10, Multiplier: 3.0 };

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const atrVal = ref.atr(bars, 10);
  const mult = 3.0;
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  const upperBand = hl2.map((v, i) => v + mult * atrVal[i]);
  const lowerBand = hl2.map((v, i) => v - mult * atrVal[i]);

  const trend = new Array(bars.length).fill(1);
  const line = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0 || Number.isNaN(upperBand[i - 1]) || Number.isNaN(lowerBand[i - 1])) {
      trend[i] = 1;
    } else if (bars[i].close > upperBand[i - 1]) {
      trend[i] = 1;
    } else if (bars[i].close < lowerBand[i - 1]) {
      trend[i] = -1;
    } else {
      trend[i] = trend[i - 1];
    }
    line[i] = trend[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  if (result.plots.length === 0) {
    issues.push("CRITICAL: zero plots — supertrend line never got drawn");
    return issues;
  }

  // color=trend==1?green:red has no direct SGScript equivalent, so a
  // faithful translation may split into separate bull/bear-only series
  // (each NaN outside its own regime) instead of one — same legitimate
  // pattern as 14-htf-trend-bias. Merge before comparing.
  const merged = new Map();
  for (const p of result.plots) {
    for (const v of p.values) {
      if (Number.isFinite(v.value)) merged.set(v.time, v.value);
    }
  }
  let mismatches = 0;
  let checked = 0;
  for (const i of SAMPLES) {
    if (Number.isNaN(line[i])) continue;
    const got = merged.get(bars[i].time);
    if (got === undefined) continue;
    checked++;
    const denom = Math.max(Math.abs(line[i]), 1e-9);
    if ((Math.abs(got - line[i]) / denom) * 100 > 3) mismatches++;
  }
  if (checked === 0) {
    issues.push("no sample bar had a comparable merged value");
  } else if (mismatches > 0) {
    issues.push(`${mismatches}/${checked} sample bars don't match the independently-computed stateful trend-flip line within 3%`);
  }

  return issues;
}
