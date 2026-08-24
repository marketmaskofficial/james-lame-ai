// Coverage for the drawing-anchor market-coordinate math (Chart Studio
// drawing tools phase): src/lib/drawing/geometry.ts. No React, no DOM.
//
// This is the fix for the root bug documented in that file's header: user
// drawings used to store a raw bar-array LOGICAL INDEX as their anchor,
// which silently pointed at a different bar/time after `prependBars()`
// (loading older history) shifted every existing bar to a higher index.
// These tests exist specifically to lock in that logicalToTime/
// timeToLogicalExtrapolated round-trip and the "history load doesn't move
// existing anchors" guarantee, plus the magnet/snap behavior.
//
// Usage: npx tsx test/workspace/drawingGeometry.test.mjs

import {
  avgBarInterval,
  logicalToTime,
  timeToLogicalExtrapolated,
  nearestBarIndex,
  snapPoint,
  distToSegment,
} from "../../src/lib/drawing/geometry.ts";

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
function close(name, actual, expected, eps = 1e-6) {
  ok(`${name} (${actual} ~= ${expected})`, Math.abs(actual - expected) <= eps);
}

function bar(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

const bars = [
  bar(1000, 10, 12, 9, 11),
  bar(1060, 11, 13, 10, 12),
  bar(1120, 12, 14, 11, 13),
  bar(1180, 13, 15, 12, 14),
  bar(1240, 14, 16, 13, 15),
];

// ---- avgBarInterval -------------------------------------------------------
close("avgBarInterval: 60s spacing", avgBarInterval(bars), 60);
close("avgBarInterval: <2 bars falls back to 60", avgBarInterval([bars[0]]), 60);

// ---- logicalToTime / timeToLogicalExtrapolated round trip -----------------
for (const logical of [0, 1, 2.5, 4, -1.5, 6.25, 10]) {
  const t = logicalToTime(bars, logical);
  const back = timeToLogicalExtrapolated(bars, t);
  close(`round-trip logical ${logical}`, back, logical, 1e-6);
}
close("logicalToTime: exact bar index 2", logicalToTime(bars, 2), 1120);
close("logicalToTime: extrapolates past the last bar", logicalToTime(bars, 6), 1240 + 2 * 60);
close("timeToLogicalExtrapolated: exact bar time", timeToLogicalExtrapolated(bars, 1180), 3);
ok("timeToLogicalExtrapolated: empty bars never throws", timeToLogicalExtrapolated([], 500) === 0);

// ---- the actual regression: history backfill must not move an anchor's TIME
{
  // Simulate `loadOlderHistory` prepending two older bars — the exact
  // operation that used to corrupt a logical-index-anchored drawing.
  const older = [bar(880, 8, 9, 7, 8), bar(940, 9, 10, 8, 9)];
  const backfilled = [...older, ...bars];
  const anchorTime = bars[2].time; // 1120, originally logical index 2
  const logicalBefore = timeToLogicalExtrapolated(bars, anchorTime);
  const logicalAfter = timeToLogicalExtrapolated(backfilled, anchorTime);
  ok("history backfill: anchor TIME still resolves to the same bar", logicalAfter === 4 && backfilled[4].time === anchorTime);
  ok(
    "history backfill: logical index legitimately shifted (proving the old logical-index approach would have broken)",
    logicalBefore !== logicalAfter,
  );
}

// ---- nearestBarIndex --------------------------------------------------
ok("nearestBarIndex: empty bars -> -1", nearestBarIndex([], 100) === -1);
ok("nearestBarIndex: exact match", nearestBarIndex(bars, 1120) === 2);
ok("nearestBarIndex: before range clamps to 0", nearestBarIndex(bars, 0) === 0);
ok("nearestBarIndex: after range clamps to last", nearestBarIndex(bars, 99999) === 4);
ok("nearestBarIndex: picks the closer of two bars", nearestBarIndex(bars, 1145) === 2);

// ---- snapPoint (magnet) -------------------------------------------------
{
  const raw = { time: 1125, price: 13.9 }; // near bar[2]'s high (14)
  const off = snapPoint(bars, raw, "off");
  ok("snap off: never alters the raw point", off.time === raw.time && off.price === raw.price);

  const strong = snapPoint(bars, raw, "strong");
  ok("snap strong: time snaps to the nearest bar", strong.time === 1120);
  close("snap strong: price snaps to nearest OHLC (high=14)", strong.price, 14);

  const farRaw = { time: 1125, price: 20 }; // far from every O/H/L/C of bar[2] (12/14/11/13)
  const weakFar = snapPoint(bars, farRaw, "weak");
  ok("snap weak: time still snaps to the bar even when price doesn't", weakFar.time === 1120);
  close("snap weak: leaves price alone when not already close", weakFar.price, farRaw.price);

  const nearRaw = { time: 1125, price: 13.95 }; // very close to high=14
  const weakNear = snapPoint(bars, nearRaw, "weak");
  close("snap weak: DOES snap price when already close to an OHLC value", weakNear.price, 14);
}

// ---- distToSegment --------------------------------------------------------
close("distToSegment: point on the segment", distToSegment(5, 0, 0, 0, 10, 0), 0);
close("distToSegment: point off the segment (perpendicular)", distToSegment(5, 3, 0, 0, 10, 0), 3);
close("distToSegment: point beyond the segment's end", distToSegment(15, 0, 0, 0, 10, 0), 5);

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
