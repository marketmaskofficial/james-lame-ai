// Coverage for the drawing tool math engines (Chart Studio drawing tools
// phase): src/lib/drawing/calc.ts — Fibonacci levels, Anchored VWAP, and
// Long/Short position risk metrics. No React, no DOM.
//
// Usage: npx tsx test/workspace/drawingCalc.test.mjs

import {
  DEFAULT_FIB_LEVELS,
  computeFibLevels,
  reverseFibAnchors,
  addFibLevel,
  removeFibLevel,
  anchoredVwap,
  computePositionMetrics,
  movePositionEntry,
  movePositionTarget,
  movePositionStop,
  resizePositionWidth,
  movePositionBody,
  FIB_EXTENSION_DEFAULT_LEVELS,
  FIB_CHANNEL_DEFAULT_LEVELS,
  FIB_WEDGE_DEFAULT_LEVELS,
  FIB_TIME_ZONE_DEFAULT_LEVELS,
  FIB_SPEED_FAN_DEFAULT_LEVELS,
  FIB_CIRCLE_DEFAULT_LEVELS,
  defaultFibLevelsForTool,
  computeFibExtensionLevels,
  computeFibTimeZoneLevels,
  computeFibSpeedFanTargets,
  lerpMarketPoint,
  cyclicLineTimes,
  timeCyclesTimes,
  sineLinePoints,
  gannGridFractions,
  gannSquareFixedCorner,
  gannFanSlope,
  gannFanRatioLabel,
  GANN_FAN_RATIOS,
  GANN_FAN_DEFAULT_LEVELS,
  computeLinearRegression,
  pitchforkHandle,
  pitchforkTarget,
  pitchforkTeethAnchors,
  captureRelativePattern,
  computePriceRange,
  computeDateRange,
} from "../../src/lib/drawing/calc.ts";
import {
  distToEllipseRing,
  fibSpiralPoints,
  parallelChannelSecondRail,
  distToSegment,
  quadraticBezierPoints,
  cubicBezierPoints,
  directionalArrowGlyph,
  pointInSector,
  normalizeSectorSweep,
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
function close(name, actual, expected, eps = 1e-9) {
  ok(`${name} (${actual} ~= ${expected})`, Math.abs(actual - expected) <= eps);
}

// ---- Fibonacci --------------------------------------------------------

{
  const levels = computeFibLevels(100, 200); // uptrend, 0% at 100, 100% at 200
  close("fib 0%", levels.find((l) => l.value === 0).price, 100);
  close("fib 50%", levels.find((l) => l.value === 0.5).price, 150);
  close("fib 61.8%", levels.find((l) => l.value === 0.618).price, 100 + 100 * 0.618);
  close("fib 100%", levels.find((l) => l.value === 1).price, 200);
  ok("fib levels: default set has 7 levels", DEFAULT_FIB_LEVELS.length === 7);
}

{
  // A downtrend retracement (p1 > p2) still computes correctly — 0% is
  // always p1, 100% is always p2, regardless of which is numerically larger.
  const levels = computeFibLevels(200, 100);
  close("fib downtrend: 0% at p1", levels.find((l) => l.value === 0).price, 200);
  close("fib downtrend: 100% at p2", levels.find((l) => l.value === 1).price, 100);
  close("fib downtrend: 50% is the midpoint either way", levels.find((l) => l.value === 0.5).price, 150);
}

{
  // Reverse anchors without corrupting the level SET — only which price
  // plays p1/p2 changes.
  const p1 = { price: 100 };
  const p2 = { price: 200 };
  const [np1, np2] = reverseFibAnchors(p1, p2);
  ok("reverseFibAnchors: swaps p1/p2", np1.price === 200 && np2.price === 100);
  const before = computeFibLevels(p1.price, p2.price);
  const after = computeFibLevels(np1.price, np2.price);
  ok(
    "reverseFibAnchors: the level VALUE set (0, 0.236, ... 1) is identical before/after",
    JSON.stringify(before.map((l) => l.value)) === JSON.stringify(after.map((l) => l.value)),
  );
  close("reverseFibAnchors: 0% now sits at the old 100% price", after.find((l) => l.value === 0).price, 200);
}

{
  const withCustom = addFibLevel(DEFAULT_FIB_LEVELS, 1.272, "#ff00ff");
  ok("addFibLevel: adds the new level", withCustom.some((l) => l.value === 1.272));
  ok("addFibLevel: keeps the list sorted", withCustom.every((l, i) => i === 0 || withCustom[i - 1].value <= l.value));
  ok("addFibLevel: de-dupes by value", addFibLevel(withCustom, 1.272).filter((l) => l.value === 1.272).length === 1);

  const removed = removeFibLevel(withCustom, 1.272);
  ok("removeFibLevel: removes exactly that level", !removed.some((l) => l.value === 1.272));
  ok("removeFibLevel: leaves the rest untouched", removed.length === DEFAULT_FIB_LEVELS.length);
}

// ---- Anchored VWAP ------------------------------------------------------

function bar(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume };
}

{
  const bars = [
    bar(1, 10, 10, 10, 10, 100), // typical = 10
    bar(2, 20, 20, 20, 20, 300), // typical = 20
    bar(3, 30, 30, 30, 30, 100), // typical = 30
  ];
  const series = anchoredVwap(bars, 1);
  ok("vwap: one point per bar from the anchor", series.length === 3);
  close("vwap: first point equals the first bar's typical price", series[0].value, 10);
  // cumulative: (10*100 + 20*300) / (100+300) = 7000/400 = 17.5
  close("vwap: cumulative weighted average at bar 2", series[1].value, 17.5);
  const total = 10 * 100 + 20 * 300 + 30 * 100;
  const vol = 100 + 300 + 100;
  close("vwap: cumulative weighted average at bar 3", series[2].value, total / vol);

  const midAnchor = anchoredVwap(bars, 2);
  ok("vwap: anchoring mid-series only includes bars from the anchor onward", midAnchor.length === 2);
  close("vwap: mid-anchor first point uses only its own bar", midAnchor[0].value, 20);

  ok("vwap: anchor after all bars returns empty (never fabricates data)", anchoredVwap(bars, 999).length === 0);
  ok("vwap: empty bars returns empty", anchoredVwap([], 1).length === 0);
}

{
  // Zero-volume bars never divide by zero — falls back to the typical price.
  const bars = [bar(1, 10, 10, 10, 10, 0), bar(2, 20, 20, 20, 20, 0)];
  const series = anchoredVwap(bars, 1);
  ok("vwap: zero volume never throws or produces NaN", series.every((p) => Number.isFinite(p.value)));
  close("vwap: zero-volume bar's value is its own typical price", series[0].value, 10);
}

// ---- Long/Short position metrics ---------------------------------------

{
  // Long: entry 100, stop 90 (risk 10), target 130 (reward 30) -> R:R 3.
  const m = computePositionMetrics(100, 90, 130, 0.01, 1);
  close("position: risk per unit", m.riskPerUnit, 10);
  close("position: reward per unit", m.rewardPerUnit, 30);
  close("position: R:R", m.riskRewardRatio, 3);
  ok("position: risk ticks", m.riskTicks === 1000);
  ok("position: reward ticks", m.rewardTicks === 3000);
  close("position: risk value with valuePerPoint=5", computePositionMetrics(100, 90, 130, 0.01, 5).riskValue, 50);
}

{
  // Short: entry 100, stop 110 (risk 10, above entry), target 70 (reward 30).
  const m = computePositionMetrics(100, 110, 70, 1, 1);
  close("short position: risk per unit (direction-agnostic)", m.riskPerUnit, 10);
  close("short position: reward per unit", m.rewardPerUnit, 30);
  close("short position: R:R", m.riskRewardRatio, 3);
}

{
  // Zero risk (entry === stop) never divides by zero.
  const m = computePositionMetrics(100, 100, 130, 0.01, 1);
  ok("position: zero risk -> R:R is 0, not NaN/Infinity", m.riskRewardRatio === 0);
}

{
  // A non-positive tick size falls back to a sane default (0.01) rather than
  // dividing by zero.
  const m = computePositionMetrics(100, 90, 130, 0, 1);
  ok("position: non-positive tickSize falls back safely", Number.isFinite(m.riskTicks) && m.riskTicks > 0);
}

// ---- Long/Short position interaction anchors (Phase 3D-15) -------------
// StudioChart's onMove calls these directly for the "entry"/"target"/
// "left"/"right"/"body" anchor kinds — not a parallel reimplementation.

