// Coverage for the pure workspace-layout tree mutators (UI-4c):
// src/lib/workspace/mutations.ts. No React, no DOM — these are the exact
// functions studio.tsx calls from its add/remove/reorder/move handlers, so
// correctness here is correctness there.
//
// Usage: npx tsx test/workspace/tree.test.mjs

import {
  addWidgetToNode,
  removeWidgetFromNode,
  reorderWithinNode,
  moveWidgetBetweenNodes,
} from "../../src/lib/workspace/mutations.ts";
import { findNodeById, WELL_KNOWN_NODE_IDS } from "../../src/lib/workspace/types.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

function inst(instanceId, widgetTypeId, extra = {}) {
  return { instanceId, widgetTypeId, ...extra };
}

// Two-region fixture mirroring PRESETS.beginner's shape, kept intentionally
// small: a "left" tabs node (2 widgets, one pinned) and a "right" tabs node
// (1 widget) under a split root.
function fixture() {
  return {
    version: 1,
    name: "fixture",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "root",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          kind: "tabs",
          id: "left",
          tabs: [
            inst("code-1", "code-editor", { pinned: true }),
            inst("tester-1", "strategy-tester"),
          ],
          activeInstanceId: "code-1",
        },
        {
          kind: "tabs",
          id: "right",
          tabs: [inst("watchlist-1", "watchlist")],
          activeInstanceId: "watchlist-1",
        },
      ],
    },
  };
}

function tabsOf(layout, nodeId) {
  const n = findNodeById(layout.root, nodeId);
  return n.tabs.map((t) => t.instanceId);
}

// ---- addWidgetToNode -------------------------------------------------------

{
  const l = addWidgetToNode(fixture(), "left", "journal");
  check("add: appends the new widget", tabsOf(l, "left").length, 3);
  ok(
    "add: new instance has the right widget type",
    findNodeById(l.root, "left").tabs[2].widgetTypeId === "journal",
  );
  const active = findNodeById(l.root, "left").activeInstanceId;
  ok("add: new instance becomes active", active === findNodeById(l.root, "left").tabs[2].instanceId);
}

{
  const before = fixture();
  const after = addWidgetToNode(before, "left", "dom"); // coming-soon
  check("add: coming-soon widget is rejected (layout unchanged)", tabsOf(after, "left"), tabsOf(before, "left"));
}

{
  const before = fixture();
  const after = addWidgetToNode(before, "left", "code-editor"); // already open there
  check("add: widget already open in target node is a no-op", tabsOf(after, "left"), tabsOf(before, "left"));
}

// ---- removeWidgetFromNode ---------------------------------------------------

{
  const l = removeWidgetFromNode(fixture(), "left", "tester-1");
  check("remove: drops the instance", tabsOf(l, "left"), ["code-1"]);
}

{
  const before = fixture();
  const after = removeWidgetFromNode(before, "left", "code-1"); // pinned
  check("remove: pinned instance is rejected", tabsOf(after, "left"), tabsOf(before, "left"));
}

{
  const before = fixture();
  const after = removeWidgetFromNode(before, "right", "watchlist-1"); // last tab in node
  check("remove: last remaining tab in a node is rejected", tabsOf(after, "right"), tabsOf(before, "right"));
}

{
  // Remove the currently-active, non-last, non-pinned tab -> active reassigns sensibly.
  let f = fixture();
  f = addWidgetToNode(f, "left", "journal"); // left: code-1(pinned,active) tester-1 journal-*
  f.root.children[0].activeInstanceId = "tester-1"; // make the middle one active
  const idx = findNodeById(f.root, "left").tabs.findIndex((t) => t.instanceId === "tester-1");
  const after = removeWidgetFromNode(f, "left", "tester-1");
  const node = findNodeById(after.root, "left");
  ok(
    "remove: reassigns active to a neighbor when the active tab is removed",
    node.activeInstanceId === node.tabs[Math.max(0, idx - 1)]?.instanceId,
  );
}

// ---- reorderWithinNode -------------------------------------------------------

{
  let f = fixture();
  f = addWidgetToNode(f, "left", "journal"); // left: code-1, tester-1, journal-*
  const before = tabsOf(f, "left");
  const activeBefore = findNodeById(f.root, "left").activeInstanceId;
  const after = reorderWithinNode(f, "left", 0, 2); // move code-1 to the end
  const node = findNodeById(after.root, "left");
  check("reorder: moves the tab to the new index", node.tabs.map((t) => t.instanceId), [before[1], before[2], before[0]]);
  check("reorder: active instance identity is unchanged by position", node.activeInstanceId, activeBefore);
}

{
  const before = fixture();
  const after = reorderWithinNode(before, "left", 0, 99); // out of range
  check("reorder: out-of-range indices are a no-op", tabsOf(after, "left"), tabsOf(before, "left"));
}

// ---- moveWidgetBetweenNodes --------------------------------------------------

{
  const f = fixture();
  const after = moveWidgetBetweenNodes(f, "tester-1", "left", "right");
  check("move: removed from source", tabsOf(after, "left"), ["code-1"]);
  check("move: present in destination", tabsOf(after, "right"), ["watchlist-1", "tester-1"]);
  check("move: becomes active in destination", findNodeById(after.root, "right").activeInstanceId, "tester-1");
  const allIds = [...tabsOf(after, "left"), ...tabsOf(after, "right")];
  check("move: no duplicate anywhere", new Set(allIds).size, allIds.length);
}

