import { bestMatchingPlot } from "../helpers.mjs";

export const category = "oscillator";
export const description = "MACD(12,26,9) line/signal/histogram";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const closes = bars.map((b) => b.close);
  const { line, signal, hist } = ref.macd(closes, 12, 26, 9);

  if (result.plots.length < 2) {
    issues.push(`expected at least 2 plots (line + signal), got ${result.plots.length}`);
    return issues;
  }

  // Tolerance is wider here: MACD compounds EMA rounding differences.
  const lineMatch = bestMatchingPlot(result.plots, bars, line, SAMPLES, 4);
  if (!lineMatch) issues.push("no plot matches MACD line within 4% at sample bars");

  const signalMatch = bestMatchingPlot(
    result.plots.filter((p) => p !== lineMatch?.plot),
    bars,
    signal,
    SAMPLES,
    4,
  );
  if (!signalMatch) issues.push("no plot matches MACD signal within 4% at sample bars");

  // Histogram is optional (some ports may only draw line+signal); check softly.
  const histMatch = bestMatchingPlot(result.plots, bars, hist, SAMPLES, 6);
  if (!histMatch) issues.push("no plot matches MACD histogram within 6% at sample bars (soft check)");

  return issues;
}
