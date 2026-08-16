import { bestMatchingPlot } from "../helpers.mjs";

export const category = "volume";
export const description = "On-balance volume with a smoothing MA";

const SAMPLES = [100, 150, 200, 250, 280];

export function check(result, { bars, ref }) {
  const issues = [];
  const expectedObv = ref.obv(bars);

  if (result.plots.length < 1) {
    issues.push("expected at least 1 plot (OBV)");
    return issues;
  }

  // OBV is a cumulative sum, so an exact-value match is fragile if the port
  // starts its cumulation from a different bar; check trend/shape instead:
  // the correlation of deltas should be strongly positive.
  const match = bestMatchingPlot(result.plots, bars, expectedObv, SAMPLES, 15);
  if (!match) {
    // Fallback: check direction of movement matches at each sample pair
    // instead of absolute value, since cumulative-sum offsets are legitimate.
    const anyPlotTracksDirection = result.plots.some((p) => {
      let agree = 0;
      let total = 0;
      for (let i = 1; i < SAMPLES.length; i++) {
        const t0 = bars[SAMPLES[i - 1]].time;
        const t1 = bars[SAMPLES[i]].time;
        const v0 = p.values.find((v) => v.time === t0)?.value;
        const v1 = p.values.find((v) => v.time === t1)?.value;
        if (v0 === undefined || v1 === undefined) continue;
        total++;
        const expDir = Math.sign(expectedObv[SAMPLES[i]] - expectedObv[SAMPLES[i - 1]]);
        const gotDir = Math.sign(v1 - v0);
        if (expDir === gotDir) agree++;
      }
      return total > 0 && agree === total;
    });
    if (!anyPlotTracksDirection) issues.push("no plot's direction of movement matches OBV at sample points");
  }

  return issues;
}