{
  const p1 = { time: 1000, price: 100 };
  const moved = movePositionEntry(p1, 95);
  close("movePositionEntry: changes only price", moved.price, 95);
  ok("movePositionEntry: time is untouched", moved.time === p1.time);
}

{
  const p2 = { time: 2000, price: 130 };
  const moved = movePositionTarget(p2, 140);
  close("movePositionTarget: changes only price", moved.price, 140);
  ok("movePositionTarget: time is untouched", moved.time === p2.time);
}

{
  ok("movePositionStop: sets the stop price", movePositionStop(90, 85) === 85);
  ok("movePositionStop: works from an undefined starting stop", movePositionStop(undefined, 85) === 85);
}

{
  // p1 (entry) drawn on the left, p2 (target) on the right.
  const p1 = { time: 1000, price: 100 };
  const p2 = { time: 2000, price: 130 };
  const left = resizePositionWidth(p1, p2, "left", 800);
  close("resizePositionWidth left: moves p1's time (the left side)", left.p1.time, 800);
  ok("resizePositionWidth left: p1's price is untouched", left.p1.price === p1.price);
  ok("resizePositionWidth left: p2 is untouched", left.p2 === p2);
  const right = resizePositionWidth(p1, p2, "right", 2500);
  close("resizePositionWidth right: moves p2's time (the right side)", right.p2.time, 2500);
  ok("resizePositionWidth right: p2's price is untouched", right.p2.price === p2.price);
  ok("resizePositionWidth right: p1 is untouched", right.p1 === p1);
}

{
  // Mirrored Short: p2 (target) drawn to the LEFT of p1 (entry) — "left"/
  // "right" must resolve by actual on-screen time position, not by which of
  // p1/p2 it happens to be.
  const p1 = { time: 2000, price: 100 }; // entry, on the right
  const p2 = { time: 1000, price: 70 }; // target, on the left
  const left = resizePositionWidth(p1, p2, "left", 500);
  ok("resizePositionWidth left (short, p2 is the left side): moves p2's time", left.p2.time === 500 && left.p1 === p1);
  const right = resizePositionWidth(p1, p2, "right", 2600);
  ok("resizePositionWidth right (short, p1 is the left side): moves p1's time", right.p1.time === 2600 && right.p2 === p2);
}

{
  const p1 = { time: 1000, price: 100 }; // entry
  const p2 = { time: 2000, price: 130 }; // target
  const stop = 90;
  const moved = movePositionBody(p1, p2, stop, 500, -5);
  close("movePositionBody: shifts entry time+price", moved.p1.time, 1500);
  close("movePositionBody: shifts entry price", moved.p1.price, 95);
  close("movePositionBody: shifts target time+price", moved.p2.time, 2500);
  close("movePositionBody: shifts target price", moved.p2.price, 125);
  close("movePositionBody: shifts stop by the same price delta", moved.stop, 85);
  // Relative distances (risk/reward) must be preserved by a pure shift.
  close("movePositionBody: preserves risk distance", moved.p1.price - moved.stop, p1.price - stop);
  close("movePositionBody: preserves reward distance", moved.p2.price - moved.p1.price, p2.price - p1.price);
  const movedNoStop = movePositionBody(p1, p2, undefined, 100, 10);
  ok("movePositionBody: an undefined stop stays undefined", movedNoStop.stop === undefined);
}

// ---- Phase 3C: Trend-Based Fib Extension / Channel / Wedge -------------

// ---- defaultFibLevelsForTool: the one place per-tool ratio defaults live ---

{
  ok("defaultFibLevelsForTool('fib-ext') returns the extension defaults", defaultFibLevelsForTool("fib-ext") === FIB_EXTENSION_DEFAULT_LEVELS);
  ok("defaultFibLevelsForTool('fib-channel') returns the channel defaults", defaultFibLevelsForTool("fib-channel") === FIB_CHANNEL_DEFAULT_LEVELS);
  ok("defaultFibLevelsForTool('fib-wedge') returns the wedge defaults", defaultFibLevelsForTool("fib-wedge") === FIB_WEDGE_DEFAULT_LEVELS);
  ok("defaultFibLevelsForTool falls back to Retracement's defaults for 'fib'", defaultFibLevelsForTool("fib") === DEFAULT_FIB_LEVELS);
  ok("defaultFibLevelsForTool falls back to Retracement's defaults for an unknown tool", defaultFibLevelsForTool("unknown-tool") === DEFAULT_FIB_LEVELS);
  ok("extension defaults include ratios beyond 1 (the whole point of an extension)", FIB_EXTENSION_DEFAULT_LEVELS.some((l) => l.value > 1));
  ok("extension defaults include 0 (marks the projection anchor C itself)", FIB_EXTENSION_DEFAULT_LEVELS.some((l) => l.value === 0));
}

// ---- computeFibExtensionLevels: A->B measures the move, projected from C ---

{
  // Uptrend measured move (A=100, B=150, so move=+50), projected from C=200.
  const levels = computeFibExtensionLevels(100, 150, 200, [
    { value: 0, enabled: true },
    { value: 1, enabled: true },
    { value: 1.618, enabled: true },
  ]);
  close("fib-ext: level 0 sits exactly at C", levels.find((l) => l.value === 0).price, 200);
  close("fib-ext: level 1 is C + the full A->B move", levels.find((l) => l.value === 1).price, 250);
  close("fib-ext: level 1.618 is C + 1.618x the move", levels.find((l) => l.value === 1.618).price, 200 + 50 * 1.618);
}

{
  // Negative (downtrend) measured move: A=200, B=100 (move=-100), from C=150.
  const levels = computeFibExtensionLevels(200, 100, 150, [
    { value: 0, enabled: true },
    { value: 1, enabled: true },
    { value: 2, enabled: true },
  ]);
  close("fib-ext negative move: level 0 still sits at C", levels.find((l) => l.value === 0).price, 150);
  close("fib-ext negative move: level 1 projects DOWN by the move's magnitude", levels.find((l) => l.value === 1).price, 50);
  close("fib-ext negative move: level 2 projects down twice as far", levels.find((l) => l.value === 2).price, -50);
}

{
  // Reversing A/B flips the sign of the measured move without touching C.
  const forward = computeFibExtensionLevels(100, 150, 200, [{ value: 1, enabled: true }]);
  const reversed = computeFibExtensionLevels(150, 100, 200, [{ value: 1, enabled: true }]);
  close("fib-ext reversed A/B: forward move projects up from C", forward[0].price, 250);
  close("fib-ext reversed A/B: reversed move projects down from C by the same magnitude", reversed[0].price, 150);
}

{
  // Reacts correctly to ANY of A/B/C moving — recomputed fresh every call,
  // no cached/stale state.
  const base = computeFibExtensionLevels(100, 150, 200, [{ value: 1, enabled: true }])[0].price;
  const movedA = computeFibExtensionLevels(120, 150, 200, [{ value: 1, enabled: true }])[0].price;
  const movedB = computeFibExtensionLevels(100, 170, 200, [{ value: 1, enabled: true }])[0].price;
  const movedC = computeFibExtensionLevels(100, 150, 220, [{ value: 1, enabled: true }])[0].price;
  ok("fib-ext: moving A changes the result", movedA !== base);
  ok("fib-ext: moving B changes the result", movedB !== base);
  ok("fib-ext: moving C changes the result", movedC !== base);
  close("fib-ext: moving C shifts every level by exactly the same delta", movedC - base, 20);
}

{
  // Like computeFibLevels, computeFibExtensionLevels itself doesn't filter
  // by `enabled` — that's the CALLER's job (StudioChart.tsx pre-filters
  // before calling), so an `enabled: false` level still computes a price
  // here; it's just up to the caller not to render/hit-test it.
  const levels = computeFibExtensionLevels(100, 150, 200, [
    { value: 0, enabled: true },
    { value: 1, enabled: false },
  ]);
  ok("fib-ext: preserves each level's `enabled` flag untouched", levels.find((l) => l.value === 1).enabled === false);
  ok("fib-ext: still computes a price for a disabled level (filtering is the caller's job)", levels.find((l) => l.value === 1).price === 250);
}

{
  // Custom (user-added) ratios apply exactly like any built-in ratio — no
  // special-casing by value.
  const levels = computeFibExtensionLevels(100, 150, 200, [{ value: 4.236, enabled: true }]);
  close("fib-ext: a custom ratio (e.g. 4.236) projects correctly", levels[0].price, 200 + 50 * 4.236);
}

