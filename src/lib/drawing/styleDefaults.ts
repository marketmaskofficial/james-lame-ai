/**
 * Per-tool "last used style" memory — Phase 2 requirement: "if a user
 * restyles Trend Line to yellow/2px/dashed, future Trend Lines reuse that,"
 * scoped so ONE tool's restyle never bleeds into an unrelated tool (Rectangle
 * restyled must never affect Fib, Text, etc). Keyed by the exact `DrawTool`
 * id (not by category) — that's strictly finer-grained than "family," so the
 * no-bleed guarantee holds trivially.
 *
 * Deliberately a small dedicated localStorage store, not folded into the
 * `WorkspaceLayout`/Supabase-synced tree — same rationale
 * `src/lib/workspace/drawings.ts` already documents for drawing objects
 * themselves: this is per-device UI preference, not workspace data, and
 * reusing that existing persistence PATTERN (not a shared engine, per the
 * phase brief: "do not build a separate persistence engine just for
 * defaults") keeps it a one-file, no-new-infrastructure addition.
 */

import type { DrawTool, DrawStyle, DrawingSettings } from "@/components/studio/StudioChart";

export type ToolStyleDefaults = {
  color?: string;
  width?: number;
  style?: DrawStyle;
  settings?: DrawingSettings;
};

const KEY = "sg.studio.drawtools.styleDefaults.v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStore(): Partial<Record<string, ToolStyleDefaults>> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Partial<Record<string, ToolStyleDefaults>>): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked */
  }
}

/** The remembered style for `tool`, or undefined if the user has never
 * restyled one of these yet (callers fall back to each tool's own
 * `defaultStyle` from the registry). */
export function getToolStyleDefaults(tool: DrawTool): ToolStyleDefaults | undefined {
  return readStore()[tool];
}

/** Merges `patch` into `tool`'s remembered style (shallow for
 * color/width/style, shallow-merged for the `settings` bag so setting one
 * key — e.g. fontSize — doesn't clobber another — e.g. fibLevels). */
export function setToolStyleDefaults(tool: DrawTool, patch: ToolStyleDefaults): void {
  const store = readStore();
  const prev = store[tool];
  store[tool] = {
    ...prev,
    ...patch,
    settings: patch.settings || prev?.settings ? { ...prev?.settings, ...patch.settings } : undefined,
  };
  writeStore(store);
}

/** Test-only escape hatch — clears every remembered style. */
export function clearAllToolStyleDefaults(): void {
  writeStore({});
}
