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
  "singleChart",
  "twoChartHorizontal",
  "twoChartVertical",
  "fourChartGrid",
  "orderflowPro",
]);
ok("PRESET_ORDER covers every PRESETS key", PRESET_ORDER.length === Object.keys(PRESETS).length);

// ---- lock status matches whether a preset references a coming-soon widget --

const EXPECTED_LOCKED = {
  beginner: false,
  indicatorBuilder: false,
  backtesting: false,
  activeTrader: false,
  singleChart: false,
  twoChartHorizontal: false,
  twoChartVertical: false,
  fourChartGrid: false,
  orderflowPro: true,
};
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

// ---- UI-4g-3: multi-chart preset validity ------------------------------------
// Each new preset's chart instances must: exist in the expected count, have
// distinct instanceIds (no collisions if two presets' subtrees were ever
// merged), and carry a real chartConfig (symbol/interval) -- not rely on
// page-level defaults, since that's the whole point of persisting chart
// config in the tree (UI-4g-2). Also confirms the 4-chart preset sits
// exactly at, never over, the approved cap (widgetRegistry.ts's
// chart.maxInstances).

function collectChartInstances(presetId) {
  const acc = [];
  (function walk(node) {
    if (node.kind === "tabs") {
      for (const t of node.tabs) if (t.widgetTypeId === "chart") acc.push(t);
    } else {
      for (const c of node.children) walk(c);
    }
  })(PRESETS[presetId].root);
  return acc;
}

const EXPECTED_CHART_COUNT = {
  beginner: 1,
  indicatorBuilder: 1,
  backtesting: 1,
  activeTrader: 1,
  singleChart: 1,
  twoChartHorizontal: 2,
  twoChartVertical: 2,
  fourChartGrid: 4,
  orderflowPro: 1,
};

for (const id of PRESET_ORDER) {
  const charts = collectChartInstances(id);
  ok(`${id}: has exactly ${EXPECTED_CHART_COUNT[id]} chart instance(s)`, charts.length === EXPECTED_CHART_COUNT[id]);

  const ids = charts.map((c) => c.instanceId);
  ok(`${id}: chart instanceIds are all distinct`, new Set(ids).size === ids.length);
}

// The 5 pre-existing presets (UI-4a-4e) never set chart.chartConfig -- they
// rely on seedChartStatesFromLayout's page-level defaulting (UI-4g-2), which
// is existing, unchanged, correct behavior; those presets are explicitly not
// touched by this phase. Only the 4 new UI-4g-3 presets are required to carry
// an explicit chartConfig, since demonstrating persisted per-chart config is
// this phase's whole point.
const NEW_PRESETS_WITH_CHART_CONFIG = [
  "singleChart",
  "twoChartHorizontal",
  "twoChartVertical",
  "fourChartGrid",
];
for (const id of NEW_PRESETS_WITH_CHART_CONFIG) {
  for (const c of collectChartInstances(id)) {
    ok(
      `${id}: chart "${c.instanceId}" has a real chartConfig.symbol`,
      typeof c.chartConfig?.symbol === "string" && c.chartConfig.symbol.length > 0,
    );
    ok(
      `${id}: chart "${c.instanceId}" has a real chartConfig.interval`,
      typeof c.chartConfig?.interval === "string" && c.chartConfig.interval.length > 0,
    );
  }
}

const CHART_MAX_INSTANCES = WIDGET_REGISTRY.chart.maxInstances;
ok("widgetRegistry: chart.maxInstances is defined and === 4", CHART_MAX_INSTANCES === 4);
ok(
  "fourChartGrid: chart count sits exactly at the approved cap, never over",
  collectChartInstances("fourChartGrid").length === CHART_MAX_INSTANCES,
);
for (const id of PRESET_ORDER) {
  ok(
    `${id}: chart count never exceeds the cap`,
    collectChartInstances(id).length <= CHART_MAX_INSTANCES,
  );
}

// ---- exact multi-chart composition matches what was specified ---------------

check("twoChartHorizontal: symbols/intervals", collectChartInstances("twoChartHorizontal").map((c) => `${c.chartConfig.symbol} ${c.chartConfig.interval}`), [
  "BTCUSDT 15m",
  "BTCUSDT 1h",
]);
check("twoChartVertical: symbols/intervals", collectChartInstances("twoChartVertical").map((c) => `${c.chartConfig.symbol} ${c.chartConfig.interval}`), [
  "BTCUSDT 15m",
  "ETHUSDT 15m",
]);
check("fourChartGrid: symbols/intervals", collectChartInstances("fourChartGrid").map((c) => `${c.chartConfig.symbol} ${c.chartConfig.interval}`), [
  "BTCUSDT 15m",
  "ETHUSDT 15m",
  "SOLUSDT 15m",
  "BNBUSDT 15m",
]);

// ---- singleChart mirrors beginner's composition exactly (explicit 1-chart --
// ---- entry, per the approved decision -- beginner itself stays untouched) --

check("singleChart: sidebar composition matches beginner", widgetIdsOf("singleChart", WELL_KNOWN_NODE_IDS.rightSidebar), widgetIdsOf("beginner", WELL_KNOWN_NODE_IDS.rightSidebar));
check("singleChart: dock composition matches beginner", widgetIdsOf("singleChart", WELL_KNOWN_NODE_IDS.bottomDock), widgetIdsOf("beginner", WELL_KNOWN_NODE_IDS.bottomDock));

// ---- beginner remains byte-identical (unaffected by this phase) -------------

check("beginner: chart composition unaffected by UI-4g-3", collectChartInstances("beginner").length, 1);

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
