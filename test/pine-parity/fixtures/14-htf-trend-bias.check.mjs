export const category = "multi-timeframe";
export const description = "Bias histogram from weekly open vs current close (exercises real HTF bucket aggregation, not the close pass-through)";

const WEEK_SECONDS = 604800;
// Unix epoch was a Thursday, so plain floor(t/WEEK_SECONDS) buckets land on
// arbitrary Thursday-to-Thursday chunks, not real Monday-start calendar
// weeks. stdlib.ts's bucketOf() shifts by 3 days to correct this — mirror
// that exact shift here so this independent reference matches real weeks,
// not just whatever the runtime happens to do.
const MONDAY_SHIFT = 3 * 86400;

export function check(result, { bars }) {
  const issues = [];

  if (result.plots.length === 0) {
    issues.push("CRITICAL: zero plots — HTF bias request produced nothing");
    return issues;
  }

  // Independently bucket weekly opens by real calendar week (Monday start),
  // first bar in each bucket sets the open.
  const weeklyOpen = new Array(bars.length).fill(NaN);
  let bucket = -Infinity;
  let currentOpen = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = Math.floor((bars[i].time + MONDAY_SHIFT) / WEEK_SECONDS);
    if (b !== bucket) {
      bucket = b;
      currentOpen = bars[i].open;
    }
    weeklyOpen[i] = currentOpen;
  }
  const expectedBias = bars.map((bar, i) => (bar.close > weeklyOpen[i] ? 1 : -1));

  // A cond ? green : red single plot in Pine has no direct SGScript
  // equivalent (hist() doesn't support per-bar conditional coloring), so a
  // faithful translation may reasonably split it into two series (e.g. a
  // "bull" and "bear" histogram, each NaN outside its own regime) instead of
  // one. Merge every plot's non-NaN values by time before judging, rather
  // than assuming a single-plot output.
  const merged = new Map();
  for (const p of result.plots) {
    for (const v of p.values) {
      if (Number.isFinite(v.value)) merged.set(v.time, v.value);
    }
  }
  let agree = 0;
  let total = 0;
  for (let i = 10; i < bars.length; i++) {
    const got = merged.get(bars[i].time);
    if (got === undefined || !Number.isFinite(got)) continue;
    total++;
    if (Math.sign(got) === Math.sign(expectedBias[i])) agree++;
  }

  if (total < bars.length * 0.5) {
    issues.push(`only ${total}/${bars.length} bars produced a finite bias value`);
  } else if (agree / total < 0.85) {
    issues.push(`bias sign only agrees with independently-computed weekly-open bias on ${agree}/${total} bars (${((agree / total) * 100).toFixed(0)}%, want >=85%)`);
  }

  return issues;
}
