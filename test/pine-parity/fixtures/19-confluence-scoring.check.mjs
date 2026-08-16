import { bestMatchingPlot } from "../helpers.mjs";

export const category = "scoring";
export const description =
  "Multi-condition confluence score built entirely from `score := score + (cond ? 1 : 0)` — the exact compound-assignment pattern the system prompt calls out by name as a common source of Pine v6 compile errors (+=/-= are not legal; every line here must expand to explicit := reassignment).";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const fastEma = ref.ema(closes, 9);
  const slowEma = ref.ema(closes, 21);
  const rsiVal = ref.rsi(closes, 14);

  const expected = closes.map((c, i) => {
    if ([fastEma[i], slowEma[i], rsiVal[i]].some((v) => Number.isNaN(v))) return NaN;
    let s = 0;
    s += fastEma[i] > slowEma[i] ? 1 : 0;
    s += c > fastEma[i] ? 1 : 0;
    s += rsiVal[i] > 50 ? 1 : 0;
    s += rsiVal[i] < 70 ? 1 : 0;
    s -= rsiVal[i] > 80 ? 1 : 0;
    return s;
  });

  if (result.plots.length === 0) {
    issues.push("CRITICAL: zero plots — score never got drawn");
    return issues;
  }

  // Exact integer match expected (this is a sum of 0/1/-1 terms, no float drift).
  const plot = result.plots[0];
  const byTime = new Map(plot.values.map((v) => [v.time, v.value]));
  let mismatches = 0;
  let checked = 0;
  for (const i of SAMPLES) {
    if (Number.isNaN(expected[i])) continue;
    const got = byTime.get(bars[i].time);
    if (got === undefined) continue;
    checked++;
    if (Math.round(got) !== expected[i]) mismatches++;
  }
  if (checked === 0) {
    issues.push("no sample bar had a comparable value");
  } else if (mismatches > 0) {
    issues.push(`${mismatches}/${checked} sample bars have a score that doesn't exactly match the independently-computed confluence score`);
  }

  return issues;
}