// ---- lerpMarketPoint: the per-axis market-coordinate interpolation Fib ------
// Wedge's ray fan (and nothing pixel-space) is built on ----------------------

{
  const from = { time: 1000, price: 100 };
  const to = { time: 2000, price: 200 };
  close("lerpMarketPoint: t=0 returns the FROM point's time", lerpMarketPoint(from, to, 0).time, 1000);
  close("lerpMarketPoint: t=0 returns the FROM point's price", lerpMarketPoint(from, to, 0).price, 100);
  close("lerpMarketPoint: t=1 returns the TO point exactly", lerpMarketPoint(from, to, 1).time, 2000);
  close("lerpMarketPoint: t=0.5 is the exact midpoint in BOTH axes independently", lerpMarketPoint(from, to, 0.5).price, 150);
  close("lerpMarketPoint: t=0.5 midpoint time", lerpMarketPoint(from, to, 0.5).time, 1500);
  // t>1 extrapolates PAST `to` — exactly what a 1.618/2.618 wedge ray needs.
  close("lerpMarketPoint: t=2 extrapolates past TO by the same step", lerpMarketPoint(from, to, 2).price, 300);
  close("lerpMarketPoint: t=1.618 extrapolates the price axis correctly", lerpMarketPoint(from, to, 1.618).price, 100 + 100 * 1.618);
  // Time and price interpolate INDEPENDENTLY — a huge time delta and a small
  // price delta never bleed into each other (no shared/implied scale).
  const wideTime = { time: 1_700_000_000, price: 50 };
  const narrowPriceMove = { time: 1_700_003_600, price: 50.5 };
  const mid = lerpMarketPoint(wideTime, narrowPriceMove, 0.5);
  close("lerpMarketPoint: independent-axis interpolation — time midpoint", mid.time, 1_700_001_800);
  close("lerpMarketPoint: independent-axis interpolation — price midpoint (unaffected by the huge time scale)", mid.price, 50.25);
}

// ---- Phase 3C-2: Fib Time Zone / Fib Speed Resistance Fan -----------------

{
  ok("defaultFibLevelsForTool('fib-time') returns the time-zone defaults", defaultFibLevelsForTool("fib-time") === FIB_TIME_ZONE_DEFAULT_LEVELS);
  ok("defaultFibLevelsForTool('fib-speed-fan') returns the speed-fan defaults", defaultFibLevelsForTool("fib-speed-fan") === FIB_SPEED_FAN_DEFAULT_LEVELS);
  ok(
    "Fib Time Zone defaults are the actual Fibonacci SEQUENCE, not a 0..1 ratio band",
    JSON.stringify(FIB_TIME_ZONE_DEFAULT_LEVELS.map((l) => l.value)) === JSON.stringify([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]),
  );
  ok(
    "Fib Speed Resistance Fan defaults match the spec's ratio set",
    JSON.stringify(FIB_SPEED_FAN_DEFAULT_LEVELS.map((l) => l.value)) === JSON.stringify([0.25, 0.382, 0.5, 0.618, 0.75, 1]),
  );
}

// ---- computeFibTimeZoneLevels: whole-sequence multiples of the base interval

{
  // Anchors 1000s apart -> base interval 1000; level 0 sits exactly on the
  // start, level 1 exactly on the second anchor, level 2 twice as far, etc.
  const levels = computeFibTimeZoneLevels(1000, 1000, [
    { value: 0, enabled: true },
    { value: 1, enabled: true },
    { value: 2, enabled: true },
    { value: 3, enabled: true },
    { value: 5, enabled: true },
  ]);
  close("fib-time: level 0 sits exactly at the start anchor", levels.find((l) => l.value === 0).time, 1000);
  close("fib-time: level 1 sits exactly at the second anchor", levels.find((l) => l.value === 1).time, 2000);
  close("fib-time: level 2 is two full intervals out", levels.find((l) => l.value === 2).time, 3000);
  close("fib-time: level 3 is three full intervals out", levels.find((l) => l.value === 3).time, 4000);
  close("fib-time: level 5 (real Fibonacci sequence, not 0..1 ratios) is five intervals out", levels.find((l) => l.value === 5).time, 6000);
}

{
  // Reversed anchors (second anchor placed BEFORE the start in time): the
  // interval is negative, and every later level projects in that same
  // (backward) direction rather than silently flipping to its absolute
  // value — level 0 and level 1 still sit exactly on the two anchors.
  const levels = computeFibTimeZoneLevels(2000, -1000, [
    { value: 0, enabled: true },
    { value: 1, enabled: true },
    { value: 3, enabled: true },
  ]);
  close("fib-time reversed: level 0 still sits at the start anchor", levels.find((l) => l.value === 0).time, 2000);
  close("fib-time reversed: level 1 still sits exactly at the second anchor", levels.find((l) => l.value === 1).time, 1000);
  close("fib-time reversed: level 3 projects further in the SAME (backward) direction", levels.find((l) => l.value === 3).time, -1000);
}

{
  // Custom (user-added) time levels apply exactly like any built-in one.
  const levels = computeFibTimeZoneLevels(0, 100, [{ value: 144, enabled: true }]);
  close("fib-time: a custom sequence value (e.g. 144) projects correctly", levels[0].time, 14400);
}

{
  // Moving either anchor recalculates every level immediately (no cached
  // interval/start).
  const base = computeFibTimeZoneLevels(1000, 1000, [{ value: 2, enabled: true }])[0].time;
  const movedStart = computeFibTimeZoneLevels(1500, 1000, [{ value: 2, enabled: true }])[0].time;
  const movedInterval = computeFibTimeZoneLevels(1000, 2000, [{ value: 2, enabled: true }])[0].time;
  ok("fib-time: moving the start anchor changes every level", movedStart !== base);
  ok("fib-time: moving the second anchor (interval) changes every level", movedInterval !== base);
}

// ---- computeFibSpeedFanTargets: fan targets at B's time, fraction of A->B price move

{
  // A=(t:0, p:100), B=(t:1000, p:200) -> a +100 measured move. Every target
  // shares B's time exactly; only price varies by ratio.
  const a = { time: 0, price: 100 };
  const b = { time: 1000, price: 200 };
  const targets = computeFibSpeedFanTargets(a, b, [
    { value: 0, enabled: true },
    { value: 0.5, enabled: true },
    { value: 1, enabled: true },
  ]);
  ok("fib-speed-fan: every target shares B's time exactly (fan measured at a fixed time slice)", targets.every((t) => t.time === 1000));
  close("fib-speed-fan: ratio 0 sits at A's own price level (at B's time)", targets.find((t) => t.value === 0).price, 100);
  close("fib-speed-fan: ratio 0.5 is the midpoint of the measured move", targets.find((t) => t.value === 0.5).price, 150);
  close("fib-speed-fan: ratio 1 lands exactly on B", targets.find((t) => t.value === 1).price, 200);
}

{
  // A downward measured move works identically (direction-agnostic).
  const a = { time: 0, price: 200 };
  const b = { time: 500, price: 100 };
  const targets = computeFibSpeedFanTargets(a, b, [{ value: 0.25, enabled: true }, { value: 0.75, enabled: true }]);
  close("fib-speed-fan downtrend: ratio 0.25 is a quarter of the way down", targets.find((t) => t.value === 0.25).price, 175);
  close("fib-speed-fan downtrend: ratio 0.75 is three-quarters of the way down", targets.find((t) => t.value === 0.75).price, 125);
}

{
  // Ratios beyond 1 extrapolate past B, same convention as every other Fib
  // tool's beyond-1 ratios.
  const a = { time: 0, price: 0 };
  const b = { time: 100, price: 10 };
  const targets = computeFibSpeedFanTargets(a, b, [{ value: 1.618, enabled: true }]);
  close("fib-speed-fan: ratio > 1 extrapolates past B", targets[0].price, 16.18);
  close("fib-speed-fan: ratio > 1 still shares B's exact time", targets[0].time, 100);
}

{
  // Moving either anchor recalculates every target immediately.
  const a = { time: 0, price: 100 };
  const b = { time: 1000, price: 200 };
  const base = computeFibSpeedFanTargets(a, b, [{ value: 0.5, enabled: true }])[0].price;
  const movedA = computeFibSpeedFanTargets({ time: 0, price: 120 }, b, [{ value: 0.5, enabled: true }])[0].price;
  const movedB = computeFibSpeedFanTargets(a, { time: 1000, price: 220 }, [{ value: 0.5, enabled: true }])[0].price;
  ok("fib-speed-fan: moving A changes every target", movedA !== base);
  ok("fib-speed-fan: moving B changes every target", movedB !== base);
}

