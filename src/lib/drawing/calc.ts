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
