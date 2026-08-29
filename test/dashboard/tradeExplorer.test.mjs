// Coverage for the Phase 4D Trade Explorer's pure logic:
// src/lib/dashboard/tradeExplorer.ts. Pure, synchronous, no I/O — every
// filter/sort/paginate combination is exercised directly against
// hand-built `ClosedTrade[]` fixtures, matching the style of
// test/dashboard/metrics.test.mjs and test/dashboard/performanceScore.test.mjs.
//
// Usage: npx tsx test/dashboard/tradeExplorer.test.mjs

import {
  filterByDirection,
  filterByOutcome,
  filterBySession,
  tradeDurationMs,
  formatDuration,
  sortTrades,
  paginate,
  queryClosedTrades,
  summarizeTrades,
  isTruncated,
} from "../../src/lib/dashboard/tradeExplorer.ts";

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

const defaultQuery = {
  direction: "all",
  outcome: "all",
  session: "all",
  sortKey: "closedAt",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
};

// ==== filterByDirection: Long/Short read from `side`, never inferred =======
{
  const trades = [
    trade({ positionId: "p1", side: "buy", realizedPnl: 100 }),
    trade({ positionId: "p2", side: "sell", realizedPnl: -999 }), // would look "long-losing" if inferred from P&L
    trade({ positionId: "p3", side: "buy", realizedPnl: -10 }),
  ];
  eq("filterByDirection: 'all' returns everything", filterByDirection(trades, "all").map((t) => t.positionId), ["p1", "p2", "p3"]);
  eq("filterByDirection: 'long' -> side='buy' only", filterByDirection(trades, "long").map((t) => t.positionId), ["p1", "p3"]);
  eq("filterByDirection: 'short' -> side='sell' only, never inferred from P&L sign", filterByDirection(trades, "short").map((t) => t.positionId), ["p2"]);
}

// ==== filterByOutcome: win/loss/breakeven use netPnlForTrade (realized - commission)
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 100, commission: 10 }), // net 90 -> win
    trade({ positionId: "p2", realizedPnl: 10, commission: 100 }), // net -90 -> loss
    trade({ positionId: "p3", realizedPnl: 50, commission: 50 }), // net 0 -> breakeven
    trade({ positionId: "p4", realizedPnl: 5, commission: 0 }), // net 5 -> win
  ];
  eq("filterByOutcome: 'all'", filterByOutcome(trades, "all").map((t) => t.positionId), ["p1", "p2", "p3", "p4"]);
  eq("filterByOutcome: 'win' -> net > 0", filterByOutcome(trades, "win").map((t) => t.positionId), ["p1", "p4"]);
  eq("filterByOutcome: 'loss' -> net < 0", filterByOutcome(trades, "loss").map((t) => t.positionId), ["p2"]);
  eq("filterByOutcome: 'breakeven' -> net exactly 0", filterByOutcome(trades, "breakeven").map((t) => t.positionId), ["p3"]);
}

// ==== filterBySession: reuses the exact same fixed UTC windows as metrics.ts
{
  const trades = [
    trade({ positionId: "asia", closedAt: "2026-01-01T03:00:00.000Z" }),
    trade({ positionId: "london", closedAt: "2026-01-01T09:00:00.000Z" }),
    trade({ positionId: "overlap", closedAt: "2026-01-01T13:00:00.000Z" }),
    trade({ positionId: "newYork", closedAt: "2026-01-01T18:00:00.000Z" }),
    trade({ positionId: "offHours", closedAt: "2026-01-01T22:00:00.000Z" }),
  ];
  eq("filterBySession: 'all'", filterBySession(trades, "all").length, 5);
  eq("filterBySession: 'asia'", filterBySession(trades, "asia").map((t) => t.positionId), ["asia"]);
  eq("filterBySession: 'newYork'", filterBySession(trades, "newYork").map((t) => t.positionId), ["newYork"]);
  eq("filterBySession: 'offHours'", filterBySession(trades, "offHours").map((t) => t.positionId), ["offHours"]);
}

// ==== tradeDurationMs / formatDuration ======================================
{
  const t = trade({ openedAt: "2026-01-01T10:00:00.000Z", closedAt: "2026-01-01T10:45:00.000Z" });
  close("tradeDurationMs: 45 minutes", tradeDurationMs(t), 45 * 60 * 1000);
  eq("formatDuration: 45 minutes -> '45m'", formatDuration(45 * 60 * 1000), "45m");
  eq("formatDuration: 0ms -> '<1m'", formatDuration(0), "<1m");
  eq("formatDuration: 30 seconds -> '<1m' (never invents sub-minute precision)", formatDuration(30 * 1000), "<1m");
  eq("formatDuration: 3h 12m", formatDuration((3 * 60 + 12) * 60 * 1000), "3h 12m");
  eq("formatDuration: exactly 2h", formatDuration(2 * 60 * 60 * 1000), "2h");
  eq("formatDuration: 2d 4h", formatDuration((2 * 24 + 4) * 60 * 60 * 1000), "2d 4h");
  eq("formatDuration: exactly 3d", formatDuration(3 * 24 * 60 * 60 * 1000), "3d");

  // Defensive clamp: closedAt before openedAt (should never happen for a
  // real closed position) must never produce a negative duration.
  const backwards = trade({ openedAt: "2026-01-02T00:00:00.000Z", closedAt: "2026-01-01T00:00:00.000Z" });
  close("tradeDurationMs: clamps at 0, never negative", tradeDurationMs(backwards), 0);
}

