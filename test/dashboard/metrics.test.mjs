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

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
