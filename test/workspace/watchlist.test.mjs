// Coverage for UI-4h-3 (Enhanced Watchlist)'s new pure logic:
// src/lib/workspace/watchlistSort.ts, plus the generic findWidgetInstance
// helper and updateWatchlistConfig mutation it relies on for per-instance
// bound-chart config (same convention updateVolumeProfileConfig already
// proved for Volume Profile). No React, no DOM.
//
// Usage: npx tsx test/workspace/watchlist.test.mjs

import { sortWatchlistRows } from "../../src/lib/workspace/watchlistSort.ts";
import { findWidgetInstance } from "../../src/lib/workspace/types.ts";
import { updateWatchlistConfig } from "../../src/lib/workspace/mutations.ts";

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

const tickerOf = (s) => s;

{
  // "manual" is a pass-through — the caller's own DB `position` order, never
  // reordered by this function.
  const rows = [{ symbol: "C" }, { symbol: "A" }, { symbol: "B" }];
  const sorted = sortWatchlistRows(rows, {}, "manual", "asc", tickerOf);
  check("manual: unchanged order", sorted, rows);
}

{
  const rows = [{ symbol: "BTC" }, { symbol: "ETH" }, { symbol: "SOL" }];
  const asc = sortWatchlistRows(rows, {}, "symbol", "asc", tickerOf);
  check("symbol asc", asc.map((r) => r.symbol), ["BTC", "ETH", "SOL"]);
  const desc = sortWatchlistRows(rows, {}, "symbol", "desc", tickerOf);
  check("symbol desc", desc.map((r) => r.symbol), ["SOL", "ETH", "BTC"]);
}

{
  const rows = [{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }];
  const quotes = {
    A: { price: 10, changePct: -5 },
    B: { price: 30, changePct: 2 },
    C: { price: 20, changePct: 8 },
  };
  check(
    "price asc",
    sortWatchlistRows(rows, quotes, "price", "asc", tickerOf).map((r) => r.symbol),
    ["A", "C", "B"],
  );
  check(
    "changePct desc",
    sortWatchlistRows(rows, quotes, "changePct", "desc", tickerOf).map((r) => r.symbol),
    ["C", "B", "A"],
  );
}

{
  // A symbol with no quote yet (still loading) always sorts last, regardless
  // of direction — an unknown price/%chg is never treated as highest OR
  // lowest.
  const rows = [{ symbol: "A" }, { symbol: "B" }, { symbol: "NEW" }];
  const quotes = { A: { price: 10, changePct: 1 }, B: { price: 5, changePct: -1 } };
  const asc = sortWatchlistRows(rows, quotes, "price", "asc", tickerOf);
  const desc = sortWatchlistRows(rows, quotes, "price", "desc", tickerOf);
  ok("missing quote sorts last (asc)", asc.at(-1).symbol === "NEW");
  ok("missing quote sorts last (desc)", desc.at(-1).symbol === "NEW");
}

// --- findWidgetInstance / updateWatchlistConfig -----------------------------

function tabs(id, tabList, activeInstanceId = tabList[0]?.instanceId ?? "") {
  return { kind: "tabs", id, tabs: tabList, activeInstanceId };
}
function split(id, direction, children, sizes) {
  return { kind: "split", id, direction, children, sizes: sizes ?? children.map(() => 1 / children.length) };
}

{
  // Watchlist can live in the sidebar, the dock, or a portable edge-drop
  // leaf — unlike Volume Profile (always bottomDock), so it's found by
  // widgetTypeId anywhere in the tree, not a fixed well-known node id.
  const root = split("root", "row", [
    tabs("sidebar", [{ instanceId: "watchlist-1", widgetTypeId: "watchlist" }]),
    tabs("dock", [{ instanceId: "scanner-1", widgetTypeId: "scanner" }]),
  ]);
  const found = findWidgetInstance(root, "watchlist");
  ok("findWidgetInstance: finds instance in sidebar leaf", found?.instanceId === "watchlist-1");

  const missing = findWidgetInstance(root, "volume-profile");
  check("findWidgetInstance: null when type absent anywhere", missing, null);
}

{
  const layout = {
    version: 1,
    name: "test",
    root: tabs("dock", [{ instanceId: "watchlist-1", widgetTypeId: "watchlist" }]),
    maximizedNodeId: null,
    collapsedNodeIds: [],
  };
  const cfg = { sortBy: "price", sortDir: "desc", boundChartInstanceId: "chart-2" };
  const next = updateWatchlistConfig(layout, "watchlist-1", cfg);
  check("updateWatchlistConfig: writes config onto the matching instance", next.root.tabs[0].watchlistConfig, cfg);
  ok("updateWatchlistConfig: original layout untouched (immutable)", layout.root.tabs[0].watchlistConfig === undefined);

  const noop = updateWatchlistConfig(layout, "does-not-exist", cfg);
  ok("updateWatchlistConfig: no-op for unknown instanceId (root untouched)", noop.root === layout.root);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
