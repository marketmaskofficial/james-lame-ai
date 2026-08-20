// Coverage for UI-4h-4's crossing-condition follow-up:
// src/lib/alerts/evaluateCondition.ts — the pure function check-alerts.ts
// (the real server-side cron hook) calls per alert per poll.
//
// The crossing-detection candles below are REAL, not synthetic: fetched
// live from Binance's public klines API (BTCUSDT, 15m interval,
// 2026-08-19T21:00Z through 2026-08-20T16:45Z, 80 candles,
// data-api.binance.vision — api.binance.com itself geo-blocks this
// environment, same restriction noted by the UI-4h-3/4h-4 forks). Two real
// transitions are exercised:
//   - index 43 (69816.45) -> 44 (71300.01): a genuine upward crossing of
//     70000, followed by 35 further real candles (45-79) that never dip
//     back below 70000.
//   - index 23 (69301.27) -> 24 (68986.59): a genuine downward crossing of
//     69000, followed by index 26 (69190.35) crossing back above it — with
//     index 25 (68966.07, still below) in between correctly NOT re-firing
//     crosses_below since the prior close was already below.
// Running the real close sequence through evaluateCondition candle-by-candle
// (each candle's "prevClose" is simply the real close before it — exactly
// what check-alerts.ts's fetchPreviousClose returns from the last completed
// candle) proves crossing conditions fire on the correct transition candle
// exactly once, and never re-fire while price stays on one side across many
// subsequent real candles — the core duplicate-trigger-prevention property.
//
// Usage: npx tsx test/workspace/alertCondition.test.mjs

import { evaluateCondition } from "../../src/lib/alerts/evaluateCondition.ts";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

// Real BTCUSDT 15m closes, 2026-08-19T21:00Z .. 2026-08-20T16:45Z (80 candles).
const REAL_CLOSES = [
  69434, 69639.28, 69671.99, 69709.46, 69304.35, 69144.01, 69344.93, 69258.9,
  69356.87, 69369.06, 69317.98, 69334.79, 69572.72, 69629.96, 69571.98, 69420,
  69382.01, 69330, 69634, 69721.92, 69678, 69510.01, 69320.01, 69301.27,
  68986.59, 68966.07, 69190.35, 69195.64, 69369.58, 69359.93, 69346, 69492.01,
  69471.24, 69592, 69552.56, 69406.54, 69370.48, 69600.09, 69782.8, 69851.99,
  69804, 69692.43, 69602.56, 69816.45, 71300.01, 71349.73, 71508.62, 71592.1,
  71940.52, 71828.74, 72000.01, 71789.97, 72145.86, 72039.99, 71809.78,
  71995.99, 71983.99, 71898.19, 72154.01, 71927.07, 71792.11, 71844.76, 71686,
  71952.04, 72052.85, 71964.87, 71672.93, 71691.99, 71822.01, 71450.16, 71548,
  71826.85, 72246.95, 72413.99, 72247.34, 72470.83, 72308.97, 72406.83,
  72630.89, 72706,
];

// Replays a condition across the whole real series: candle i's "previous
// close" is candle i-1's real close (candle 0 has none — matches
// check-alerts.ts treating a failed/missing fetch as prevClose: null, which
// never fires for a crossing condition). Returns the indices where it fired.
function replay(condition, threshold) {
  const fired = [];
  for (let i = 0; i < REAL_CLOSES.length; i++) {
    const prevClose = i === 0 ? null : REAL_CLOSES[i - 1];
    if (evaluateCondition(condition, REAL_CLOSES[i], threshold, prevClose)) {
      fired.push(i);
    }
  }
  return fired;
}

{
  // Genuine real upward crossing of 70000 at index 44 (69816.45 -> 71300.01).
  const fired = replay("crosses_above", 70000);
  ok("crosses_above fires exactly once, at the real crossing candle", fired.length === 1 && fired[0] === 44);
}

{
  // The other side of the same real crossing: crosses_below at 70000 never
  // fires anywhere in this window (price only ever crosses upward through
  // 70000 in this real series).
  const fired = replay("crosses_below", 70000);
  ok("crosses_below never fires when price never crosses back down", fired.length === 0);
}

{
  // Genuine real downward crossing of 69000 at index 24 (69301.27 -> 68986.59),
  // then a genuine real upward crossing back at index 26 (68966.07 -> 69190.35).
  // Index 25 (68966.07, still below 69000) must NOT re-fire crosses_below.
  const down = replay("crosses_below", 69000);
  ok("crosses_below fires exactly once, at the real downward-crossing candle", down.length === 1 && down[0] === 24);

  const up = replay("crosses_above", 69000);
  ok("crosses_above fires exactly once, at the real re-crossing candle", up.length === 1 && up[0] === 26);
}

{
  // Level conditions (existing, unchanged behavior): "above" fires on every
  // real candle from the crossing point onward, not just the transition —
  // proving the edge/level distinction is real and the old behavior is
  // untouched by adding the new condition types.
  const fired = replay("above", 70000);
  ok(
    "above (level) fires on every real candle at/past threshold, not just the crossing",
    fired.length === REAL_CLOSES.length - 44 &&
      fired[0] === 44 &&
      fired[fired.length - 1] === REAL_CLOSES.length - 1,
  );
}

{
  const fired = replay("below", 69000);
  // Real candles at/below 69000 in this series: index 24, 25 only.
  ok("below (level) fires on every real candle at/under threshold", JSON.stringify(fired) === JSON.stringify([24, 25]));
}

{
  // prevClose: null (fetch failed / no history yet) must never let a
  // crossing condition fire, even if price is already past the threshold —
  // this is what stops a crossing alert from firing immediately on its
  // first-ever poll just because price happens to already be past the
  // threshold at creation time.
  ok("crosses_above never fires with unknown previous side", !evaluateCondition("crosses_above", 71300.01, 70000, null));
  ok("crosses_below never fires with unknown previous side", !evaluateCondition("crosses_below", 68986.59, 69000, null));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:\n" + failures.join("\n\n"));
  process.exit(1);
}
