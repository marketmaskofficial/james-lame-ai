// Deterministic, no-model description of a generated indicator.
//
// UI-5b's "Explain" action reads the IndicatorSpec directly rather than
// asking the model to re-describe the code: the spec is already the single
// source of truth the Pine and SGScript twins were generated from (see the
// header comment in ./types.ts), so formatting it can't drift from what was
// actually built and can't regenerate or modify anything.

import type { IndicatorSpec, SpecInput, SpecRule } from "./types";

function inputLine(i: SpecInput): string {
  const bits: string[] = [i.type];
  if (i.min !== undefined || i.max !== undefined) {
    bits.push(`range ${i.min ?? "-∞"}..${i.max ?? "∞"}`);
  }
  if (i.options?.length) bits.push(`one of: ${i.options.join(", ")}`);
  return `- ${i.label || i.name} (${bits.join(", ")}), default ${JSON.stringify(i.default)}`;
}

function ruleLines(rules: SpecRule[]): string[] {
  return rules.map((r) => `- ${r.description}${r.logic ? ` (${r.logic})` : ""}`);
}

function section(title: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `${title}:\n${lines.join("\n")}`;
}

/** Renders the current spec as plain-language sections. Pure and synchronous — describes, never regenerates. */
export function explainSpec(spec: IndicatorSpec): string {
  const parts: string[] = [];

  parts.push(
    `"${spec.name}" is ${spec.kind === "strategy" ? "a strategy" : "an indicator"}, plotted ${
      spec.overlay ? "directly on price" : "in its own pane"
    }.`,
  );

  if (spec.purpose) parts.push(`Purpose: ${spec.purpose}`);

  if (spec.inputs.length) {
    parts.push(section(`Inputs (${spec.inputs.length})`, spec.inputs.map(inputLine)));
  }

  parts.push(section("How it's calculated", ruleLines(spec.calculations)));
  parts.push(section("Bullish conditions", ruleLines(spec.bullishConditions)));
  parts.push(section("Bearish conditions", ruleLines(spec.bearishConditions)));
  parts.push(section("Confirmations required", ruleLines(spec.confirmations)));
  parts.push(section("State rules", ruleLines(spec.stateRules)));

  if (spec.kind === "strategy") {
    parts.push(section("Entries", ruleLines(spec.entries)));
    parts.push(section("Exits", ruleLines(spec.exits)));
    const risk = [
      spec.stopLoss ? `Stop loss: ${spec.stopLoss}` : "",
      spec.takeProfit ? `Take profit: ${spec.takeProfit}` : "",
      spec.riskReward ? `Risk:reward: ${spec.riskReward}` : "",
    ].filter(Boolean);
    if (risk.length) parts.push(risk.join("\n"));
  }

  if (spec.plots.length) parts.push(section("Plots", spec.plots.map((p) => `- ${p}`)));

  parts.push(`Repaint classification: ${spec.repaint}.`);

  if (spec.dataLimitations.length) {
    parts.push(section("Known data limitations", spec.dataLimitations.map((d) => `- ${d}`)));
  }
  if (spec.assumptions.length) {
    parts.push(section("Assumptions", spec.assumptions.map((a) => `- ${a}`)));
  }

  parts.push(
    "This description comes directly from the indicator's specification — the same specification its Pine and SGScript code were generated from — not a new AI read of the code.",
  );

  return parts.filter(Boolean).join("\n\n");
}
