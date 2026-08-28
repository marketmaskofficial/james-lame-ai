/**
 * Local persistence for Chart Studio drawing objects.
 *
 * Extends (does not replace) the pre-existing `sg.studio.drawings`
 * localStorage store that `src/lib/studio-handoff.ts` already shipped for
 * this — reusing the same storage key/JSON shape family rather than
 * inventing a second persistence subsystem, per this phase's brief. The one
 * real fix here: the OLD store was keyed only by `"symbol:interval"`, which
 * silently collided across chart instances — two charts open on the same
 * symbol/timeframe (a completely normal multi-chart setup: comparing a 5m
 * and 1h view of the same pair side by side is one thing, but two 5m panes
 * on the same symbol for layout reasons is not unusual either) would load
 * and overwrite EACH OTHER's drawings, breaking the multi-chart-isolation
 * guarantee. The key now includes the owning chart instance id.
 *
 * Deliberately still a dedicated localStorage store, not folded into the
 * `WorkspaceLayout` tree (`src/lib/workspace/persistence.ts`): that tree is
 * also the exact JSON blob synced to the signed-in user's Supabase
 * `workspace_layouts` row, and adding a new field there would need a
 * database migration — explicitly out of scope for this phase. Keeping
 * drawings in their own local store means they survive every in-tree change
 * (panel resize, Chart/Split/Code switching, saved-layout switching, a full
 * page reload) without depending on the tree's own persistence lifecycle at
 * all, and an old saved layout with no drawing data simply finds nothing
 * under this key — never a destructive migration.
 */

import type { Drawing } from "@/components/studio/StudioChart";

const DRAWINGS_KEY = "sg.studio.drawings.v2";
/** Superseded key from before per-chart-instance isolation — read once as a
 * one-time fallback so drawings made before this phase aren't silently
 * dropped, never written to again. */
const LEGACY_DRAWINGS_KEY = "sg.studio.drawings";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function keyFor(chartInstanceId: string, symbol: string, interval: string): string {
  return `${chartInstanceId}::${symbol}:${interval}`;
}

function readStore(key: string): Record<string, unknown[]> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown[]>) : {};
  } catch {
    return {};
  }
}

/**
 * Loads drawings for one chart instance's current symbol/interval. Falls
 * back to the legacy (pre-instance-id) key ONLY when nothing exists yet
 * under the new key AND this is the first chart instance to ask for this
 * symbol/interval this session — a best-effort one-time recovery of
 * pre-existing local drawings, not a silent ongoing alias (a second chart on
 * the same symbol/interval won't also inherit the legacy set once the first
 * one has claimed it, avoiding a re-introduction of the exact collision this
 * migration fixes).
 */
const claimedLegacyKeys = new Set<string>();

export function loadDrawingsFor(chartInstanceId: string, symbol: string, interval: string): Drawing[] {
  if (!isBrowser()) return [];
  const store = readStore(DRAWINGS_KEY);
  const key = keyFor(chartInstanceId, symbol, interval);
  const found = store[key];
  if (Array.isArray(found)) return found as Drawing[];

  const legacyKey = `${symbol}:${interval}`;
  if (claimedLegacyKeys.has(legacyKey)) return [];
  const legacyStore = readStore(LEGACY_DRAWINGS_KEY);
  const legacy = legacyStore[legacyKey];
  if (Array.isArray(legacy) && legacy.length > 0) {
    claimedLegacyKeys.add(legacyKey);
    return legacy as Drawing[];
  }
  return [];
}

export function saveDrawingsFor(
  chartInstanceId: string,
  symbol: string,
  interval: string,
  drawings: Drawing[],
): void {
  if (!isBrowser()) return;
  try {
    const store = readStore(DRAWINGS_KEY);
    store[keyFor(chartInstanceId, symbol, interval)] = drawings;
    window.localStorage.setItem(DRAWINGS_KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked */
  }
}