// ==== sortTrades =============================================================
{
  const trades = [
    trade({ positionId: "p1", symbol: "NQZ6", realizedPnl: 30, closedAt: "2026-01-02T00:00:00.000Z", openedAt: "2026-01-01T22:00:00.000Z" }), // net 30, 2h duration
    trade({ positionId: "p2", symbol: "ESZ6", realizedPnl: 10, closedAt: "2026-01-01T00:00:00.000Z", openedAt: "2026-01-01T00:00:00.000Z" }), // net 10, 0 duration
    trade({ positionId: "p3", symbol: "CLZ6", realizedPnl: 20, closedAt: "2026-01-03T00:00:00.000Z", openedAt: "2026-01-01T00:00:00.000Z" }), // net 20, 2d duration
  ];
  eq("sortTrades: closedAt desc (newest first) is the default direction", sortTrades(trades, "closedAt", "desc").map((t) => t.positionId), ["p3", "p1", "p2"]);
  eq("sortTrades: closedAt asc (oldest first)", sortTrades(trades, "closedAt", "asc").map((t) => t.positionId), ["p2", "p1", "p3"]);
  eq("sortTrades: symbol asc is alphabetical (CLZ6 < ESZ6 < NQZ6)", sortTrades(trades, "symbol", "asc").map((t) => t.positionId), ["p3", "p2", "p1"]);
  eq("sortTrades: netPnl desc sorts numerically (30 > 20 > 10), not as strings", sortTrades(trades, "netPnl", "desc").map((t) => t.positionId), ["p1", "p3", "p2"]);
  eq("sortTrades: netPnl asc", sortTrades(trades, "netPnl", "asc").map((t) => t.positionId), ["p2", "p3", "p1"]);
  eq("sortTrades: duration desc (longest first)", sortTrades(trades, "duration", "desc").map((t) => t.positionId), ["p3", "p1", "p2"]);
  eq("sortTrades: duration asc (shortest first)", sortTrades(trades, "duration", "asc").map((t) => t.positionId), ["p2", "p1", "p3"]);
}

// ==== paginate ===============================================================
{
  const trades = Array.from({ length: 7 }, (_, i) => trade({ positionId: `p${i}` }));
  const page1 = paginate(trades, 1, 3);
  eq("paginate: page 1 of 3-per-page over 7 items", page1.rows.map((t) => t.positionId), ["p0", "p1", "p2"]);
  eq("paginate: totalCount reflects the full set, not just this page", page1.totalCount, 7);
  eq("paginate: totalPages rounds up (7/3 -> 3 pages)", page1.totalPages, 3);

  const page3 = paginate(trades, 3, 3);
  eq("paginate: last page has the remainder (1 item)", page3.rows.map((t) => t.positionId), ["p6"]);

  const pastEnd = paginate(trades, 99, 3);
  eq("paginate: a page number past the end clamps to the last real page, not an empty slice", pastEnd.page, 3);
  eq("paginate: clamped page still returns the last page's real rows", pastEnd.rows.map((t) => t.positionId), ["p6"]);

  const empty = paginate([], 1, 25);
  eq("paginate: empty input -> empty rows, totalCount 0", empty, { rows: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 1 });

  const zeroPage = paginate(trades, 0, 3);
  eq("paginate: page 0 clamps up to page 1, never an invalid negative offset", zeroPage.page, 1);
}

