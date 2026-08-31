// Coverage for the Trading Dashboard's pure analytics (Phase 4A):
// src/lib/dashboard/metrics.ts. No React, no DOM, no live Supabase — this
// exercises the exact functions the dashboard route calls, plus a
// reference-model check of the `v_closed_trades` SQL view's own derivation
// logic (closed-only filtering, commission aggregation, exit-price
// derivation), since this test suite has no live Postgres connection to
// exercise the actual deployed view or its RLS policies directly — that
// requires a real Supabase instance and is out of scope here. What IS
// covered here is that the JOIN/AGGREGATION ALGORITHM itself (which the SQL
// migration is hand-verified against) never mixes data across positions or
// accounts, and that a real Postgres `security_invoker` view over
// `trade_positions`/`trade_executions` (both already RLS'd
// `USING (auth.uid() = user_id)`) enforces per-user isolation by
// construction, not by a second, re-implemented auth check.
//
// Usage: npx tsx test/dashboard/metrics.test.mjs

import {
  deriveClosedTrades,
  filterClosedTrades,
  netPnlForTrade,
  classifyTrade,
  utcDayKey,
  computeDashboardMetrics,
  dayWinRate,
  cumulativePnlSeries,
  dailyPnlSeries,
  derivedBalanceSeries,
  computeDrawdown,
  calendarDayBuckets,
  bySymbol,
  byDirection,
  byDayOfWeek,
  byHourOfDay,
  bySession,
  sessionForUtcHour,
} from "../../src/lib/dashboard/metrics.ts";

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
function close(name, actual, expected, eps = 1e-6) {
  ok(`${name} (${actual} ~= ${expected})`, typeof actual === "number" && Math.abs(actual - expected) <= eps);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} (${a} === ${e})`, a === e);
}

function trade(overrides) {
  return {
    positionId: "p1",
    userId: "u1",
    accountId: "a1",
    symbol: "ESZ6",
    side: "buy",
    qty: 1,
    avgEntry: 100,
    realizedPnl: 0,
    openedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:00.000Z",
    commission: 0,
    fillCount: 2,
    exitPrice: 101,
    ...overrides,
  };
}

// ---- commission/P&L semantics (verified against oms.server.ts) -----------
// oms.server.ts:295 computes `realized` from price movement only; it is
// written straight to trade_positions.realized_pnl / trade_executions
// .realized_pnl with NO commission subtracted (lines 302-303, 313, 381).
// Commission is only netted at the account-rollup level (lines 397-398),
// never on the trade itself — so every "net" figure here must subtract it.
{
  const t = trade({ realizedPnl: 100, commission: 30 });
  close("netPnlForTrade subtracts commission from gross realized_pnl", netPnlForTrade(t), 70);
  const free = trade({ realizedPnl: 100, commission: 0 });
  close("netPnlForTrade with zero commission equals gross", netPnlForTrade(free), 100);
}

// ---- win/loss/breakeven classification ------------------------------------
{
  ok("classifyTrade: positive net -> win", classifyTrade(trade({ realizedPnl: 100, commission: 10 })) === "win");
  ok("classifyTrade: negative net -> loss", classifyTrade(trade({ realizedPnl: 10, commission: 100 })) === "loss");
  ok("classifyTrade: exact-zero net -> breakeven", classifyTrade(trade({ realizedPnl: 10, commission: 10 })) === "breakeven");
}

// ---- utcDayKey: timezone-safe day boundary --------------------------------
{
  // 23:30 US Eastern (-05:00) on Jan 1st is 04:30 UTC on Jan 2nd — a naive
  // string-slice of the raw offset timestamp would wrongly say "2026-01-01".
  eq("utcDayKey converts a non-UTC offset to the correct UTC calendar day", utcDayKey("2026-01-01T23:30:00.000-05:00"), "2026-01-02");
  eq("utcDayKey on an exact UTC midnight timestamp", utcDayKey("2026-03-15T00:00:00.000Z"), "2026-03-15");
  eq("utcDayKey on a UTC end-of-day timestamp stays on the same day", utcDayKey("2026-03-15T23:59:59.999Z"), "2026-03-15");
}

// ---- computeDashboardMetrics: the 8 core metrics --------------------------
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 105, commission: 10, closedAt: "2026-01-01T10:00:00.000Z" }), // win, net 95
    trade({ positionId: "p2", realizedPnl: -45, commission: 10, closedAt: "2026-01-01T15:00:00.000Z" }), // loss, net -55
    trade({ positionId: "p3", realizedPnl: 5, commission: 5, closedAt: "2026-01-02T10:00:00.000Z" }), // breakeven, net 0
    trade({ positionId: "p4", realizedPnl: 210, commission: 20, closedAt: "2026-01-03T10:00:00.000Z" }), // win, net 190
  ];
  const m = computeDashboardMetrics(trades);
  close("Net P&L sums net-of-commission across every trade incl. breakeven", m.netPnl, 95 - 55 + 0 + 190);
  ok("Total Trades includes breakeven", m.totalTrades === 4);
  close("Trade Win %: wins/(wins+losses), breakeven excluded from denominator", m.winRatePct, (2 / 3) * 100);
  close("Profit Factor: gross profit / |gross loss|, net-of-commission", m.profitFactor, (95 + 190) / 55);
  close("Average Winning Trade", m.avgWinningTrade, (95 + 190) / 2);
  close("Average Losing Trade (signed negative)", m.avgLosingTrade, -55);
  close("Average Win/Loss Ratio", m.avgWinLossRatio, Math.abs((95 + 190) / 2) / 55);
  // Day buckets (UTC): day1 = 95-55=40 (win day), day2 = 0 (not a win day), day3 = 190 (win day) -> 2/3 winning days
  close("Day Win %", m.dayWinRatePct, (2 / 3) * 100);
}

// ---- zero-loss Profit Factor edge case (matches engine.ts: null, never Infinity) --
{
  const onlyWins = [trade({ positionId: "p1", realizedPnl: 100, commission: 0 }), trade({ positionId: "p2", realizedPnl: 50, commission: 0 })];
  const m = computeDashboardMetrics(onlyWins);
  ok("Profit Factor with zero losses is null, not Infinity", m.profitFactor === null);
  ok("Average Losing Trade with zero losses is null", m.avgLosingTrade === null);
  ok("Avg Win/Loss Ratio with zero losses is null", m.avgWinLossRatio === null);
}

// ---- zero-win edge case (symmetry check) ----------------------------------
{
  const onlyLosses = [trade({ positionId: "p1", realizedPnl: -100, commission: 0 })];
  const m = computeDashboardMetrics(onlyLosses);
  ok("Win % with zero wins is 0, not null (decisive trades exist)", m.winRatePct === 0);
  ok("Average Winning Trade with zero wins is null", m.avgWinningTrade === null);
  ok("Profit Factor with zero gross profit is 0", m.profitFactor === 0);
}

// ---- all-breakeven edge case: no decisive trades at all -------------------
{
  const allBreakeven = [trade({ positionId: "p1", realizedPnl: 5, commission: 5 })];
  const m = computeDashboardMetrics(allBreakeven);
  ok("Win % is null when there are no decisive (non-breakeven) trades", m.winRatePct === null);
  ok("Total Trades still counts the breakeven trade", m.totalTrades === 1);
}

// ---- empty data ------------------------------------------------------------
{
  const m = computeDashboardMetrics([]);
  eq("computeDashboardMetrics([]) never produces NaN/undefined", m, {
    netPnl: 0,
    winRatePct: null,
    profitFactor: null,
    dayWinRatePct: null,
    avgWinningTrade: null,
    avgLosingTrade: null,
    avgWinLossRatio: null,
    totalTrades: 0,
  });
  eq("cumulativePnlSeries([]) is empty", cumulativePnlSeries([]), []);
  eq("dailyPnlSeries([]) is empty", dailyPnlSeries([]), []);
  eq("derivedBalanceSeries([], 1000) is empty", derivedBalanceSeries([], 1000), []);
  eq("dayWinRate([]) is null", dayWinRate([]), null);
  const dd = computeDrawdown([]);
  eq("computeDrawdown([]) is all-zero, not NaN", dd, { curve: [], maxDrawdown: 0, maxDrawdownPct: 0, currentDrawdown: 0, currentDrawdownPct: 0 });
}

// ---- cumulative P&L: chronological regardless of input order --------------
{
  const trades = [
    trade({ positionId: "p3", realizedPnl: 30, commission: 0, closedAt: "2026-01-03T00:00:00.000Z" }),
    trade({ positionId: "p1", realizedPnl: 10, commission: 0, closedAt: "2026-01-01T00:00:00.000Z" }),
    trade({ positionId: "p2", realizedPnl: 20, commission: 0, closedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const series = cumulativePnlSeries(trades);
  eq("cumulativePnlSeries sorts by closedAt regardless of input order", series.map((p) => p.time), [
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
  ]);
  eq("cumulativePnlSeries running total", series.map((p) => p.cumulative), [10, 30, 60]);
}

// ---- daily P&L aggregation --------------------------------------------------
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 40, commission: 0, closedAt: "2026-02-01T05:00:00.000Z" }),
    trade({ positionId: "p2", realizedPnl: -15, commission: 0, closedAt: "2026-02-01T20:00:00.000Z" }),
    trade({ positionId: "p3", realizedPnl: 5, commission: 0, closedAt: "2026-02-02T12:00:00.000Z" }),
  ];
  const daily = dailyPnlSeries(trades);
  eq("dailyPnlSeries buckets by UTC day, sorted ascending", daily, [
    { day: "2026-02-01", netPnl: 25, tradeCount: 2 },
    { day: "2026-02-02", netPnl: 5, tradeCount: 1 },
  ]);
}

// ---- derived balance --------------------------------------------------------
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 100, commission: 0, closedAt: "2026-01-01T00:00:00.000Z" }),
    trade({ positionId: "p2", realizedPnl: -40, commission: 0, closedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const balance = derivedBalanceSeries(trades, 1000);
  eq("derivedBalanceSeries = startingBalance + cumulative net P&L", balance.map((p) => p.balance), [1100, 1060]);
}

// ---- drawdown ----------------------------------------------------------------
{
  // Balance: 1000 -> 1200 (new peak) -> 1050 (drawdown from 1200) -> 1300 (new peak, drawdown resets)
  const series = [
    { time: "t0", balance: 1000 },
    { time: "t1", balance: 1200 },
    { time: "t2", balance: 1050 },
    { time: "t3", balance: 1300 },
  ];
  const dd = computeDrawdown(series);
  close("maxDrawdown is the largest peak-to-trough $ drop", dd.maxDrawdown, 150);
  close("maxDrawdownPct is relative to the peak at that point", dd.maxDrawdownPct, (150 / 1200) * 100);
  close("currentDrawdown at a new all-time-high point is zero", dd.currentDrawdown, 0);
  close("currentDrawdownPct at a new all-time-high point is zero", dd.currentDrawdownPct, 0);
  eq("drawdown curve has one point per input point", dd.curve.length, series.length);
}

// ---- account filter ----------------------------------------------------------
{
  const trades = [
    trade({ positionId: "p1", accountId: "acct-A", realizedPnl: 10 }),
    trade({ positionId: "p2", accountId: "acct-B", realizedPnl: 999 }),
    trade({ positionId: "p3", accountId: "acct-A", realizedPnl: 20 }),
  ];
  const filtered = filterClosedTrades(trades, { accountId: "acct-A" });
  eq("filterClosedTrades by accountId excludes every other account's trades", filtered.map((t) => t.positionId), ["p1", "p3"]);
  ok("filtering by accountId never leaks another account's P&L into the set", !filtered.some((t) => t.realizedPnl === 999));
}

// ---- date filter (closed_at, inclusive boundaries) ---------------------------
{
  const trades = [
    trade({ positionId: "p1", closedAt: "2026-01-01T00:00:00.000Z" }),
    trade({ positionId: "p2", closedAt: "2026-01-15T12:00:00.000Z" }),
    trade({ positionId: "p3", closedAt: "2026-01-31T23:59:59.999Z" }),
    trade({ positionId: "p4", closedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const filtered = filterClosedTrades(trades, { fromUtc: "2026-01-01T00:00:00.000Z", toUtc: "2026-01-31T23:59:59.999Z" });
  eq("filterClosedTrades by date range is inclusive on both boundaries and excludes outside it", filtered.map((t) => t.positionId), ["p1", "p2", "p3"]);
}

// ---- symbol filter (compositional with the others) ---------------------------
{
  const trades = [trade({ positionId: "p1", symbol: "ESZ6" }), trade({ positionId: "p2", symbol: "NQZ6" })];
  eq("filterClosedTrades by symbol", filterClosedTrades(trades, { symbol: "NQZ6" }).map((t) => t.positionId), ["p2"]);
}

// ---- deriveClosedTrades: the closed-trade adapter (mirrors v_closed_trades) --
{
  const positions = [
    { id: "p-open", userId: "u1", accountId: "a1", symbol: "ESZ6", side: "buy", qty: 1, avgEntry: 100, realizedPnl: 0, status: "open", openedAt: "t0", closedAt: null },
    { id: "p-closed", userId: "u1", accountId: "a1", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 50, status: "closed", openedAt: "t0", closedAt: "t1" },
  ];
  const executions = [
    // Opening fill on p-open — must never appear in the closed-trade output.
    { positionId: "p-open", side: "buy", qty: 1, price: 100, commission: 1 },
    // p-closed: one opening (same-side) fill, two closing (opposite-side) fills at different prices.
    { positionId: "p-closed", side: "buy", qty: 2, price: 100, commission: 2 },
    { positionId: "p-closed", side: "sell", qty: 1, price: 110, commission: 1 },
    { positionId: "p-closed", side: "sell", qty: 1, price: 120, commission: 1 },
  ];
  const closedTrades = deriveClosedTrades(positions, executions);
  eq("deriveClosedTrades: closed-only filtering excludes open positions", closedTrades.map((t) => t.positionId), ["p-closed"]);
  const t = closedTrades[0];
  close("deriveClosedTrades: commission aggregation sums every linked fill (both opening and closing)", t.commission, 2 + 1 + 1);
  ok("deriveClosedTrades: fill count includes opening AND closing fills", t.fillCount === 3);
  close(
    "deriveClosedTrades: exit price is the qty-weighted average of ONLY the opposite-side (closing) fills",
    t.exitPrice,
    (110 * 1 + 120 * 1) / 2,
  );
}

{
  // A position closed with no opposite-side execution linked to it at all —
  // the documented OMS flip edge case (see the view's own SQL comment).
  // Must yield `null`, never a fabricated/guessed exit price.
  const positions = [{ id: "p1", userId: "u1", accountId: "a1", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 20, status: "closed", openedAt: "t0", closedAt: "t1" }];
  const executions = [{ positionId: "p1", side: "buy", qty: 1, price: 100, commission: 1 }];
  const [t] = deriveClosedTrades(positions, executions);
  ok("deriveClosedTrades: exit price is null (not guessed) when no closing fill is linked", t.exitPrice === null);
  close("deriveClosedTrades: commission still aggregates whatever IS linked", t.commission, 1);
}

{
  // Multi-position, multi-account mixing: the join must never attribute one
  // position's fills to another, even when both belong to the same account,
  // and even when a DIFFERENT account's positions/executions are present in
  // the same input arrays (the shape RLS would hand back for one user with
  // several accounts).
  const positions = [
    { id: "p1", userId: "u1", accountId: "acct-A", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 10, status: "closed", openedAt: "t0", closedAt: "t1" },
    { id: "p2", userId: "u1", accountId: "acct-A", symbol: "NQZ6", side: "sell", qty: 0, avgEntry: 200, realizedPnl: 30, status: "closed", openedAt: "t0", closedAt: "t2" },
    { id: "p3", userId: "u1", accountId: "acct-B", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 999, status: "closed", openedAt: "t0", closedAt: "t3" },
  ];
  const executions = [
    { positionId: "p1", side: "sell", qty: 1, price: 105, commission: 2 },
    { positionId: "p2", side: "buy", qty: 1, price: 190, commission: 3 },
    { positionId: "p3", side: "sell", qty: 1, price: 100, commission: 4 },
  ];
  const closedTrades = deriveClosedTrades(positions, executions);
  const p1 = closedTrades.find((t) => t.positionId === "p1");
  const p2 = closedTrades.find((t) => t.positionId === "p2");
  close("deriveClosedTrades: p1's commission is only its own linked fill", p1.commission, 2);
  close("deriveClosedTrades: p2's commission is only its own linked fill, not p1's or p3's", p2.commission, 3);
  ok("deriveClosedTrades: p1's exit price is derived from its own fill only", Math.abs(p1.exitPrice - 105) < 1e-9);
  const acctAOnly = filterClosedTrades(closedTrades, { accountId: "acct-A" });
  eq("filtering the derived set by accountId isolates acct-A from acct-B", acctAOnly.map((t) => t.positionId), ["p1", "p2"]);
  ok("acct-A's filtered set never includes acct-B's P&L", !acctAOnly.some((t) => t.realizedPnl === 999));
}

// ==== Phase 4B-1: Trading Calendar + Performance Breakdowns ================

// ---- calendarDayBuckets: commission-adjusted, per-UTC-day aggregation -----
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 100, commission: 20, closedAt: "2026-03-05T08:00:00.000Z" }), // net 80, win
    trade({ positionId: "p2", realizedPnl: -30, commission: 5, closedAt: "2026-03-05T18:00:00.000Z" }), // net -35, loss
    trade({ positionId: "p3", realizedPnl: 10, commission: 0, closedAt: "2026-03-06T09:00:00.000Z" }), // net 10, win
  ];
  const buckets = calendarDayBuckets(trades);
  eq("calendarDayBuckets produces one bucket per UTC day with trades, sorted ascending", buckets.map((b) => b.day), [
    "2026-03-05",
    "2026-03-06",
  ]);
  const day1 = buckets[0];
  close("calendarDayBuckets net P&L is commission-adjusted, matching netPnlForTrade", day1.netPnl, 80 - 35);
  eq("calendarDayBuckets trade count per day", day1.tradeCount, 2);
  eq("calendarDayBuckets wins/losses per day", [day1.wins, day1.losses], [1, 1]);
  eq("calendarDayBuckets([]) is empty", calendarDayBuckets([]), []);
}
{
  // One breakeven-only day must still appear (isLowSample true, winRatePct not applicable here since
  // calendarDayBuckets doesn't expose winRatePct as its own concern beyond GroupSummary — but wins/losses must both be 0).
  const trades = [trade({ positionId: "p1", realizedPnl: 5, commission: 5, closedAt: "2026-04-01T00:00:00.000Z" })];
  const [bucket] = calendarDayBuckets(trades);
  eq("calendarDayBuckets: a lone breakeven trade counts as neither a win nor a loss", [bucket.wins, bucket.losses], [0, 0]);
  close("calendarDayBuckets: breakeven day net P&L is exactly zero", bucket.netPnl, 0);
}

// ---- bySymbol: grouping, sorted by net P&L descending ----------------------
{
  const trades = [
    trade({ positionId: "p1", symbol: "ESZ6", realizedPnl: 50, commission: 0 }),
    trade({ positionId: "p2", symbol: "NQZ6", realizedPnl: 200, commission: 0 }),
    trade({ positionId: "p3", symbol: "ESZ6", realizedPnl: -10, commission: 0 }),
  ];
  const bySym = bySymbol(trades);
  eq("bySymbol sorts by net P&L descending", bySym.map((s) => s.symbol), ["NQZ6", "ESZ6"]);
  const es = bySym.find((s) => s.symbol === "ESZ6");
  close("bySymbol aggregates net P&L across every trade for that symbol", es.netPnl, 40);
  eq("bySymbol trade count", es.tradeCount, 2);
  ok("bySymbol: a 2-trade group is flagged low sample (< 5 trades)", es.isLowSample === true);
  eq("bySymbol([]) is empty", bySymbol([]), []);
}

// ---- byDirection: read directly from `side`, never inferred from P&L ------
{
  const trades = [
    trade({ positionId: "p1", side: "buy", realizedPnl: 100, commission: 0 }), // long, win
    trade({ positionId: "p2", side: "buy", realizedPnl: -20, commission: 0 }), // long, loss
    trade({ positionId: "p3", side: "sell", realizedPnl: -999, commission: 0 }), // short, loss (would look like a "long win" if P&L-inferred)
  ];
  const dirs = byDirection(trades);
  eq("byDirection always returns both Long and Short, in that order", dirs.map((d) => d.direction), ["long", "short"]);
  const long = dirs.find((d) => d.direction === "long");
  const short = dirs.find((d) => d.direction === "short");
  eq("byDirection: long group is built from side='buy' trades only", long.tradeCount, 2);
  close("byDirection: long net P&L", long.netPnl, 80);
  eq("byDirection: short group is built from side='sell' trades only, not misclassified by its P&L sign", short.tradeCount, 1);
  close("byDirection: short net P&L", short.netPnl, -999);
  eq("byDirection with zero trades still returns both sides at zero, not omitted", byDirection([]).map((d) => d.tradeCount), [0, 0]);
}

// ---- byDayOfWeek: fixed Monday..Sunday order, zero-trade days included -----
{
  // 2026-03-02 is a Monday (UTC); 2026-03-04 is a Wednesday (UTC).
  const trades = [
    trade({ positionId: "p1", realizedPnl: 50, commission: 0, closedAt: "2026-03-02T12:00:00.000Z" }),
    trade({ positionId: "p2", realizedPnl: -10, commission: 0, closedAt: "2026-03-04T12:00:00.000Z" }),
  ];
  const days = byDayOfWeek(trades);
  eq("byDayOfWeek always returns exactly 7 entries in Monday..Sunday order", days.map((d) => d.label), [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);
  const monday = days.find((d) => d.label === "Monday");
  const wednesday = days.find((d) => d.label === "Wednesday");
  const tuesday = days.find((d) => d.label === "Tuesday");
  close("byDayOfWeek: Monday net P&L from the UTC-Monday trade", monday.netPnl, 50);
  close("byDayOfWeek: Wednesday net P&L from the UTC-Wednesday trade", wednesday.netPnl, -10);
  eq("byDayOfWeek: a day with zero trades stays in the list (neutral, not removed)", tuesday.tradeCount, 0);
  ok("byDayOfWeek: zero-trade day is not flagged low sample", tuesday.isLowSample === false);
}

// ---- byHourOfDay: all 24 UTC hours always present --------------------------
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 40, commission: 0, closedAt: "2026-01-01T09:15:00.000Z" }), // hour 9
    trade({ positionId: "p2", realizedPnl: -5, commission: 0, closedAt: "2026-01-01T09:45:00.000Z" }), // also hour 9
  ];
  const hours = byHourOfDay(trades);
  eq("byHourOfDay always returns all 24 UTC hours", hours.length, 24);
  eq("byHourOfDay hours are 0..23 in order", hours.map((h) => h.hourUtc), Array.from({ length: 24 }, (_, i) => i));
  const hour9 = hours.find((h) => h.hourUtc === 9);
  close("byHourOfDay: both trades in the same UTC hour are aggregated together", hour9.netPnl, 35);
  eq("byHourOfDay: an inactive hour has zero trades, not omitted", hours.find((h) => h.hourUtc === 0).tradeCount, 0);
}

// ---- sessionForUtcHour: mutually-exclusive fixed UTC boundaries ------------
{
  eq("00:00 UTC (midnight) -> Asia", sessionForUtcHour(0), "asia");
  eq("06:59 UTC (hour 6) -> Asia", sessionForUtcHour(6), "asia");
  eq("07:00 UTC (hour 7) -> London", sessionForUtcHour(7), "london");
  eq("11:59 UTC (hour 11) -> London", sessionForUtcHour(11), "london");
  eq("12:00 UTC (hour 12) -> London/New York Overlap", sessionForUtcHour(12), "overlap");
  eq("15:59 UTC (hour 15) -> London/New York Overlap", sessionForUtcHour(15), "overlap");
  eq("16:00 UTC (hour 16) -> New York", sessionForUtcHour(16), "newYork");
  eq("20:59 UTC (hour 20) -> New York", sessionForUtcHour(20), "newYork");
  eq("21:00 UTC (hour 21) -> Off Hours", sessionForUtcHour(21), "offHours");
  eq("23:00 UTC (hour 23) -> Off Hours", sessionForUtcHour(23), "offHours");
  // Every hour of the day must map to exactly one of the five sessions (no gaps, no overlap).
  const allSessions = new Set(Array.from({ length: 24 }, (_, h) => sessionForUtcHour(h)));
  eq("sessionForUtcHour covers exactly the 5 defined sessions across all 24 hours", [...allSessions].sort(), [
    "asia",
    "london",
    "newYork",
    "offHours",
    "overlap",
  ]);
}

// ---- bySession: classification uses closedAt, never journal_entries.session
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 20, commission: 0, closedAt: "2026-01-01T00:30:00.000Z" }), // asia
    trade({ positionId: "p2", realizedPnl: 30, commission: 0, closedAt: "2026-01-01T08:00:00.000Z" }), // london
    trade({ positionId: "p3", realizedPnl: -10, commission: 0, closedAt: "2026-01-01T13:00:00.000Z" }), // overlap
    trade({ positionId: "p4", realizedPnl: 40, commission: 0, closedAt: "2026-01-01T17:00:00.000Z" }), // new york
    trade({ positionId: "p5", realizedPnl: -5, commission: 0, closedAt: "2026-01-01T22:00:00.000Z" }), // off hours
  ];
  const sessions = bySession(trades);
  eq("bySession always returns all 5 sessions in a fixed order", sessions.map((s) => s.session), [
    "asia",
    "london",
    "overlap",
    "newYork",
    "offHours",
  ]);
  eq("bySession: total trades across all sessions equals the input, never double-counted", sessions.reduce((s, x) => s + x.tradeCount, 0), 5);
  close("bySession: Asia bucket net P&L", sessions.find((s) => s.session === "asia").netPnl, 20);
  close("bySession: New York bucket net P&L", sessions.find((s) => s.session === "newYork").netPnl, 40);
  eq("bySession([]) still returns all 5 sessions at zero trades, not omitted", bySession([]).map((s) => s.tradeCount), [0, 0, 0, 0, 0]);
}

// ---- low-sample flag: consistent across every breakdown, never fabricated -
{
  const fourTrades = Array.from({ length: 4 }, (_, i) => trade({ positionId: `p${i}`, symbol: "ESZ6", realizedPnl: 10 }));
  const fiveTrades = Array.from({ length: 5 }, (_, i) => trade({ positionId: `p${i}`, symbol: "NQZ6", realizedPnl: 10 }));
  const combined = bySymbol([...fourTrades, ...fiveTrades]);
  ok("bySymbol: exactly 4 trades is flagged low sample", combined.find((s) => s.symbol === "ESZ6").isLowSample === true);
  ok("bySymbol: exactly 5 trades is NOT flagged low sample", combined.find((s) => s.symbol === "NQZ6").isLowSample === false);
  ok(
    "bySymbol: the actual statistics are still present for a low-sample group, never hidden",
    combined.find((s) => s.symbol === "ESZ6").netPnl === 40,
  );
}

// ---- one-trade and empty-input sanity across every new breakdown ----------
{
  const one = [trade({ positionId: "p1", realizedPnl: 15, commission: 5, closedAt: "2026-05-04T10:00:00.000Z" })]; // Monday, hour 10, London session
  eq("calendarDayBuckets with one trade", calendarDayBuckets(one).length, 1);
  eq("bySymbol with one trade", bySymbol(one).length, 1);
  eq("byDirection with one trade still returns both sides", byDirection(one).length, 2);
  eq("byDayOfWeek with one trade still returns all 7 days", byDayOfWeek(one).length, 7);
  eq("byHourOfDay with one trade still returns all 24 hours", byHourOfDay(one).length, 24);
  eq("bySession with one trade still returns all 5 sessions", bySession(one).length, 5);

  eq("calendarDayBuckets([]) length", calendarDayBuckets([]).length, 0);
  eq("bySymbol([]) length", bySymbol([]).length, 0);
  eq("byDirection([]) length (both sides still present)", byDirection([]).length, 2);
  eq("byDayOfWeek([]) length (all 7 days still present)", byDayOfWeek([]).length, 7);
  eq("byHourOfDay([]) length (all 24 hours still present)", byHourOfDay([]).length, 24);
  eq("bySession([]) length (all 5 sessions still present)", bySession([]).length, 5);
}

// ---- multi-symbol account-isolation continues to hold through breakdowns --
{
  // Same account-isolation guarantee as the existing deriveClosedTrades test, exercised
  // through the new grouping functions: filtering by account BEFORE grouping must never
  // let another account's trades leak into a symbol/session/day bucket.
  const positions = [
    { id: "p1", userId: "u1", accountId: "acct-A", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 10, status: "closed", openedAt: "t0", closedAt: "2026-01-01T08:00:00.000Z" },
    { id: "p2", userId: "u1", accountId: "acct-B", symbol: "ESZ6", side: "buy", qty: 0, avgEntry: 100, realizedPnl: 999, status: "closed", openedAt: "t0", closedAt: "2026-01-01T08:30:00.000Z" },
  ];
  const closedTrades = deriveClosedTrades(positions, []);
  const acctAOnly = filterClosedTrades(closedTrades, { accountId: "acct-A" });
  const sym = bySymbol(acctAOnly);
  eq("account isolation holds when grouping by symbol after filtering", sym.length, 1);
  close("account isolation: acct-B's P&L never leaks into acct-A's symbol group", sym[0].netPnl, 10);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
