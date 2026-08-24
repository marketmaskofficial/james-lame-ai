// Coverage for the per-chart-instance drawing undo/redo stack (Chart Studio
// drawing tools phase): src/lib/drawing/history.ts. No React, no DOM.
//
// The key guarantee under test: history is scoped PER CHART INSTANCE — an
// undo on chart 1 must never affect chart 2's drawings, matching the
// multi-chart-isolation requirement the rest of the drawing engine holds to.
//
// Usage: npx tsx test/workspace/drawingHistory.test.mjs

import {
  recordDrawingChange,
  canUndo,
  canRedo,
  undoDrawings,
  redoDrawings,
  clearDrawingHistory,
} from "../../src/lib/drawing/history.ts";

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

function d(id, x) {
  return { id, tool: "trend", p1: { time: x, price: x }, p2: { time: x, price: x } };
}

const CHART_A = "chart-history-test-a";
const CHART_B = "chart-history-test-b";

{
  ok("fresh chart: canUndo is false", canUndo(CHART_A) === false);
  ok("fresh chart: canRedo is false", canRedo(CHART_A) === false);

  const empty = [];
  const withOne = [d("1", 1)];
  recordDrawingChange(CHART_A, empty, withOne);
  ok("after recording a create: canUndo is true", canUndo(CHART_A) === true);
  ok("after recording a create: canRedo is still false", canRedo(CHART_A) === false);

  const undone = undoDrawings(CHART_A, withOne);
  ok("undo: returns the pre-create (empty) snapshot", Array.isArray(undone) && undone.length === 0);
  ok("undo: canRedo is now true", canRedo(CHART_A) === true);
  ok("undo: canUndo is now false (nothing further back)", canUndo(CHART_A) === false);

  const redone = redoDrawings(CHART_A, undone);
  ok("redo: restores the created drawing", redone.length === 1 && redone[0].id === "1");
  ok("redo: canUndo is true again", canUndo(CHART_A) === true);
  ok("redo: canRedo is false again (redo stack consumed)", canRedo(CHART_A) === false);
}

{
  // Multi-step: create, move, delete — each a separate undo step. Starts
  // from a clean stack so the exhaustion checks below are exact.
  clearDrawingHistory(CHART_A);
  const s0 = [];
  const s1 = [d("1", 1)];
  const s2 = [d("1", 2)]; // "moved"
  const s3 = []; // "deleted"
  recordDrawingChange(CHART_A, s0, s1);
  recordDrawingChange(CHART_A, s1, s2);
  recordDrawingChange(CHART_A, s2, s3);

  let cur = s3;
  cur = undoDrawings(CHART_A, cur);
  ok("multi-step undo 1/3: back to post-move state", cur.length === 1 && cur[0].p1.time === 2);
  cur = undoDrawings(CHART_A, cur);
  ok("multi-step undo 2/3: back to post-create state", cur.length === 1 && cur[0].p1.time === 1);
  cur = undoDrawings(CHART_A, cur);
  ok("multi-step undo 3/3: back to empty", cur.length === 0);
  ok("multi-step undo: exhausted, canUndo false", canUndo(CHART_A) === false);
  const beyond = undoDrawings(CHART_A, cur);
  ok("undo beyond the bottom of the stack returns null", beyond === null);
}

{
  // A new change after undoing clears the redo stack, like every normal
  // undo/redo implementation.
  recordDrawingChange(CHART_A, [], [d("x", 1)]);
  const undone = undoDrawings(CHART_A, [d("x", 1)]);
  ok("branch setup: undo succeeded", undone.length === 0);
  ok("branch setup: redo is available", canRedo(CHART_A) === true);
  recordDrawingChange(CHART_A, [], [d("y", 1)]); // a genuinely new change
  ok("a new committed change clears the redo stack", canRedo(CHART_A) === false);
}

{
  // Isolation: chart A's history must never leak into chart B's.
  recordDrawingChange(CHART_A, [], [d("a1", 1)]);
  ok("chart B starts with no undo history of its own", canUndo(CHART_B) === false);
  recordDrawingChange(CHART_B, [], [d("b1", 1)]);
  const undoneB = undoDrawings(CHART_B, [d("b1", 1)]);
  ok("undoing chart B returns chart B's own empty snapshot", undoneB.length === 0);
  ok("chart A's undo stack is unaffected by chart B's activity", canUndo(CHART_A) === true);
}

{
  clearDrawingHistory(CHART_B);
  ok("clearDrawingHistory: drops the stack entirely", canUndo(CHART_B) === false && canRedo(CHART_B) === false);
}

{
  // Reference-equal before/after (nothing actually changed) is a no-op —
  // doesn't pollute the undo stack with a phantom step.
  clearDrawingHistory("chart-noop-test");
  const arr = [d("1", 1)];
  recordDrawingChange("chart-noop-test", arr, arr);
  ok("recording a reference-equal before/after is a no-op", canUndo("chart-noop-test") === false);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
