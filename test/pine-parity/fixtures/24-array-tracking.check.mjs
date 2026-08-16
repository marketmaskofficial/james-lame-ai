import { bestMatchingPlot } from "../helpers.mjs";

export const category = "language-features";
export const description = "array.push/array.shift/array.size FIFO-capped level tracking (cap of 5)";
export const settings = { "Max Tracked Levels": 5, "Pivot Lookback": 10 };

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const highs = bars.map((b) => b.high);
  const pivotIdx = ref.pivots(highs, 10).highs;

  const expectedCount = new Array(bars.length).fill(0);
  let seen = 0;
  let pIdx = 0;
  for (let i = 0; i < bars.length; i++) {
    while (pIdx < pivotIdx.length && pivotIdx[pIdx] === i) {
      seen++;
      pIdx++;
    }
    expectedCount[i] = Math.min(5, seen);
  }

  if (result.plots.length === 0) {
    issues.push("CRITICAL: zero plots — tracked-level count never got drawn");
    return issues;
  }

  const match = bestMatchingPlot(result.plots, bars, expectedCount, SAMPLES, 1);
  if (!match) {
    issues.push("no plot matches the independently-computed FIFO-capped tracked-level count within 1% at sample bars");
  }

  return issues;
}
