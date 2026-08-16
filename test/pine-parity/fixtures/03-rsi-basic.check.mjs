import { bestMatchingPlot } from "../helpers.mjs";

export const category = "oscillator";
export const description = "RSI(14) with overbought/oversold hlines";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const expected = ref.rsi(closes, 14);

  const match = bestMatchingPlot(result.plots, bars, expected, SAMPLES, 2);
  if (!match) issues.push("no plot matches RSI(14) within 2% at sample bars");

  if (result.hlines.length < 2) {
    issues.push(`expected at least 2 hlines (overbought/oversold), got ${result.hlines.length}`);
  } else {
    const has70 = result.hlines.some((h) => Math.abs(h.price - 70) < 0.01);
    const has30 = result.hlines.some((h) => Math.abs(h.price - 30) < 0.01);
    if (!has70) issues.push("no hline at 70 (overbought)");
    if (!has30) issues.push("no hline at 30 (oversold)");
  }

  return issues;
}