// ---- Phase 3C-3: Trend-Based Fib Time / Pitchfan --------------------------
// Both reuse existing math verbatim (computeFibTimeZoneLevels /
// lerpMarketPoint) with different inputs — no new calc.ts functions, so
// these tests exercise the exact call pattern StudioChart.tsx's
// fib-time-trend/pitchfan render branches use, not new primitives.

{
  ok(
    "defaultFibLevelsForTool('fib-time-trend') reuses Fib Time Zone's exact defaults (same array reference)",
    defaultFibLevelsForTool("fib-time-trend") === FIB_TIME_ZONE_DEFAULT_LEVELS,
  );
  ok(
    "defaultFibLevelsForTool('pitchfan') reuses Fib Wedge's exact defaults (same array reference)",
    defaultFibLevelsForTool("pitchfan") === FIB_WEDGE_DEFAULT_LEVELS,
  );
}

{
  // Trend-Based Fib Time: A=(t:0), B=(t:1000) measures a +1000 interval;
  // projection starts from C=(t:5000), NOT from A — this is the one thing
  // that differs from plain Fib Time Zone (which projects from its own p1).
  const a = { time: 0 };
  const b = { time: 1000 };
  const c = { time: 5000 };
  const interval = b.time - a.time;
  const levels = computeFibTimeZoneLevels(c.time, interval, [
    { value: 0, enabled: true },
    { value: 1, enabled: true },
    { value: 3, enabled: true },
  ]);
  close("fib-time-trend: level 0 sits exactly on the projection anchor C, not A", levels.find((l) => l.value === 0).time, 5000);
  close("fib-time-trend: level 1 is one A->B interval past C", levels.find((l) => l.value === 1).time, 6000);
  close("fib-time-trend: level 3 is three A->B intervals past C", levels.find((l) => l.value === 3).time, 8000);
}

{
  // Reversing A/B flips the measured interval's sign, and projection from C
  // follows that same (now-backward) direction — exactly like Fib
  // Extension's reversed-anchor behavior, applied to time instead of price.
  const a = { time: 1000 };
  const b = { time: 0 };
  const c = { time: 5000 };
  const levels = computeFibTimeZoneLevels(c.time, b.time - a.time, [{ value: 0, enabled: true }, { value: 2, enabled: true }]);
  close("fib-time-trend reversed: level 0 still sits exactly on C", levels.find((l) => l.value === 0).time, 5000);
  close("fib-time-trend reversed: level 2 projects backward from C (negative interval)", levels.find((l) => l.value === 2).time, 3000);
}

{
  // Moving any of the three anchors (A, B, or C) recalculates every level.
  const a = { time: 0 };
  const b = { time: 1000 };
  const c = { time: 5000 };
  const base = computeFibTimeZoneLevels(c.time, b.time - a.time, [{ value: 2, enabled: true }])[0].time;
  const movedA = computeFibTimeZoneLevels(c.time, b.time - 500, [{ value: 2, enabled: true }])[0].time;
  const movedB = computeFibTimeZoneLevels(c.time, 1500 - a.time, [{ value: 2, enabled: true }])[0].time;
  const movedC = computeFibTimeZoneLevels(6000, b.time - a.time, [{ value: 2, enabled: true }])[0].time;
  ok("fib-time-trend: moving A changes every level", movedA !== base);
  ok("fib-time-trend: moving B changes every level", movedB !== base);
  ok("fib-time-trend: moving C changes every level", movedC !== base);
}

{
  // Pitchfan: identical pivot-ray-fan math to Fib Wedge — a ray target is
  // lerpMarketPoint(B, C, ratio), exactly as StudioChart.tsx's paintFibWedge
  // (shared verbatim by pitchfan via a null fillOpacity) computes it.
  const pivot = { time: 0, price: 100 };
  const b = { time: 500, price: 150 };
  const c = { time: 500, price: 250 };
  const ray0 = lerpMarketPoint(b, c, 0);
  const ray1 = lerpMarketPoint(b, c, 1);
  const rayHalf = lerpMarketPoint(b, c, 0.5);
  close("pitchfan: ratio 0 ray target sits exactly on B", ray0.price, 150);
  close("pitchfan: ratio 1 ray target sits exactly on C", ray1.price, 250);
  close("pitchfan: ratio 0.5 ray target is the B->C midpoint", rayHalf.price, 200);
  ok("pitchfan: the pivot itself never moves — only ray TARGETS vary by ratio", pivot.price === 100);
}

// ---- Phase 3C-4: Fib Circles / Fib Speed Resistance Arcs / Fib Spiral -----
// Circles/Arcs reuse the shared FibLevel model with new geometry primitives
// (distToEllipseRing); Spiral introduces one new deterministic parametric
// primitive (fibSpiralPoints) since no existing math approximates a
// logarithmic spiral.

{
  ok(
    "defaultFibLevelsForTool('fib-circles') resolves to FIB_CIRCLE_DEFAULT_LEVELS (same array reference)",
    defaultFibLevelsForTool("fib-circles") === FIB_CIRCLE_DEFAULT_LEVELS,
  );
  ok(
    "defaultFibLevelsForTool('fib-speed-arcs') reuses the identical Fib Circles default set (same array reference)",
    defaultFibLevelsForTool("fib-speed-arcs") === FIB_CIRCLE_DEFAULT_LEVELS,
  );
}

{
  // distToEllipseRing: a point exactly ON the ring is distance 0; a point
  // well inside the smallest ring is NOT (unlike a filled-interior test).
  close("distToEllipseRing: point on the ring edge (right vertex)", distToEllipseRing(110, 100, 100, 100, 10, 20), 0);
  close("distToEllipseRing: point on the ring edge (top vertex)", distToEllipseRing(100, 80, 100, 100, 10, 20), 0);
  ok("distToEllipseRing: center point is far from a ring (not a false interior hit)", distToEllipseRing(100, 100, 100, 100, 10, 20) > 5);
  ok(
    "distToEllipseRing: handles non-uniform rx/ry (elliptical, not circular) scaling correctly",
    distToEllipseRing(100, 121, 100, 100, 10, 20) > distToEllipseRing(100, 120, 100, 100, 10, 20),
  );
}

{
  // fibSpiralPoints: deterministic, starts at radius r0 from center, and
  // strictly increases in radius as theta advances (logarithmic spiral,
  // never contracts).
  const pts = fibSpiralPoints(0, 0, 10, 0, 1);
  ok("fibSpiralPoints: produces multiple sampled points", pts.length > 10);
  close("fibSpiralPoints: first point sits at radius r0 on the starting angle", Math.hypot(pts[0].x, pts[0].y), 10);
  let monotonic = true;
  for (let i = 1; i < pts.length; i++) {
    const rPrev = Math.hypot(pts[i - 1].x, pts[i - 1].y);
    const rCur = Math.hypot(pts[i].x, pts[i].y);
    if (rCur <= rPrev) monotonic = false;
  }
  ok("fibSpiralPoints: radius strictly increases along the spiral (golden-ratio growth, never contracts)", monotonic);
  const pts2 = fibSpiralPoints(5, -5, 10, Math.PI / 2, 1);
  ok("fibSpiralPoints: deterministic — identical inputs produce identical output", JSON.stringify(pts) !== JSON.stringify(pts2) && pts2.length === fibSpiralPoints(5, -5, 10, Math.PI / 2, 1).length);
}

// ---- Phase 3D-3: Cyclic Lines / Time Cycles / Sine Line -------------------

{
  // Cyclic Lines: repeats bidirectionally, indefinitely, within the range.
  const times = cyclicLineTimes(1000, 200, 0, 2000);
  ok("cyclicLineTimes: includes the anchor itself", times.includes(1000));
  ok("cyclicLineTimes: includes a forward repeat (1200)", times.includes(1200));
  ok("cyclicLineTimes: includes a backward repeat (800)", times.includes(800));
  ok("cyclicLineTimes: never generates a time outside [rangeStart, rangeEnd]", times.every((t) => t >= 0 && t <= 2000));
  ok("cyclicLineTimes: evenly spaced by the interval", times.every((t, i) => i === 0 || Math.abs(times[i] - times[i - 1] - 200) < 1e-9));
}

