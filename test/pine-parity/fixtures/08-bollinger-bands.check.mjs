import { bestMatchingPlot } from "../helpers.mjs";

export const category = "bands";
export const description = "Bollinger Bands (20, 2.0) with fill between upper/lower";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const { basis, upper, lower } = ref.bollinger(closes, 20, 2.0);

  if (result.plots.length < 3) {
    issues.push(`expected at least 3 plots (basis/upper/lower), got ${result.plots.length}`);
  }

  const basisMatch = bestMatchingPlot(result.plots, bars, basis, SAMPLES, 2);
  if (!basisMatch) issues.push("no plot matches basis SMA(20) within 2%");
  const upperMatch = bestMatchingPlot(result.plots, bars, upper, SAMPLES, 2);
  if (!upperMatch) issues.push("no plot matches upper band within 2%");
  const lowerMatch = bestMatchingPlot(result.plots, bars, lower, SAMPLES, 2);
  if (!lowerMatch) issues.push("no plot matches lower band within 2%");

  if (result.fills.length < 1) issues.push("expected a fill() between the bands");

  return issues;
}
