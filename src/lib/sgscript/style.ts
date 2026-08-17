// Universal Chart Studio style resolver.
//
// This is the ONE source of truth for what an indicator looks like by
// default. Indicator logic (FVG detection, EMA crossovers, BOS structure...)
// decides WHAT to draw; this module decides HOW it looks when the indicator
// doesn't say otherwise. Every primitive-producing function in runtime.ts
// (box, line, label, signal, zones, plot, hline) resolves through here —
// that's what makes it universal: a brand-new AI-generated indicator that
// never heard of this file still gets clean defaults, because it can't call
// box()/line()/plot() without going through the functions that consume it.
//
// Resolution order (highest priority last): global default < semantic
// preset < whatever the script/indicator explicitly passed in its call.
// "Explicitly passed" already covers the user-settings case — a script's
// input.* value flowing into a box()/line() call IS the user's override,
// so there's no separate settings layer to thread through here.

export type ZoneRole =
  | "zone.active.bullish"
  | "zone.active.bearish"
  | "zone.inactive.bullish"
  | "zone.inactive.bearish"
  | "session.asia"
  | "session.london"
  | "session.newYork";

export type LineRole = "level.support" | "level.resistance";
export type PlotRole = "plot.primary" | "plot.secondary" | "plot.reference";
export type MarkerRole = "signal.buy" | "signal.sell";

export type StyleRole = ZoneRole | LineRole | PlotRole | MarkerRole;

export type ZonePreset = {
  color: string;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  textSize: "tiny" | "small" | "normal" | "large";
};

export type LinePreset = { color: string; width: number; opacity: number };
export type PlotPreset = { color: string; width: number };
export type MarkerPreset = { color: string; shape: "arrow" | "circle" | "square" | "triangle" };

/**
 * Visual-strength philosophy: candles are always the dominant element.
 * Zones/session shading are subtle-to-moderate translucent fills with thin,
 * soft borders (never a bright/thick outline). Inactive (mitigated) zones
 * drop further still. Lines/plots are clear and readable since they carry
 * the actual signal. Labels are small and restrained.
 */
export const ZONE_PRESETS: Record<ZoneRole, ZonePreset> = {
  "zone.active.bullish": {
    color: "rgba(34,197,94,0.15)",
    opacity: 1,
    borderColor: "rgba(148,163,184,0.45)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "zone.active.bearish": {
    color: "rgba(239,68,68,0.15)",
    opacity: 1,
    borderColor: "rgba(148,163,184,0.45)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "zone.inactive.bullish": {
    color: "rgba(34,197,94,0.15)",
    opacity: 0.35,
    borderColor: "rgba(148,163,184,0.3)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "zone.inactive.bearish": {
    color: "rgba(239,68,68,0.15)",
    opacity: 0.35,
    borderColor: "rgba(148,163,184,0.3)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "session.asia": {
    color: "rgba(56,189,248,0.10)",
    opacity: 1,
    borderColor: "rgba(56,189,248,0.35)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "session.london": {
    color: "rgba(167,139,250,0.10)",
    opacity: 1,
    borderColor: "rgba(167,139,250,0.35)",
    borderWidth: 1,
    textSize: "tiny",
  },
  "session.newYork": {
    color: "rgba(250,204,21,0.10)",
    opacity: 1,
    borderColor: "rgba(250,204,21,0.35)",
    borderWidth: 1,
    textSize: "tiny",
  },
};

export const LINE_PRESETS: Record<LineRole, LinePreset> = {
  "level.support": { color: "rgba(34,197,94,0.6)", width: 1, opacity: 1 },
  "level.resistance": { color: "rgba(239,68,68,0.6)", width: 1, opacity: 1 },
};

export const PLOT_PRESETS: Record<PlotRole, PlotPreset> = {
  "plot.primary": { color: "#e6b800", width: 2 },
  "plot.secondary": { color: "#38bdf8", width: 2 },
  "plot.reference": { color: "rgba(230,184,0,0.7)", width: 1 },
};

export const MARKER_PRESETS: Record<MarkerRole, MarkerPreset> = {
  "signal.buy": { color: "#22c55e", shape: "arrow" },
  "signal.sell": { color: "#ef4444", shape: "arrow" },
};

/**
 * Applied automatically to every run, for every indicator, unless the
 * script calls limitDrawings() with its own values. This is what makes
 * density management "universal" rather than opt-in per script — an AI
 * indicator that never heard of limitDrawings() still can't spam the chart
 * with an unbounded history of objects.
 */
export const DEFAULT_MAX_VISIBLE = {
  boxes: 50,
  lines: 50,
  labels: 50,
  markers: 300,
};

/**
 * Safety clamps — never overrides deliberate styling, only catches values
 * that are structurally impossible to have been intended (opacity outside
 * 0..1, e.g. a script that assumed Pine's 0-100 transparency scale;
 * absurd widths; label text that would read as a paragraph, not a label).
 * Applied unconditionally, source-agnostic (AI-written or hand-written) —
 * that's what makes these "clamps" rather than "opinions": a value inside
 * the sane range is never touched.
 */
export function clampOpacity(v: number | undefined, fallback = 1): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

export function clampWidth(v: number | undefined, fallback: number, max = 8): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(0, v));
}

export function clampLabelText(s: string | undefined, maxLen = 40): string | undefined {
  if (s == null) return s;
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/**
 * There are exactly two valid panes. A script that means "not the price
 * pane" is far more likely to have typed a plausible English word
 * ("oscillator", "osc pane", "OSC") than the exact literal "osc" — and a
 * strict equality check against that literal silently mis-routes anything
 * else to the price pane with no error, exactly the failure class as
 * Pine's 0-100 vs this runtime's 0-1 opacity scale. Normalize instead of
 * trusting an exact string match: anything that isn't clearly "price"
 * is treated as osc.
 */
export function normalizePane(v: unknown, fallback: "price" | "osc"): "price" | "osc" {
  if (typeof v !== "string" || v.trim() === "") return fallback;
  return v.trim().toLowerCase().startsWith("price") ? "price" : "osc";
}
