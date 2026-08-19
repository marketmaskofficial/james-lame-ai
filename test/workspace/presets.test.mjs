// Coverage for the workspace preset catalog (UI-4e):
// src/lib/workspace/presets.ts. Asserts every preset only places widgets
// into regions they can actually render in (WidgetTypeDef.renderableRegions,
// from UI-4c's capability gating), that lock status matches whether a
// preset references any coming-soon widget, and that every "tabs" node has
// at least one tab. No React, no DOM.
//
// Usage: npx tsx test/workspace/presets.test.mjs

import { PRESETS, PRESET_ORDER, isPresetLocked } from "../../src/lib/workspace/presets.ts";
import { WIDGET_REGISTRY } from "../../src/lib/workspace/widgetRegistry.ts";
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

// ---- PRESET_ORDER lists every real preset, Beginner first -------------------

check("PRESET_ORDER order", PRESET_ORDER, [
  "beginner",
  "indicatorBuilder",
  "backtesting",
  "activeTrader",
  "orderflowPro",
]);
ok("PRESET_ORDER covers every PRESETS key", PRESET_ORDER.length === Object.keys(PRESETS).length);

// ---- lock status matches whether a preset references a coming-soon widget --

const EXPECTED_LOCKED = { beginner: false, indicatorBuilder: false, backtesting: false, activeTrader: false, orderflowPro: true };
for (const id of PRESET_ORDER) {
  ok(`isPresetLocked(${id}) === ${EXPECTED_LOCKED[id]}`, isPresetLocked(PRESETS[id]) === EXPECTED_LOCKED[id]);
}

// ---- every "tabs" node in every preset has at least one tab -----------------

function collectTabsNodes(node, acc = []) {
  if (node.kind === "tabs") acc.push(node);
  else for (const c of node.children) collectTabsNodes(c, acc);
  return acc;
}

for (const id of PRESET_ORDER) {
  const tabsNodes = collectTabsNodes(PRESETS[id].root);
  ok(`${id}: has at least one "tabs" node`, tabsNodes.length > 0);
  for (const n of tabsNodes) {
    ok(`${id}: node "${n.id}" has >= 1 tab`, n.tabs.length > 0);
    ok(
      `${id}: node "${n.id}" activeInstanceId references a real tab`,
      n.tabs.some((t) => t.instanceId === n.activeInstanceId),
    );
  }
}

// ---- capability check: sidebar/dock tabs only reference widgets that can --
// ---- actually render in that region (renderableRegions, from UI-4c) -------

for (const id of PRESET_ORDER) {
  const sidebar = findNodeById(PRESETS[id].root, WELL_KNOWN_NODE_IDS.rightSidebar);
  const dock = findNodeById(PRESETS[id].root, WELL_KNOWN_NODE_IDS.bottomDock);
  if (sidebar) {
    for (const t of sidebar.tabs) {
      ok(
        `${id}: sidebar widget "${t.widgetTypeId}" is sidebar-capable`,
        WIDGET_REGISTRY[t.widgetTypeId].renderableRegions.includes("sidebar"),
      );
    }
  }
  if (dock) {
    for (const t of dock.tabs) {
      ok(
        `${id}: dock widget "${t.widgetTypeId}" is dock-capable`,
        WIDGET_REGISTRY[t.widgetTypeId].renderableRegions.includes("dock"),
      );
    }
  }
}

// ---- exact widget composition matches what was specified --------------------

function widgetIdsOf(presetId, nodeId) {
  const node = findNodeById(PRESETS[presetId].root, nodeId);
  return node ? node.tabs.map((t) => t.widgetTypeId) : [];
}

check("indicatorBuilder: sidebar composition", widgetIdsOf("indicatorBuilder", WELL_KNOWN_NODE_IDS.rightSidebar), [
  "ai-builder",
]);
check("indicatorBuilder: dock composition", widgetIdsOf("indicatorBuilder", WELL_KNOWN_NODE_IDS.bottomDock), [
  "code-editor",
  "strategy-tester",
  "saved-indicators",
]);

check("backtesting: sidebar composition", widgetIdsOf("backtesting", WELL_KNOWN_NODE_IDS.rightSidebar), [
  "watchlist",
]);
check("backtesting: dock composition", widgetIdsOf("backtesting", WELL_KNOWN_NODE_IDS.bottomDock), [
  "code-editor",
  "strategy-tester",
  "saved-indicators",
  "journal",
]);

check("activeTrader: sidebar composition", widgetIdsOf("activeTrader", WELL_KNOWN_NODE_IDS.rightSidebar), [
  "watchlist",
  "trade",
  "alerts",
]);
check("activeTrader: dock composition", widgetIdsOf("activeTrader", WELL_KNOWN_NODE_IDS.bottomDock), [
  "positions",
  "orders",
]);

// ---- Beginner stays byte-identical to its pre-UI-4e composition -------------
// (guards against an accidental default-experience change during this phase)

check("beginner: sidebar composition unchanged", widgetIdsOf("beginner", WELL_KNOWN_NODE_IDS.rightSidebar), [
  "watchlist",
  "trade",
  "ai-builder",
  "alerts",
]);
check("beginner: dock composition unchanged", widgetIdsOf("beginner", WELL_KNOWN_NODE_IDS.bottomDock), [
  "code-editor",
  "strategy-tester",
  "positions",
  "orders",
  "history",
  "journal",
  "saved-indicators",
  "reference",
]);

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
