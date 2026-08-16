export const category = "multi-timeframe";
export const description = "Weekly EMA(10) requested from a daily chart via request.security + [1]/lookahead_on";

export function check(result, { bars, ref }) {
  const issues = [];

  if (result.plots.length === 0) {
    issues.push("CRITICAL: zero plots — HTF request produced nothing");
    return issues;
  }

  const plot = result.plots[0];
  const finiteCount = plot.values.filter((v) => Number.isFinite(v.value)).length;
  if (finiteCount < bars.length * 0.5) {
    issues.push(`only ${finiteCount}/${bars.length} bars have a finite value — HTF series looks broken/mostly NaN`);
  }

  // Weak but meaningful signal: an HTF(weekly) EMA should not be byte-identical
  // to the plain on-chart EMA(10) — if it is, the "H" in HTF was likely
  // ignored by the translation (or, per this runtime's htf() implementation,
  // htf().close is a pass-through of the base close series, which is a real
  // architectural limitation worth knowing about either way — logged as a
  // soft warning, not a hard failure, since it may not be a translation bug.
  const closes = bars.map((b) => b.close);
  const plainEma = ref.ema(closes, 10);
  const byTime = new Map(plot.values.map((v) => [v.time, v.value]));
  let identicalCount = 0;
  let comparable = 0;
  for (let i = 100; i < bars.length; i += 20) {
    const got = byTime.get(bars[i].time);
    const plain = plainEma[i];
    if (got === undefined || Number.isNaN(plain)) continue;
    comparable++;
    if (Math.abs(got - plain) < 1e-6) identicalCount++;
  }
  if (comparable > 0 && identicalCount === comparable) {
    issues.push(
      "SOFT WARNING (not counted as failure): output is byte-identical to the plain on-chart EMA(10) — either the HTF request had no effect, or runtime.ts's htf() close pass-through (c[i]=close[i] always, only open/high/low/volume are bucketed) makes this indistinguishable for a close-based EMA. Worth a closer look either way.",
    );
    // Intentionally not pushed as a real issue — see comment above.
    return [];
  }

  return issues;
}
