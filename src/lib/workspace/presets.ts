/**
 * Code-defined default layouts, expressed in the general tree shape from
 * types.ts. `beginner` is today's ACTUAL Chart Studio layout — same widgets,
 * same tab order, same default panel proportions — so adopting this data
 * model changes nothing about what a user sees. `orderflowPro` is a locked
 * preview referencing not-yet-real widgets, present only so the Presets
 * picker can show "Orderflow Pro (coming soon)" honestly instead of that
 * concept not existing anywhere.
 *
 * Topology (UI-4f-1): `root` is a ROW split of `[chart-column, right-sidebar]`
 * (plus `dom-panel` for the locked orderflowPro preview), and `chart-column`
 * is a COLUMN split of `[chart-area, bottom-dock]` — this matches what
 * studio.tsx's DOM has always actually rendered (chart stacked above the
 * dock, with the sidebar as a separate full-height column beside both), now
 * that `LayoutTree` genuinely walks this structure instead of the three
 * regions being hardcoded JSX. Earlier phases (UI-4a-4e) declared a
 * different shape here — `root` = column[`main-row`, bottom-dock], `main-row`
 * = row[chart-area, right-sidebar] — which was never actually wrong to have
 * shipped, since nothing rendered "split" nodes before UI-4f-1; it just
 * doesn't match reality now that something does. `safeParseWorkspaceLayout`
 * (persistence.ts) transparently repairs any already-persisted saved layout
 * still using that old shape into this one, preserving every widget/tab
 * exactly, so no user-visible change or migration step is needed.
 *
 * Note on `sizes`: still illustrative proportions, not literally read yet —
 * studio.tsx's real UI still sizes the sidebar/dock in absolute pixels
 * (`sidebarWidth`/`dockHeight` state) with the chart taking the flex
 * remainder. Reading `sizes` for actual pane sizing is UI-4f-2.
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
      direction: "row",
      sizes: [0.82, 0.18],
      children: [
        {
          kind: "split",
          id: "chart-column",
          direction: "column",
          // 320px was Chart Studio's real, hardcoded default dock height
          // (pre-UI-4f-2) at a typical viewport -- [0.78, 0.22] rendered a
          // visibly shorter ~187px dock once `sizes` actually became
          // load-bearing (it was never read before this phase), a real
          // discrepancy caught via a before/after screenshot comparison,
          // not a hypothetical. [0.62, 0.38] reproduces the historical
          // ~320px default closely.
          sizes: [0.62, 0.38],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
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
      direction: "row",
      sizes: [0.82, 0.18],
      children: [
        {
          kind: "split",
          id: "chart-column",
          direction: "column",
          // Same correction as the Beginner preset above -- [0.78, 0.22]
          // renders a visibly cramped dock now that `sizes` actually
          // governs pane sizing (UI-4f-2).
          sizes: [0.62, 0.38],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
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
        {
          kind: "tabs",
          id: "right-sidebar",
          tabs: [inst("ai-builder-1", "ai-builder")],
          activeInstanceId: "ai-builder-1",
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
      direction: "row",
      sizes: [0.82, 0.18],
      children: [
        {
          kind: "split",
          id: "chart-column",
          direction: "column",
          // Scaled by the same correction factor as Beginner's (see above)
          // while preserving this preset's original intent of a relatively
          // taller dock than the other presets (0.28 vs 0.22 before).
          sizes: [0.55, 0.45],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
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
        {
          kind: "tabs",
          id: "right-sidebar",
          tabs: [inst("watchlist-1", "watchlist")],
          activeInstanceId: "watchlist-1",
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
      direction: "row",
      sizes: [0.78, 0.22],
      children: [
        {
          kind: "split",
          id: "chart-column",
          direction: "column",
          // Same correction as the Beginner preset above.
          sizes: [0.62, 0.38],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
            },
            {
              kind: "tabs",
              id: "bottom-dock",
              tabs: [inst("positions-1", "positions"), inst("orders-1", "orders")],
              activeInstanceId: "positions-1",
            },
          ],
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
      direction: "row",
      sizes: [0.6, 0.2, 0.2],
      children: [
        {
          kind: "split",
          id: "chart-column",
          direction: "column",
          sizes: [0.7, 0.3],
          children: [
            {
              kind: "tabs",
              id: "chart-area",
              tabs: [inst("chart-1", "chart")],
              activeInstanceId: "chart-1",
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
  },
};

/** A preset is locked (not selectable yet) if it references any widget type that isn't real yet. */
export function isPresetLocked(layout: WorkspaceLayout): boolean {
  return collectWidgetTypeIds(layout.root).some(
    (id) => WIDGET_REGISTRY[id].availability === "coming-soon",
  );
}
