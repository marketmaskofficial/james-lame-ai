import { bestMatchingPlot } from "../helpers.mjs";

export const category = "oscillator";
export const description = "Stochastic %K/%D (14,3,3)";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const { k, d } = ref.stochastic(bars, 14, 3, 3);

  if (result.plots.length < 2) {
    issues.push(`expected at least 2 plots (%K + %D), got ${result.plots.length}`);
    return issues;
  }

  const kMatch = bestMatchingPlot(result.plots, bars, k, SAMPLES, 4);
  if (!kMatch) issues.push("no plot matches %K within 4% at sample bars");

  const dMatch = bestMatchingPlot(
    result.plots.filter((p) => p !== kMatch?.plot),
    bars,
    d,
    SAMPLES,
    4,
  );
  if (!dMatch) issues.push("no plot matches %D within 4% at sample bars");

  return issues;
}
