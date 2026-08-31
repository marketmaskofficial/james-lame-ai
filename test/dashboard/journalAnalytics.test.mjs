// Coverage for the Phase 4F Journal Analytics pure logic:
// src/lib/dashboard/journalAnalytics.ts. Pure, synchronous, no I/O — matches
// the style of test/dashboard/tradeExplorer.test.mjs and
// test/dashboard/journalDraft.test.mjs.
//
// Usage: npx tsx test/dashboard/journalAnalytics.test.mjs

import {
  buildJournalAnalyticsTrades,
  summarizeJournalGroup,
  bySetup,
  byStrategy,
  byEmotion,
  byTag,
  byMistake,
  byGrade,
  byJournalSession,
  journaledVsNonJournaled,
  byGradeAndSetup,
  byEmotionAndOutcome,
  byMistakeAndSetup,
  sortJournalGroups,
  applyJournalFocusFilter,
} from "../../src/lib/dashboard/journalAnalytics.ts";
import { netPnlForTrade, classifyTrade } from "../../src/lib/dashboard/metrics.ts";

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
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} (${a} === ${e})`, a === e);
}
function close(name, actual, expected, eps = 1e-6) {
  ok(`${name} (${actual} ~= ${expected})`, typeof actual === "number" && Math.abs(actual - expected) <= eps);
}

let seq = 0;
/** A minimal, valid `ClosedTrade` fixture — every test overrides only the
 * fields it cares about. `positionId` auto-increments so callers never
 * accidentally collide unless they want to. */
function trade(overrides = {}) {
  seq += 1;
  return {
    positionId: overrides.positionId ?? `pos-${seq}`,
    userId: "user-1",
    accountId: "acct-1",
    symbol: "BTCUSDT",
    side: "buy",
    qty: 1,
    avgEntry: 100,
    realizedPnl: 0,
    openedAt: "2026-08-15T02:00:00.000Z",
    closedAt: "2026-08-15T02:10:00.000Z",
    commission: 0,
    fillCount: 2,
    exitPrice: 100,
    ...overrides,
  };
}

/** A win of net `amount` (realizedPnl = amount, commission = 0). */
function winOf(amount, overrides = {}) {
  return trade({ realizedPnl: amount, commission: 0, ...overrides });
}
/** A loss of net `amount` (amount should be positive; realizedPnl = -amount). */
function lossOf(amount, overrides = {}) {
  return trade({ realizedPnl: -amount, commission: 0, ...overrides });
}
function breakeven(overrides = {}) {
  return trade({ realizedPnl: 0, commission: 0, ...overrides });
}

/** Builds a `JournalAnalyticsTrade` directly (bypassing `buildJournalAnalyticsTrades`)
 * for tests that only care about the grouping functions, not assembly. */
function jTrade(overrides = {}) {
  const base = trade(overrides);
  return {
    ...base,
    hasJournal: overrides.hasJournal ?? true,
    journalEntryId: overrides.journalEntryId ?? `entry-${base.positionId}`,
    journalSession: overrides.journalSession ?? null,
    grade: overrides.grade ?? null,
    setup: overrides.setup ?? null,
    strategy: overrides.strategy ?? null,
    emotion: overrides.emotion ?? null,
    mistakes: overrides.mistakes ?? [],
    tags: overrides.tags ?? [],
  };
}

// ==== summarizeJournalGroup ==================================================
{
  const g = summarizeJournalGroup([winOf(10), winOf(20), lossOf(5), breakeven()]);
  eq("summarizeJournalGroup: tradeCount", g.tradeCount, 4);
  eq("summarizeJournalGroup: wins", g.wins, 2);
  eq("summarizeJournalGroup: losses", g.losses, 1);
  eq("summarizeJournalGroup: breakevens", g.breakevens, 1);
  close("summarizeJournalGroup: netPnl", g.netPnl, 25);
  close("summarizeJournalGroup: winRatePct (2/3)", g.winRatePct, (2 / 3) * 100);
  close("summarizeJournalGroup: avgWin", g.avgWin, 15);
  close("summarizeJournalGroup: avgLoss", g.avgLoss, -5);
  close("summarizeJournalGroup: profitFactor", g.profitFactor, 30 / 5);
  close("summarizeJournalGroup: avgNetTrade (reused from GroupSummary)", g.avgNetTrade, 25 / 4);

  const noLosses = summarizeJournalGroup([winOf(10)]);
  eq("summarizeJournalGroup: profitFactor null with no losses", noLosses.profitFactor, null);
  eq("summarizeJournalGroup: avgLoss null with no losses", noLosses.avgLoss, null);

  const empty = summarizeJournalGroup([]);
  eq("summarizeJournalGroup: empty group tradeCount", empty.tradeCount, 0);
  eq("summarizeJournalGroup: empty group isLowSample is false (no trades, not 'too few')", empty.isLowSample, false);

  // Net P&L is never reinvented — matches netPnlForTrade/classifyTrade directly.
  const mixed = [winOf(7), lossOf(3)];
  const manualNet = mixed.reduce((s, t) => s + netPnlForTrade(t), 0);
  close("summarizeJournalGroup: netPnl matches netPnlForTrade sum exactly", summarizeJournalGroup(mixed).netPnl, manualNet);
}

// ==== Low-sample boundary (1-4 = Low Sample, 5+ = not) =======================
{
  const four = summarizeJournalGroup([winOf(1), winOf(1), winOf(1), winOf(1)]);
  ok("4 trades: isLowSample === true", four.isLowSample === true);
  const five = summarizeJournalGroup([winOf(1), winOf(1), winOf(1), winOf(1), winOf(1)]);
  ok("5 trades: isLowSample === false", five.isLowSample === false);
  const one = summarizeJournalGroup([winOf(1)]);
  ok("1 trade: isLowSample === true", one.isLowSample === true);
}

// ==== buildJournalAnalyticsTrades — assembly correctness =====================
{
  const trades = [trade({ positionId: "p1" }), trade({ positionId: "p2" }), trade({ positionId: "p3" })];
  const journalEntries = [
    { id: "e1", position_id: "p1", session: "asia", grade: "A" },
    // p2 and p3 have no journal entry at all.
  ];
  const entryTerms = [
    { journal_entry_id: "e1", term_id: "t-setup", kind: "setup" },
    { journal_entry_id: "e1", term_id: "t-strategy", kind: "strategy" },
    { journal_entry_id: "e1", term_id: "t-emotion", kind: "emotion" },
    { journal_entry_id: "e1", term_id: "t-mistake-1", kind: "mistake" },
    { journal_entry_id: "e1", term_id: "t-mistake-2", kind: "mistake" },
    { journal_entry_id: "e1", term_id: "t-tag-1", kind: "tag" },
    { journal_entry_id: "e1", term_id: "t-tag-2", kind: "tag" },
  ];
  const taxonomyTerms = [
    { id: "t-setup", label: "Order Block" },
    { id: "t-strategy", label: "London Breakout Retest" },
    { id: "t-emotion", label: "Focused" },
    { id: "t-mistake-1", label: "Early Entry" },
    { id: "t-mistake-2", label: "Moved Stop" },
    { id: "t-tag-1", label: "London" },
    { id: "t-tag-2", label: "News" },
  ];

  const result = buildJournalAnalyticsTrades(trades, journalEntries, entryTerms, taxonomyTerms);
  const p1 = result.find((t) => t.positionId === "p1");
  const p2 = result.find((t) => t.positionId === "p2");

  ok("p1: hasJournal true", p1.hasJournal === true);
  eq("p1: journalEntryId", p1.journalEntryId, "e1");
  eq("p1: journalSession", p1.journalSession, "asia");
  eq("p1: grade", p1.grade, "A");
  eq("p1: setup", p1.setup, "Order Block");
  eq("p1: strategy", p1.strategy, "London Breakout Retest");
  eq("p1: emotion", p1.emotion, "Focused");
  eq("p1: mistakes (both attached)", [...p1.mistakes].sort(), ["Early Entry", "Moved Stop"]);
  eq("p1: tags (both attached)", [...p1.tags].sort(), ["London", "News"]);

  ok("p2: hasJournal false (no journal_entries row)", p2.hasJournal === false);
  eq("p2: journalEntryId null", p2.journalEntryId, null);
  eq("p2: journalSession null", p2.journalSession, null);
  eq("p2: grade null", p2.grade, null);
  eq("p2: setup null", p2.setup, null);
  eq("p2: mistakes empty array (never invented)", p2.mistakes, []);
  eq("p2: tags empty array (never invented)", p2.tags, []);

  ok("result has one row per input trade (3 in, 3 out)", result.length === 3);
}

{
  // A journal entry that exists but has no terms attached at all — every
  // taxonomy field stays null/empty, never fabricated.
  const trades = [trade({ positionId: "p1" })];
  const journalEntries = [{ id: "e1", position_id: "p1", session: null, grade: null }];
  const result = buildJournalAnalyticsTrades(trades, journalEntries, [], []);
  const p1 = result[0];
  ok("journal entry with zero terms: hasJournal still true", p1.hasJournal === true);
  eq("journal entry with zero terms: setup null", p1.setup, null);
  eq("journal entry with zero terms: strategy null", p1.strategy, null);
  eq("journal entry with zero terms: emotion null", p1.emotion, null);
  eq("journal entry with zero terms: mistakes []", p1.mistakes, []);
  eq("journal entry with zero terms: tags []", p1.tags, []);
  eq("journal entry with zero terms: journalSession null (not manufactured)", p1.journalSession, null);
  eq("journal entry with zero terms: grade null (not manufactured)", p1.grade, null);
}

// ==== bySetup / byStrategy / byEmotion — single-value grouping ===============
{
  const trades = [
    jTrade({ setup: "Order Block", ...{ realizedPnl: 10 } }),
    jTrade({ setup: "Order Block", ...{ realizedPnl: 20 } }),
    jTrade({ setup: "FVG", ...{ realizedPnl: -5 } }),
    jTrade({ setup: null }), // no setup — must be excluded entirely
  ];
  const rows = bySetup(trades);
  eq("bySetup: excludes trades with no setup (2 groups, not 3)", rows.length, 2);
  const ob = rows.find((r) => r.setup === "Order Block");
  eq("bySetup: Order Block tradeCount", ob.tradeCount, 2);
  close("bySetup: Order Block netPnl", ob.netPnl, 30);
  ok("bySetup: sorted by netPnl descending (Order Block before FVG)", rows[0].setup === "Order Block");
}

{
  const trades = [jTrade({ strategy: "London Breakout Retest" }), jTrade({ strategy: null })];
  eq("byStrategy: excludes null strategy", byStrategy(trades).length, 1);

  const emoTrades = [jTrade({ emotion: "Focused" }), jTrade({ emotion: "FOMO", realizedPnl: -50 })];
  const emoRows = byEmotion(emoTrades);
  eq("byEmotion: two distinct emotions -> two groups", emoRows.length, 2);
}

// ==== byTag / byMistake — multi-value fan-out, no double-counting ============
{
  // One trade with THREE tags must contribute to three groups, but only
  // ONCE to each — never twice to the same tag even if the array somehow
  // contained a duplicate label.
  const t = jTrade({ tags: ["London", "News", "London"], realizedPnl: 12 });
  const rows = byTag([t]);
  eq("byTag: 3-tag array with a duplicate label produces 2 distinct groups", rows.length, 2);
  const london = rows.find((r) => r.tag === "London");
  eq("byTag: duplicate 'London' label still counts the trade only ONCE in that bucket", london.tradeCount, 1);
  const news = rows.find((r) => r.tag === "News");
  eq("byTag: 'News' bucket also has exactly 1 trade", news.tradeCount, 1);
  close("byTag: each bucket reports the SAME trade's full netPnl (12), not a fraction of it", london.netPnl, 12);
  close("byTag: News bucket also reports the full 12, not split", news.netPnl, 12);

  // One trade with two DIFFERENT tags contributes to both groups independently.
  const a = jTrade({ tags: ["A"], realizedPnl: 5 });
  const b = jTrade({ tags: ["A", "B"], realizedPnl: 7 });
  const multi = byTag([a, b]);
  const tagA = multi.find((r) => r.tag === "A");
  const tagB = multi.find((r) => r.tag === "B");
  eq("byTag: tag A has both trades", tagA.tradeCount, 2);
  eq("byTag: tag B has only the second trade", tagB.tradeCount, 1);
  close("byTag: tag A net P&L is the sum of both trades' full amounts", tagA.netPnl, 12);

  // No tags at all -> contributes to zero groups, no "No Tag" bucket invented.
  const untagged = jTrade({ tags: [] });
  eq("byTag: a trade with zero tags produces zero groups on its own", byTag([untagged]).length, 0);
}

{
  const withTwoMistakes = jTrade({ mistakes: ["Early Entry", "Moved Stop"], realizedPnl: -20 });
  const rows = byMistake([withTwoMistakes]);
  eq("byMistake: one trade with 2 mistakes -> 2 groups", rows.length, 2);
  ok("byMistake: both groups see the trade exactly once", rows.every((r) => r.tradeCount === 1));

  // Default sort: net P&L ASCENDING (worst/most costly first) — the one
  // inverted-default table in this whole module.
  const costly = jTrade({ mistakes: ["Revenge Trade"], realizedPnl: -100 });
  const mild = jTrade({ mistakes: ["Late Entry"], realizedPnl: -5 });
  const sorted = byMistake([costly, mild]);
  eq("byMistake: default-sorted worst (most negative) net P&L first", sorted[0].mistake, "Revenge Trade");

  eq("byMistake: no mistakes -> zero groups, no 'No Mistake' bucket invented", byMistake([jTrade({ mistakes: [] })]).length, 0);
}

// ==== byGrade — always all 6 fixed buckets, including zero-trade grades =====
{
  const trades = [jTrade({ grade: "A" }), jTrade({ grade: "A" }), jTrade({ grade: "F", realizedPnl: -30 }), jTrade({ grade: null })];
  const rows = byGrade(trades);
  eq("byGrade: always exactly 6 rows (A+,A,B,C,D,F) regardless of data", rows.length, 6);
  eq("byGrade: fixed order starts at A+", rows[0].grade, "A+");
  eq("byGrade: ends at F", rows[5].grade, "F");
  const aRow = rows.find((r) => r.grade === "A");
  eq("byGrade: A has 2 trades", aRow.tradeCount, 2);
  const bRow = rows.find((r) => r.grade === "B");
  eq("byGrade: B has 0 trades (zero-trade bucket still present)", bRow.tradeCount, 0);
  ok("byGrade: a null-grade trade contributes to no bucket", rows.reduce((s, r) => s + r.tradeCount, 0) === 3);
}

// ==== byJournalSession — distinct from computed UTC session ==================
{
  // closedAt's UTC hour (14:00) computes to "overlap" in metrics.ts's own
  // sessionForUtcHour, but the MANUAL journal session is deliberately set to
  // "asia" here — byJournalSession must classify by the manual field only,
  // never re-derive it from closedAt.
  const t = jTrade({ journalSession: "asia", closedAt: "2026-08-15T14:00:00.000Z" });
  const rows = byJournalSession([t]);
  eq("byJournalSession: always exactly 5 rows", rows.length, 5);
  const asiaRow = rows.find((r) => r.session === "asia");
  eq("byJournalSession: manual session 'asia' used, NOT the computed-from-closedAt session", asiaRow.tradeCount, 1);
  const overlapRow = rows.find((r) => r.session === "overlap");
  eq("byJournalSession: computed session ('overlap' for this hour) is NOT silently substituted", overlapRow.tradeCount, 0);

  const noSession = jTrade({ journalSession: null });
  const noneRows = byJournalSession([noSession]);
  ok("byJournalSession: a trade with no manual session contributes to no bucket", noneRows.every((r) => r.tradeCount === 0));
}

// ==== journaledVsNonJournaled — partition sums to the base total =============
{
  const trades = [
    jTrade({ hasJournal: true, realizedPnl: 10 }),
    jTrade({ hasJournal: true, realizedPnl: 20 }),
    jTrade({ hasJournal: false, realizedPnl: -5 }),
  ];
  const { journaled, nonJournaled } = journaledVsNonJournaled(trades);
  eq("journaledVsNonJournaled: journaled count", journaled.tradeCount, 2);
  eq("journaledVsNonJournaled: nonJournaled count", nonJournaled.tradeCount, 1);
  eq(
    "journaledVsNonJournaled: counts sum to the base filtered total",
    journaled.tradeCount + nonJournaled.tradeCount,
    trades.length,
  );
  close("journaledVsNonJournaled: journaled netPnl", journaled.netPnl, 30);
  close("journaledVsNonJournaled: nonJournaled netPnl", nonJournaled.netPnl, -5);

  // All journaled / all non-journaled edge cases never crash and still sum correctly.
  const allJournaled = journaledVsNonJournaled([jTrade({ hasJournal: true }), jTrade({ hasJournal: true })]);
  eq("journaledVsNonJournaled: all-journaled nonJournaled count is 0", allJournaled.nonJournaled.tradeCount, 0);
  const allNon = journaledVsNonJournaled([jTrade({ hasJournal: false })]);
  eq("journaledVsNonJournaled: all-non-journaled journaled count is 0", allNon.journaled.tradeCount, 0);

  // Phase 4G: Trade Explorer reuses this exact function against its own
  // already-loaded rows, which carry ONLY `hasJournal` — never the full
  // taxonomy join (journalEntryId/session/grade/setup/strategy/emotion/
  // mistakes/tags) a `JournalAnalyticsTrade` has. This proves the widened
  // `JournaledTrade` parameter type still produces correct results against
  // that minimal shape, with no other journal fields present at all.
  const minimalRows = [
    { ...trade({ realizedPnl: 10 }), hasJournal: true },
    { ...trade({ realizedPnl: -4 }), hasJournal: false },
    { ...trade({ realizedPnl: 6 }), hasJournal: true },
  ];
  const fromMinimalRows = journaledVsNonJournaled(minimalRows);
  eq("journaledVsNonJournaled: works against a minimal {ClosedTrade, hasJournal} row shape (Trade Explorer reuse)", fromMinimalRows.journaled.tradeCount, 2);
  eq("journaledVsNonJournaled: minimal-shape nonJournaled count", fromMinimalRows.nonJournaled.tradeCount, 1);
  close("journaledVsNonJournaled: minimal-shape journaled netPnl", fromMinimalRows.journaled.netPnl, 16);
}

// ==== Combination analytics ===================================================
{
  // Grade x Setup
  const trades = [
    jTrade({ grade: "A", setup: "Order Block", realizedPnl: 10 }),
    jTrade({ grade: "A", setup: "Order Block", realizedPnl: 20 }),
    jTrade({ grade: "A", setup: "FVG", realizedPnl: -5 }),
    jTrade({ grade: "F", setup: "Order Block", realizedPnl: -100 }),
    jTrade({ grade: "A", setup: null }), // missing setup side -> excluded from this combo
    jTrade({ grade: null, setup: "Order Block" }), // missing grade side -> excluded
  ];
  const combo = byGradeAndSetup(trades);
  eq("byGradeAndSetup: 3 real (grade,setup) cells", combo.length, 3);
  const aOb = combo.find((c) => c.grade === "A" && c.setup === "Order Block");
  eq("byGradeAndSetup: A x Order Block has 2 trades", aOb.tradeCount, 2);
  close("byGradeAndSetup: A x Order Block netPnl", aOb.netPnl, 30);
  ok(
    "byGradeAndSetup: a trade missing EITHER side contributes to no cell",
    combo.reduce((s, c) => s + c.tradeCount, 0) === 4,
  );
}

{
  // Emotion x Outcome — outcome is classifyTrade's real classification, not
  // a parallel definition.
  const focusedWin = jTrade({ emotion: "Focused", realizedPnl: 15 });
  const focusedLoss = jTrade({ emotion: "Focused", realizedPnl: -15 });
  const fomoLoss = jTrade({ emotion: "FOMO", realizedPnl: -40 });
  const combo = byEmotionAndOutcome([focusedWin, focusedLoss, fomoLoss]);
  const focusedWinCell = combo.find((c) => c.emotion === "Focused" && c.outcome === "win");
  const focusedLossCell = combo.find((c) => c.emotion === "Focused" && c.outcome === "loss");
  const fomoLossCell = combo.find((c) => c.emotion === "FOMO" && c.outcome === "loss");
  eq("byEmotionAndOutcome: Focused x win has 1 trade", focusedWinCell.tradeCount, 1);
  eq("byEmotionAndOutcome: Focused x loss has 1 trade", focusedLossCell.tradeCount, 1);
  eq("byEmotionAndOutcome: FOMO x loss has 1 trade", fomoLossCell.tradeCount, 1);
  eq(
    "byEmotionAndOutcome: outcome matches classifyTrade's own real classification",
    focusedWinCell.outcome,
    classifyTrade(focusedWin),
  );
}

{
  // Mistake x Setup — mistake side fans out like byMistake.
  const t = jTrade({ mistakes: ["Early Entry", "Moved Stop"], setup: "Order Block", realizedPnl: -30 });
  const combo = byMistakeAndSetup([t]);
  eq("byMistakeAndSetup: one trade with 2 mistakes on 1 setup -> 2 cells", combo.length, 2);
  ok("byMistakeAndSetup: each cell sees the trade exactly once", combo.every((c) => c.tradeCount === 1));
  ok("byMistakeAndSetup: default sorted worst net P&L first", combo[0].netPnl <= combo[combo.length - 1].netPnl);
}

// ==== sortJournalGroups ========================================================
{
  const groups = [
    { tradeCount: 5, winRatePct: 40, netPnl: 100, avgNetTrade: 20, profitFactor: 1.5 },
    { tradeCount: 2, winRatePct: 80, netPnl: -50, avgNetTrade: -25, profitFactor: null },
    { tradeCount: 9, winRatePct: null, netPnl: 0, avgNetTrade: 0, profitFactor: 2.0 },
  ];
  const byNetPnlDesc = sortJournalGroups(groups, "netPnl", "desc");
  eq("sortJournalGroups: netPnl desc order", byNetPnlDesc.map((g) => g.netPnl), [100, 0, -50]);
  const byNetPnlAsc = sortJournalGroups(groups, "netPnl", "asc");
  eq("sortJournalGroups: netPnl asc order", byNetPnlAsc.map((g) => g.netPnl), [-50, 0, 100]);

  const byPf = sortJournalGroups(groups, "profitFactor", "desc");
  ok("sortJournalGroups: null profitFactor always sorts last, even descending", byPf[byPf.length - 1].profitFactor === null);
  const byPfAsc = sortJournalGroups(groups, "profitFactor", "asc");
  ok("sortJournalGroups: null profitFactor sorts last ascending too (never coerced to 0)", byPfAsc[byPfAsc.length - 1].profitFactor === null);

  const byWinRate = sortJournalGroups(groups, "winRatePct", "desc");
  ok("sortJournalGroups: null winRatePct sorts last regardless of direction", byWinRate[byWinRate.length - 1].winRatePct === null);
}

// ==== applyJournalFocusFilter ==================================================
{
  const trades = [
    jTrade({ setup: "Order Block", mistakes: ["Early Entry"], tags: ["London"], grade: "A", emotion: "Focused", journalSession: "asia" }),
    jTrade({ setup: "FVG", mistakes: ["Late Entry"], tags: ["News"], grade: "F", emotion: "FOMO", journalSession: "london" }),
  ];
  eq("applyJournalFocusFilter: null focus passes every trade through unchanged", applyJournalFocusFilter(trades, null).length, 2);
  eq("applyJournalFocusFilter: setup focus", applyJournalFocusFilter(trades, { kind: "setup", value: "Order Block" }).length, 1);
  eq("applyJournalFocusFilter: grade focus", applyJournalFocusFilter(trades, { kind: "grade", value: "F" }).length, 1);
  eq("applyJournalFocusFilter: emotion focus", applyJournalFocusFilter(trades, { kind: "emotion", value: "Focused" }).length, 1);
  eq("applyJournalFocusFilter: mistake focus (array membership)", applyJournalFocusFilter(trades, { kind: "mistake", value: "Late Entry" }).length, 1);
  eq("applyJournalFocusFilter: tag focus (array membership)", applyJournalFocusFilter(trades, { kind: "tag", value: "London" }).length, 1);
  eq("applyJournalFocusFilter: session focus", applyJournalFocusFilter(trades, { kind: "session", value: "london" }).length, 1);
  eq("applyJournalFocusFilter: no match -> empty, not an error", applyJournalFocusFilter(trades, { kind: "setup", value: "Nonexistent" }).length, 0);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
