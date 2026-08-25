/**
 * Pure calculation engines shared by the drawing tools that need real math
 * beyond "draw a line between two points": Fibonacci retracement levels,
 * Anchored VWAP, and Long/Short position risk metrics. No React, no DOM, no
 * lightweight-charts — directly unit-testable and reusable by future tools
 * (Fib Extension/Channel/Time Zone/Fan all reuse `FibLevel`/level math;
 * Fixed Range / Anchored Volume Profile would reuse the same bar-window
 * selection `anchoredVwap` already does).
 */

import type { Bar } from "./geometry";

// ---- Fibonacci ---------------------------------------------------------

export type FibLevel = {
  value: number; // 0..1 (or beyond, for extension-style levels)
  color?: string;
  enabled?: boolean;
};

/** TradingView-standard default retracement levels. */
export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  { value: 0, enabled: true },
  { value: 0.236, enabled: true },
  { value: 0.382, enabled: true },
  { value: 0.5, enabled: true },
  { value: 0.618, enabled: true },
  { value: 0.786, enabled: true },
  { value: 1, enabled: true },
];

export type FibComputedLevel = FibLevel & { price: number };

/**
 * Price for each level between two anchor prices. `p1` is always treated as
 * the 0% anchor and `p2` as the 100% anchor — callers wanting "reverse
 * anchors" behavior just swap which point is p1/p2 (see
 * `reverseFibAnchors`), so this function itself never needs to know which
 * anchor came first chronologically.
 */
export function computeFibLevels(
  p1Price: number,
  p2Price: number,
  levels: FibLevel[] = DEFAULT_FIB_LEVELS,
): FibComputedLevel[] {
  const range = p2Price - p1Price;
  return levels.map((lvl) => ({ ...lvl, price: p1Price + range * lvl.value }));
}

/** Swaps which anchor is 0%/100% without mutating the input levels array —
 * "reverse anchors without corruption" from the spec: the level *set* is
 * untouched, only which price plays p1 vs p2 changes. */
export function reverseFibAnchors<T extends { price: number }>(p1: T, p2: T): [T, T] {
  return [p2, p1];
}

/** Adds a custom level, keeping the list sorted and de-duplicated by value. */
export function addFibLevel(levels: FibLevel[], value: number, color?: string): FibLevel[] {
  const next = [...levels.filter((l) => l.value !== value), { value, color, enabled: true }];
  return next.sort((a, b) => a.value - b.value);
}

export function removeFibLevel(levels: FibLevel[], value: number): FibLevel[] {
  return levels.filter((l) => l.value !== value);
}

// ---- Fibonacci: Trend-Based Extension / Channel / Wedge (Phase 3C) ------
//
// These three tools reuse the SAME `FibLevel`/`FibComputedLevel` model above
// (enable/disable, color, custom ratios via addFibLevel/removeFibLevel) —
// they only need their own conventional default RATIO sets (extension/
// channel/wedge ratios aren't the same as Retracement's 0..1 band) and their
// own PRICE projection math (an extension/channel/wedge level isn't "a point
// between two anchors" the way a retracement level is).

/** Trend-Based Fib Extension's conventional defaults: 0 marks the projection
 * anchor (C) itself; everything else is >0 and mostly >1 — an extension's
 * whole point is levels OUTSIDE the measured A->B move, unlike Retracement's
 * inside-the-move 0..1 band. */
export const FIB_EXTENSION_DEFAULT_LEVELS: FibLevel[] = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618].map((value) => ({
  value,
  enabled: true,
}));

/** Fib Channel's conventional defaults: ratios of the base A->B->width
 * offset, rendered as rails parallel to the A->B trend line (0 = the trend
 * line itself, 1 = exactly the width anchor's own rail). */
export const FIB_CHANNEL_DEFAULT_LEVELS: FibLevel[] = [0, 0.382, 0.618, 1, 1.618, 2.618].map((value) => ({
  value,
  enabled: true,
}));

/** Fib Wedge's conventional defaults (Pitchfan-style ray fan): fractions
 * along the B->C segment that each ray from the shared pivot (A) passes
 * through. */
export const FIB_WEDGE_DEFAULT_LEVELS: FibLevel[] = [0, 0.382, 0.5, 0.618, 1, 1.618, 2.618].map((value) => ({
  value,
  enabled: true,
}));

/** The one place that knows which conventional default ratio set belongs to
 * which Fib tool — every render/hit-test/settings call site asks THIS
 * instead of carrying its own `?? SOME_DEFAULT` per tool id, so adding a
 * future Fib tool's own default set never means hunting down every place
 * that needs to know about it. */
