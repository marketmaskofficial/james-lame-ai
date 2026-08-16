import { bestMatchingPlot } from "../helpers.mjs";

export const category = "moving-average";
export const description = "SMA(20)/SMA(50) crossover with plotted lines and cross markers";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const expectedFast = ref.sma(closes, 20);
  const expectedSlow = ref.sma(closes, 50);

  if (result.plots.length < 2) {
    issues.push(`expected at least 2 plots, got ${result.plots.length}`);
    return issues;
  }

  const fastMatch = bestMatchingPlot(result.plots, bars, expectedFast, SAMPLES, 2);
  if (!fastMatch) issues.push("no plot matches SMA(20) within 2% at sample bars");

  const slowMatch = bestMatchingPlot(
    result.plots.filter((p) => p !== fastMatch?.plot),
    bars,
    expectedSlow,
    SAMPLES,
    2,
  );
  if (!slowMatch) issues.push("no plot matches SMA(50) within 2% at sample bars");

  return issues;
}
