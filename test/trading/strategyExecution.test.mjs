// Phase 5B-1 — coverage for src/lib/trading/strategyExecution.ts, the pure
// StrategyOutput -> OMS order-intent adapter. Same hand-rolled ok()/eq()
// style as test/builder/generationState.test.mjs — no mocking, every
// scenario built from plain bar/strategy fixtures.
//
// Usage: npx tsx test/trading/strategyExecution.test.mjs

import { resolveOrderIntent, selectEligibleSignals, strategySignalId } from "../../src/lib/trading/strategyExecution.ts";

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

function bar(time, overrides = {}) {
  return { time, open: 100, high: 101, low: 99, close: 100, volume: 10, ...overrides };
}
function bars(times) {
  return times.map((t) => bar(t));
}
function ctx(overrides = {}) {
  return {
    armedAt: 1000,
    indicatorId: "ind-1",
    indicatorVersion: 3,
    indicatorName: "Test Strategy",
    accountId: "acct-1",
    symbol: "BTCUSDT",
    timeframe: "15m",
    ...overrides,
  };
}
function strategy(entries = [], exits = []) {
  return { declared: true, entries, exits, notes: [] };
}
function entry(overrides = {}) {
  return { bar: 0, side: "long", stop: null, target: null, targetR: null, trail: null, qty: null, breakEvenAfterR: null, riskPercent: null, comment: "", ...overrides };
}
function exit(overrides = {}) {
  return { bar: 0, side: null, comment: "", ...overrides };
}

// ==== strategySignalId — deterministic, never random =========================
{
  const c = ctx();
  const id1 = strategySignalId(c, 1500, "entry", "long");
  const id2 = strategySignalId(c, 1500, "entry", "long");
  eq("strategySignalId: identical inputs produce the identical id (deterministic, not random)", id1, id2);
  ok("strategySignalId: different bar times produce different ids", strategySignalId(c, 1500, "entry", "long") !== strategySignalId(c, 1600, "entry", "long"));
  ok("strategySignalId: different sides produce different ids", strategySignalId(c, 1500, "entry", "long") !== strategySignalId(c, 1500, "entry", "short"));
  ok("strategySignalId: entry vs exit produce different ids", strategySignalId(c, 1500, "entry", "long") !== strategySignalId(c, 1500, "exit", "long"));
  ok("strategySignalId: a null side (flatten) is distinguishable from a real side", strategySignalId(c, 1500, "exit", null) !== strategySignalId(c, 1500, "exit", "long"));
}

// ==== selectEligibleSignals — the historical/new-bar boundary (5B-6) ========
{
  // armedAt=1000. Bars: 900 (historical), 1000 (== armedAt, still excluded),
  // 1100 (new, confirmed since a newer bar exists), 1200 (currently forming).
  const b = bars([900, 1000, 1100, 1200]);
  const strat = strategy([
    entry({ bar: 0 }), // historical (900 <= armedAt)
    entry({ bar: 1 }), // == armedAt, still excluded (armedAt is the boundary bar itself, not eligible)
    entry({ bar: 2, side: "long" }), // NEW and confirmed (1100 > 1000, and bar 3 exists after it)
    entry({ bar: 3, side: "long" }), // currently forming last bar — never eligible yet
  ]);
  const eligible = selectEligibleSignals(strat, b, ctx(), new Set());
  eq("selectEligibleSignals: exactly one signal is eligible (only the confirmed bar strictly after armedAt)", eligible.length, 1);
  eq("selectEligibleSignals: the eligible signal is the one on bar time 1100", eligible[0].barTime, 1100);

  ok("selectEligibleSignals: a signal on the still-forming last bar is NEVER eligible, even if it would otherwise qualify (no repaint execution)", !eligible.some((s) => s.barTime === 1200));
  ok("selectEligibleSignals: a signal on the armedAt bar itself is excluded (armedAt is a boundary, not a green light)", !eligible.some((s) => s.barTime === 1000));
  ok("selectEligibleSignals: a signal on a historical bar before armedAt is excluded", !eligible.some((s) => s.barTime === 900));
}

// ==== selectEligibleSignals — dedup guard (5B-7) ==============================
{
  const b = bars([1000, 1100, 1200]);
  const strat = strategy([entry({ bar: 1, side: "long" })]);
  const c = ctx();
  const first = selectEligibleSignals(strat, b, c, new Set());
  eq("selectEligibleSignals: a genuinely new signal is returned the first time", first.length, 1);

  const alreadyProcessed = new Set([first[0].signalId]);
  const second = selectEligibleSignals(strat, b, c, alreadyProcessed);
  eq("selectEligibleSignals: the SAME strategy re-evaluated against the SAME bars (settings tweak, resize, remount, repeated effect run) returns NOTHING once its signalId is marked processed", second.length, 0);
}

