export const category = "strategy";
export const description = "RSI mean-reversion strategy with percent-based stop/target on every entry";
export const settings = { "RSI Length": 14, Oversold: 30, Overbought: 70, "Stop %": 2.0, "Target %": 4.0 };

export function check(result, { bars }) {
  const issues = [];
  if (!result.strategy.declared) {
    issues.push("CRITICAL: strategy.declared is false");
    return issues;
  }
  if (result.strategy.entries.length === 0) {
    issues.push("CRITICAL: zero entries fired across 300 bars of RSI(14) oscillation — expected at least a few");
    return issues;
  }

  let missingStop = 0;
  let missingTarget = 0;
  let wrongDirection = 0;
  for (const e of result.strategy.entries) {
    if (e.stop === null) missingStop++;
    if (e.target === null) missingTarget++;
    const entryPx = bars[e.bar]?.close;
    if (entryPx === undefined) continue;
    if (e.stop !== null) {
      const stopIsBelow = e.stop < entryPx;
      if ((e.side === "long" && !stopIsBelow) || (e.side === "short" && stopIsBelow)) wrongDirection++;
    }
    if (e.target !== null) {
      const targetIsAbove = e.target > entryPx;
      if ((e.side === "long" && !targetIsAbove) || (e.side === "short" && targetIsAbove)) wrongDirection++;
    }
  }

  if (missingStop > 0) issues.push(`${missingStop}/${result.strategy.entries.length} entries have no stop — Pine source sets one on every entry`);
  if (missingTarget > 0) issues.push(`${missingTarget}/${result.strategy.entries.length} entries have no target — Pine source sets one on every entry`);
  if (wrongDirection > 0) issues.push(`${wrongDirection} stop/target value(s) are on the wrong side of entry price for their long/short direction`);

  return issues;
}
