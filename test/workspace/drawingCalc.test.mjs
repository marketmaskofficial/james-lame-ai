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
} from "../../src/lib/drawing/calc.ts";

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

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
