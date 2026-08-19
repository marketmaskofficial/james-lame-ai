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
  setActiveTab,
  splitLeafWithWidget,
  isPortableForNewLeaf,
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
  // "right" is a generic (non-well-known) leaf id, so it isn't protected —
  // UI-4f-3 lets a non-protected leaf legitimately empty out and collapse
  // away, rather than enforcing a universal floor. Removing its last tab
  // must succeed, and since "root" had exactly two children ("left",
  // "right"), losing "right" collapses root down to its sole surviving
  // child ("left") directly, per collapseEmptyNodes.
  const before = fixture();
  const after = removeWidgetFromNode(before, "right", "watchlist-1");
  ok("remove: emptying a non-protected leaf drops it from the tree", findNodeById(after.root, "right") === null);
  ok("remove: parent split collapses to its one surviving child", after.root.kind === "tabs" && after.root.id === "left");
  check("remove: the surviving leaf's own tabs are untouched by the collapse", tabsOf(after, "left"), tabsOf(before, "left"));
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
  // Same non-protected-leaf collapse behavior as removeWidgetFromNode above,
  // now via a cross-strip move: "right" only has one tab, and "right" isn't
  // a protected leaf, so moving that last tab out succeeds and collapses
  // "right" (and, cascading, the two-child "root" split down to "left").
  const before = fixture();
  const after = moveWidgetBetweenNodes(before, "watchlist-1", "right", "left");
  ok("move: emptying a non-protected source leaf drops it from the tree", findNodeById(after.root, "right") === null);
  ok("move: parent split collapses to its one surviving child", after.root.kind === "tabs" && after.root.id === "left");
  check("move: the widget actually landed in the destination", tabsOf(after, "left"), ["code-1", "tester-1", "watchlist-1"]);
}

{
  // Protected leaves (UI-4f-3): right-sidebar and bottom-dock keep the exact
  // pre-UI-4f-3 floor, using their real well-known ids so isProtectedLeaf
  // actually recognizes them (unlike the generic "left"/"right" fixture
  // above, which deliberately exercises the *non*-protected path).
  const before = regionFixture();
  const afterRemove = removeWidgetFromNode(before, WELL_KNOWN_NODE_IDS.rightSidebar, "watchlist-1");
  check(
    "remove: protected leaf (right-sidebar) still enforces the last-tab floor",
    tabsOf(afterRemove, WELL_KNOWN_NODE_IDS.rightSidebar),
    tabsOf(before, WELL_KNOWN_NODE_IDS.rightSidebar),
  );
  ok("remove: protected leaf is not dropped from the tree", findNodeById(afterRemove.root, WELL_KNOWN_NODE_IDS.rightSidebar) !== null);

  const afterMove = moveWidgetBetweenNodes(before, "watchlist-1", WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock);
  check(
    "move: protected leaf (right-sidebar) still enforces the last-tab floor",
    tabsOf(afterMove, WELL_KNOWN_NODE_IDS.rightSidebar),
    tabsOf(before, WELL_KNOWN_NODE_IDS.rightSidebar),
  );
}

{
  // Three-leaf fixture: proves collapseEmptyNodes handles a split with more
  // than two children correctly (drop just the emptied one, renormalize
  // sizes across the survivors, no premature single-child collapse) rather
  // than only the trivial two-child case above.
  const threeLeafFixture = () => ({
    version: 1,
    name: "three-leaf",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "root3",
      direction: "row",
      sizes: [0.34, 0.33, 0.33],
      children: [
        { kind: "tabs", id: "a", tabs: [inst("a1", "watchlist")], activeInstanceId: "a1" },
        { kind: "tabs", id: "b", tabs: [inst("b1", "journal")], activeInstanceId: "b1" },
        { kind: "tabs", id: "c", tabs: [inst("c1", "orders"), inst("c2", "positions")], activeInstanceId: "c1" },
      ],
    },
  });
  const before = threeLeafFixture();
  const after = removeWidgetFromNode(before, "a", "a1");
  ok("three-leaf: emptied leaf is dropped", findNodeById(after.root, "a") === null);
  ok("three-leaf: unaffected siblings survive", findNodeById(after.root, "b") !== null && findNodeById(after.root, "c") !== null);
  ok("three-leaf: root stays a split (more than one survivor, no premature collapse)", after.root.kind === "split");
  check("three-leaf: root's children shrink to the two survivors", after.root.children.map((c) => c.id), ["b", "c"]);
  check("three-leaf: sizes renormalize to sum to 1 across survivors", Math.round(after.root.sizes.reduce((a, b) => a + b, 0) * 1000) / 1000, 1);
}

