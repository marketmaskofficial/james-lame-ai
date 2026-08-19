/**
 * Code-defined default layouts, expressed in the general tree shape from
 * types.ts. `beginner` is today's ACTUAL Chart Studio layout — same widgets,
 * same tab order, same default panel proportions — so adopting this data
 * model changes nothing about what a user sees. `orderflowPro` is a locked
 * preview referencing not-yet-real widgets, present only so the Presets
 * picker can show "Orderflow Pro (coming soon)" honestly instead of that
 * concept not existing anywhere.
 *
 * Note on `sizes`: today's real UI sizes the sidebar/dock in absolute pixels
 * (`sidebarWidth`/`dockHeight` state in studio.tsx) with the chart taking
 * the flex remainder — not proportional weights. studio.tsx only ever reads
 * the `right-sidebar` and `bottom-dock` "tabs" nodes out of this tree (see
 * `WELL_KNOWN_NODE_IDS`/`findNodeById` usage there) — there is no rendering
 * for any third region or for the `root`/`main-row` split structure beyond
 * those two lookups. Every preset below places widgets only into those two
 * regions for that reason; `orderflowPro`'s extra `dom-panel` column is
 * inert data (kept for continuity with its existing shape) until real
 * multi-pane rendering exists.
 */

import type { WidgetTypeId, WorkspaceLayout } from "./types";
import { collectWidgetTypeIds } from "./types";
import { WIDGET_REGISTRY } from "./widgetRegistry";

function inst(instanceId: string, widgetTypeId: WidgetTypeId) {
  return { instanceId, widgetTypeId };
}

export type PresetId =
  | "beginner"
  | "indicatorBuilder"
  | "backtesting"
  | "activeTrader"
  | "orderflowPro";

/** Display order for the Presets picker — Beginner first. */
export const PRESET_ORDER: PresetId[] = [
  "beginner",
  "indicatorBuilder",
  "backtesting",
  "activeTrader",
  "orderflowPro",
];

export const PRESETS: Record<PresetId, WorkspaceLayout> = {
  beginner: {
    version: 1,
    name: "Beginner",
    isPreset: true,
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "workspace-root",
      direction: "column",
      sizes: [0.78, 0.22],
      children: [
        {
          kind: "split",
          id: "main-row",
          direction: "row",
          sizes: [0.82, 0.18],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "right-sidebar",
              tabs: [
                inst("watchlist-1", "watchlist"),
                inst("trade-1", "trade"),
                inst("ai-builder-1", "ai-builder"),
                inst("alerts-1", "alerts"),
              ],
              activeInstanceId: "watchlist-1",
            },
          ],
        },
        {
          kind: "tabs",
          id: "bottom-dock",
          tabs: [
            { ...inst("code-editor-1", "code-editor"), pinned: true },
            inst("strategy-tester-1", "strategy-tester"),
            inst("positions-1", "positions"),
            inst("orders-1", "orders"),
            inst("history-1", "history"),
            inst("journal-1", "journal"),
            inst("saved-indicators-1", "saved-indicators"),
            inst("reference-1", "reference"),
          ],
          activeInstanceId: "code-editor-1",
        },
      ],
    },
  },

  indicatorBuilder: {
    version: 1,
    name: "Indicator Builder",
    isPreset: true,
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "workspace-root",
      direction: "column",
      sizes: [0.78, 0.22],
      children: [
        {
          kind: "split",
          id: "main-row",
          direction: "row",
          sizes: [0.82, 0.18],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "right-sidebar",
              tabs: [inst("ai-builder-1", "ai-builder")],
              activeInstanceId: "ai-builder-1",
            },
          ],
        },
        {
          kind: "tabs",
          id: "bottom-dock",
          tabs: [
            { ...inst("code-editor-1", "code-editor"), pinned: true },
            inst("strategy-tester-1", "strategy-tester"),
            inst("saved-indicators-1", "saved-indicators"),
          ],
          activeInstanceId: "code-editor-1",
        },
      ],
    },
  },

  backtesting: {
    version: 1,
    name: "Backtesting",
    isPreset: true,
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "workspace-root",
      direction: "column",
      sizes: [0.72, 0.28],
      children: [
        {
          kind: "split",
          id: "main-row",
          direction: "row",
          sizes: [0.82, 0.18],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "right-sidebar",
              tabs: [inst("watchlist-1", "watchlist")],
              activeInstanceId: "watchlist-1",
            },
          ],
        },
        {
          kind: "tabs",
          id: "bottom-dock",
          tabs: [
            { ...inst("code-editor-1", "code-editor"), pinned: true },
            inst("strategy-tester-1", "strategy-tester"),
            inst("saved-indicators-1", "saved-indicators"),
            inst("journal-1", "journal"),
          ],
          activeInstanceId: "strategy-tester-1",
        },
      ],
    },
  },

  activeTrader: {
    version: 1,
    name: "Active Trader",
    isPreset: true,
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "workspace-root",
      direction: "column",
      sizes: [0.78, 0.22],
      children: [
        {
          kind: "split",
          id: "main-row",
          direction: "row",
          sizes: [0.78, 0.22],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "right-sidebar",
              tabs: [
                inst("watchlist-1", "watchlist"),
                inst("trade-1", "trade"),
                inst("alerts-1", "alerts"),
              ],
              activeInstanceId: "trade-1",
            },
          ],
        },
        {
          kind: "tabs",
          id: "bottom-dock",
          tabs: [inst("positions-1", "positions"), inst("orders-1", "orders")],
          activeInstanceId: "positions-1",
        },
      ],
    },
  },

  orderflowPro: {
    version: 1,
    name: "Orderflow Pro",
    isPreset: true,
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "workspace-root",
      direction: "column",
      sizes: [0.7, 0.3],
      children: [
        {
          kind: "split",
          id: "main-row",
          direction: "row",
          sizes: [0.6, 0.2, 0.2],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "dom-panel",
              tabs: [inst("dom-1", "dom")],
              activeInstanceId: "dom-1",
            },
            {
              kind: "tabs",
              id: "right-sidebar",
              tabs: [
                inst("watchlist-1", "watchlist"),
                inst("trade-1", "trade"),
                inst("alerts-1", "alerts"),
              ],
              activeInstanceId: "watchlist-1",
            },
          ],
        },
        {
          kind: "tabs",
          id: "bottom-dock",
          tabs: [
            inst("time-sales-1", "time-sales"),
            inst("footprint-1", "footprint"),
            inst("positions-1", "positions"),
            inst("orders-1", "orders"),
          ],
          activeInstanceId: "time-sales-1",
        },
      ],
    },
  },
};

/** A preset is locked (not selectable yet) if it references any widget type that isn't real yet. */
export function isPresetLocked(layout: WorkspaceLayout): boolean {
  return collectWidgetTypeIds(layout.root).some(
    (id) => WIDGET_REGISTRY[id].availability === "coming-soon",
  );
}