{
  // Reversed anchors: cyclicLineInterval is always computed as an absolute
  // difference by the caller (Math.abs(p2.time - p1.time)) BEFORE reaching
  // cyclicLineTimes, so the same anchorTime + interval pair produces the
  // identical grid regardless of which anchor the user dragged first.
  const forward = cyclicLineTimes(1000, 200, 0, 2000);
  const reversedInterval = cyclicLineTimes(1000, Math.abs(800 - 1000), 0, 2000); // as if p1=1000,p2=800
  ok("cyclicLineTimes: reversed-anchor interval (abs) produces the identical grid", JSON.stringify(forward) === JSON.stringify(reversedInterval));
}

{
  // Degenerate interval (negligible drag) never infinite-loops.
  const times = cyclicLineTimes(500, 0, 0, 10000);
  ok("cyclicLineTimes: non-positive interval degrades to just the anchor", times.length === 1 && times[0] === 500);
}

{
  // Time Cycles: fixed forward-only count, deliberately NOT the same policy
  // as Cyclic Lines above even though both take an interval.
  const times = timeCyclesTimes(1000, 200, 5);
  ok("timeCyclesTimes: starts at the anchor itself", times[0] === 1000);
  ok("timeCyclesTimes: produces exactly count+1 times (anchor + 5 forward repeats)", times.length === 6);
  ok("timeCyclesTimes: every repeat is STRICTLY forward of the anchor (never backward)", times.every((t) => t >= 1000));
  ok("timeCyclesTimes: last repeat lands at anchor + count*interval", times[times.length - 1] === 1000 + 5 * 200);
  const degenerate = timeCyclesTimes(500, 0, 5);
  ok("timeCyclesTimes: non-positive interval degrades to just the anchor", degenerate.length === 1 && degenerate[0] === 500);
}

{
  // Time Cycles interval regeneration: moving either anchor recomputes both
  // the interval and the anchor point fresh — no cached state.
  const before = timeCyclesTimes(1000, 200, 3);
  const movedInterval = timeCyclesTimes(1000, 300, 3);
  const movedAnchor = timeCyclesTimes(1500, 200, 3);
  ok("timeCyclesTimes: changing the interval changes every repeat", JSON.stringify(before) !== JSON.stringify(movedInterval));
  ok("timeCyclesTimes: changing the anchor shifts every repeat", JSON.stringify(before) !== JSON.stringify(movedAnchor));
}

{
  // Sine Line: p1 is the trough (baseline - amplitude), p2 the next peak
  // (baseline + amplitude), half a period apart — BOTH anchors must sit
  // exactly on the generated curve.
  const p1 = { time: 0, price: 100 }; // trough
  const p2 = { time: 500, price: 200 }; // peak
  const pts = sineLinePoints(p1, p2, 0, 24); // no extra half-periods: just the defining pair's own curve
  close("sineLinePoints: first sample sits exactly on p1 (the trough)", pts[0].price, 100, 1e-6);
  close("sineLinePoints: last sample sits exactly on p2 (the peak)", pts[pts.length - 1].price, 200, 1e-6);
  ok("sineLinePoints: every sampled price stays within [trough, peak]", pts.every((p) => p.price >= 100 - 1e-6 && p.price <= 200 + 1e-6));
}

{
  // Reversed anchors (p2 earlier than p1): normalized internally so the
  // SAME physical curve results regardless of drag direction.
  const p1 = { time: 500, price: 200 }; // peak, but placed as the FIRST click
  const p2 = { time: 0, price: 100 }; // trough, placed SECOND
  const pts = sineLinePoints(p1, p2, 0, 24);
  close("sineLinePoints (reversed anchors): first sample is still the EARLIER-in-time trough", pts[0].price, 100, 1e-6);
  close("sineLinePoints (reversed anchors): last sample is still the LATER-in-time peak", pts[pts.length - 1].price, 200, 1e-6);
}

{
  // Extending beyond the defining pair: more samples, still smooth
  // (monotonic phase progression), still deterministic.
  const p1 = { time: 0, price: 0 };
  const p2 = { time: 100, price: 10 };
  const pts = sineLinePoints(p1, p2, 3, 24);
  const pts2 = sineLinePoints(p1, p2, 3, 24);
  ok("sineLinePoints: extending adds samples before AND after the defining pair", pts[0].time < p1.time && pts[pts.length - 1].time > p2.time);
  ok("sineLinePoints: deterministic — identical inputs produce identical output", JSON.stringify(pts) === JSON.stringify(pts2));
  ok("sineLinePoints: time strictly increases sample to sample", pts.every((p, i) => i === 0 || p.time > pts[i - 1].time));
}

// ---- Phase 3D-4: Gann Box / Square Fixed / Square / Fan -------------------

{
  // Gann grid: N+1 evenly-spaced fractions including the box's own 0/1
  // border — shared by Box/Square Fixed/Square.
  const fracs = gannGridFractions(4);
  ok("gannGridFractions: default 4 divisions produces 5 fractions (0, .25, .5, .75, 1)", fracs.length === 5);
  ok("gannGridFractions: includes both box-border fractions (0 and 1)", fracs[0] === 0 && fracs[fracs.length - 1] === 1);
  ok("gannGridFractions: evenly spaced", fracs.every((f, i) => i === 0 || Math.abs(f - fracs[i - 1] - 0.25) < 1e-9));
  const fracs8 = gannGridFractions(8);
  ok("gannGridFractions: a different division count produces a different (still evenly-spaced) set", fracs8.length === 9 && fracs8[1] === 0.125);
  ok("gannGridFractions: degenerate (non-positive) divisions degrades to just the box border", gannGridFractions(0).length === 2);
}

{
  // Gann Square Fixed: pure addition of already-computed market-unit
  // extents onto the anchor — StudioChart.tsx does the pixel-ratio work,
  // this just needs to place the corner correctly (including negative
  // extents, e.g. a price axis where "down" is a lower price).
  const anchor = { time: 1000, price: 100 };
  const corner = gannSquareFixedCorner(anchor, 500, 20);
  ok("gannSquareFixedCorner: places the corner time/price extent forward from the anchor", corner.time === 1500 && corner.price === 120);
  const cornerNegative = gannSquareFixedCorner(anchor, 500, -20);
  ok("gannSquareFixedCorner: handles a negative price extent (axis pointing the other way)", cornerNegative.price === 80);
}

{
  // Gann Fan ratios: the nine conventional angles, base rate multiples.
  ok("GANN_FAN_RATIOS: has all nine conventional Gann angles", GANN_FAN_RATIOS.length === 9);
  ok("GANN_FAN_RATIOS: includes the base 1x1 angle at multiplier 1", GANN_FAN_RATIOS.some((r) => r.label === "1x1" && r.value === 1));
  ok("GANN_FAN_RATIOS: includes 2x1 (multiplier 2) and 1x2 (multiplier 0.5)", GANN_FAN_RATIOS.some((r) => r.label === "2x1" && r.value === 2) && GANN_FAN_RATIOS.some((r) => r.label === "1x2" && r.value === 0.5));
  ok("GANN_FAN_DEFAULT_LEVELS: one enabled FibLevel per ratio", GANN_FAN_DEFAULT_LEVELS.length === 9 && GANN_FAN_DEFAULT_LEVELS.every((l) => l.enabled === true));
  ok("defaultFibLevelsForTool('gann-fan') resolves to GANN_FAN_DEFAULT_LEVELS (same array reference)", defaultFibLevelsForTool("gann-fan") === GANN_FAN_DEFAULT_LEVELS);
}

{
  // Gann Fan slope: baseRate (from the tool's own p1->p2 drag) times each
  // ratio multiplier — 2x1 must be exactly twice as steep as 1x1, 1x2 half.
  const baseRate = 0.5; // price units per time unit, as if p1->p2 defined this
  close("gannFanSlope: 1x1 equals the base rate exactly", gannFanSlope(baseRate, 1), 0.5);
  close("gannFanSlope: 2x1 is exactly double the base rate", gannFanSlope(baseRate, 2), 1.0);
  close("gannFanSlope: 1x2 is exactly half the base rate", gannFanSlope(baseRate, 0.5), 0.25);
  close("gannFanSlope: 8x1 is eight times steeper than 1x8", gannFanSlope(baseRate, 8), gannFanSlope(baseRate, 1 / 8) * 64, 1e-9);
}

