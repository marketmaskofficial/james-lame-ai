/**
 * UI-4h-5: pure market/session statistics derived entirely from a bound
 * chart's already-real OHLCV bars (`Bar[]` — no new fetch, same convention
 * Volume Profile/Watchlist already use). No React/DOM.
 *
 * "Session" here means a UTC time-of-day bucket applied to real bars, NOT a
 * claim about actual regional exchange hours — crypto trades 24/7, so
 * "Asia"/"London"/"New York" are the standard retail-trading UTC-block
 * labels commonly used to describe when regional activity is heaviest, not
 * literal open/close times of a market. The exact ranges used (ignoring
 * daylight-saving shifts, since bars are UTC-stamped and this is a labeling
 * convention, not a precision claim):
 *   Asia:      00:00–09:00 UTC
 *   London:    08:00–17:00 UTC
 *   New York:  13:00–22:00 UTC
 * "Current Day" is simply today's full UTC calendar day so far (00:00 UTC to
 * now), not a session-hour bucket.
 */

import type { Bar } from "../sgscript/types";
import { atr as atrSeries } from "../sgscript/stdlib";

export type SessionId = "day" | "asia" | "london" | "newyork";

export const SESSION_LABELS: Record<SessionId, string> = {
  day: "Current Day",
  asia: "Asia",
  london: "London",
  newyork: "New York",
};

/** [startHour, endHour) in UTC, applied to today's UTC calendar date. `day` has no fixed hour range — it's 00:00 UTC through now. */
export const SESSION_UTC_HOURS: Partial<Record<SessionId, { startHour: number; endHour: number }>> = {
  asia: { startHour: 0, endHour: 9 },
  london: { startHour: 8, endHour: 17 },
  newyork: { startHour: 13, endHour: 22 },
};

export type SessionStats = {
  open: number;
  high: number;
  low: number;
  /** Last bar's close within the session window (not necessarily the current price — the session may have already ended). */
  close: number;
  range: number;
  changePct: number;
  volume: number;
  barCount: number;
  /** Unix seconds, the session window's [start, end) — `end` clamped to `now` if the window hasn't fully elapsed yet. */
  startTime: number;
  endTime: number;
} | null;

export type PrevDayStats = { high: number; low: number; close: number } | null;

export type MarketStats = {
  currentPrice: number;
  session: SessionStats;
  prevDay: PrevDayStats;
  /** (currentPrice - session.high) / session.high * 100 — can be positive if price has since risen past a session that already ended. Null if no session data. */
  distanceFromSessionHighPct: number | null;
  distanceFromSessionLowPct: number | null;
  /** ATR(14) over the bound chart's own native-timeframe bars (reuses stdlib's existing `atr`, not a new implementation) — null if too few bars. */
  atr: number | null;
};

const EMPTY: MarketStats = {
  currentPrice: 0,
  session: null,
  prevDay: null,
  distanceFromSessionHighPct: null,
  distanceFromSessionLowPct: null,
  atr: null,
};

/** Start of `date`'s UTC calendar day, as unix seconds. */
function utcDayStart(unixSeconds: number): number {
  const d = new Date(unixSeconds * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

function summarizeWindow(bars: Bar[], startTime: number, endTime: number): SessionStats {
  const inWindow = bars.filter((b) => b.time >= startTime && b.time < endTime);
  if (inWindow.length === 0) return null;
  const open = inWindow[0].open;
  const close = inWindow[inWindow.length - 1].close;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const b of inWindow) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volume += b.volume;
  }
  return {
    open,
    high,
    low,
    close,
    range: high - low,
    changePct: open !== 0 ? ((close - open) / open) * 100 : 0,
    volume,
    barCount: inWindow.length,
    startTime,
    endTime,
  };
}

export function computeMarketStats(bars: Bar[], session: SessionId, nowMs: number = Date.now()): MarketStats {
  if (bars.length === 0) return EMPTY;
  const nowSec = nowMs / 1000;
  const currentPrice = bars[bars.length - 1].close;
  const todayStart = utcDayStart(nowSec);

  let sessionWindow: SessionStats;
  if (session === "day") {
    sessionWindow = summarizeWindow(bars, todayStart, nowSec + 1);
  } else {
    const hours = SESSION_UTC_HOURS[session]!;
    const start = todayStart + hours.startHour * 3600;
    const end = todayStart + hours.endHour * 3600;
    sessionWindow = summarizeWindow(bars, start, Math.min(end, nowSec + 1));
  }

  const prevDayStart = todayStart - 86400;
  const prevDayWindow = summarizeWindow(bars, prevDayStart, todayStart);
  const prevDay: PrevDayStats = prevDayWindow
    ? { high: prevDayWindow.high, low: prevDayWindow.low, close: prevDayWindow.close }
    : null;

  const distanceFromSessionHighPct = sessionWindow
    ? ((currentPrice - sessionWindow.high) / sessionWindow.high) * 100
    : null;
  const distanceFromSessionLowPct = sessionWindow
    ? ((currentPrice - sessionWindow.low) / sessionWindow.low) * 100
    : null;

  let atr: number | null = null;
  if (bars.length >= 15) {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const series = atrSeries(highs, lows, closes, 14);
    const last = series[series.length - 1];
    atr = Number.isFinite(last) ? last : null;
  }

  return {
    currentPrice,
    session: sessionWindow,
    prevDay,
    distanceFromSessionHighPct,
    distanceFromSessionLowPct,
    atr,
  };
}
