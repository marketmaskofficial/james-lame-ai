// Indicator Specification — the source of truth for every Signal Goat project.
//
// The AI produces a spec first, and both representations (Pine Script for
// export, SGScript for the live chart) are generated from it. Conversational
// edits patch the spec, not the code, so unrelated logic is never regenerated.

import { z } from "zod";

export const RepaintClassSchema = z.enum([
  "non-repainting",
  "confirmed-bar-only",
  "realtime-changing",
  "intentionally-repainting",
  "potentially-repainting",
  "unknown",
]);
export type RepaintClass = z.infer<typeof RepaintClassSchema>;

export const SpecInputSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.enum(["number", "bool", "string", "color", "source", "timeframe"]),
  default: z.union([z.number(), z.boolean(), z.string()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  group: z.string().optional(),
});
export type SpecInput = z.infer<typeof SpecInputSchema>;

export const SpecRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  // Deterministic restatement of the rule, e.g. "close > ema(close, len)".
  logic: z.string().optional(),
});
export type SpecRule = z.infer<typeof SpecRuleSchema>;

export const IndicatorSpecSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().default("Untitled indicator"),
  purpose: z.string().default(""),
  kind: z.enum(["indicator", "strategy"]).default("indicator"),
  overlay: z.boolean().default(true),

  // Market context
  symbols: z.array(z.string()).default([]),
  timeframe: z.string().optional(),
  higherTimeframes: z.array(z.string()).default([]),
  lowerTimeframes: z.array(z.string()).default([]),
  sessions: z.array(z.string()).default([]),

  // Data
  dataRequirements: z.array(z.string()).default([]),
  dataLimitations: z.array(z.string()).default([]),

  // Logic
  inputs: z.array(SpecInputSchema).default([]),
  calculations: z.array(SpecRuleSchema).default([]),
  bullishConditions: z.array(SpecRuleSchema).default([]),
  bearishConditions: z.array(SpecRuleSchema).default([]),
  confirmations: z.array(SpecRuleSchema).default([]),
  stateRules: z.array(SpecRuleSchema).default([]),
  entries: z.array(SpecRuleSchema).default([]),
  exits: z.array(SpecRuleSchema).default([]),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
  riskReward: z.string().optional(),

  // Presentation
  plots: z.array(z.string()).default([]),
  drawings: z.array(z.string()).default([]),
  alerts: z.array(z.string()).default([]),
  colors: z.record(z.string(), z.string()).default({}),

  // Meta
  repaint: RepaintClassSchema.default("unknown"),
  assumptions: z.array(z.string()).default([]),
});

export type IndicatorSpec = z.infer<typeof IndicatorSpecSchema>;

export const EMPTY_SPEC: IndicatorSpec = IndicatorSpecSchema.parse({});

/** Accepts loose/partial AI output and never throws. */
export function coerceSpec(input: unknown): IndicatorSpec {
  const parsed = IndicatorSpecSchema.safeParse(input);
  return parsed.success ? parsed.data : EMPTY_SPEC;
}

/** Compact human summary used in chat and version changelogs. */
export function summarizeSpec(spec: IndicatorSpec): string {
  const bits: string[] = [];
  bits.push(spec.kind === "strategy" ? "Strategy" : "Indicator");
  if (spec.timeframe) bits.push(spec.timeframe);
  if (spec.higherTimeframes.length) bits.push(`HTF ${spec.higherTimeframes.join("/")}`);
  if (spec.sessions.length) bits.push(spec.sessions.join("/"));
  const counts = [
    spec.bullishConditions.length ? `${spec.bullishConditions.length} bull` : "",
    spec.bearishConditions.length ? `${spec.bearishConditions.length} bear` : "",
    spec.inputs.length ? `${spec.inputs.length} inputs` : "",
  ].filter(Boolean);
  if (counts.length) bits.push(counts.join(", "));
  return bits.join(" · ");
}

/** Field-level diff between two specs, for version comparison. */
export function diffSpecs(a: IndicatorSpec, b: IndicatorSpec): string[] {
  const out: string[] = [];
  const keys = Object.keys(IndicatorSpecSchema.shape) as Array<keyof IndicatorSpec>;
  for (const k of keys) {
    const av = JSON.stringify(a[k] ?? null);
    const bv = JSON.stringify(b[k] ?? null);
    if (av !== bv) out.push(String(k));
  }
  return out;
}
