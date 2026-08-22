// Coverage for UI-5b's Explain action: src/lib/spec/explain.ts.
// explainSpec() is a pure, synchronous formatter of the IndicatorSpec that
// already drove the Pine/SGScript generation — no model call, no market
// data. These tests confirm it reads real spec fields faithfully (not a
// canned string) and never mutates its input.
//
// Usage: npx tsx test/workspace/aiBuilderExplain.test.mjs

import { explainSpec } from "../../src/lib/spec/explain.ts";
import { coerceSpec, EMPTY_SPEC } from "../../src/lib/spec/types.ts";

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

function includes(name, haystack, needle) {
  ok(`${name} (contains "${needle}")`, haystack.includes(needle));
}

function notIncludes(name, haystack, needle) {
  ok(`${name} (must not contain "${needle}")`, !haystack.includes(needle));
}

{
  const spec = coerceSpec({
    name: "EMA 21/55 Cross",
    purpose: "Trend-follow using a fast/slow EMA cross with an ATR trailing stop.",
    kind: "strategy",
    overlay: true,
    inputs: [
      { name: "fastLen", label: "Fast EMA length", type: "number", default: 21, min: 1, max: 200, step: 1 },
      { name: "slowLen", label: "Slow EMA length", type: "number", default: 55, min: 1, max: 400, step: 1 },
      { name: "useAtr", label: "Use ATR stop", type: "bool", default: true },
    ],
    calculations: [
      { id: "c1", description: "Fast EMA of close over fastLen", logic: "ema(close, fastLen)" },
      { id: "c2", description: "Slow EMA of close over slowLen", logic: "ema(close, slowLen)" },
    ],
    bullishConditions: [{ id: "b1", description: "Fast EMA crosses above slow EMA" }],
    bearishConditions: [{ id: "b2", description: "Fast EMA crosses below slow EMA" }],
    confirmations: [{ id: "cf1", description: "Volume above its 20-bar average" }],
    entries: [{ id: "e1", description: "Enter long on bullish cross with confirmation" }],
    exits: [{ id: "x1", description: "Exit on ATR trailing stop hit" }],
    stopLoss: "2x ATR(14) below entry",
    takeProfit: "3R",
    riskReward: "1:1.5",
    plots: ["Fast EMA line", "Slow EMA line", "ATR trailing stop line"],
    repaint: "confirmed-bar-only",
    dataLimitations: ["Backtested on daily bars only"],
    assumptions: ["Applies to liquid large-cap symbols"],
  });

  const text = explainSpec(spec);

  includes("name", text, "EMA 21/55 Cross");
  includes("purpose", text, "Trend-follow using a fast/slow EMA cross");
  includes("kind (strategy)", text, "a strategy");
  includes("overlay", text, "directly on price");
  includes("input count", text, "Inputs (3)");
  includes("input label", text, "Fast EMA length");
  includes("input range", text, "range 1..200");
  includes("calculation logic", text, "ema(close, fastLen)");
  includes("bullish condition", text, "Fast EMA crosses above slow EMA");
  includes("bearish condition", text, "Fast EMA crosses below slow EMA");
  includes("confirmation", text, "Volume above its 20-bar average");
  includes("entry (strategy kind)", text, "Enter long on bullish cross with confirmation");
  includes("exit (strategy kind)", text, "Exit on ATR trailing stop hit");
  includes("stop loss", text, "2x ATR(14) below entry");
  includes("take profit", text, "3R");
  includes("risk:reward", text, "1:1.5");
  includes("plots", text, "ATR trailing stop line");
  includes("repaint classification", text, "confirmed-bar-only");
  includes("data limitations", text, "Backtested on daily bars only");
  includes("assumptions", text, "liquid large-cap symbols");
  includes("honesty disclaimer", text, "not a new AI read of the code");

  // Deep-freeze-style guard: explainSpec must not mutate the spec object it reads.
  const before = JSON.stringify(spec);
  explainSpec(spec);
  ok("does not mutate the input spec", JSON.stringify(spec) === before);
}

{
  // Plain indicator (not a strategy): entries/exits/stop-loss section must be
  // omitted entirely, not shown empty — an indicator has no trade management.
  const spec = coerceSpec({
    name: "RSI Divergence",
    kind: "indicator",
    overlay: false,
    purpose: "Flags bullish/bearish RSI divergence with labels.",
    bullishConditions: [{ id: "b1", description: "Price makes a lower low while RSI makes a higher low" }],
  });
  const text = explainSpec(spec);
  includes("indicator kind", text, "an indicator");
  includes("non-overlay pane", text, "its own pane");
  notIncludes("no Entries section for a plain indicator", text, "Entries:");
  notIncludes("no Exits section for a plain indicator", text, "Exits:");
  notIncludes("no stop loss line for a plain indicator", text, "Stop loss:");
}

{
  // The empty/default spec must still produce a non-empty, sensible description
  // rather than throwing or returning blank sections.
  const text = explainSpec(EMPTY_SPEC);
  ok("empty spec still produces text", typeof text === "string" && text.length > 0);
  includes("empty spec default name", text, "Untitled indicator");
  includes("empty spec repaint", text, "unknown");
}

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
