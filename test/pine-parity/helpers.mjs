// Shared assertion helpers for fixture check.mjs files.
//
// Plots are matched by VALUE, not by title — the AI translator is free to
// name things differently than the Pine source did, so asserting on exact
// titles would make checks fragile for reasons that have nothing to do with
// correctness. Instead we ask "does *any* plot in the output match this
// expected series within tolerance at these sample points", which tests the
// thing that actually matters.

function timeIndex(bars) {
  const m = new Map();
  bars.forEach((b, i) => m.set(b.time, i));
  return m;
}

/** Value a PlotOut/HLineOut-style series has at a given bar index, or undefined. */
export function valueAtIndex(plot, bars, index) {
  const t = bars[index]?.time;
  if (t === undefined) return undefined;
  const point = plot.values.find((v) => v.time === t);
  return point?.value;
}

/**
 * Finds the plot in `plots` whose values best match `expected` (array
 * indexed by bar position, NaN/undefined entries skipped) across
 * `sampleIndices`, within `tolerancePct`. Returns { plot, avgErrPct } or null.
 */
export function bestMatchingPlot(plots, bars, expected, sampleIndices, tolerancePct = 2) {
  const tIdx = timeIndex(bars);
  let best = null;
  for (const p of plots) {
    const byTime = new Map(p.values.map((v) => [v.time, v.value]));
    let errs = [];
    for (const i of sampleIndices) {
      const exp = expected[i];
      if (exp === undefined || Number.isNaN(exp)) continue;
      const t = bars[i]?.time;
      const got = byTime.get(t);
      if (got === undefined || !Number.isFinite(got)) continue;
      const denom = Math.max(Math.abs(exp), 1e-9);
      errs.push((Math.abs(got - exp) / denom) * 100);
    }
    if (errs.length === 0) continue;
    const avgErrPct = errs.reduce((a, b) => a + b, 0) / errs.length;
    if (!best || avgErrPct < best.avgErrPct) best = { plot: p, avgErrPct, matched: errs.length };
  }
  if (best && best.avgErrPct <= tolerancePct && best.matched >= sampleIndices.length * 0.6) return best;
  return null;
}

export function inRange(n, min, max) {
  return n >= min && n <= max;
}
