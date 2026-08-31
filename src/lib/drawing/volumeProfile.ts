/**
 * Phase 3B: real chart-data-driven Volume Profile calculation for the two
 * drawing tools (Fixed Range Volume Profile / Anchored Volume Profile) —
 * resolves a drawing's TIME-based range/anchor into an actual bar-index
 * window, then reuses the exact same engines the existing Volume Profile
 * WIDGET already uses (`VolumeProfilePanel.tsx`):
 *
 *  - `volumeProfile()` (src/lib/sgscript/stdlib.ts) — the OHLCV-bar-range
 *    binning engine that also backs SGScript's own `volumeProfile(...)`
 *    primitive. It already takes plain `high`/`low`/`volume` arrays plus a
 *    `[from, to]` bar-INDEX window, so it was already decoupled from the
 *    widget and needed no extraction to reuse here.
 *  - `computeValueArea()` (src/lib/workspace/volumeProfileMath.ts) — POC/VAH/
 *    VAL over whatever bins were computed above. Also already a pure,
 *    widget-independent function.
 *
 * This module's only real job, and the one thing neither of those existing
 * engines does, is the TIME -> bar-index resolution: a drawing's anchors are
 * stored as market coordinates (unix-second times), never raw indices or
 * pixels (see geometry.ts's module doc for why), so this is where "which
 * bars fall inside the user's selected range" gets decided. Pure functions
 * only — no React, no DOM, no lightweight-charts — directly unit-testable
 * and safe to call from both StudioChart's render loop and its hit-test.
 */

import type { Bar } from "./geometry";
import { volumeProfile as binVolumeProfile } from "@/lib/sgscript/stdlib";
import { computeValueArea, type ValueArea, type VolumeProfileBin } from "@/lib/workspace/volumeProfileMath";

export type DrawingVolumeProfileResult = {
  bins: VolumeProfileBin[];
  valueArea: ValueArea;
  /** Bar-array indices actually included (inclusive), or -1/-1 if none. */
  fromIdx: number;
  toIdx: number;
  barCount: number;
};

function emptyResult(): DrawingVolumeProfileResult {
  return { bins: [], valueArea: computeValueArea([], 0), fromIdx: -1, toIdx: -1, barCount: 0 };
}

/** Every bar whose own time falls within [min(startTime,endTime),
 * max(startTime,endTime)] inclusive — order-independent, since a drawing's
 * two anchors can be dragged past each other (start after end). A bar
 * exactly on either boundary is included (a Fixed Range box drawn edge-to-
 * edge on two candles should include both of them, not just the bars
 * strictly between them). */
function resolveTimeRange(bars: Bar[], startTime: number, endTime: number): { fromIdx: number; toIdx: number } | null {
  if (bars.length === 0) return null;
  const lo = Math.min(startTime, endTime);
  const hi = Math.max(startTime, endTime);
  let fromIdx = -1;
  let toIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].time >= lo && bars[i].time <= hi) {
      if (fromIdx === -1) fromIdx = i;
      toIdx = i;
    }
  }
  if (fromIdx === -1) return null;
  return { fromIdx, toIdx };
}

function computeFromRange(bars: Bar[], fromIdx: number, toIdx: number, rows: number, valueAreaPct: number): DrawingVolumeProfileResult {
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const volume = bars.map((b) => b.volume);
  const bins = binVolumeProfile(high, low, volume, fromIdx, toIdx, Math.max(2, Math.round(rows)));
  return {
    bins,
    valueArea: computeValueArea(bins, valueAreaPct),
    fromIdx,
    toIdx,
    barCount: toIdx - fromIdx + 1,
  };
}

/**
 * Fixed Range Volume Profile: only the bars whose time falls inside the
 * user's selected [startTime, endTime] window (inclusive of the boundary
 * bars) are ever included — bars outside the range never contribute,
 * regardless of how much history is loaded either side of it.
 */
export function computeFixedRangeVolumeProfile(
  bars: Bar[],
  startTime: number,
  endTime: number,
  rows: number,
  valueAreaPct: number,
): DrawingVolumeProfileResult {
  const range = resolveTimeRange(bars, startTime, endTime);
  if (!range) return emptyResult();
  return computeFromRange(bars, range.fromIdx, range.toIdx, rows, valueAreaPct);
}

/**
 * Anchored Volume Profile: from the first loaded bar at-or-after
 * `anchorTime` through the most recent/rightmost loaded bar — the standard
 * "anchored to now" convention. Recomputes fresh from the anchor every call
 * (no running/incremental state to desync), so as more bars load the same
 * anchor naturally picks up the newly-extended range on the next call — the
 * anchor itself (a TIME, never a bar index) never moves.
 */
export function computeAnchoredVolumeProfile(
  bars: Bar[],
  anchorTime: number,
  rows: number,
  valueAreaPct: number,
): DrawingVolumeProfileResult {
  if (bars.length === 0) return emptyResult();
  const fromIdx = bars.findIndex((b) => b.time >= anchorTime);
  if (fromIdx === -1) return emptyResult(); // anchor is after every loaded bar
  const toIdx = bars.length - 1;
  return computeFromRange(bars, fromIdx, toIdx, rows, valueAreaPct);
}
