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
  projectLineForward,
  projectLineBackward,
  pointInEllipse,
  pointInPolygon,
  fibChannelLevelOffset,
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

// ---- projectLineForward / projectLineBackward (Extended Line's Phase 2 --
// bidirectional extension, sharing Ray's existing forward-extension math) --

{
  // A line rising left-to-right (x1<x2, y1>y2 in screen space i.e. going up):
  // forward projection should reach the canvas's right edge (width=100).
  const fwd = projectLineForward(10, 80, 30, 60, 100);
  close("projectLineForward: reaches the right edge's x", fwd.x, 100);
  // Slope preserved: dy/dx from (10,80)->(30,60) is -1; at x=100, y = 80 + (-1)*(100-10) = -10.
  close("projectLineForward: preserves the line's slope", fwd.y, -10);

  const back = projectLineBackward(10, 80, 30, 60);
  close("projectLineBackward: reaches the left edge's x (0)", back.x, 0);
  // y = 80 + (-1)*(0-10) = 90.
  close("projectLineBackward: preserves the line's slope", back.y, 90);
}

{
  // Ray only ever extends FORWARD — projectLineForward must return the
  // ORIGINAL p2 (no extension) when the edge sits behind p1 in that
  // direction, exactly like the pre-existing inline Ray math did.
  const noExtend = projectLineForward(80, 50, 60, 40, 100); // trending toward x=0, not x=100
  ok("projectLineForward: no extension when p2 is already past the edge in that direction", noExtend.x === 60 && noExtend.y === 40);

  const noExtendBack = projectLineBackward(50, 50, 30, 40); // dx<0: going backward moves AWAY from x=0, never reaches it
  ok("projectLineBackward: no extension when going backward moves away from the left edge", noExtendBack.x === 50 && noExtendBack.y === 50);
}

{
  // Vertical segment (dx=0): forward/backward projection can't extend
  // horizontally — must return the original point, never divide by zero.
  const fwd = projectLineForward(50, 80, 50, 20, 100);
  ok("projectLineForward: vertical segment (dx=0) returns p2 unchanged, no NaN", fwd.x === 50 && fwd.y === 20);
  const back = projectLineBackward(50, 80, 50, 20);
  ok("projectLineBackward: vertical segment (dx=0) returns p1 unchanged, no NaN", back.x === 50 && back.y === 80);
}

// ---- pointInEllipse (Phase 3A: Ellipse's hit-test region) ------------------
// Deliberately a real interior test, not Circle/Rect's looser rectangular
// bounding-box shortcut — a point in a bounding-box corner (outside the
// ellipse itself) must NOT hit.

ok("pointInEllipse: center is inside", pointInEllipse(50, 50, 50, 50, 20, 10));
ok("pointInEllipse: on the rim along the x-axis (exactly at rx)", pointInEllipse(70, 50, 50, 50, 20, 10));
ok("pointInEllipse: on the rim along the y-axis (exactly at ry)", pointInEllipse(50, 60, 50, 50, 20, 10));
ok(
  "pointInEllipse: bounding-box CORNER is outside the ellipse (the whole point of not using a rect hit-test)",
  !pointInEllipse(70, 60, 50, 50, 20, 10),
);
ok("pointInEllipse: clearly outside", !pointInEllipse(100, 100, 50, 50, 20, 10));
ok("pointInEllipse: degenerate zero radius never divides by zero / never throws", pointInEllipse(50, 50, 50, 50, 0, 0) === true);
ok("pointInEllipse: degenerate zero radius excludes a point a hair off-center", !pointInEllipse(51, 50, 50, 50, 0, 0));

// ---- pointInPolygon (Phase 3A: Path's filled-interior hit-test region) ----

{
  // A simple square, (0,0)-(10,0)-(10,10)-(0,10).
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  ok("pointInPolygon: center of a square is inside", pointInPolygon(5, 5, square));
  ok("pointInPolygon: clearly outside the square", !pointInPolygon(20, 20, square));
  ok("pointInPolygon: outside along one axis only", !pointInPolygon(5, 20, square));
}

{
  // A non-convex (L-shaped) polygon — the even-odd ray-casting test must
  // still correctly exclude the notch, not just approximate a convex hull.
  const lShape = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 10 },
  ];
  ok("pointInPolygon: inside the L-shape's solid arm", pointInPolygon(2, 2, lShape));
  ok("pointInPolygon: inside the notch (removed corner) is OUTSIDE", !pointInPolygon(8, 8, lShape));
}

// ---- Phase 3C: fibChannelLevelOffset — Fib Channel's per-level parallel ---
// pixel offset, generalizing the pre-existing Parallel Channel tool's own
// perpendicular-offset math to scale by an arbitrary ratio instead of
// always using the full width-anchor offset.

{
  // A horizontal trend line (0,0)->(10,0), width anchor 4px "below" it in
  // screen space (0,4) — so the perpendicular offset is a pure vertical
  // shift here, easy to check exactly.
  const zero = fibChannelLevelOffset(0, 0, 10, 0, 0, 4, 0);
  ok("fibChannelLevelOffset: ratio 0 is exactly the trend line itself (no offset)", zero.dx === 0 && zero.dy === 0);

  const full = fibChannelLevelOffset(0, 0, 10, 0, 0, 4, 1);
  close("fibChannelLevelOffset: ratio 1 reproduces the width anchor's own offset (dx)", full.dx, 0);
  close("fibChannelLevelOffset: ratio 1 reproduces the width anchor's own offset (dy)", full.dy, 4);

  const half = fibChannelLevelOffset(0, 0, 10, 0, 0, 4, 0.5);
  close("fibChannelLevelOffset: ratio 0.5 is exactly half the width anchor's offset", half.dy, 2);

  const beyond = fibChannelLevelOffset(0, 0, 10, 0, 0, 4, 1.618);
  close("fibChannelLevelOffset: ratio 1.618 extends past the width anchor's own rail", beyond.dy, 4 * 1.618);

  const negative = fibChannelLevelOffset(0, 0, 10, 0, 0, -4, 1);
  close("fibChannelLevelOffset: a width anchor on the OTHER side offsets the opposite direction", negative.dy, -4);
}

{
  // A sloped trend line — offset must stay perpendicular to the trend
  // direction (not simply vertical), verified by checking the offset vector
  // is orthogonal to the trend line's own direction vector (dot product 0).
  const x1 = 0, y1 = 0, x2 = 10, y2 = 10, x3 = 3, y3 = -1;
  const { dx, dy } = fibChannelLevelOffset(x1, y1, x2, y2, x3, y3, 1);
  const trendDx = x2 - x1;
  const trendDy = y2 - y1;
  close("fibChannelLevelOffset: the offset vector is perpendicular to a sloped trend line (dot product ~0)", dx * trendDx + dy * trendDy, 0);
}

{
  // Dragging the trend anchors (changing x1/y1/x2/y2) while keeping the same
  // width anchor changes the offset — correctly reacting to trend direction
  // changes, not caching a stale perpendicular.
  const a = fibChannelLevelOffset(0, 0, 10, 0, 0, 4, 1);
  const b = fibChannelLevelOffset(0, 0, 10, 5, 0, 4, 1);
  ok("fibChannelLevelOffset: changing the trend line's direction changes the computed offset", a.dy !== b.dy || a.dx !== b.dx);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
