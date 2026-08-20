// Coverage for UI-4h-5 (Market / Session Statistics widget)'s pure logic:
// src/lib/workspace/marketStats.ts. Uses constructed bars with known UTC
// timestamps (not live fetched data) so session-bucket boundaries can be
// verified exactly, deterministically, with no network dependency — the
// interactive Playwright pass separately cross-checks this same logic
// against a real bound chart's live bars.
//
// Usage: npx tsx test/workspace/marketStats.test.mjs

import { computeMarketStats, SESSION_UTC_HOURS } from "../../src/lib/workspace/marketStats.ts";
import { atr as atrSeries } from "../../src/lib/sgscript/stdlib.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

function closeTo(name, actual, expected, eps = 1e-6) {
  if (Math.abs(actual - expected) <= eps) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected ~${expected}\n  actual:   ${actual}`);
  }
}

// Documented convention, asserted so a silent edit can't drift without
// breaking this test: Asia 00-09 UTC, London 08-17 UTC, New York 13-22 UTC.
check("SESSION_UTC_HOURS.asia", SESSION_UTC_HOURS.asia, { startHour: 0, endHour: 9 });
check("SESSION_UTC_HOURS.london", SESSION_UTC_HOURS.london, { startHour: 8, endHour: 17 });
check("SESSION_UTC_HOURS.newyork", SESSION_UTC_HOURS.newyork, { startHour: 13, endHour: 22 });

const DAY0 = Date.UTC(2024, 0, 1) / 1000; // 2024-01-01T00:00:00Z
const DAY1 = Date.UTC(2024, 0, 2) / 1000; // 2024-01-02T00:00:00Z

// Previous (full) day: 24 hourly bars, hour h -> open=h, high=h+2, low=h-1, close=h+1, volume=10+h.
const prevDayBars = Array.from({ length: 24 }, (_, h) => ({
  time: DAY0 + h * 3600,
  open: h,
  high: h + 2,
  low: h - 1,
  close: h + 1,
  volume: 10 + h,
}));

// Current day so far: hourly bars 0..15, hour h -> open=100+h, high=+2, low=-1, close=+1, volume=10+h.
const currentDayBars = Array.from({ length: 16 }, (_, h) => ({
  time: DAY1 + h * 3600,
  open: 100 + h,
  high: 100 + h + 2,
  low: 100 + h - 1,
  close: 100 + h + 1,
  volume: 10 + h,
}));

const bars = [...prevDayBars, ...currentDayBars];
// "Now" = 2024-01-02T15:30:00Z — mid-way through hour 15, the last loaded bar.
const NOW = (DAY1 + 15 * 3600 + 30 * 60) * 1000;

{
  const stats = computeMarketStats(bars, "day", NOW);
  ok("day: currentPrice is the last bar's close", stats.currentPrice === 116);
  ok("day session present", stats.session !== null);
  check("day.open", stats.session.open, 100);
  check("day.high", stats.session.high, 117);
  check("day.low", stats.session.low, 99);
  check("day.close", stats.session.close, 116);
  check("day.range", stats.session.range, 18);
  closeTo("day.changePct", stats.session.changePct, 16);
  check("day.volume", stats.session.volume, 280);
  check("day.barCount", stats.session.barCount, 16);
  closeTo("distanceFromSessionHighPct (day)", stats.distanceFromSessionHighPct, ((116 - 117) / 117) * 100);
  closeTo("distanceFromSessionLowPct (day)", stats.distanceFromSessionLowPct, ((116 - 99) / 99) * 100);
}

{
  const stats = computeMarketStats(bars, "asia", NOW);
  check("asia.open", stats.session.open, 100);
  check("asia.high", stats.session.high, 110);
  check("asia.low", stats.session.low, 99);
  check("asia.close", stats.session.close, 109);
  check("asia.range", stats.session.range, 11);
  closeTo("asia.changePct", stats.session.changePct, 9);
  check("asia.volume", stats.session.volume, 126);
  check("asia.barCount", stats.session.barCount, 9);
  // currentPrice (116) has since risen past the already-ended Asia session's
  // high (110) — distance is legitimately positive, proving this isn't
  // clamped to "always <= 0".
  closeTo("distanceFromSessionHighPct (asia, price now above ended session's high)",
    stats.distanceFromSessionHighPct, ((116 - 110) / 110) * 100);
}

{
  const stats = computeMarketStats(bars, "london", NOW);
  check("london.open", stats.session.open, 108);
  check("london.high", stats.session.high, 117);
  check("london.low", stats.session.low, 107);
  check("london.close", stats.session.close, 116);
  check("london.range", stats.session.range, 10);
  closeTo("london.changePct", stats.session.changePct, ((116 - 108) / 108) * 100);
  check("london.volume", stats.session.volume, 172);
  check("london.barCount", stats.session.barCount, 8);
}

{
  const stats = computeMarketStats(bars, "newyork", NOW);
  check("newyork.open", stats.session.open, 113);
  check("newyork.high", stats.session.high, 117);
  check("newyork.low", stats.session.low, 112);
  check("newyork.close", stats.session.close, 116);
  check("newyork.range", stats.session.range, 5);
  closeTo("newyork.changePct", stats.session.changePct, ((116 - 113) / 113) * 100);
  check("newyork.volume", stats.session.volume, 72);
  check("newyork.barCount", stats.session.barCount, 3);
}

{
  // Previous UTC day's stats are independent of which session is selected.
  const stats = computeMarketStats(bars, "day", NOW);
  ok("prevDay present", stats.prevDay !== null);
  check("prevDay.high", stats.prevDay.high, 25);
  check("prevDay.low", stats.prevDay.low, -1);
  check("prevDay.close", stats.prevDay.close, 24);
}

{
  // "Now" earlier in the current UTC day, before the New York session
  // (13:00 UTC) has started yet today — must report no session data rather
  // than fabricating a window or silently reusing yesterday's.
  const earlyNow = (DAY1 + 5 * 3600) * 1000; // 2024-01-02T05:00:00Z
  const earlyBars = [...prevDayBars, ...currentDayBars.slice(0, 6)]; // hours 0..5 only
  const stats = computeMarketStats(earlyBars, "newyork", earlyNow);
  ok("newyork session not yet started today -> null", stats.session === null);
  ok("distanceFromSessionHighPct null when no session data", stats.distanceFromSessionHighPct === null);
  ok("distanceFromSessionLowPct null when no session data", stats.distanceFromSessionLowPct === null);
}

{
  const stats = computeMarketStats([], "day", NOW);
  check("empty bars -> currentPrice 0", stats.currentPrice, 0);
  ok("empty bars -> session null", stats.session === null);
  ok("empty bars -> prevDay null", stats.prevDay === null);
  ok("empty bars -> atr null", stats.atr === null);
}

{
  // ATR reuses stdlib's existing atr() directly — same output, not a
  // reimplementation, verified by comparing against calling it ourselves.
  const stats = computeMarketStats(bars, "day", NOW);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);
  const expected = atrSeries(highs, lows, closes, 14).at(-1);
  ok("atr is a finite number", typeof stats.atr === "number" && Number.isFinite(stats.atr));
  check("atr matches stdlib's atr() directly", stats.atr, expected);
}

{
  // Fewer than 15 bars: too little history for a 14-period ATR.
  const stats = computeMarketStats(currentDayBars.slice(0, 10), "day", NOW);
  ok("atr null with < 15 bars", stats.atr === null);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