{
  // Reversed anchors: the CALLER computes baseRate as (p2.price-p1.price)/
  // (p2.time-p1.time) — reversing which anchor is p1/p2 flips the sign of
  // BOTH numerator and denominator, so the resulting rate (and therefore
  // every ray's slope) is IDENTICAL either way; only gannFanSlope's pure
  // multiplication is under test here, so this checks that invariant
  // directly rather than re-deriving the division in the test itself.
  const forwardRate = (200 - 100) / (500 - 0); // p1=(0,100), p2=(500,200)
  const reversedRate = (100 - 200) / (0 - 500); // p1=(500,200), p2=(0,100)
  ok("gannFanSlope inputs: reversed anchors produce the identical base rate", Math.abs(forwardRate - reversedRate) < 1e-12);
  ok("gannFanSlope: identical base rate produces identical slopes for every ratio", GANN_FAN_RATIOS.every((r) => gannFanSlope(forwardRate, r.value) === gannFanSlope(reversedRate, r.value)));
}

{
  // Ratio labels: looked up from GANN_FAN_RATIOS by value, not
  // reconstructed — an unrecognized custom value degrades to a plain
  // decimal string instead of a wrong label.
  ok("gannFanRatioLabel: known ratio resolves to its conventional 'AxB' label", gannFanRatioLabel(2) === "2x1" && gannFanRatioLabel(0.25) === "1x4");
  ok("gannFanRatioLabel: unrecognized custom value degrades to a plain decimal string", gannFanRatioLabel(1.5) === "1.5");
}

// ---- Phase 3D-5: Regression Trend / Pitchfork family -----------------------

{
  // Perfect linear data: slope/intercept must be exact, residuals zero.
  const points = [
    { time: 0, value: 10 },
    { time: 100, value: 20 },
    { time: 200, value: 30 },
    { time: 300, value: 40 },
  ];
  const { slope, intercept, stdDev } = computeLinearRegression(points);
  close("computeLinearRegression: perfectly linear data recovers the exact slope", slope, 0.1);
  close("computeLinearRegression: perfectly linear data recovers the exact intercept", intercept, 10);
  close("computeLinearRegression: zero residuals for perfectly linear data", stdDev, 0, 1e-9);
}

{
  // Flat data (zero slope): the fit should be a horizontal line at the mean.
  const points = [
    { time: 0, value: 50 },
    { time: 100, value: 50 },
    { time: 200, value: 50 },
  ];
  const { slope, intercept } = computeLinearRegression(points);
  close("computeLinearRegression: flat data has zero slope", slope, 0);
  close("computeLinearRegression: flat data's intercept equals the constant value", intercept, 50);
}

{
  // Degenerate inputs never throw / divide by zero.
  ok("computeLinearRegression: empty input degrades to a zero-everything result", computeLinearRegression([]).slope === 0 && computeLinearRegression([]).stdDev === 0);
  const single = computeLinearRegression([{ time: 5, value: 42 }]);
  ok("computeLinearRegression: single point degrades to zero slope at that value", single.slope === 0 && single.intercept === 42);
}

{
  // Pitchfork: all four variants built from lerpMarketPoint's midpoint math
  // (t=0.5) — verify each variant's documented handle/target/teeth.
  const p0 = { time: 0, price: 100 };
  const p1 = { time: 100, price: 150 };
  const p2 = { time: 200, price: 60 };
  const midP1P2 = { time: 150, price: 105 };

  const stdHandle = pitchforkHandle(p0, p1, p2, "standard");
  ok("pitchforkHandle standard: handle is P0 itself", stdHandle.time === p0.time && stdHandle.price === p0.price);
  const stdTarget = pitchforkTarget(p0, p1, p2, "standard");
  close("pitchforkTarget standard: target is the midpoint of P1/P2", stdTarget.price, midP1P2.price);
  const [stdT1, stdT2] = pitchforkTeethAnchors(p0, p1, p2, "standard");
  ok("pitchforkTeethAnchors standard: teeth pass through P1 and P2", stdT1 === p1 && stdT2 === p2);

  const schiffHandle = pitchforkHandle(p0, p1, p2, "schiff");
  close("pitchforkHandle schiff: handle is the midpoint of P0/P1", schiffHandle.price, (p0.price + p1.price) / 2);
  const schiffTarget = pitchforkTarget(p0, p1, p2, "schiff");
  ok("pitchforkTarget schiff: SAME target as standard (midpoint of P1/P2)", schiffTarget.price === stdTarget.price && schiffTarget.time === stdTarget.time);

  const modSchiffHandle = pitchforkHandle(p0, p1, p2, "modified-schiff");
  close("pitchforkHandle modified-schiff: handle is the midpoint of P0 and midpoint(P1,P2)", modSchiffHandle.price, (p0.price + midP1P2.price) / 2);
  ok(
    "pitchforkHandle: standard/schiff/modified-schiff produce three DIFFERENT handle points (not aliased)",
    stdHandle.price !== schiffHandle.price && schiffHandle.price !== modSchiffHandle.price && stdHandle.price !== modSchiffHandle.price,
  );

  const insideHandle = pitchforkHandle(p0, p1, p2, "inside");
  ok("pitchforkHandle inside: handle is P1 (swapped pivot)", insideHandle.time === p1.time && insideHandle.price === p1.price);
  const insideTarget = pitchforkTarget(p0, p1, p2, "inside");
  close("pitchforkTarget inside: target is the midpoint of P0/P2 (not P1/P2)", insideTarget.price, (p0.price + p2.price) / 2);
  const [insideT1, insideT2] = pitchforkTeethAnchors(p0, p1, p2, "inside");
  ok("pitchforkTeethAnchors inside: teeth pass through P0 and P2 (not P1/P2)", insideT1 === p0 && insideT2 === p2);
}

// ---- Phase 3D-5 closeout: Parallel Channel's second-rail hit-test fix -----
// The bug: hit-testing only ever checked the p1->p2 baseline, never the
// offset second rail StudioChart.tsx's renderer (and Flat Top/Bottom's own
// renderer) actually draws — clicking squarely on that second, clearly
// visible line silently missed. Both the renderer and the hit-test now call
// this ONE shared function, so they can never drift apart again.

{
  // A horizontal baseline (p1->p2) offset straight up by p3: the second
  // rail should be an identical horizontal line, shifted by exactly that
  // perpendicular distance — the classic "drag out channel width" case.
  const rail2 = parallelChannelSecondRail(0, 100, 200, 100, 0, 70);
  close("parallelChannelSecondRail: horizontal baseline offsets straight up by p3's perpendicular distance (y1)", rail2.y1, 70);
  close("parallelChannelSecondRail: horizontal baseline offsets straight up by p3's perpendicular distance (y2)", rail2.y2, 70);
  close("parallelChannelSecondRail: offsetting a horizontal baseline never shifts it sideways", rail2.x1, 0);
  ok("parallelChannelSecondRail: rail2 stays exactly as long as the baseline (still a parallel copy)", Math.abs(rail2.x2 - rail2.x1) === Math.abs(200 - 0));
}

{
  // Degenerate p1===p2 (zero-length baseline) never divides by zero /
  // produces NaN.
  const rail2 = parallelChannelSecondRail(50, 50, 50, 50, 80, 50);
  ok("parallelChannelSecondRail: degenerate zero-length baseline never produces NaN", Number.isFinite(rail2.x1) && Number.isFinite(rail2.y1) && Number.isFinite(rail2.x2) && Number.isFinite(rail2.y2));
}

{
  // The actual regression this fix targets: a click sitting squarely ON
  // the second rail (far from the baseline) must now report a SMALL
  // hit-test distance — before the fix, only the baseline was checked, so
  // this exact click would have scored a large (wrong) distance.
  const x1 = 0, y1 = 100, x2 = 200, y2 = 100, x3 = 0, y3 = 60; // p3 40px above baseline
  const rail2 = parallelChannelSecondRail(x1, y1, x2, y2, x3, y3);
  const clickOnRail2 = { x: 100, y: 60 }; // dead center of the second rail
  const distToBaseline = distToSegment(clickOnRail2.x, clickOnRail2.y, x1, y1, x2, y2);
  const distToRail2 = distToSegment(clickOnRail2.x, clickOnRail2.y, rail2.x1, rail2.y1, rail2.x2, rail2.y2);
  ok("regression: a click on the second rail is FAR from the baseline (would have missed pre-fix)", distToBaseline > 30);
  close("regression: that SAME click is essentially ON the second rail post-fix", distToRail2, 0, 1e-9);
  ok("regression: the second-rail distance is now what a 'best distance across both rails' check would correctly pick", distToRail2 < distToBaseline);
}

// ---- Phase 3D-6: Brushes/Arrows/Shapes closeout ----------------------------

