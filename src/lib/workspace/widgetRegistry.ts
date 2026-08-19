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
    // UI-4g-2: approved cap on simultaneous chart instances — enforced by
    // createInstanceAsNewPane in mutations.ts, not just the UI.
    maxInstances: 4,
    // Not placeable via the sidebar/dock add-widget system at all (it's not
    // one of the two capability-gated regions) — value is unused but
    // structurally required by the type.
    renderableRegions: ["dock"],
  },
  watchlist: {
    id: "watchlist",
    label: "Watchlist",
    category: "core",
    availability: "available",
    renderableRegions: ["sidebar", "dock"],
  },
  trade: {
    id: "trade",
    label: "Trade",
    category: "account",
    availability: "available",
    renderableRegions: ["sidebar", "dock"],
  },
  "ai-builder": {
    id: "ai-builder",
    label: "AI",
    category: "core",
    availability: "available",
    renderableRegions: ["sidebar", "dock"],
  },
  alerts: {
    id: "alerts",
    label: "Alerts",
    category: "core",
    availability: "available",
    renderableRegions: ["sidebar", "dock"],
  },
  // The remaining "available" widgets below are dock-only: studio.tsx's
  // sidebar branch has real rendering code for exactly watchlist/trade/
  // ai-builder/alerts (checked directly, not assumed) and nothing else —
  // every one of these hits the generic "not available in the sidebar yet"
  // fallback regardless of how simple or complex its own content is, so
  // marking any of them sidebar-capable without first building that
  // rendering would defeat the whole point of this capability list. That's
  // full cross-region rendering work, explicitly out of scope here.
  "code-editor": {
    id: "code-editor",
    label: "Code",
    category: "core",
    availability: "available",
    renderableRegions: ["dock"],
  },
  "strategy-tester": {
    id: "strategy-tester",
    label: "Strategy tester",
    category: "core",
    availability: "available",
    renderableRegions: ["dock"],
  },
  positions: {
    id: "positions",
    label: "Positions",
    category: "account",
    availability: "available",
    renderableRegions: ["dock"],
  },
  orders: {
    id: "orders",
    label: "Orders",
    category: "account",
    availability: "available",
    renderableRegions: ["dock"],
  },
  history: {
    id: "history",
    label: "History",
    category: "account",
    availability: "available",
    renderableRegions: ["dock"],
  },
  journal: {
    id: "journal",
    label: "Journal",
    category: "account",
    availability: "available",
    renderableRegions: ["dock"],
  },
  "saved-indicators": {
    id: "saved-indicators",
    label: "Saved",
    category: "core",
    availability: "available",
    renderableRegions: ["dock"],
  },
  reference: {
    id: "reference",
    label: "Reference",
    category: "core",
    availability: "available",
    renderableRegions: ["dock"],
  },
  scanner: {
    id: "scanner",
    label: "Scanner",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs a market-wide screening data source that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  news: {
    id: "news",
    label: "News",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs a licensed news feed that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  dom: {
    id: "dom",
    label: "DOM / Order Book",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs a live Level 2 order-book data source that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  footprint: {
    id: "footprint",
    label: "Footprint",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs tick-level bid/ask trade data that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  "time-sales": {
    id: "time-sales",
    label: "Time & Sales",
    category: "orderflow",
    availability: "coming-soon",
    comingSoonReason: "Needs a live trade-tape data source that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  heatmap: {
    id: "heatmap",
    label: "Heatmap",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs cross-market real-time data that isn't connected yet.",
    renderableRegions: ["dock"],
  },
  "volume-profile": {
    id: "volume-profile",
    label: "Volume Profile",
    category: "analysis",
    availability: "coming-soon",
    comingSoonReason: "Needs tick-level volume-at-price data that isn't connected yet.",
    renderableRegions: ["dock"],
  },
};

export function getWidgetDef(id: WidgetTypeId): WidgetTypeDef {
  return WIDGET_REGISTRY[id];
}

export function listWidgetDefs(): WidgetTypeDef[] {
  return Object.values(WIDGET_REGISTRY);
}