export function defaultFibLevelsForTool(tool: string): FibLevel[] {
  if (tool === "fib-ext") return FIB_EXTENSION_DEFAULT_LEVELS;
  if (tool === "fib-channel") return FIB_CHANNEL_DEFAULT_LEVELS;
  if (tool === "fib-wedge") return FIB_WEDGE_DEFAULT_LEVELS;
  return DEFAULT_FIB_LEVELS;
}

/**
 * Trend-Based Fib Extension: measures the A->B move, then projects each
 * level FROM C (`price = C + (B - A) * ratio`). Deliberately not
 * `computeFibLevels` re-anchored at C — a Retracement's band sits BETWEEN
 * its two anchors, while an Extension's levels sit outside C, scaled by a
 * move measured somewhere else entirely (A->B). Recomputes fresh from the
 * three raw anchor prices every call (no cached/derived state to go stale),
 * so it's always correct immediately after A, B, or C moves, and cheap
 * enough to call every render frame without memoizing.
 */
export function computeFibExtensionLevels(
  aPrice: number,
  bPrice: number,
  cPrice: number,
  levels: FibLevel[] = FIB_EXTENSION_DEFAULT_LEVELS,
): FibComputedLevel[] {
  const move = bPrice - aPrice;
  return levels.map((lvl) => ({ ...lvl, price: cPrice + move * lvl.value }));
}

/** A point a fraction `t` of the way from `from` to `to` (t outside [0,1]
 * extrapolates past either end) — computed independently per axis (time,
 * price) in MARKET coordinates, never screen pixels. This is the one
 * primitive Fib Wedge's ray fan needs: each ray passes through
 * `lerpMarketPoint(B, C, ratio)` for one Fibonacci ratio. Interpolating time
 * and price as two independent linear axes (rather than, say, a single
 * "distance along the segment") is what keeps this meaningful when time and
 * price don't share a pixel scale — see this module's and geometry.ts's
 * module docs. */
export function lerpMarketPoint(
  from: { time: number; price: number },
  to: { time: number; price: number },
  t: number,
): { time: number; price: number } {
  return { time: from.time + (to.time - from.time) * t, price: from.price + (to.price - from.price) * t };
}

// ---- Anchored VWAP ------------------------------------------------------

export type VwapPoint = { time: number; value: number };

/**
 * Volume-weighted average price computed cumulatively from `anchorTime`
 * forward, using only the bars actually loaded (`bars`) — never fabricates
 * volume. Returns one point per bar from the anchor bar onward, so the
 * caller can draw it as a line/plot that extends as new bars arrive
 * (recompute is O(n) from the anchor each time; cheap for any realistic
 * loaded-bar count and simplest to reason about correctness-wise — no running
 * state to get out of sync with a symbol/timeframe change).
 */
export function anchoredVwap(bars: Bar[], anchorTime: number): VwapPoint[] {
  const startIdx = bars.findIndex((b) => b.time >= anchorTime);
  if (startIdx < 0) return [];
  const out: VwapPoint[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.high + b.low + b.close) / 3;
    cumPV += typical * b.volume;
    cumVol += b.volume;
    out.push({ time: b.time, value: cumVol > 0 ? cumPV / cumVol : typical });
  }
  return out;
}

// ---- Long/Short position planning ---------------------------------------

export type PositionMetrics = {
  riskPerUnit: number;
  rewardPerUnit: number;
  riskRewardRatio: number;
  riskTicks: number;
  rewardTicks: number;
  riskValue: number;
  rewardValue: number;
};

/**
 * Risk/reward metrics for a Long/Short position-planning drawing. `tickSize`/
 * `valuePerPoint` come from the same instrument metadata the trading ticket
 * already uses (`src/lib/trading/instruments.ts`) — this is a chart
 * measurement/planning tool only, it never touches order routing.
 */
export function computePositionMetrics(
  entry: number,
  stop: number,
  target: number,
  tickSize: number,
  valuePerPoint: number,
): PositionMetrics {
  const riskPerUnit = Math.abs(entry - stop);
  const rewardPerUnit = Math.abs(target - entry);
  const safeTick = tickSize > 0 ? tickSize : 0.01;
  return {
    riskPerUnit,
    rewardPerUnit,
    riskRewardRatio: riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0,
    riskTicks: Math.round(riskPerUnit / safeTick),
    rewardTicks: Math.round(rewardPerUnit / safeTick),
    riskValue: riskPerUnit * valuePerPoint,
    rewardValue: rewardPerUnit * valuePerPoint,
  };
}
