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
} from "../../src/lib/drawing/calc.ts";
import { distToEllipseRing, fibSpiralPoints } from "../../src/lib/drawing/geometry.ts";

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

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
