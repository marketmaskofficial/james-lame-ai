import { bestMatchingPlot } from "../helpers.mjs";

export const category = "moving-average";
export const description = "Three-EMA ribbon (9/21/55)";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const expected = [
    ["EMA(9)", ref.ema(closes, 9)],
    ["EMA(21)", ref.ema(closes, 21)],
    ["EMA(55)", ref.ema(closes, 55)],
  ];

  if (result.plots.length < 3) {
    issues.push(`expected at least 3 plots, got ${result.plots.length}`);
    return issues;
  }

  const used = new Set();
  for (const [label, series] of expected) {
    const candidates = result.plots.filter((p) => !used.has(p));
    const match = bestMatchingPlot(candidates, bars, series, SAMPLES, 2);
    if (!match) {
      issues.push(`no plot matches ${label} within 2% at sample bars`);
    } else {
      used.add(match.plot);
    }
  }
  return issues;
}
