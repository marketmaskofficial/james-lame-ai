/**
 * Chart Studio drawing tools — market-coordinate <-> bar-index conversion,
 * magnet/snap, and a couple of small geometry helpers.
 *
 * Root problem this exists to fix: before this phase, user-drawn objects
 * (StudioChart's `Drawing` type) stored their anchors as `{ logical, price }`
 * — a *bar-array-index* position, captured once at draw time via
 * `chart.timeScale().coordinateToLogical()` and then used forever after as
 * the drawing's authoritative location. That index is only stable as long as
 * bar #0 stays bar #0. `loadOlderHistory` (studio.tsx) calls
 * `prependBars()` (src/lib/market/candles.ts), which — as its name says —
 * prepends older candles to the FRONT of the array. Every bar after the
 * prepended ones shifts to a higher index, so every existing drawing
 * anchored by logical index silently jumps to a different bar/time the next
 * time older history loads, with no error and no visual cue why.
 *
 * Indicator-drawn primitives (boxes/lines/labels from `RunResult`) never had
 * this bug because they're anchored by bar TIME (unix seconds) and converted
 * to a pixel position fresh every render frame via the time->logical->pixel
 * pipeline in StudioChart's `timeToLogical`/`logicalToPixel`. This module
 * gives user-drawn objects the same treatment: anchors are stored as
 * `{ time, price }` (a real "market coordinate", never a raw screen pixel or
 * an index into whatever the bars array happens to look like right now), and
 * `timeToLogicalExtrapolated` re-derives a fresh logical/pixel position from
 * that time on every frame — the exact fix `timeToLogical` already got for
 * off-screen indicator objects, generalized so it never returns null (a
 * drawing anchored just past the last loaded bar, e.g. a ray drawn into the
 * empty space ahead of price, still needs a real coordinate to render at).
 *
 * `logicalToTime` is the other direction, used once at creation/drag time to
 * convert a raw pointer position (which lightweight-charts only gives you as
 * a logical index) into the time value that gets persisted.
 *
 * Pure functions only — no React, no DOM, no lightweight-charts import — so
 * this is directly unit-testable and reusable from anywhere (StudioChart's
 * render loop, pointer handlers, and the drawing math tests).
 */

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketPoint = { time: number; price: number };

/** Average seconds between consecutive bars — the extrapolation step for
 * positions outside the loaded range. Falls back to 60s for <2 bars (can't
 * measure spacing yet) since that's only ever used transiently before real
 * data loads. */
export function avgBarInterval(bars: Bar[]): number {
  if (bars.length < 2) return 60;
  return (bars[bars.length - 1].time - bars[0].time) / (bars.length - 1);
}

/**
 * Converts a (possibly fractional, possibly out-of-range) logical bar index
 * into a real unix-second time, interpolating between the two bracketing
 * bars in range and linearly extrapolating past either edge using the
 * dataset's own average bar spacing. Never returns null — every logical
 * position on a chart with at least one loaded bar maps to *some* time.
 */
export function logicalToTime(bars: Bar[], logical: number): number {
  if (bars.length === 0) return Math.floor(Date.now() / 1000);
  const n = bars.length;
  const step = avgBarInterval(bars);
  if (n === 1) return bars[0].time + logical * step;
  if (logical <= 0) return bars[0].time + logical * step;
  if (logical >= n - 1) return bars[n - 1].time + (logical - (n - 1)) * step;
  const lo = Math.floor(logical);
  const hi = Math.min(lo + 1, n - 1);
  const frac = logical - lo;
  return bars[lo].time + (bars[hi].time - bars[lo].time) * frac;
}

/**
 * Inverse of `logicalToTime`, extended to always succeed (unlike
 * StudioChart's own `timeToLogical`, which intentionally returns null for a
 * time far outside the loaded range — the right call for an *indicator*
 * result that shouldn't paint a misleading box at the chart's edge, but
 * wrong for a *user's own drawing*, which must keep rendering at a
 * consistent, correctly-extrapolated position even when panned somewhere
 * the underlying time isn't currently loaded).
 */
export function timeToLogicalExtrapolated(bars: Bar[], time: number): number {
  if (bars.length === 0) return 0;
  const n = bars.length;
  const step = avgBarInterval(bars);
  if (n === 1) return step > 0 ? (time - bars[0].time) / step : 0;
  if (time <= bars[0].time) return step > 0 ? (time - bars[0].time) / step : 0;
  if (time >= bars[n - 1].time) return n - 1 + (step > 0 ? (time - bars[n - 1].time) / step : 0);
  // Binary search for the bracketing pair, then interpolate.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const span = bars[hi].time - bars[lo].time;
  const frac = span > 0 ? (time - bars[lo].time) / span : 0;
  return lo + frac;
}