{
  // maximizedNodeId/collapsedNodeIds must not dangle after a collapse drops
  // the node they referenced.
  const before = fixture();
  before.maximizedNodeId = "right";
  before.collapsedNodeIds = ["right"];
  const after = removeWidgetFromNode(before, "right", "watchlist-1");
  check("collapse cleanup: dangling maximizedNodeId is cleared", after.maximizedNodeId, null);
  check("collapse cleanup: dangling collapsedNodeIds entry is dropped", after.collapsedNodeIds, []);
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

// ---- splitLeafWithWidget / setActiveTab / isPortableForNewLeaf (UI-4f-4) ----

{
  ok("isPortableForNewLeaf: sidebar+dock widget is portable", isPortableForNewLeaf("watchlist"));
  ok("isPortableForNewLeaf: dock-only widget is NOT portable", !isPortableForNewLeaf("journal"));
}

{
  // journal is dock-only -> not portable -> edge-drop into a new pane must
  // be rejected outright, same as the capability rule everywhere else.
  const before = regionFixture();
  const after = splitLeafWithWidget(before, "journal-1", WELL_KNOWN_NODE_IDS.bottomDock, WELL_KNOWN_NODE_IDS.rightSidebar, "right");
  check("split: rejected for a non-portable widget", after, before);
}

{
  // watchlist-1 is the sidebar's only tab and the sidebar is protected ->
  // splitting it away would empty a protected leaf -> rejected.
  const before = regionFixture();
  const after = splitLeafWithWidget(before, "watchlist-1", WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock, "top");
  check("split: rejected when source would empty a protected leaf", after, before);
}

// addWidgetToNode generates instance ids as `${widgetTypeId}-${uuid}`, not a
// fixed string — capture the real id dynamically rather than assuming one.
function tradeIdIn(layout, nodeId) {
  return findNodeById(layout.root, nodeId).tabs.find((t) => t.widgetTypeId === "trade").instanceId;
}

for (const [edge, wantDirection, newFirst] of [
  ["top", "column", true],
  ["bottom", "column", false],
  ["left", "row", true],
  ["right", "row", false],
]) {
  // Give the sidebar a second portable tab first so removing one doesn't
  // hit the protected-leaf floor -- isolates the split geometry itself.
  let f = regionFixture();
  f = addWidgetToNode(f, WELL_KNOWN_NODE_IDS.rightSidebar, "trade");
  const tradeId = tradeIdIn(f, WELL_KNOWN_NODE_IDS.rightSidebar);
  const after = splitLeafWithWidget(f, tradeId, WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock, edge);
  const newRoot = after.root; // root's children: [ splitOrDock..., ... ] -- bottomDock got wrapped
  const wrapped = newRoot.children.find((c) => c.kind === "split" && c.children.some((cc) => cc.id === WELL_KNOWN_NODE_IDS.bottomDock));
  ok(`split(${edge}): produces a new split node`, Boolean(wrapped));
  check(`split(${edge}): correct direction`, wrapped?.direction, wantDirection);
  const order = wrapped?.children.map((c) => c.id === WELL_KNOWN_NODE_IDS.bottomDock);
  check(`split(${edge}): correct child order (is bottom-dock first?)`, order?.[0], !newFirst);
  const newLeaf = wrapped?.children.find((c) => c.id !== WELL_KNOWN_NODE_IDS.bottomDock);
  check(`split(${edge}): new leaf holds exactly the dragged widget`, newLeaf?.tabs.map((t) => t.instanceId), [tradeId]);
  ok(`split(${edge}): new leaf id doesn't collide with an existing one`, newLeaf && newLeaf.id !== WELL_KNOWN_NODE_IDS.bottomDock && newLeaf.id !== WELL_KNOWN_NODE_IDS.rightSidebar);
  ok(`split(${edge}): source (sidebar) no longer has the dragged instance`, !tabsOf(after, WELL_KNOWN_NODE_IDS.rightSidebar).includes(tradeId));
}

{
  // End-to-end round trip: split, then close the widget out of the new
  // leaf -- it must collapse away cleanly (sibling reclaims the space), not
  // leave a dangling empty pane. Real path, not the synthetic UI-4f-3
  // fixture: this is collapseEmptyNodes exercised through the actual
  // mutator a real edge-drop calls.
  let f = regionFixture();
  f = addWidgetToNode(f, WELL_KNOWN_NODE_IDS.rightSidebar, "trade");
  const tradeId = tradeIdIn(f, WELL_KNOWN_NODE_IDS.rightSidebar);
  const afterSplit = splitLeafWithWidget(f, tradeId, WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock, "right");
  const wrapped = afterSplit.root.children.find(
    (c) => c.kind === "split" && c.children.some((cc) => cc.id === WELL_KNOWN_NODE_IDS.bottomDock),
  );
  const newLeafId = wrapped.children.find((c) => c.id !== WELL_KNOWN_NODE_IDS.bottomDock).id;
  const afterClose = removeWidgetFromNode(afterSplit, newLeafId, tradeId);
  ok("split-then-close: new leaf's id no longer exists in the tree", findNodeById(afterClose.root, newLeafId) === null);
  ok("split-then-close: bottom-dock is back as a direct child of root (split collapsed away)", afterClose.root.children.some((c) => c.id === WELL_KNOWN_NODE_IDS.bottomDock));
  check("split-then-close: bottom-dock's own tabs are unaffected", tabsOf(afterClose, WELL_KNOWN_NODE_IDS.bottomDock), tabsOf(f, WELL_KNOWN_NODE_IDS.bottomDock));
}

{
  // setActiveTab: switches which instance is active without touching tabs.
  const before = regionFixture();
  const withTrade = addWidgetToNode(before, WELL_KNOWN_NODE_IDS.bottomDock, "trade");
  const tradeId = tradeIdIn(withTrade, WELL_KNOWN_NODE_IDS.bottomDock);
  const after = setActiveTab(withTrade, WELL_KNOWN_NODE_IDS.bottomDock, tradeId);
  check("setActiveTab: activeInstanceId updated", findNodeById(after.root, WELL_KNOWN_NODE_IDS.bottomDock).activeInstanceId, tradeId);
  check("setActiveTab: tabs array unchanged", tabsOf(after, WELL_KNOWN_NODE_IDS.bottomDock), tabsOf(withTrade, WELL_KNOWN_NODE_IDS.bottomDock));
}

{
  // setActiveTab: no-op for an instance that doesn't exist in that node.
  const before = regionFixture();
  const after = setActiveTab(before, WELL_KNOWN_NODE_IDS.bottomDock, "not-a-real-instance");
  check("setActiveTab: no-op for a nonexistent instance", after, before);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
