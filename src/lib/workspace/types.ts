/**
 * Modular trading workspace — data model (UI-4a scaffolding).
 *
 * Shaped as a general recursive layout tree — the same conceptual shape a
 * docking manager (golden-layout / rc-dock / dockview) serializes to — even
 * though this phase does not adopt one of those libraries or build drag
 * interactions. The point: today's fixed chart/sidebar/dock layout is
 * representable as a (trivial) tree right now, so a later phase adding real
 * drag-to-dock only adds an interaction layer on top of this shape — it
 * never has to migrate already-saved layouts to a new schema.
 *
 * This file defines the shape only. Nothing in the running app reads or
 * writes it yet (that's a later phase) — see presets.ts for the "beginner"
 * preset expressing today's actual studio.tsx layout in this shape, used to
 * prove the model fits reality before anything is wired to it.
 */

export type WidgetTypeId =
  | "chart"
  | "watchlist"
  | "trade"
  | "ai-builder"
  | "alerts"
  | "code-editor"
  | "strategy-tester"
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "saved-indicators"
  | "reference"
  | "scanner"
  | "news"
  | "dom"
  | "footprint"
  | "time-sales"
  | "heatmap"
  | "volume-profile";

export type WidgetAvailability = "available" | "coming-soon";

export type WidgetTypeDef = {
  id: WidgetTypeId;
  label: string;
  category: "core" | "analysis" | "orderflow" | "account";
  availability: WidgetAvailability;
  /**
   * True for widget types that can have more than one open instance at once
   * (e.g. a second chart on a different symbol). Every widget today is
   * effectively singleton per its region; kept explicit now so a future
   * multi-instance UI doesn't need a schema change.
   */
  allowMultipleInstances?: boolean;
  /**
   * Why this widget isn't real yet — the shared coming-soon placeholder's
   * entire UI is this string. Never render fabricated data for a
   * "coming-soon" widget; this is the honest substitute for that.
   */
  comingSoonReason?: string;
};

/**
 * One open widget inside a "tabs" node. `instanceId` — not `widgetTypeId` —
 * is the tree's real identity, so the same widget type can eventually appear
 * more than once (two charts, two watchlists) without ambiguity.
 */
export type WidgetInstance = {
  instanceId: string;
  widgetTypeId: WidgetTypeId;
  /** User override of the registry's default label, if renamed. */
  title?: string;
};

export type LayoutNode =
  | {
      kind: "tabs";
      id: string;
      tabs: WidgetInstance[];
      activeInstanceId: string;
    }
  | {
      kind: "split";
      id: string;
      direction: "row" | "column";
      /** Relative weights, same length/order as `children`. */
      sizes: number[];
      children: LayoutNode[];
    };

export type WorkspaceLayout = {
  version: 1;
  /** Present once saved as a Supabase row (a later persistence phase sets this) — absent for in-memory presets. */
  id?: string;
  name: string;
  isPreset?: boolean;
  root: LayoutNode;
  /** VSCode-style "maximize this node" — when set, only that node renders at full size. References a LayoutNode id. */
  maximizedNodeId: string | null;
  /** Nodes rendering only their tab strip / collapsed chrome. References LayoutNode ids. */
  collapsedNodeIds: string[];
};

/**
 * Well-known node ids that today's fixed chrome (chart / right sidebar /
 * bottom dock) maps onto, so the existing collapse/maximize toolbar buttons
 * can eventually target this tree with zero behavior change — same ids,
 * just read from a tree instead of separate booleans.
 */
export const WELL_KNOWN_NODE_IDS = {
  root: "workspace-root",
  mainRow: "main-row",
  chartArea: "chart-area",
  rightSidebar: "right-sidebar",
  bottomDock: "bottom-dock",
} as const;

/** Depth-first collection of every widget type referenced anywhere in a layout tree. */
export function collectWidgetTypeIds(node: LayoutNode): WidgetTypeId[] {
  if (node.kind === "tabs") return node.tabs.map((t) => t.widgetTypeId);
  return node.children.flatMap(collectWidgetTypeIds);
}

/** Depth-first find of a node by id, or null if absent. */
export function findNodeById(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.kind === "split") {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}
