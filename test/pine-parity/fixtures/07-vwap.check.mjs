import { bestMatchingPlot } from "../helpers.mjs";

export const category = "volume";
export const description = "Cumulative (session-less) VWAP";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const expected = ref.vwap(bars);

  const match = bestMatchingPlot(result.plots, bars, expected, SAMPLES, 2);
  if (!match) issues.push("no plot matches cumulative VWAP within 2% at sample bars");

  return issues;
}