// ==== selectEligibleSignals — a settings/code change never replays an old
// ==== bar's signal, and never fabricates work when nothing declared ========
{
  ok("selectEligibleSignals: an undeclared strategy (visual-only indicator) returns nothing, no matter what entries/exits arrays contain", selectEligibleSignals({ declared: false, entries: [entry()], exits: [], notes: [] }, bars([1000, 1100]), ctx(), new Set()).length === 0);
  ok("selectEligibleSignals: fewer than 2 bars returns nothing (there is no 'a newer bar exists' to confirm anything against)", selectEligibleSignals(strategy([entry({ bar: 0 })]), bars([1100]), ctx(), new Set()).length === 0);
}

// ==== selectEligibleSignals — exits follow the identical boundary rules ====
{
  const b = bars([1000, 1100, 1200]);
  const strat = strategy([], [exit({ bar: 1, side: "long" })]);
  const eligible = selectEligibleSignals(strat, b, ctx(), new Set());
  eq("selectEligibleSignals: an eligible exit is returned", eligible.length, 1);
  eq("selectEligibleSignals: the exit's kind is exit", eligible[0].kind, "exit");
  eq("selectEligibleSignals: the exit carries its declared side", eligible[0].declaredSide, "long");
}

// ==== resolveOrderIntent — entries always resolve (OMS handles reversal) ===
{
  const pendingLong = { signalId: "s1", kind: "entry", declaredSide: "long", barTime: 1100, qty: null, stopLoss: 95, takeProfit: 110 };
  const r1 = resolveOrderIntent(pendingLong, null, 1);
  eq("resolveOrderIntent: a long entry with no declared qty uses the configured default qty", r1.qty, 1);
  eq("resolveOrderIntent: a long entry resolves to a buy order", r1.side, "buy");
  eq("resolveOrderIntent: an entry is never reduceOnly", r1.reduceOnly, false);
  eq("resolveOrderIntent: an entry carries the declared stopLoss through", r1.stopLoss, 95);
  eq("resolveOrderIntent: an entry carries the declared takeProfit through", r1.takeProfit, 110);

  const pendingShort = { signalId: "s2", kind: "entry", declaredSide: "short", barTime: 1100, qty: 5, stopLoss: null, takeProfit: null };
  const r2 = resolveOrderIntent(pendingShort, { side: "buy", qty: 3 }, 1);
  eq("resolveOrderIntent: a short entry resolves to a sell order regardless of any currently open position — OMS's own native flip handles the reversal, this adapter never invents close-then-open accounting", r2.side, "sell");
  eq("resolveOrderIntent: a script-declared qty overrides the configured default", r2.qty, 5);
  ok("resolveOrderIntent: an entry never includes stopLoss/takeProfit keys when none were declared", !("stopLoss" in r2) && !("takeProfit" in r2));
}

// ==== resolveOrderIntent — exits only resolve against a REAL open position =
{
  const pendingExitLong = { signalId: "s3", kind: "exit", declaredSide: "long", barTime: 1100, qty: null, stopLoss: null, takeProfit: null };
  ok("resolveOrderIntent: an exit with NO open position resolves to null — never a fabricated close", resolveOrderIntent(pendingExitLong, null, 1) === null);
  ok("resolveOrderIntent: an exit declared for 'long' when the open position is actually short resolves to null — never closes the wrong side", resolveOrderIntent(pendingExitLong, { side: "sell", qty: 2 }, 1) === null);

  const r = resolveOrderIntent(pendingExitLong, { side: "buy", qty: 4 }, 1);
  ok("resolveOrderIntent: an exit against a matching open long resolves to a real order", r !== null);
  eq("resolveOrderIntent: closing a long resolves to a sell order", r.side, "sell");
  eq("resolveOrderIntent: closing is sized to the position's OWN qty, never the strategy's entry qty or the configured default", r.qty, 4);
  eq("resolveOrderIntent: closing is always reduceOnly", r.reduceOnly, true);
  eq("resolveOrderIntent: closing is tagged purpose exit", r.purpose, "exit");

  const pendingExitFlatten = { signalId: "s4", kind: "exit", declaredSide: null, barTime: 1100, qty: null, stopLoss: null, takeProfit: null };
  const rShort = resolveOrderIntent(pendingExitFlatten, { side: "sell", qty: 2 }, 1);
  ok("resolveOrderIntent: a null declaredSide (flatten anything) closes whatever is actually open, here a short", rShort !== null && rShort.side === "buy" && rShort.qty === 2);
  const rLong = resolveOrderIntent(pendingExitFlatten, { side: "buy", qty: 7 }, 1);
  ok("resolveOrderIntent: the same null-declaredSide exit closes a long just as well", rLong !== null && rLong.side === "sell" && rLong.qty === 7);
}

// ==== resolveOrderIntent — never a zero/negative fabricated quantity =======
{
  const pending = { signalId: "s5", kind: "entry", declaredSide: "long", barTime: 1100, qty: 0, stopLoss: null, takeProfit: null };
  ok("resolveOrderIntent: a declared qty of 0 falls back to the configured default rather than submitting a zero-qty order", resolveOrderIntent(pending, null, 2).qty === 2);
  ok("resolveOrderIntent: if even the default qty is not positive, resolves to null rather than submitting an invalid order", resolveOrderIntent(pending, null, 0) === null);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