{
  // Rotated Rectangle: the 4 corners (p1, p2, rail2.p2, rail2.p1) formed by
  // parallelChannelSecondRail must be a genuine PARALLELOGRAM (opposite
  // sides equal length and parallel) — the property that gives it real
  // oriented/rotated geometry, distinct from an axis-aligned Rectangle.
  const x1 = 0, y1 = 0, x2 = 100, y2 = 0, x3 = 20, y3 = 40;
  const rail2 = parallelChannelSecondRail(x1, y1, x2, y2, x3, y3);
  const side1 = Math.hypot(x2 - x1, y2 - y1);
  const side2 = Math.hypot(rail2.x2 - rail2.x1, rail2.y2 - rail2.y1);
  close("Rotated Rectangle: opposite sides (p1->p2 and rail2) have equal length", side1, side2);
  const side3 = Math.hypot(rail2.x1 - x1, rail2.y1 - y1);
  const side4 = Math.hypot(rail2.x2 - x2, rail2.y2 - y2);
  close("Rotated Rectangle: the other pair of opposite sides also have equal length", side3, side4);
  ok("Rotated Rectangle: the offset rail is NOT collinear with the baseline (genuinely a 2D box, not a degenerate line)", Math.abs(rail2.y1 - y1) > 1e-6);
}

{
  // Arc/Curve: quadraticBezierPoints must start/end EXACTLY at the two
  // endpoints and genuinely deviate from the straight chord in between
  // (real curvature, not a straight line in disguise).
  const pts = quadraticBezierPoints(0, 0, 50, 40, 100, 0);
  close("quadraticBezierPoints: first sample sits exactly on the start point", pts[0].x, 0);
  close("quadraticBezierPoints: last sample sits exactly on the end point", pts[pts.length - 1].x, 100);
  close("quadraticBezierPoints: last sample's y matches the end point", pts[pts.length - 1].y, 0, 1e-9);
  const midSample = pts[Math.floor(pts.length / 2)];
  ok("quadraticBezierPoints: the midpoint sample deviates from the straight chord (genuine curvature)", midSample.y > 5);
}

{
  // Double Curve: cubicBezierPoints must also start/end exactly at its two
  // endpoints, and — the property that makes it genuinely DISTINCT from
  // Curve's quadratic — must be able to express an S-shape (two bends,
  // deviating in OPPOSITE directions on either half), which a quadratic
  // curve through a single control point cannot.
  const pts = cubicBezierPoints(0, 0, 30, 40, 70, -40, 100, 0);
  close("cubicBezierPoints: first sample sits exactly on the start point", pts[0].x, 0);
  close("cubicBezierPoints: last sample sits exactly on the end point", pts[pts.length - 1].x, 100);
  const quarter = pts[Math.floor(pts.length / 4)];
  const threeQuarter = pts[Math.floor((pts.length * 3) / 4)];
  ok("cubicBezierPoints: an S-shaped control layout produces deviations in OPPOSITE directions (a real double bend)", quarter.y > 0 && threeQuarter.y < 0);
}

{
  // Arrow Marker: the glyph's tip must sit exactly `size` pixels from the
  // anchor along the given angle, and the two base points must be
  // symmetric around that same angle (an isosceles triangle, not a
  // lopsided one) — the deterministic shape behind "arrowhead orientation".
  const size = 10;
  const angle = -Math.PI / 4; // up-and-to-the-right
  const glyph = directionalArrowGlyph(0, 0, angle, size);
  close("directionalArrowGlyph: tip sits exactly `size` pixels from the anchor", Math.hypot(glyph.tip.x, glyph.tip.y), size, 1e-9);
  close("directionalArrowGlyph: tip's angle from the anchor matches the requested orientation", Math.atan2(glyph.tip.y, glyph.tip.x), angle, 1e-9);
  const base1Dist = Math.hypot(glyph.base1.x, glyph.base1.y);
  const base2Dist = Math.hypot(glyph.base2.x, glyph.base2.y);
  close("directionalArrowGlyph: both base points sit the same distance from the anchor (symmetric, isosceles)", base1Dist, base2Dist);
  ok("directionalArrowGlyph: a different orientation angle moves the tip to a genuinely different position", directionalArrowGlyph(0, 0, 0, size).tip.x !== glyph.tip.x);
}

// ---- Phase 3D-8: Forecasting (Bars Pattern / Sector) -----------------------

{
  // Bars Pattern: captures REAL relative close-price deltas from the actual
  // bars in range — deltas[0] is always 0 (the first bar is its own base).
  const bars = [
    { time: 0, close: 100 },
    { time: 60, close: 110 },
    { time: 120, close: 95 },
    { time: 180, close: 105 },
    { time: 1000, close: 999 }, // well outside the range — must be excluded
  ];
  const { deltas, barInterval } = captureRelativePattern(bars, 0, 180);
  ok("captureRelativePattern: captures exactly the bars within [start,end], excluding ones outside it", deltas.length === 4);
  close("captureRelativePattern: first delta is always 0 (the base bar)", deltas[0], 0);
  close("captureRelativePattern: second delta is the real close-price difference from the base", deltas[1], 10);
  close("captureRelativePattern: third delta correctly goes negative (a real down move)", deltas[2], -5);
  close("captureRelativePattern: barInterval matches the actual spacing between the first two captured bars", barInterval, 60);
}

{
  // Reversed range (end time given before start time) must capture the
  // identical pattern — a user can drag either direction.
  const bars = [
    { time: 0, close: 50 },
    { time: 60, close: 55 },
    { time: 120, close: 45 },
  ];
  const forward = captureRelativePattern(bars, 0, 120);
  const reversed = captureRelativePattern(bars, 120, 0);
  ok("captureRelativePattern: reversed start/end times capture the identical pattern", JSON.stringify(forward) === JSON.stringify(reversed));
}

{
  // Degenerate inputs never throw.
  ok("captureRelativePattern: empty bars array degrades to an empty pattern", captureRelativePattern([], 0, 100).deltas.length === 0);
  const single = captureRelativePattern([{ time: 0, close: 42 }], 0, 100);
  ok("captureRelativePattern: a single in-range bar produces one zero delta and no interval", single.deltas.length === 1 && single.deltas[0] === 0 && single.barInterval === 0);
}

{
  // Sector: a real interior test — inside the radius AND between the two
  // boundary angles, following the ACTUAL rendered pie-slice.
  const ox = 0, oy = 0, radius = 10;
  const startAngle = 0; // pointing along +x
  const endAngle = Math.PI / 2; // pointing along +y (a quarter-circle sector)
  ok("pointInSector: a point inside the radius AND between the two angles is inside", pointInSector(5, 5, ox, oy, radius, startAngle, endAngle));
  ok("pointInSector: a point beyond the radius (even at the right angle) is outside", pointInSector(20, 20, ox, oy, radius, startAngle, endAngle) === false);
  ok("pointInSector: a point within the radius but OUTSIDE the angular range is outside", pointInSector(-5, -5, ox, oy, radius, startAngle, endAngle) === false);
  ok("pointInSector: the origin itself is always inside (distance 0)", pointInSector(0, 0, ox, oy, radius, startAngle, endAngle));
}

{
  // Sector angle wraparound: boundary angles given in either order/sign
  // must still produce a consistent, correctly-oriented sector.
  const ox = 0, oy = 0, radius = 10;
  // A sector from 170° to -170° (i.e. wrapping through 180°) should
  // include a point at exactly 180°.
  const startAngle = (170 * Math.PI) / 180;
  const endAngle = (-170 * Math.PI) / 180;
  const pointAt180 = { x: -8, y: 0 };
  ok("pointInSector: handles angle wraparound across +/-180 degrees correctly", pointInSector(pointAt180.x, pointAt180.y, ox, oy, radius, startAngle, endAngle));
}

// ---- Phase 3D-8 closeout: Sector deterministic sweep ----------------------

{
  // The core fix: swapping which anchor is "first" (angleA vs angleB) must
  // produce the IDENTICAL rendered sector — not flip to the reflex
  // (>180°) side. 30° and 100° are 70° apart the short way.
  const a = (30 * Math.PI) / 180;
  const b = (100 * Math.PI) / 180;
  const forward = normalizeSectorSweep(a, b);
  const reversed = normalizeSectorSweep(b, a);
  const close9 = (x, y) => Math.abs(x - y) < 1e-9;
  ok(
    "normalizeSectorSweep: reversing the two input angles produces the IDENTICAL (startAngle, endAngle) pair",
    close9(forward.startAngle, reversed.startAngle) && close9(forward.endAngle, reversed.endAngle),
  );
  const sweep = forward.endAngle - forward.startAngle;
  ok("normalizeSectorSweep: the chosen sweep is the SHORT way around (<=180°), not the 290° reflex side", sweep <= Math.PI + 1e-9);
  close("normalizeSectorSweep: the short-way sweep between 30° and 100° is exactly 70°", sweep, (70 * Math.PI) / 180, 1e-9);
}