// ==== queryClosedTrades: full pipeline, including account/date/symbol ======
{
  const trades = [
    trade({ positionId: "p1", accountId: "acct-A", symbol: "ESZ6", side: "buy", realizedPnl: 100, commission: 10, closedAt: "2026-01-05T00:00:00.000Z" }), // net 90, win
    trade({ positionId: "p2", accountId: "acct-A", symbol: "ESZ6", side: "sell", realizedPnl: -50, commission: 0, closedAt: "2026-01-03T00:00:00.000Z" }), // net -50, loss
    trade({ positionId: "p3", accountId: "acct-A", symbol: "NQZ6", side: "buy", realizedPnl: 20, commission: 0, closedAt: "2026-01-04T00:00:00.000Z" }), // net 20, win
    trade({ positionId: "p4", accountId: "acct-B", symbol: "ESZ6", side: "buy", realizedPnl: 999, commission: 0, closedAt: "2026-01-06T00:00:00.000Z" }), // different account
  ];

  const byAccount = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A" });
  eq("queryClosedTrades: account filter isolates acct-A from acct-B", byAccount.rows.map((t) => t.positionId), ["p1", "p3", "p2"]);
  ok("queryClosedTrades: acct-B's P&L never leaks into acct-A's result", !byAccount.rows.some((t) => t.realizedPnl === 999));

  const bySymbol = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", symbol: "NQZ6" });
  eq("queryClosedTrades: symbol filter", bySymbol.rows.map((t) => t.positionId), ["p3"]);

  const byDateRange = queryClosedTrades(trades, {
    ...defaultQuery,
    accountId: "acct-A",
    fromUtc: "2026-01-04T00:00:00.000Z",
    toUtc: "2026-01-05T23:59:59.999Z",
  });
  eq("queryClosedTrades: date range filter (inclusive boundaries)", byDateRange.rows.map((t) => t.positionId), ["p1", "p3"]);

  const winners = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", outcome: "win" });
  eq("queryClosedTrades: outcome=win composes with account filter (default sort: closedAt desc)", winners.rows.map((t) => t.positionId), ["p1", "p3"]);

  const shorts = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", direction: "short" });
  eq("queryClosedTrades: direction=short composes with account filter", shorts.rows.map((t) => t.positionId), ["p2"]);
}

// ==== pagination boundaries + page-size behavior through the full pipeline =
{
  const trades = Array.from({ length: 30 }, (_, i) =>
    trade({ positionId: `p${i}`, accountId: "acct-A", closedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }),
  );
  const page1 = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", pageSize: 10, page: 1 });
  eq("queryClosedTrades: pageSize=10 returns exactly 10 rows on a full page", page1.rows.length, 10);
  eq("queryClosedTrades: totalCount reflects the full 30-trade set", page1.totalCount, 30);
  eq("queryClosedTrades: totalPages for 30 items at pageSize 10", page1.totalPages, 3);

  const page3 = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", pageSize: 10, page: 3 });
  eq("queryClosedTrades: last page has the remainder", page3.rows.length, 10);

  const page4 = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", pageSize: 10, page: 4 });
  eq("queryClosedTrades: requesting a page past the end clamps instead of returning empty", page4.page, 3);
}

// ==== no-result state (filters match nothing) ================================
{
  const trades = [trade({ positionId: "p1", accountId: "acct-A", symbol: "ESZ6" })];
  const noMatch = queryClosedTrades(trades, { ...defaultQuery, accountId: "acct-A", symbol: "DOES_NOT_EXIST" });
  eq("queryClosedTrades: filters matching nothing return an empty (not error) result", noMatch.rows, []);
  eq("queryClosedTrades: empty result totalCount is 0", noMatch.totalCount, 0);
  eq("queryClosedTrades: empty result totalPages is still 1, never 0", noMatch.totalPages, 1);
}

// ==== summarizeTrades: complements, never duplicates, the Performance Score
{
  const trades = [
    trade({ positionId: "p1", realizedPnl: 100, commission: 10 }), // net 90, win
    trade({ positionId: "p2", realizedPnl: 10, commission: 100 }), // net -90, loss
    trade({ positionId: "p3", realizedPnl: 50, commission: 50 }), // net 0, breakeven
  ];
  const s = summarizeTrades(trades);
  close("summarizeTrades: netPnl sums net-of-commission across every trade incl. breakeven", s.netPnl, 90 - 90 + 0);
  eq("summarizeTrades: totalTrades includes breakeven", s.totalTrades, 3);
  eq("summarizeTrades: wins/losses/breakevens counted correctly", [s.wins, s.losses, s.breakevens], [1, 1, 1]);
  close("summarizeTrades: winRatePct excludes breakeven from the denominator", s.winRatePct, 50);
  close("summarizeTrades: avgTrade divides by ALL trades, including breakeven", s.avgTrade, 0 / 3);

  const empty = summarizeTrades([]);
  eq("summarizeTrades: empty input never produces NaN/undefined", empty, {
    netPnl: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRatePct: null,
    avgTrade: null,
  });
}

// ==== isTruncated: the 2000-row cap disclosure flag
{
  ok("isTruncated: fetch below the cap is not truncated", isTruncated(1999, 2000) === false);
  ok("isTruncated: fetch exactly at the cap is treated as truncated", isTruncated(2000, 2000) === true);
  ok("isTruncated: an empty fetch is never truncated", isTruncated(0, 2000) === false);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
