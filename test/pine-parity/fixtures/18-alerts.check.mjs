export const category = "alerts";
export const description =
  "Breakout markers plus alertcondition() calls. KNOWN GAP: runtime.ts's sandboxed scope has no alertcondition/alert primitive at all (unlike table()/bgcolor(), which at least degrade gracefully via a warn() stub) — if the translation emits a literal alertcondition(...) call, the whole script throws a ReferenceError instead of just dropping the alert. This fixture's main value is exposing whether that happens (see the runtimeOk stage) — the check below only verifies the breakout markers survive either way.";
export const settings = { "Breakout Length": 20 };

export function check(result, { bars }) {
  const issues = [];

  const len = 20;
  let breakoutCount = 0;
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  for (let i = len; i < bars.length; i++) {
    const windowHigh = Math.max(...highs.slice(i - len, i));
    const windowLow = Math.min(...lows.slice(i - len, i));
    if (bars[i].close >= windowHigh || bars[i].close <= windowLow) breakoutCount++;
  }

  if (result.markers.length === 0 && breakoutCount > 0) {
    issues.push(`CRITICAL: zero markers, expected ~${breakoutCount} breakout signals (via plotshape -> signal())`);
  }

  return issues;
}