{
  const before = fixture();
  const after = moveWidgetBetweenNodes(before, "code-1", "left", "right"); // pinned
  check("move: pinned instance can't be moved away from its source", tabsOf(after, "left"), tabsOf(before, "left"));
  check("move: destination is untouched when the move is rejected", tabsOf(after, "right"), tabsOf(before, "right"));
}

{
  // Drain "right" to nothing left to move away, since it only has one tab.
  const before = fixture();
  const after = moveWidgetBetweenNodes(before, "watchlist-1", "right", "left");
  check("move: last-tab-in-source protection applies to move too", tabsOf(after, "right"), tabsOf(before, "right"));
}

// ---- capability-aware region gating (UI-4c tightening) ----------------------
//
// regionKindForNodeId only recognizes the two well-known node ids, so these
// cases use those exact ids (unlike the generic "left"/"right" fixture above)
// to actually exercise the renderableRegions checks in addWidgetToNode /
// moveWidgetBetweenNodes.

function regionFixture() {
  return {
    version: 1,
    name: "region-fixture",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "root",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          kind: "tabs",
          id: WELL_KNOWN_NODE_IDS.bottomDock,
          tabs: [inst("code-1", "code-editor", { pinned: true }), inst("journal-1", "journal")],
          activeInstanceId: "code-1",
        },
        {
          kind: "tabs",
          id: WELL_KNOWN_NODE_IDS.rightSidebar,
          tabs: [inst("watchlist-1", "watchlist")],
          activeInstanceId: "watchlist-1",
        },
      ],
    },
  };
}

{
  // "journal" is dock-only (renderableRegions: ["dock"]) — adding it to the
  // sidebar must be rejected at the mutator level, not just hidden in the UI.
  const before = regionFixture();
  const after = addWidgetToNode(before, WELL_KNOWN_NODE_IDS.rightSidebar, "journal");
  check(
    "add: dock-only widget rejected when target region is sidebar",
    tabsOf(after, WELL_KNOWN_NODE_IDS.rightSidebar),
    tabsOf(before, WELL_KNOWN_NODE_IDS.rightSidebar),
  );
}

{
  // "trade" is sidebar+dock capable — adding it to the sidebar must succeed.
  const after = addWidgetToNode(regionFixture(), WELL_KNOWN_NODE_IDS.rightSidebar, "trade");
  check("add: sidebar-capable widget accepted into sidebar", tabsOf(after, WELL_KNOWN_NODE_IDS.rightSidebar).length, 2);
}

{
  // Moving the dock-only "journal-1" into the sidebar must be rejected —
  // and rejected BEFORE anything is removed from the source, so the widget
  // is never lost.
  const before = regionFixture();
  const after = moveWidgetBetweenNodes(before, "journal-1", WELL_KNOWN_NODE_IDS.bottomDock, WELL_KNOWN_NODE_IDS.rightSidebar);
  check(
    "move: dock-only widget rejected when destination is sidebar (source untouched)",
    tabsOf(after, WELL_KNOWN_NODE_IDS.bottomDock),
    tabsOf(before, WELL_KNOWN_NODE_IDS.bottomDock),
  );
  check(
    "move: dock-only widget rejected when destination is sidebar (destination untouched)",
    tabsOf(after, WELL_KNOWN_NODE_IDS.rightSidebar),
    tabsOf(before, WELL_KNOWN_NODE_IDS.rightSidebar),
  );
}

{
  // Moving "watchlist-1" (sidebar+dock capable) into the dock must still
  // work — capability gating must not become over-broad and block valid
  // moves. Give the sidebar a second tab first so this isn't also hitting
  // the pre-existing last-tab-in-a-region floor (a different protection).
  let f = regionFixture();
  f = addWidgetToNode(f, WELL_KNOWN_NODE_IDS.rightSidebar, "trade");
  const after = moveWidgetBetweenNodes(f, "watchlist-1", WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock);
  check("move: capable widget still moves successfully between regions", tabsOf(after, WELL_KNOWN_NODE_IDS.bottomDock), [
    "code-1",
    "journal-1",
    "watchlist-1",
  ]);
}

{
  // Moving a widget into a destination that already has that widget type
  // open must be rejected (no duplicate), on top of the capability check.
  // Put "trade" in both regions first, then try to move the dock's "trade"
  // into the sidebar, which already has one.
  let f = regionFixture();
  f = addWidgetToNode(f, WELL_KNOWN_NODE_IDS.bottomDock, "trade");
  f = addWidgetToNode(f, WELL_KNOWN_NODE_IDS.rightSidebar, "trade");
  const before = f;
  const dockTradeId = findNodeById(before.root, WELL_KNOWN_NODE_IDS.bottomDock).tabs.find(
    (t) => t.widgetTypeId === "trade",
  ).instanceId;
  const after = moveWidgetBetweenNodes(before, dockTradeId, WELL_KNOWN_NODE_IDS.bottomDock, WELL_KNOWN_NODE_IDS.rightSidebar);
  check(
    "move: rejected when the widget type is already open in the destination",
    tabsOf(after, WELL_KNOWN_NODE_IDS.bottomDock),
    tabsOf(before, WELL_KNOWN_NODE_IDS.bottomDock),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
