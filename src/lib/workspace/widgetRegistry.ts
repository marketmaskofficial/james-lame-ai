/**
 * Catalog of widget TYPES Chart Studio's workspace can host. This is a
 * code-defined constant (what's possible ships with the app), not user data
 * — user data is a WorkspaceLayout (see types.ts) referencing these ids.
 *
 * "coming-soon" entries are registered so the roadmap is honest and
 * discoverable, but must never render fabricated data — every coming-soon
 * widget's entire UI is its `comingSoonReason`, shown by one shared
 * placeholder component (ComingSoonWidget), not a fake working-looking one.
 */

import type { WidgetTypeDef, WidgetTypeId } from "./types";

export const WIDGET_REGISTRY: Record<WidgetTypeId, WidgetTypeDef> = {
  chart: {
    id: "chart",
    label: "Chart",
    category: "core",
    availability: "available",
    allowMultipleInstances: true,
  },
  watchlist: {
    id: "watchlist",
    label: "Watchlist",
    category: "core",
    availability: "available",
  },
  trade: {
    id: "trade",
    label: "Trade",
    category: "account",
    availability: "available",
  },
  "ai-builder": {
    id: "ai-builder",
    label: "AI",
    category: "core",
    availability: "available",
  },
  alerts: {
    id: "alerts",
    label: "Alerts",
    category: "core",
    availability: "available",
  },
  "code-editor": {
    id: "code-editor",
    label: "Code",
    category: "core",
    availability: "available",
  },
  "strategy-tester": {
    id: "strategy-tester",
    label: "Strategy tester",
    category: "core",
    availability: "available",
  },
  positions: {
    id: "positions",
    label: "Positions",
    category: "account",
    availability: "available",
  },
  orders: {
    id: "orders",
    label: "Orders",
    category: "account",
    availability: "available",
  },
  history: {
    id: "history",
    label: "History",
    category: "account",
    availability: "available",
  },
  journal: {
    id: "journal",
    label: "Journal",
    category: "account",
    availability: "available",
  },
  "saved-indicators": {
    id: "saved-indicators",
    label: "Saved",
    category: "core",
    availability: "available",
  },
  reference: {
    id: "reference",
    label: "Reference",
    category: "core",
    availability: "available",
  },
  scanner: {
    id: "scanner",
    label: "Scanner",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs a market-wide screening data source that isn't connected yet.",
  },
  news: {
    id: "news",
    label: "News",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs a licensed news feed that isn't connected yet.",
  },
  dom: {
    id: "dom",
    label: "DOM / Order Book",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs a live Level 2 order-book data source that isn't connected yet.",
  },
  footprint: {
    id: "footprint",
    label: "Footprint",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs tick-level bid/ask trade data that isn't connected yet.",
  },
  "time-sales": {
    id: "time-sales",
    label: "Time & Sales",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs a live trade-tape data source that isn't connected yet.",
  },
  heatmap: {
    id: "heatmap",
    label: "Heatmap",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs cross-market real-time data that isn't connected yet.",
  },
  "volume-profile": {
    id: "volume-profile",
    label: "Volume Profile",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs tick-level volume-at-price data that isn't connected yet.",
  },
};

export function getWidgetDef(id: WidgetTypeId): WidgetTypeDef {
  return WIDGET_REGISTRY[id];
}

export function listWidgetDefs(): WidgetTypeDef[] {
  return Object.values(WIDGET_REGISTRY);
}
