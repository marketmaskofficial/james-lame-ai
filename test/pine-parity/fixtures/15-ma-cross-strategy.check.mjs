export const category = "strategy";
export const description = "MA(10)/MA(30) crossover strategy with long/short entries";
export const settings = { "Fast Length": 10, "Slow Length": 30 };

function detectCrosses(fast, slow) {
  const crosses = [];
  for (let i = 1; i < fast.length; i++) {
    if (Number.isNaN(fast[i]) || Number.isNaN(slow[i]) || Number.isNaN(fast[i - 1]) || Number.isNaN(slow[i - 1])) continue;
    const prevDiff = fast[i - 1] - slow[i - 1];
    const diff = fast[i] - slow[i];
    if (prevDiff <= 0 && diff > 0) crosses.push({ index: i, side: "long" });
    else if (prevDiff >= 0 && diff < 0) crosses.push({ index: i, side: "short" });
  }
  return crosses;
}

export function check(result, { bars, ref }) {
  const issues = [];
  if (!result.strategy.declared) {
    issues.push("CRITICAL: strategy.declared is false — no strategy.entry call was recognized");
    return issues;
  }

  const closes = bars.map((b) => b.close);
  const expectedCrosses = detectCrosses(ref.sma(closes, 10), ref.sma(closes, 30));

  if (result.strategy.entries.length === 0 && expectedCrosses.length > 0) {
    issues.push(`CRITICAL: zero entries fired, expected ~${expectedCrosses.length} crossover entries`);
    return issues;
  }

  const ratio = result.strategy.entries.length / Math.max(1, expectedCrosses.length);
  if (ratio < 0.4 || ratio > 2.5) {
    issues.push(`entry count ${result.strategy.entries.length} is far from expected order-of-magnitude ~${expectedCrosses.length}`);
  }

  // Fuzzy alignment: most expected crosses should have a matching-side entry nearby.
  let matched = 0;
  for (const c of expectedCrosses) {
    const near = result.strategy.entries.some((e) => e.side === c.side && Math.abs(e.bar - c.index) <= 3);
    if (near) matched++;
  }
  const matchRate = expectedCrosses.length > 0 ? matched / expectedCrosses.length : 1;
  if (matchRate < 0.5) {
    issues.push(`only ${matched}/${expectedCrosses.length} expected crossovers have a matching-side entry within 3 bars (${(matchRate * 100).toFixed(0)}%, want >=50%)`);
  }

  return issues;
}
