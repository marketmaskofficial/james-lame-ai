/**
 * Pure calculation engines shared by the drawing tools that need real math
 * beyond "draw a line between two points": Fibonacci retracement levels,
 * Anchored VWAP, and Long/Short position risk metrics. No React, no DOM, no
 * lightweight-charts — directly unit-testable and reusable by future tools
 * (Fib Extension/Channel/Time Zone/Fan all reuse `FibLevel`/level math;
 * Fixed Range / Anchored Volume Profile would reuse the same bar-window
 * selection `anchoredVwap` already does).
 */

import { type Bar, type MarketPoint, timeToLogicalExtrapolated } from "./geometry";

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

// ---- Fibonacci: Time Zone / Speed Resistance Fan (Phase 3C-2) -----------
//
// Both reuse the same `FibLevel`/`FibComputedLevel`-shaped model above (the
// per-level enable/disable/color/custom-value machinery every other Fib tool
// already has via addFibLevel/removeFibLevel) — they only need their own
// conventional default VALUE sets and their own projection math, exactly
// like the three Phase 3C tools above.

/** Fib Time Zone's conventional defaults: the actual Fibonacci SEQUENCE
 * (0, 1, 2, 3, 5, 8, 13, ...), NOT the 0..1 ratio band every other Fib tool
 * here uses — each value is a whole-number multiple of the base time
 * interval measured between the tool's two anchors, matching the
 * conventional Fib Time Zone tool (TradingView et al.), not a retracement- or
 * extension-style ratio. */
export const FIB_TIME_ZONE_DEFAULT_LEVELS: FibLevel[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89].map((value) => ({
  value,
  enabled: true,
}));

/** Fib Speed Resistance Fan's conventional defaults: fractions of the
 * measured move's vertical (price) extent, taken at the second anchor's
 * time, that each fan ray from the first anchor passes through. */
export const FIB_SPEED_FAN_DEFAULT_LEVELS: FibLevel[] = [0.25, 0.382, 0.5, 0.618, 0.75, 1].map((value) => ({
  value,
  enabled: true,
}));

/** Fib Circles / Fib Speed Resistance Arcs (Phase 3C-4) conventional
 * defaults: the same 0.382/0.5/0.618/1/1.618/2.618-style ratio set already
 * used by Fib Wedge/Pitchfan, applied as concentric ring radii (as fractions
 * of the p1->p2 distance) instead of ray positions. */