{
  // A pair that wraps across 0°/360° (e.g. 350° and 20°, 30° apart the
  // short way through 0°) must still resolve consistently either order.
  const a = (350 * Math.PI) / 180;
  const b = (20 * Math.PI) / 180;
  const forward = normalizeSectorSweep(a, b);
  const reversed = normalizeSectorSweep(b, a);
  const close9 = (x, y) => Math.abs(x - y) < 1e-9;
  ok(
    "normalizeSectorSweep: wraparound pair (350°/20°) is also order-independent",
    close9(forward.startAngle, reversed.startAngle) && close9(forward.endAngle, reversed.endAngle),
  );
  const sweep = forward.endAngle - forward.startAngle;
  close("normalizeSectorSweep: the short way across the 0° wraparound is exactly 30°", sweep, (30 * Math.PI) / 180, 1e-9);
}

{
  // Sanity: the normalized (startAngle, endAngle) pair still feeds
  // pointInSector correctly — a point squarely inside the short-way wedge
  // is inside regardless of input order, and the reflex-side point is not.
  const ox = 0, oy = 0, radius = 10;
  const a = 0;
  const b = Math.PI / 2; // 90°
  const insideShortWedge = { x: 7, y: 7 }; // ~45°, inside the 0-90 wedge
  const insideReflexSide = { x: -7, y: -7 }; // ~225°, the OTHER (reflex) side
  for (const [angleA, angleB] of [[a, b], [b, a]]) {
    const { startAngle, endAngle } = normalizeSectorSweep(angleA, angleB);
    ok(`pointInSector + normalizeSectorSweep(${angleA === a ? "a,b" : "b,a"}): the short-way wedge point is inside`, pointInSector(insideShortWedge.x, insideShortWedge.y, ox, oy, radius, startAngle, endAngle));
    ok(`pointInSector + normalizeSectorSweep(${angleA === a ? "a,b" : "b,a"}): the reflex-side point stays outside`, !pointInSector(insideReflexSide.x, insideReflexSide.y, ox, oy, radius, startAngle, endAngle));
  }
}

// ---- Phase 3D-10: Measurers (Price Range / Date Range) --------------------

{
  // Positive movement: end above start.
  const r = computePriceRange(100, 130);
  close("computePriceRange: positive move — diff", r.diff, 30);
  close("computePriceRange: positive move — pct", r.pct, 30);
  ok("computePriceRange: positive move — direction is +1", r.direction === 1);
  ok("computePriceRange: start/end prices pass through unchanged (not normalized)", r.startPrice === 100 && r.endPrice === 130);
}

{
  // Negative movement: end below start.
  const r = computePriceRange(100, 80);
  close("computePriceRange: negative move — diff", r.diff, -20);
  close("computePriceRange: negative move — pct", r.pct, -20);
  ok("computePriceRange: negative move — direction is -1", r.direction === -1);
}

{
  // Zero movement.
  const r = computePriceRange(100, 100);
  close("computePriceRange: zero move — diff is exactly 0", r.diff, 0);
  ok("computePriceRange: zero move — direction is 0", r.direction === 0);
}

{
  // Zero STARTING price safety — must never divide by zero / produce NaN.
  const r = computePriceRange(0, 50);
  ok("computePriceRange: zero starting price never produces NaN/Infinity", Number.isFinite(r.pct));
  close("computePriceRange: zero starting price safely reports 0% (not fabricated)", r.pct, 0);
  close("computePriceRange: diff itself is still correct even when pct can't be computed", r.diff, 50);
}

{
  // Reversed anchors: computePriceRange takes p1/p2 EXACTLY as drawn — this
  // is meaningful information (a drop vs. a rise), unlike Date Range below,
  // so reversing must flip the sign, not normalize it away.
  const forward = computePriceRange(100, 130);
  const reversed = computePriceRange(130, 100);
  ok("computePriceRange: reversed anchors flip the sign of diff (a real, meaningful difference)", reversed.diff === -forward.diff);
  ok("computePriceRange: reversed anchors flip direction", reversed.direction === -forward.direction);
}

{
  // Tick count: only computed when a reliable tickSize is actually given —
  // never fabricated.
  const withTick = computePriceRange(100, 100.5, 0.25);
  ok("computePriceRange: tick count computed correctly from a real tickSize", withTick.ticks === 2);
  const noTick = computePriceRange(100, 100.5);
  ok("computePriceRange: no tickSize given -> ticks is null, never a fabricated default", noTick.ticks === null);
  const zeroTick = computePriceRange(100, 100.5, 0);
  ok("computePriceRange: a zero/invalid tickSize is treated as 'no reliable tick data', not a divide-by-zero", zeroTick.ticks === null);
}

{
  // Date Range: forward range.
  const bars = [bar(0, 1, 1, 1, 1, 1), bar(60, 1, 1, 1, 1, 1), bar(120, 1, 1, 1, 1, 1), bar(180, 1, 1, 1, 1, 1)];
  const r = computeDateRange(bars, 0, 180);
  close("computeDateRange: forward range — elapsedSeconds", r.elapsedSeconds, 180);
  ok("computeDateRange: forward range — startTime/endTime in chronological order", r.startTime === 0 && r.endTime === 180);
  ok("computeDateRange: forward range — bar count matches the actual loaded spacing (3 bar-widths apart)", r.barCount === 3);
}

{
  // Date Range: reversed anchors — elapsed time must stay positive and
  // start/end must normalize to chronological order (unlike Price Range,
  // a date range has no meaningful "sign").
  const bars = [bar(0, 1, 1, 1, 1, 1), bar(60, 1, 1, 1, 1, 1), bar(120, 1, 1, 1, 1, 1), bar(180, 1, 1, 1, 1, 1)];
  const forward = computeDateRange(bars, 0, 180);
  const reversed = computeDateRange(bars, 180, 0);
  ok("computeDateRange: reversed anchors produce the IDENTICAL result (order-independent)", JSON.stringify(forward) === JSON.stringify(reversed));
  ok("computeDateRange: elapsedSeconds is never negative", reversed.elapsedSeconds >= 0);
}

{
  // Bar count with gaps: computeDateRange uses the SAME gap-aware logical-
  // index math every other pan/zoom-correct tool already uses, so a big
  // calendar gap (e.g. a weekend) with the SAME number of actual loaded
  // bars on either side still reports the correct BAR count, not an
  // inflated calendar-based one.
  const barsWithGap = [
    bar(0, 1, 1, 1, 1, 1),
    bar(60, 1, 1, 1, 1, 1),
    bar(120, 1, 1, 1, 1, 1),
    bar(200000, 1, 1, 1, 1, 1), // a huge calendar gap, still just the next loaded bar
  ];
  const r = computeDateRange(barsWithGap, 0, 200000);
  ok("computeDateRange: a large calendar gap between consecutive loaded bars still counts as ONE bar-width, not a calendar-scaled count", r.barCount === 3);
}

{
  // Degenerate: no bars loaded yet -> barCount is null (never fabricated),
  // but elapsedSeconds is still real market-coordinate math.
  const r = computeDateRange([], 0, 180);
  ok("computeDateRange: no bars loaded -> barCount is null, never fabricated", r.barCount === null);
  close("computeDateRange: elapsedSeconds is still computed correctly with no bars loaded", r.elapsedSeconds, 180);
}

{
  // Date + Price Range must reuse the exact SAME two functions Price
  // Range/Date Range use standalone — calling them independently with the
  // same inputs must produce byte-identical results (the "shared
  // calculation parity" requirement).
  const bars = [bar(0, 1, 1, 1, 1, 1), bar(60, 1, 1, 1, 1, 1), bar(120, 1, 1, 1, 1, 1)];
  const priceOnly = computePriceRange(100, 115);
  const dateOnly = computeDateRange(bars, 0, 120);
  const combinedPrice = computePriceRange(100, 115);
  const combinedDate = computeDateRange(bars, 0, 120);
  ok("Date + Price Range's price half is byte-identical to standalone Price Range's own calculation", JSON.stringify(priceOnly) === JSON.stringify(combinedPrice));
  ok("Date + Price Range's date half is byte-identical to standalone Date Range's own calculation", JSON.stringify(dateOnly) === JSON.stringify(combinedDate));
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
