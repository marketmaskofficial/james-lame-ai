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

{
  // Regression test for the shared "double-invoked updater" bug (see the
  // long comment above the drawing mutators in src/routes/studio.tsx, and
  // the fix's commit message). React does NOT guarantee that a functional
  // `setState` updater runs exactly once per commit — `dispatchSetState`'s
  // eager-bailout optimization calls the updater once, synchronously
  // (against the currently-committed value) to check whether the result
  // actually differs before scheduling a re-render, then calls it again
  // for the real render — BOTH calls starting from the SAME committed
  // value. That is harmless for a pure updater (same input -> same output,
  // only one commit lands) but studio.tsx used to call the side-effecting
  // `recordDrawingChange` (and `undoDrawings`/`redoDrawings`) FROM INSIDE
  // that updater, so one drawing creation pushed history TWICE even though
  // the chart's `drawings` array only actually changed once. Confirmed to
  // reproduce on plain Trend Line too — it was never tool-specific.

  // --- demonstrates the bug's exact failure mode, standalone -------------
  // (i.e. what history.ts does if a caller violates "call exactly once per
  // commit" — this is the hazard the fix in studio.tsx eliminates by
  // construction, not something history.ts itself guards against).
  clearDrawingHistory("chart-doubleinvoke-bug-demo");
  {
    const before = [];
    const after = [d("bug-demo", 1)];
    // Simulating the OLD, buggy call-site: recordDrawingChange invoked from
    // inside a functional updater that React runs twice for one commit.
    recordDrawingChange("chart-doubleinvoke-bug-demo", before, after); // the "eager" call
    recordDrawingChange("chart-doubleinvoke-bug-demo", before, after); // the "real" call
  }
  undoDrawings("chart-doubleinvoke-bug-demo", [d("bug-demo", 1)]);
  ok(
    "BUG DEMO: calling recordDrawingChange twice per commit leaves a stray entry after one Undo",
    canUndo("chart-doubleinvoke-bug-demo") === true, // the phantom extra push
  );

  // --- the fix: exactly one recordDrawingChange call per commit ----------
  clearDrawingHistory("chart-doubleinvoke-fixed");
  {
    const before = [];
    const created = d("fixed-1", 1);
    const after = [...before, created];
    // Fixed call-site discipline (see addDrawing/removeDrawing/updateDrawing/
    // duplicateDrawing/setAllDrawingsField/deleteAllDrawings/undo/redo in
    // studio.tsx): the updater itself is pure and merely computes `after`;
    // the history push happens separately, in the plain calling function,
    // exactly once — so it doesn't matter how many times a would-be React
    // updater invokes the pure part.
    const pureUpdater = (prev) => (prev === before ? after : prev);
    const eagerInvocation = pureUpdater(before);
    const realInvocation = pureUpdater(before);
    ok("pure updater invoked twice still yields the same committed value", eagerInvocation === realInvocation);
    recordDrawingChange("chart-doubleinvoke-fixed", before, realInvocation); // called ONCE, outside the updater
  }
  ok("FIXED: creation records exactly one history entry", canUndo("chart-doubleinvoke-fixed") === true);
  const undoneOnce = undoDrawings("chart-doubleinvoke-fixed", [d("fixed-1", 1)]);
  ok("FIXED: one Undo removes exactly the one drawing just created", Array.isArray(undoneOnce) && undoneOnce.length === 0);
  ok("FIXED: no stray second undo step is left behind after the one Undo", canUndo("chart-doubleinvoke-fixed") === false);
  const redoneOnce = redoDrawings("chart-doubleinvoke-fixed", undoneOnce);
  ok("FIXED: Redo restores exactly the created drawing", redoneOnce.length === 1 && redoneOnce[0].id === "fixed-1");
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