/** Index of the bar whose time is closest to `time` (empty bars -> -1). */
export function nearestBarIndex(bars: Bar[], time: number): number {
  if (bars.length === 0) return -1;
  let lo = 0;
  let hi = bars.length - 1;
  if (time <= bars[0].time) return 0;
  if (time >= bars[hi].time) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time === time) return mid;
    if (bars[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  const a = Math.max(0, lo - 1);
  return Math.abs(bars[a].time - time) <= Math.abs(bars[lo].time - time) ? a : lo;
}

/**
 * Magnet/snap: pulls a raw market point onto the nearest bar's own time, and
 * (when `strength !== "off"`) onto whichever of that bar's O/H/L/C sits
 * closest to the raw price. "off" returns the point completely untouched —
 * per spec, disabling the magnet must never silently alter a user's chosen
 * coordinate, including the time component snapping to the bar grid.
 */
export function snapPoint(
  bars: Bar[],
  raw: MarketPoint,
  strength: "off" | "weak" | "strong",
): MarketPoint {
  if (strength === "off" || bars.length === 0) return raw;
  const idx = nearestBarIndex(bars, raw.time);
  if (idx < 0) return raw;
  const bar = bars[idx];
  const candidates = [bar.open, bar.high, bar.low, bar.close];
  let best = candidates[0];
  let bestDist = Math.abs(candidates[0] - raw.price);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(c - raw.price);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  // "weak" only snaps once the raw price is already close (within 25% of the
  // bar's own high-low range) — "strong" always snaps to the nearest of the
  // four OHLC prices regardless of distance. Both always snap time to the bar.
  if (strength === "weak") {
    const range = Math.max(1e-9, bar.high - bar.low);
    if (bestDist > range * 0.25) return { time: bar.time, price: raw.price };
  }
  return { time: bar.time, price: best };
}

/** Euclidean pixel distance — small shared helper for hit-testing. */
export function pixelDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Point-to-segment distance in pixel space, for hit-testing lines/rays/brush strokes. */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return pixelDist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return pixelDist(px, py, x1 + t * dx, y1 + t * dy);
}

/**
 * Projects the line through (x1,y1)->(x2,y2) forward past p2, out to the
 * canvas's right edge (`width`) — the Ray tool's existing extension math,
 * pulled out into a pure/testable helper so Extended Line (which needs the
 * SAME forward projection plus a backward one) doesn't fork a second copy of
 * it. Only extends when the edge is actually further from p1 than p2 is in
 * that same direction (`scale > 1`) — a line trending away from the edge
 * stays at its own p2, exactly like Ray already behaves.
 */
export function projectLineForward(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const scale = dx === 0 ? 1 : (width - x1) / dx;
  if (scale > 1) return { x: x1 + dx * scale, y: y1 + dy * scale };
  return { x: x2, y: y2 };
}

/**
 * Mirror of `projectLineForward` for the backward direction (past p1, out to
 * the canvas's left edge, x=0) — Extended Line's other half. Never used by
 * Ray (which only ever extends forward/"into the future").
 */
export function projectLineBackward(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const scale = dx === 0 ? 0 : (0 - x1) / dx;
  if (scale < 0) return { x: x1 + dx * scale, y: y1 + dy * scale };
  return { x: x1, y: y1 };
}

/**
 * True if (px,py) lies inside (or exactly on) the axis-aligned ellipse
 * centered at (cx,cy) with radii (rx,ry) — Phase 3A's Ellipse hit-test
 * region. Deliberately a real interior test (same "click anywhere inside a
 * filled shape selects it" convention StudioChart's own `pointInTriangle`
 * already uses), NOT the looser rectangular-bounding-box shortcut Circle/
 * Rect share — an ellipse's corners are empty space, and a box hit-test over
 * those corners would be an "oversized rectangular hit region" the phase
 * brief explicitly calls out to avoid for Ellipse specifically.
 */
export function pointInEllipse(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  const safeRx = Math.max(1e-9, rx);
  const safeRy = Math.max(1e-9, ry);
  const nx = (px - cx) / safeRx;
  const ny = (py - cy) / safeRy;
  return nx * nx + ny * ny <= 1;
}

/**
 * True if (px,py) lies inside the closed polygon defined by `pts` (standard
 * even-odd ray-casting test). Path's fill-interior hit-test region — the
 * same interior-click convention as `pointInEllipse`/`pointInTriangle`,
 * generalized to an arbitrary vertex count instead of exactly three, so a
 * closed/filled Path is selectable anywhere inside it, not just within a few
 * pixels of its outline.
 */
export function pointInPolygon(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
