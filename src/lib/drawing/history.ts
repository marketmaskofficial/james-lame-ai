/**
 * Small, purpose-built undo/redo for Chart Studio drawings — deliberately
 * NOT a general app-wide history engine. Studio has no existing undo/redo
 * mechanism drawings could integrate with (verified: no `history`/`undo`
 * state anywhere in studio.tsx outside the unrelated AI-project
 * version-history panel and the trading "history" dock tab), so per spec
 * this stays scoped to exactly what drawings need rather than growing into
 * a competing global architecture.
 *
 * One stack PER CHART INSTANCE (keyed by instanceId) — undoing on chart 1
 * must never affect chart 2's drawings. Each entry is a full snapshot of
 * that chart's `Drawing[]` array; snapshots are cheap (drawings are small
 * plain objects, realistic counts are in the dozens-to-low-hundreds) and a
 * snapshot-per-commit is far simpler and more obviously correct than a
 * diff/patch log. Callers push a new snapshot on every COMMITTED change
 * (create, move/resize finished, setting change, delete) — never on
 * transient in-progress drag state, so dragging a drawing across 50 frames
 * is one undo step, not fifty.
 */

import type { Drawing } from "@/components/studio/StudioChart";

const MAX_DEPTH = 100;

type Stack = { past: Drawing[][]; future: Drawing[][] };

const stacks = new Map<string, Stack>();

function stackFor(chartInstanceId: string): Stack {
  let s = stacks.get(chartInstanceId);
  if (!s) {
    s = { past: [], future: [] };
    stacks.set(chartInstanceId, s);
  }
  return s;
}

/** Records `before` as an undo point right before applying a committed
 * change that results in `after`. Clears redo history, as any normal
 * undo/redo stack does once a new change branches off. No-ops if `before`
 * and `after` are reference-equal (nothing actually changed). */
export function recordDrawingChange(chartInstanceId: string, before: Drawing[], after: Drawing[]): void {
  if (before === after) return;
  const s = stackFor(chartInstanceId);
  s.past.push(before);
  if (s.past.length > MAX_DEPTH) s.past.shift();
  s.future = [];
}

export function canUndo(chartInstanceId: string): boolean {
  return stackFor(chartInstanceId).past.length > 0;
}

export function canRedo(chartInstanceId: string): boolean {
  return stackFor(chartInstanceId).future.length > 0;
}

/** Pops the most recent snapshot and returns it, pushing `current` onto the
 * redo stack. Returns null if there's nothing to undo. */
export function undoDrawings(chartInstanceId: string, current: Drawing[]): Drawing[] | null {
  const s = stackFor(chartInstanceId);
  const prev = s.past.pop();
  if (prev === undefined) return null;
  s.future.push(current);
  return prev;
}

export function redoDrawings(chartInstanceId: string, current: Drawing[]): Drawing[] | null {
  const s = stackFor(chartInstanceId);
  const next = s.future.pop();
  if (next === undefined) return null;
  s.past.push(current);
  return next;
}

/** Drops all history for a chart instance — called when a chart instance is
 * closed, so a stale stack never leaks into a differently-purposed future
 * instance id. */
export function clearDrawingHistory(chartInstanceId: string): void {
  stacks.delete(chartInstanceId);
}
