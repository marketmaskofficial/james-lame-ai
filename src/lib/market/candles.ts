/**
 * Candle hygiene helpers shared by every market-data provider adapter.
 *
 * The chart is only trustworthy if the bar array is: sorted ascending, free of
 * duplicate timestamps, aligned to real timeframe boundaries, and never mixed
 * across symbol/timeframe switches. All of that logic lives here so a future
 * futures/stocks/forex adapter inherits it for free.
 *
 * Nothing in here fabricates, smooths, or interpolates prices — it only orders,
 * de-duplicates and merges values that the provider actually returned.
 */

import type { Bar } from "@/lib/sgscript/types";

const UNIT_SECONDS: Record<string, number> = {
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/** Seconds in one bar of `interval` ("5m", "4h", "1d", "1w"). 1M is variable. */
export function intervalSeconds(interval: string): number | null {
  const m = /^(\d+)([mhdw])$/.exec(interval);
  if (!m) return null; // "1M" (calendar month) has no fixed length
  return Number(m[1]) * (UNIT_SECONDS[m[2]] ?? 0);
}

/** Open timestamp of the bar that contains `timeSec`. */
export function barOpenTime(timeSec: number, interval: string): number {
  const step = intervalSeconds(interval);
  if (!step) return timeSec;
  return Math.floor(timeSec / step) * step;
}

const finite = (n: number) => Number.isFinite(n);

function valid(b: Bar): boolean {
  return (
    finite(b.time) &&
    b.time > 0 &&
    finite(b.open) &&
    finite(b.high) &&
    finite(b.low) &&
    finite(b.close) &&
    b.high >= b.low
  );
}

/**
 * Sort ascending, drop malformed rows, and collapse duplicate timestamps
 * keeping the most recent version of each bar (providers re-send the forming
 * candle on reconnect).
 */
export function normalizeBars(bars: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const b of bars) {
    if (!valid(b)) continue;
    byTime.set(b.time, b);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Merge a realtime bar into history.
 * - equal timestamp  -> replace the forming candle in place
 * - newer timestamp  -> append (a new interval started)
 * - older timestamp  -> patch that historical bar if it exists, else ignore
 *   (never re-append out of order)
 */
export function mergeLiveBar(prev: Bar[], bar: Bar, maxBars = 5000): Bar[] {
  if (!valid(bar) || prev.length === 0) return prev;
  const last = prev[prev.length - 1];
  if (bar.time === last.time) {
    const next = prev.slice();
    next[next.length - 1] = bar;
    return next;
  }
  if (bar.time > last.time) {
    const next = [...prev, bar];
    return next.length > maxBars ? next.slice(-maxBars) : next;
  }
  const idx = prev.findIndex((b) => b.time === bar.time);
  if (idx === -1) return prev;
  const next = prev.slice();
  next[idx] = bar;
  return next;
}

/** Prepend older history without duplicating or reordering existing bars. */
export function prependBars(older: Bar[], current: Bar[]): Bar[] {
  if (!older.length) return current;
  if (!current.length) return normalizeBars(older);
  const firstTime = current[0].time;
  const head = normalizeBars(older).filter((b) => b.time < firstTime);
  return head.concat(current);
}

/** True when the newest bar is older than one full interval (stale feed). */
export function isStale(bars: Bar[], interval: string, nowSec: number): boolean {
  const step = intervalSeconds(interval);
  if (!step || !bars.length) return false;
  return nowSec - bars[bars.length - 1].time > step * 2;
}
