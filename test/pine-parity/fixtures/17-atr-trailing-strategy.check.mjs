export const category = "strategy";
export const description =
  "EMA-cross entries with a real ATR-multiple TRAILING stop, using the trail: series option added to strategy.long/short and ratcheted by the backtest engine every bar (favourable direction only).";
export const settings = { "ATR Length": 14, "ATR Multiplier": 3.0, "Trend EMA Length": 20 };

function detectCrosses(price, ema) {
  const crosses = [];
  for (let i = 1; i < price.length; i++) {
    if (Number.isNaN(ema[i]) || Number.isNaN(ema[i - 1])) continue;
    const prevDiff = price[i - 1] - ema[i - 1];
    const diff = price[i] - ema[i];
    if (prevDiff <= 0 && diff > 0) crosses.push({ index: i, side: "long" });
    else if (prevDiff >= 0 && diff < 0) crosses.push({ index: i, side: "short" });
  }
  return crosses;
}

export function check(result, { bars, ref, backtest }) {
  const issues = [];
  if (!result.strategy.declared) {
    issues.push("CRITICAL: strategy.declared is false");
    return issues;
  }

  const closes = bars.map((b) => b.close);
  const trendEma = ref.ema(closes, 20);
  const expectedCrosses = detectCrosses(closes, trendEma);

  if (result.strategy.entries.length === 0 && expectedCrosses.length > 0) {
    issues.push(`CRITICAL: zero entries fired, expected ~${expectedCrosses.length} EMA crosses`);
    return issues;
  }

  const withTrail = result.strategy.entries.filter(
    (e) => Array.isArray(e.trail) && e.trail.length === bars.length,
  );
  if (withTrail.length === 0) {
    issues.push(
      "no entry uses the trail: series option — the AI fell back to a static stop instead of a real trailing stop (or is still using an approach from before trail: existed)",
    );
    return issues;
  }
  if (withTrail.length < result.strategy.entries.length * 0.7) {
    issues.push(
      `only ${withTrail.length}/${result.strategy.entries.length} entries use trail: — expected nearly all of them to, since every entry in this strategy should trail`,
    );
  }

  if (!backtest || !backtest.ok) {
    issues.push(`backtest did not produce a report: ${backtest && !backtest.ok ? backtest.message : "unknown"}`);
    return issues;
  }
  if (backtest.trades.length === 0) {
    issues.push("backtest produced zero trades — cannot verify ratcheting actually happened");
    return issues;
  }

  // For each stopped-out trade that lasted more than a couple of bars, the
  // final stop should differ meaningfully from the ATR-distance a *static*
  // stop would have set at entry — proving the level actually moved instead
  // of sitting frozen at its initial value for the life of the trade.
  const atrVals = ref.atr(bars, 14);
  let ratchetedCount = 0;
  let checkable = 0;
  for (const t of backtest.trades) {
    const heldBars = Math.round((t.exitTime - t.entryTime) / 86400);
    if (t.exitReason !== "Stop Loss" || heldBars < 3 || t.stop === null) continue;
    const entryIdx = bars.findIndex((b) => b.time === t.entryTime);
    const atrAtEntry = entryIdx >= 0 ? atrVals[entryIdx] : NaN;
    if (!Number.isFinite(atrAtEntry)) continue;
    checkable++;
    const staticStop = t.direction === "long" ? t.entryPrice - atrAtEntry * 3 : t.entryPrice + atrAtEntry * 3;
    const moved = Math.abs(t.stop - staticStop) > atrAtEntry * 0.5; // moved by more than half an ATR
    if (moved) ratchetedCount++;
  }

  if (checkable > 0 && ratchetedCount === 0) {
    issues.push(
      `none of the ${checkable} multi-bar stopped-out trade(s) show a stop that moved from its entry-time ATR distance — trailing does not appear to be taking effect`,
    );
  }

  return issues;
}
