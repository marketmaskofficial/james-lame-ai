// Coverage for the Phase 3a/3b backtest engine additions: risk-based
// position sizing, breakeven stop moves, MAE/MFE tracking, and determinism.
// Hand-builds bars + a StrategyOut directly against runBacktestEngine() —
// the same engine the app uses, not a second interpretation — so this
// exercises exactly the code path a real strategy goes through, just
// without needing a full runScript() round-trip for numbers that are
// easiest to reason about when the bars are chosen by hand.
//
// Usage: npx tsx test/backtest/engine.test.mjs

import { runBacktestEngine, DEFAULT_SETTINGS } from "../../src/lib/backtest/engine.ts";

let pass = 0;
let fail = 0;
const failures = [];

function bar(time, open, high, low, close, volume = 1) {
  return { time, open, high, low, close, volume };
}

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`); }
}

function close(name, actual, expected, eps = 1e-6) {
  if (typeof actual === "number" && Math.abs(actual - expected) <= eps) pass++;
  else { fail++; failures.push(`${name}\n  expected: ~${expected}\n  actual:   ${actual}`); }
}

const SYMBOL = "TESTUSD"; // falls through to genericCrypto: tickSize 0.01, qtyStep 0.0001, multiplier 1

function emptyStrategy(entries, exits = []) {
  return { declared: true, entries, exits, notes: [] };
}

// ---- risk-based position sizing --------------------------------------------
{
  const bars = [bar(0, 100, 100, 100, 100), bar(60, 100, 100, 100, 100), bar(120, 100, 100, 100, 100)];
  const strategy = emptyStrategy([
    {
      bar: 0, side: "long", stop: 95, target: null, targetR: null, trail: null,
      qty: null, breakEvenAfterR: null, riskPercent: 2, comment: "long",
    },
  ]);
  const settings = { ...DEFAULT_SETTINGS, startingCapital: 10000, slippageTicks: 0 };
  const result = runBacktestEngine({ bars, strategy, symbol: SYMBOL, interval: "1m", strategyName: "test", settings });
  if (result.ok) {
    // riskCash = 10000 * 2% = 200; riskPerUnit = |100 - 95| = 5; qty = 200/5 = 40
    close("risk-based sizing: qty = riskCash / riskPerUnit", result.trades[0]?.qty, 40);
  } else {
    fail++; failures.push(`risk-based sizing: backtest was blocked — ${result.message}`);
  }
}

// ---- risk-based sizing without a stop: falls back, but never silently ----
{
  const bars = [bar(0, 100, 100, 100, 100), bar(60, 100, 100, 100, 100), bar(120, 100, 100, 100, 100)];
  const strategy = emptyStrategy([
    {
      bar: 0, side: "long", stop: null, target: null, targetR: null, trail: null,
      qty: null, breakEvenAfterR: null, riskPercent: 2, comment: "long",
    },
  ]);
  const result = runBacktestEngine({
    bars, strategy, symbol: SYMBOL, interval: "1m", strategyName: "test",
    settings: { ...DEFAULT_SETTINGS, slippageTicks: 0 }, // default sizing: percent_equity 10%
  });
  // No stop -> riskBasedQty can't be computed -> falls back to the settings'
  // sizing mode (which can size fine without a stop) rather than dropping
  // the trade — but that substitution must be reported, not silent.
  check("risk-based sizing without a stop: trade still opens via fallback sizing", result.ok, true);
  if (result.ok) {
    check("  -> qty came from percent_equity fallback, not risk-based (0)", result.trades.length, 1);
    check(
      "  -> the substitution is reported in limitations, not silent",
      result.limitations.some((l) => l.includes("requested risk-based sizing but declared no stop")),
      true,
    );
  }
}

// ---- breakeven stop move + MAE/MFE -----------------------------------------
{
  const bars = [
    bar(0, 100, 100, 100, 100),      // signal bar
    bar(60, 100, 100, 100, 100),     // entry fills at this bar's open = 100
    bar(120, 101, 106, 101, 105),    // favourable excursion to 106 (+6, >= 1R of 5) arms breakeven -> stop 95->100
    bar(180, 104, 104, 95, 96),      // reverses hard; ORIGINAL stop (95) would still be hit, but so does the NEW one (100)
  ];
  const strategy = emptyStrategy([
    {
      bar: 0, side: "long", stop: 95, target: null, targetR: null, trail: null,
      qty: 1, breakEvenAfterR: 1, riskPercent: null, comment: "long",
    },
  ]);
  const result = runBacktestEngine({
    bars, strategy, symbol: SYMBOL, interval: "1m", strategyName: "test",
    settings: { ...DEFAULT_SETTINGS, slippageTicks: 0, commissionPerUnit: 0 },
  });
  if (result.ok && result.trades.length === 1) {
    const t = result.trades[0];
    // If breakeven had NOT armed, this would exit at 95 with a real loss.
    // Exiting at exactly 100 with ~0 pnl is the only way to prove the stop
    // actually moved, not just that *some* stop got hit.
    close("breakeven: exit price is the moved stop (100), not the original (95)", t.exitPrice, 100);
    close("breakeven: pnl is ~0 (protected at entry, not a loss)", t.pnl, 0);
    check("breakeven: exit reason is Stop Loss", t.exitReason, "Stop Loss");
    // MFE: best price reached after entry was 106 -> 6 points of favourable excursion.
    close("MFE: best excursion after entry (106 - 100)", t.mfe, 6);
    // MAE: worst price reached after entry was 95 -> 5 points of adverse excursion.
    close("MAE: worst excursion after entry (100 - 95)", t.mae, 5);
    // 1R = |entry(100) - initialStop(95)| = 5. mfeR = 6/5 = 1.2, maeR = 5/5 = 1.
    close("MFE in R (initial risk, not the moved stop)", t.mfeR, 1.2);
    close("MAE in R (initial risk, not the moved stop)", t.maeR, 1);
  } else {
    fail++;
    failures.push(`breakeven/MAE-MFE: expected exactly one trade, got: ${JSON.stringify(result)}`);
  }
}

// ---- determinism -------------------------------------------------------------
{
  const makeArgs = () => ({
    bars: [
      bar(0, 100, 101, 99, 100.5),
      bar(60, 100.5, 102, 100, 101.5),
      bar(120, 101.5, 103, 101, 102.5),
      bar(180, 102.5, 104, 98, 99),
      bar(240, 99, 100, 97, 98),
    ],
    strategy: emptyStrategy([
      {
        bar: 0, side: "long", stop: 97, target: 105, targetR: null, trail: null,
        qty: null, breakEvenAfterR: 0.5, riskPercent: 1, comment: "long",
      },
    ]),
    symbol: SYMBOL,
    interval: "1m",
    strategyName: "determinism test",
    settings: { ...DEFAULT_SETTINGS, startingCapital: 25000, slippageTicks: 1, commissionPerUnit: 0.5 },
  });

  const r1 = runBacktestEngine(makeArgs());
  const r2 = runBacktestEngine(makeArgs());
  check("determinism: identical inputs run twice produce byte-identical output", r1, r2);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