export const FIB_CIRCLE_DEFAULT_LEVELS: FibLevel[] = [0.382, 0.5, 0.618, 1, 1.618, 2.618].map((value) => ({
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
  if (tool === "fib-time") return FIB_TIME_ZONE_DEFAULT_LEVELS;
  if (tool === "fib-speed-fan") return FIB_SPEED_FAN_DEFAULT_LEVELS;
  // Trend-Based Fib Time (Phase 3C-3): the identical Fibonacci SEQUENCE
  // concept as Fib Time Zone, just measured from a trend (A->B) instead of
  // the tool's own two anchors directly — reuses the exact same default
  // set rather than a duplicate "same 11 numbers, different name" constant.
  if (tool === "fib-time-trend") return FIB_TIME_ZONE_DEFAULT_LEVELS;
  // Pitchfan (Phase 3C-3): the identical pivot-ray-fan geometry as Fib
  // Wedge (see StudioChart.tsx's paintFibWedge, shared verbatim) — reuses
  // Wedge's own default ratio set for the same reason.
  if (tool === "pitchfan") return FIB_WEDGE_DEFAULT_LEVELS;
  // Fib Circles / Fib Speed Resistance Arcs (Phase 3C-4): concentric-ring
  // tools share one default ratio set (see FIB_CIRCLE_DEFAULT_LEVELS above).
  if (tool === "fib-circles" || tool === "fib-speed-arcs") return FIB_CIRCLE_DEFAULT_LEVELS;
  // Gann Fan (Phase 3D-4): reuses the exact same enable/color/custom-value
  // `levels` machinery as every fan tool above — see GANN_FAN_DEFAULT_LEVELS
  // below for why its values are angle-ratio multipliers, not Fibonacci
  // ratios.
  if (tool === "gann-fan") return GANN_FAN_DEFAULT_LEVELS;
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

export type FibTimeComputedLevel = FibLevel & { time: number };

/**
 * Fib Time Zone: vertical time levels projected forward from the starting
 * anchor (`startTime`) at whole-number Fibonacci-sequence multiples of the
 * base interval measured between the tool's two anchors
 * (`intervalSeconds = p2.time - p1.time`, kept SIGNED rather than coerced to
 * its absolute value — level 0 always sits exactly on the start anchor,
 * level 1 exactly on the second anchor, and if the second anchor is dragged
 * to the other side of the start, every later level naturally projects in
 * that same direction instead of silently reinterpreting the drag). Fresh
 * from the two raw anchor times every call — same no-cached-state
 * convention as `computeFibExtensionLevels`, so it's always correct the
 * instant either anchor moves.
 */
export function computeFibTimeZoneLevels(
  startTime: number,
  intervalSeconds: number,
  levels: FibLevel[] = FIB_TIME_ZONE_DEFAULT_LEVELS,
): FibTimeComputedLevel[] {
  return levels.map((lvl) => ({ ...lvl, time: startTime + intervalSeconds * lvl.value }));
}

/**
 * Fib Speed Resistance Fan: each enabled ratio's fan-line target point — a
 * fraction `ratio` of the way up the measured A->B price move, taken at B's
 * OWN time (not a free third anchor the way Fib Wedge's B->C segment is).
 * Expressed via the shared `lerpMarketPoint` primitive already used by Fib
 * Wedge, not a bespoke price-only lerp: interpolating between a virtual
 * point that shares B's time but A's price, and B itself, means the
 * interpolated TIME is always exactly `b.time` (both endpoints already share
 * it) while only price varies — exactly the classic Speed Resistance Fan
 * convention of "fan lines from the first point through fractions of the
 * vertical move, measured at the second point's time".
 */
export function computeFibSpeedFanTargets(
  a: { time: number; price: number },
  b: { time: number; price: number },
  levels: FibLevel[] = FIB_SPEED_FAN_DEFAULT_LEVELS,
): (FibLevel & { time: number; price: number })[] {
  return levels.map((lvl) => ({ ...lvl, ...lerpMarketPoint({ time: b.time, price: a.price }, b, lvl.value) }));
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

/**
 * Long/Short Position's dedicated anchor edits (Phase 3D-15) — pure, so the
 * interaction-safety invariants (price-only edits never touch time, and
 * vice versa) are unit-testable without going through StudioChart's canvas
 * pointer-event plumbing. StudioChart's onMove calls these directly; it
 * does not reimplement this logic inline.
 */
export function movePositionEntry(p1: MarketPoint, price: number): MarketPoint {
  return { ...p1, price };
}

export function movePositionTarget(p2: MarketPoint, price: number): MarketPoint {
  return { ...p2, price };
}

export function movePositionStop(_stop: number | undefined, price: number): number {
  return price;
}

/**
 * Left/right width-resize: moves whichever of p1/p2 currently sits on that
 * side's time extent, leaving both anchors' prices untouched. "Which side"
 * is resolved from the p1/p2 passed in (the caller's fixed pre-drag
 * snapshot) so a resize that crosses over the opposite edge mid-drag keeps
 * moving the same anchor's time throughout the gesture.
 */
export function resizePositionWidth(
  p1: MarketPoint,
  p2: MarketPoint,
  edge: "left" | "right",
  time: number,
): { p1: MarketPoint; p2: MarketPoint } {
  const leftIsP1 = p1.time <= p2.time;
  const movingP1 = edge === "left" ? leftIsP1 : !leftIsP1;
  return {
    p1: movingP1 ? { ...p1, time } : p1,
    p2: !movingP1 ? { ...p2, time } : p2,
  };
}

/**
 * Whole-object move: shifts both anchors and the stop together by the same
 * time/price delta, preserving entry/target/stop's relative distances.
 */
export function movePositionBody(
  p1: MarketPoint,
  p2: MarketPoint,
  stop: number | undefined,
  dt: number,
  dp: number,
): { p1: MarketPoint; p2: MarketPoint; stop: number | undefined } {
  return {
    p1: { time: p1.time + dt, price: p1.price + dp },
    p2: { time: p2.time + dt, price: p2.price + dp },
    stop: stop != null ? stop + dp : stop,
  };
}

// ---- Cycles: Cyclic Lines / Time Cycles / Sine Line (Phase 3D-3) ----------
//
// Cyclic Lines and Time Cycles are both defined by two anchors establishing
// ONE base interval (`Math.abs(p2.time - p1.time)`, computed inline at each
// call site — not worth its own one-line wrapper) — StudioChart.tsx's
// paint/hit-test code for both reads that same interval, only the REPEAT
// POLICY differs (see each function's own doc comment for why that's a real
// behavioral distinction, not a cosmetic one).

/** Every repeated Cyclic-Lines TIME within [rangeStart, rangeEnd], anchored
 * at `anchorTime` and spaced by `interval`. Cyclic Lines' whole identity is
 * "repeats indefinitely across the ENTIRE visible chart in both
 * directions" — unlike Time Cycles below, there's no fixed count. Guards a
 * degenerate (non-positive) interval or empty range by returning just the
 * anchor, never an infinite loop. Reversed anchors produce the IDENTICAL
 * grid: p1 and p2 are themselves exactly one interval apart, so either
 * one's time already sits on the same absolute grid — this function only
 * ever reads `anchorTime` (typically p1.time), never which anchor was
 * placed first. */
export function cyclicLineTimes(anchorTime: number, interval: number, rangeStart: number, rangeEnd: number): number[] {
  if (!(interval > 0) || !(rangeEnd > rangeStart)) return [anchorTime];
  const firstK = Math.ceil((rangeStart - anchorTime) / interval);
  const lastK = Math.floor((rangeEnd - anchorTime) / interval);
  const times: number[] = [];
  for (let k = firstK; k <= lastK; k++) times.push(anchorTime + k * interval);
  return times;
}

/** Time Cycles' own repeat policy — DELIBERATELY different from Cyclic
 * Lines above even though both read the exact same interval: a FIXED count
 * of cycles forward from the anchor only, never backward, never tied to
 * the visible range. This IS the real behavioral distinction between the
 * two TradingView tools (not a style difference), so it's a genuine second
 * function rather than a parameterized wrapper around cyclicLineTimes.
 * `count` defaults to 5 — TradingView's own default cycle count. */
export function timeCyclesTimes(anchorTime: number, interval: number, count = 5): number[] {
  if (!(interval > 0)) return [anchorTime];
  const times: number[] = [anchorTime];
  for (let k = 1; k <= count; k++) times.push(anchorTime + k * interval);
  return times;
}

/** Sine Line's genuine deterministic parametric curve. The two defining
 * anchors are a TROUGH (earlier in time, at baseline - amplitude) and the
 * very next PEAK (later in time, at baseline + amplitude) — half a period
 * apart — so BOTH anchors sit exactly ON the rendered curve, unlike a naive
 * "amplitude from price delta, period from time delta" formula where
 * neither endpoint would actually lie on the curve. Reversed anchors (p2
 * earlier than p1) are normalized internally rather than requiring the
 * caller to sort them first. Extends `extraHalfPeriods` beyond the defining
 * pair on each side (a fixed, reasonable default — same "fixed sampling
 * budget, smooth without excessive CPU" philosophy as geometry.ts's
 * `fibSpiralPoints` and its own `turns` parameter) so the drawing reads as
 * a genuine repeating wave, not one isolated hump. Returns MARKET-coordinate
 * points, never pixels — StudioChart.tsx converts to pixels only at
 * render/hit-test time. */
export function sineLinePoints(
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  extraHalfPeriods = 3,
  stepsPerHalfPeriod = 24,
): { time: number; price: number }[] {
  const early = p1.time <= p2.time ? p1 : p2;
  const late = p1.time <= p2.time ? p2 : p1;
  const halfPeriod = late.time - early.time;
  if (!(halfPeriod > 0)) return [p1, p2];
  const baseline = (early.price + late.price) / 2;
  const amplitude = (late.price - early.price) / 2;
  const totalHalfPeriods = 1 + extraHalfPeriods * 2;
  const startTime = early.time - extraHalfPeriods * halfPeriod;
  const totalSteps = Math.max(1, Math.round(totalHalfPeriods * stepsPerHalfPeriod));
  const points: { time: number; price: number }[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = startTime + (i / stepsPerHalfPeriod) * halfPeriod;
    const phase = (t - early.time) / halfPeriod;
    const price = baseline - amplitude * Math.cos(phase * Math.PI);
    points.push({ time: t, price });
  }
  return points;
}

// ---- Gann: Box / Square Fixed / Square / Fan (Phase 3D-4) -----------------
//
// Gann Box, Gann Square Fixed, and Gann Square are all "a box divided into
// N equal parts on each axis, plus its two corner-to-corner diagonals" —
// ONE shared grid primitive (gannGridFractions) backs all three; they only
// differ in how their defining p1/p2 anchors get established (a drag for
// Box/Square, a single click with an auto-computed default size for Square
// Fixed — see gannSquareFixedCorner). Gann Fan is mathematically distinct
// (real sloped rays, not a grid) but reuses the exact same `FibLevel`
// enable/color/custom-value model every other fan tool already has.

/** Evenly-spaced fractional grid lines (0..1 inclusive) for Gann Box/Square
 * Fixed/Square's internal division grid — shared by all three since they're
 * all the same "box divided into N equal parts" geometry. `divisions`
 * defaults to 4 (TradingView's own default: quarters). The 0 and 1
 * fractions ARE the box's own outer border, so callers never need a
 * separate "stroke the box outline" step. */
export function gannGridFractions(divisions = 4): number[] {
  if (!(divisions > 0)) return [0, 1];
  const fractions: number[] = [];
  for (let i = 0; i <= divisions; i++) fractions.push(i / divisions);
  return fractions;
}

/** Gann Square Fixed's default second corner. Unlike Gann Square/Gann Box
 * (dragged, so p2 comes directly from the user), Gann Square Fixed is a
 * single-click tool — its box size has to come from somewhere.
 * StudioChart.tsx's onDown computes `timeExtent`/`priceExtent` from the
 * CURRENT pixel-per-bar/price-per-pixel scale (so the box reads as roughly
 * square in screen space at the moment of creation) and passes them in
 * already converted to market units — this function just adds them to the
 * anchor. The result is then stored as an ordinary, fixed, independently
 * editable market-coordinate p1/p2 pair afterward, exactly like Gann
 * Square — "Fixed" describes CREATION behavior (no drag needed), not an
 * ongoing pixel-space exception to canonical market-coordinate storage. */
export function gannSquareFixedCorner(
  anchor: { time: number; price: number },
  timeExtent: number,
  priceExtent: number,
): { time: number; price: number } {
  return { time: anchor.time + timeExtent, price: anchor.price + priceExtent };
}

export type GannFanRatio = { value: number; label: string };

/** The nine conventional Gann Fan angle ratios, expressed as multipliers of
 * the tool's own p1->p2 "1x1" rate (see gannFanSlope) — "2x1" is twice as
 * steep as the user's own drawn angle, "1x2" is half as steep, and so on.
 * `value` doubles as the FibLevel-compatible value this tool's `levels`
 * capability reads/writes (enable/color/custom-value all reuse the exact
 * same machinery every other fan tool already has); `label` is only for
 * the canvas ray label (see StudioChart.tsx's paintGannFan and
 * gannFanRatioLabel below) — the generic Levels settings list formats
 * `value` as a plain ratio/percentage like every other fan tool, same as
 * every prior phase's fan tools. */
export const GANN_FAN_RATIOS: GannFanRatio[] = [
  { value: 1 / 8, label: "1x8" },
  { value: 1 / 4, label: "1x4" },
  { value: 1 / 3, label: "1x3" },
  { value: 1 / 2, label: "1x2" },
  { value: 1, label: "1x1" },
  { value: 2, label: "2x1" },
  { value: 3, label: "3x1" },
  { value: 4, label: "4x1" },
  { value: 8, label: "8x1" },
];

/** Default `FibLevel[]` for Gann Fan — one enabled level per ratio above. */
export const GANN_FAN_DEFAULT_LEVELS: FibLevel[] = GANN_FAN_RATIOS.map((r) => ({ value: r.value, enabled: true }));

/** One Gann Fan ray's slope (price-per-time), given the base "1x1" rate
 * defined by the tool's own two anchors (dp/dt from p1 to p2) and one
 * ratio multiplier. This is the fundamental thing that makes a Gann Fan
 * mathematically distinct from Fib Speed Resistance Fan: each ray here is
 * a real sloped line continuing indefinitely from p1 at `baseRate *
 * multiplier`, never a ray toward one fixed fractional target price at
 * p2's fixed time. */
export function gannFanSlope(baseRate: number, multiplier: number): number {
  return baseRate * multiplier;
}

/** Canvas label for a Gann Fan ratio value (e.g. 2 -> "2x1", 0.25 ->
 * "1x4") — looked up from GANN_FAN_RATIOS by value rather than
 * reconstructed from scratch, so a custom/unrecognized level (added via
 * the generic "add level" input) degrades to a plain decimal instead of a
 * wrong label. */
export function gannFanRatioLabel(value: number): string {
  const known = GANN_FAN_RATIOS.find((r) => Math.abs(r.value - value) < 1e-9);
  return known ? known.label : String(value);
}

// ---- Regression Trend (Phase 3D-5) -----------------------------------------

export type RegressionResult = { slope: number; intercept: number; stdDev: number };

/** Ordinary least-squares linear regression over (time, value) points —
 * Regression Trend's actual math, not a generic channel substitute. `slope`/
 * `intercept` describe the fitted line (`value = slope*time + intercept`);
 * `stdDev` is the population standard deviation of the RESIDUALS
 * (actual - predicted), used to offset the channel's upper/lower bounds by
 * a multiple of it — the conventional "regression channel" construction. */
export function computeLinearRegression(points: { time: number; value: number }[]): RegressionResult {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, stdDev: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].value, stdDev: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.time;
    sumY += p.value;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.time - meanX) * (p.value - meanY);
    den += (p.time - meanX) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  let sumSqResid = 0;
  for (const p of points) {
    const predicted = slope * p.time + intercept;
    sumSqResid += (p.value - predicted) ** 2;
  }
  const stdDev = Math.sqrt(sumSqResid / n);
  return { slope, intercept, stdDev };
}

// ---- Pitchfork family (Phase 3D-5) -----------------------------------------
//
// Standard (Andrews'), Schiff, Modified Schiff, and Inside Pitchfork share
// ONE geometry model instead of four renderers — all built from
// `lerpMarketPoint`'s existing midpoint math (t=0.5) applied to a different
// combination of the three defining anchors P0/P1/P2:
//   - standard: median runs P0 -> midpoint(P1,P2); outer teeth pass through
//     P1 and P2, parallel to the median.
//   - schiff: median origin shifts to midpoint(P0,P1) (same target/teeth as
//     standard) — the well-known "Schiff" variant.
//   - modified-schiff: median origin shifts further, to the midpoint of P0
//     and the standard target (midpoint(P1,P2)).
//   - inside: swaps which point is the pivot — P1 becomes the origin, P0/P2
//     become the outer teeth anchors, target becomes midpoint(P0,P2).
// These are commonly-cited definitions for each variant, not an
// automatically-validated "correct" pattern — like every other manual
// pattern tool in this app, the drawing works regardless of whether it
// matches a textbook example.

export type PitchforkVariant = "standard" | "schiff" | "modified-schiff" | "inside";

export function pitchforkHandle(
  p0: { time: number; price: number },
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  variant: PitchforkVariant,
): { time: number; price: number } {
  if (variant === "inside") return p1;
  if (variant === "schiff") return lerpMarketPoint(p0, p1, 0.5);
  if (variant === "modified-schiff") return lerpMarketPoint(p0, lerpMarketPoint(p1, p2, 0.5), 0.5);
  return p0;
}

export function pitchforkTarget(
  p0: { time: number; price: number },
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  variant: PitchforkVariant,
): { time: number; price: number } {
  if (variant === "inside") return lerpMarketPoint(p0, p2, 0.5);
  return lerpMarketPoint(p1, p2, 0.5);
}

export function pitchforkTeethAnchors(
  p0: { time: number; price: number },
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  variant: PitchforkVariant,
): [{ time: number; price: number }, { time: number; price: number }] {
  return variant === "inside" ? [p0, p2] : [p1, p2];
}

// ---- Bars Pattern (Phase 3D-8) ---------------------------------------------

export type CapturedPattern = { deltas: number[]; barInterval: number };

/** Captures a genuine RELATIVE price pattern from the actual loaded bars
 * within [startTime, endTime] — close-price deltas from the first bar in
 * range, not full OHLC (keeps the persisted drawing lightweight per the
 * phase brief's "avoid duplicating full market data unnecessarily", while
 * still being a real captured pattern, not a generic polyline). `deltas[0]`
 * is always 0 (the first bar IS the base). Capped at `maxPoints` so an
 * accidentally huge drag never balloons the drawing's persisted size.
 * StudioChart.tsx projects this forward from the tool's own p2 anchor using
 * `barInterval` for even time-spacing — see paintBarsPattern. */
export function captureRelativePattern(
  bars: { time: number; close: number }[],
  startTime: number,
  endTime: number,
  maxPoints = 200,
): CapturedPattern {
  const lo = Math.min(startTime, endTime);
  const hi = Math.max(startTime, endTime);
  const inRange = bars.filter((b) => b.time >= lo && b.time <= hi).slice(0, maxPoints);
  if (inRange.length === 0) return { deltas: [], barInterval: 0 };
  const base = inRange[0].close;
  const barInterval = inRange.length > 1 ? inRange[1].time - inRange[0].time : 0;
  return { deltas: inRange.map((b) => b.close - base), barInterval };
}

// ---- Measurers: Price Range / Date Range / Date + Price Range (Phase 3D-10)
//
// Both Price Range and Date Range's own math were already inlined directly
// in StudioChart.tsx's render loop (correct, but neither testable in
// isolation nor reusable) — extracted here as pure functions so Date +
// Price Range can call the SAME two, rather than a third copy of either
// calculation.

export type PriceRangeResult = {
  startPrice: number;
  endPrice: number;
  /** Signed: positive for a price INCREASE from start to end. */
  diff: number;
  /** Signed percent, e.g. 12.34 for +12.34%. 0 when startPrice is 0 (never divides by zero). */
  pct: number;
  direction: 1 | -1 | 0;
  /** Whole ticks the move represents, or null when no reliable tickSize was
   * given — NEVER a fabricated default; the caller decides what "no tick
   * data" should display. */
  ticks: number | null;
};

/** Price Range's actual math: p1/p2 are taken exactly as drawn (never
 * normalized/reordered) — dragging from a high down to a low vs. a low up
 * to a high are DIFFERENT, meaningful measurements (the sign of `diff`/
 * `direction` is the whole point), unlike Date Range's time span below. */
export function computePriceRange(startPrice: number, endPrice: number, tickSize?: number): PriceRangeResult {
  const diff = endPrice - startPrice;
  const pct = startPrice !== 0 ? (diff / startPrice) * 100 : 0;
  const direction: 1 | -1 | 0 = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  const ticks = tickSize != null && tickSize > 0 ? Math.round(Math.abs(diff) / tickSize) : null;
  return { startPrice, endPrice, diff, pct, direction, ticks };
}

export type DateRangeResult = {
  /** Always the EARLIER of the two anchor times — a duration/date range
   * doesn't have a meaningful "sign" the way a price move does, so
   * (unlike computePriceRange) these ARE normalized regardless of which
   * anchor the user dragged first. */
  startTime: number;
  endTime: number;
  /** Always >= 0. */
  elapsedSeconds: number;
  /** Bar-index distance via the SAME gap-aware logical-index math
   * (timeToLogicalExtrapolated) every other pan/zoom-correct drawing tool
   * in this codebase already uses — correctly reflects missing sessions/
   * weekends/holidays rather than assuming uniform calendar spacing, and
   * still returns a sensible value for anchors placed beyond the loaded
   * history (extrapolated from the average bar interval). Null only when
   * no bars are loaded at all yet. */
  barCount: number | null;
};

export function computeDateRange(bars: Bar[], time1: number, time2: number): DateRangeResult {
  const startTime = Math.min(time1, time2);
  const endTime = Math.max(time1, time2);
  const elapsedSeconds = endTime - startTime;
  const barCount = bars.length > 0 ? Math.round(Math.abs(timeToLogicalExtrapolated(bars, endTime) - timeToLogicalExtrapolated(bars, startTime))) : null;
  return { startTime, endTime, elapsedSeconds, barCount };
}
