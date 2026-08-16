export const category = "strategy";
export const description =
  "EMA-cross entries with an ATR-multiple trailing stop. KNOWN GAP: runtime.ts's strategy schema (StrategyEntryOut.stop) is a single static number set at entry — there is no strategy.exit() primitive and no way to represent a stop that ratchets bar-by-bar. This check verifies only what the current schema can represent (a stop roughly ATR*mult away at entry time), not true trailing behavior.";
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

export function check(result, { bars, ref }) {
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

  const withStop = result.strategy.entries.filter((e) => e.stop !== null);
  if (withStop.length === 0) {
    issues.push(
      "no entries carry a stop at all — given the schema gap noted above, the AI should still fold an ATR-distance stop into strategy.entry's {stop:...}, but none did",
    );
    return issues;
  }

  const atrVals = ref.atr(bars, 14);
  let farFromAtr = 0;
  for (const e of withStop) {
    const entryPx = bars[e.bar]?.close;
    const atrAtEntry = atrVals[e.bar];
    if (entryPx === undefined || Number.isNaN(atrAtEntry)) continue;
    const dist = Math.abs(e.stop - entryPx);
    const expectedDist = atrAtEntry * 3.0;
    if (expectedDist > 0 && Math.abs(dist - expectedDist) / expectedDist > 0.6) farFromAtr++;
  }
  if (farFromAtr > withStop.length * 0.5) {
    issues.push(`${farFromAtr}/${withStop.length} stops are far from the expected ATR(14)*3 distance at entry`);
  }

  return issues;
}
