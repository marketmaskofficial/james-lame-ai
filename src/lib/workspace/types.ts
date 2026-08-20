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
   * UI-4g-2: hard ceiling on simultaneous instances of this widget type
   * anywhere in the tree, when `allowMultipleInstances` is true (meaningless
   * otherwise). Chart is the only widget this applies to today (4, per the
   * approved multi-chart cap) — a generic field rather than a chart-specific
   * one so it isn't a hardcoded special case, enforced by the mutators in
   * mutations.ts (not just the UI) so it can't be bypassed.
   */
  maxInstances?: number;
  /**
   * Why this widget isn't real yet — the shared coming-soon placeholder's
   * entire UI is this string. Never render fabricated data for a
   * "coming-soon" widget; this is the honest substitute for that.
   */
  comingSoonReason?: string;
  /**
   * Which existing regions this widget type has REAL rendering wired up for
   * today — not an aspiration, a fact about the current codebase. A region
   * move/add is only ever offered (and only ever succeeds at the mutator
   * level — see mutations.ts) when the destination is in this list, so the
   * "this widget isn't available here yet" fallback can never be the result
   * of a normal UI-driven move; it only exists as defensive last-resort
   * insurance against a future bug.
   */
  renderableRegions: Array<"sidebar" | "dock">;
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
  /**
   * When true, this specific open instance can't be closed — a property of
   * how a layout USES a widget (an instance placed by a preset), not of the
   * widget type itself, since nothing is inherently "required" globally.
   * Enforced by `removeWidgetFromNode`, not just the UI, so it can't be
   * bypassed by calling the mutator directly.
   */
  pinned?: boolean;
  /**
   * UI-4g-2: this instance's own runtime config, persisted in the tree
   * itself (not page-level-only state) so a saved layout — local OR the
   * signed-in Supabase `workspace_layouts` row, both just an opaque JSON
   * blob — can restore each chart's own symbol/timeframe/type/settings
   * independently on reload or on a different device. Only meaningful for
   * `widgetTypeId === "chart"`; every other widget type still has none.
   * Deliberately loose/untyped here (`unknown` for `settings`) — this file
   * stays workspace-generic and doesn't import studio.tsx's `ChartSettings`
   * shape; the caller narrows/validates it.
   */
  chartConfig?: {
    symbol: string;
    interval: string;
    chartType?: string;
    settings?: Record<string, unknown>;
    /**
     * UI-4g-4: opt-in symbol/timeframe linking across chart instances — one
     * shared linked set, not named groups. "independent" (or missing/absent,
     * which means the same thing — every chart from before this phase and
     * every newly-added chart defaults here) never sends or receives
     * propagation. "symbol"/"timeframe"/"both" propagate a user-driven
     * change on THIS field, once, to every other chart instance whose own
     * linkMode also includes that field — see `propagateLinkedChartField`
     * in studio.tsx for the actual one-shot (non-chaining) propagation.
     */
    linkMode?: "independent" | "symbol" | "timeframe" | "both";
  };
  /**
   * UI-4h-2: this instance's own settings, persisted in the tree itself —
   * same rationale as `chartConfig` above (an opaque field on an opaque jsonb
   * column, so no migration is needed either way). Only meaningful for
   * `widgetTypeId === "volume-profile"`.
   */
  volumeProfileConfig?: {
    /** Number of price bins the visible lookback window is divided into. */
    bins: number;
    /** How many of the bound chart's most recent bars to compute the profile over. */
    lookbackBars: number;
    /** Target % of total volume the Value Area (VAH/VAL) should contain, expanded outward from the POC bin. */
    valueAreaPct: number;
    /**
     * Which open chart instance this widget reads bars/symbol/interval from.
     * The literal `"active"` tracks whichever chart currently has focus
     * (studio.tsx's `activeChartInstanceId`); any other value is a specific
     * chart's own instanceId, pinning this widget to that chart independently
     * of which one the user is actively working in — falls back to `"active"`
     * if the pinned chart instance no longer exists (e.g. it was closed).
     */
    boundChartInstanceId: string;
  };
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
 *
 * `chartColumn` (UI-4f-1) is the split node that actually groups chart-area
 * + bottom-dock into one column — this is what studio.tsx's real DOM has
 * always done (a `<main>` containing the chart div stacked above the dock
 * section, with the sidebar as a separate full-height sibling), which does
 * NOT match the `root`/`mainRow` shape originally declared in UI-4a
 * (`root` = column[mainRow, bottomDock], `mainRow` = row[chartArea,
 * rightSidebar] — a shape nothing ever actually rendered, since nothing
 * walked "split" nodes before UI-4f-1). `mainRow` is kept here, unused by
 * current presets, purely so `persistence.ts` can still recognize and
 * repair that legacy shape in any already-persisted saved layout.
 */
export const WELL_KNOWN_NODE_IDS = {
  root: "workspace-root",
  mainRow: "main-row",
  chartColumn: "chart-column",
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

/**
 * UI-4f-5: the full id path from `root` down to (and including) `leafId`, or
 * null if not found. Maximize/collapse originally assumed a leaf's only
 * ancestor was one fixed, well-known split id (`chart-column` for the dock,
 * `workspace-root` for the sidebar) — true when nothing else could nest
 * between them. Edge-drop (UI-4f-4) breaks that assumption: it can wrap
 * `bottom-dock` or `right-sidebar` in a brand-new split with a generated id,
 * which the old hardcoded check had no way to know about. This walks the
 * REAL tree instead, so the caller can make every ancestor along the actual
 * path non-resizable and know which child at each level to keep emphasized
 * — not just the two originally-anticipated cases.
 */
export function pathToLeaf(root: LayoutNode, leafId: string): string[] | null {
  if (root.kind === "tabs") return root.id === leafId ? [root.id] : null;
  for (const child of root.children) {
    const sub = pathToLeaf(child, leafId);
    if (sub) return [root.id, ...sub];
  }
  return null;
}

/**
 * Maps a "tabs" node id to the capability-region label a WidgetTypeDef's
 * `renderableRegions` speaks in. Returns null for node ids that aren't one
 * of the two customizable regions (e.g. the fixed chart area) — capability
 * gating only applies to regions a widget can actually be added/moved into.
 */
export function regionKindForNodeId(nodeId: string): "sidebar" | "dock" | null {
  if (nodeId === WELL_KNOWN_NODE_IDS.rightSidebar) return "sidebar";
  if (nodeId === WELL_KNOWN_NODE_IDS.bottomDock) return "dock";
  return null;
}

/**
 * Leaves that must never structurally disappear from the tree via a widget
 * move/removal (UI-4f-3): the two permanent chrome regions. Each keeps a
 * hard floor of 1 remaining tab, enforced by the mutators in mutations.ts;
 * any other leaf id may legitimately empty out and collapse away instead —
 * see `collapseEmptyNodes`.
 *
 * UI-4g-2: `chart-area` is deliberately NOT listed here anymore — with
 * multiple chart instances possible, chart-area is just an ordinary leaf
 * that happens to hold one of them; a chart being dragged/edge-dropped out
 * of it and into a new pane must be able to empty it and collapse it away
 * exactly like any other non-permanent leaf. What's actually protected now
 * is "the last remaining chart instance anywhere in the tree" — a
 * cross-tree, instance-count rule, not a specific node id. See
 * `wouldLeaveNoInstancesOfType`, checked by the mutators alongside this.
 */
export function isProtectedLeaf(nodeId: string): boolean {
  return regionKindForNodeId(nodeId) !== null;
}

/** Total tabs anywhere in the tree whose `widgetTypeId` matches. */
export function countInstancesOfType(root: LayoutNode, widgetTypeId: WidgetTypeId): number {
  return collectWidgetTypeIds(root).filter((id) => id === widgetTypeId).length;
}

/**
 * UI-4g-2: true if removing `instanceId` (a widget of type `widgetTypeId`)
 * would leave zero instances of that type anywhere in the tree. Only ever
 * meaningful for multi-instance-capable types (today, only `chart` —
 * everything else already has exactly one instance or none) — for a
 * single-instance type this is equivalent to "is this the only one," which
 * is already true by construction, so callers only need to invoke this for
 * types where more than one could legitimately exist. Losing the last chart
 * would break the app outright (nothing left to show bars/indicators on),
 * not just look different — this is the multi-chart-era equivalent of what
 * `chart-area`'s old node-based protection used to guarantee.
 */
export function wouldLeaveNoInstancesOfType(
  root: LayoutNode,
  instanceId: string,
  widgetTypeId: WidgetTypeId,
): boolean {
  return countInstancesOfType(root, widgetTypeId) <= 1;
}

/**
 * Removes "tabs" nodes left with zero tabs, and collapses "split" nodes down
 * to their one surviving child (or drops them too if every child was
 * emptied) — the same shape of repair `persistence.ts`'s `repairNode`
 * already does when recovering corrupted saved data, reused here (rather
 * than duplicated by refactoring that already-tested repair path) so a
 * widget move/removal that legitimately empties a non-protected leaf
 * (UI-4f-3) cleans up the tree structurally instead of leaving a dangling
 * empty pane. Protected leaves never reach this path empty in practice —
 * their mutators enforce the floor of 1 tab above — so this function
 * doesn't need to know about that distinction itself. Returns the identical
 * node reference when nothing actually changed, so callers can cheaply
 * detect a no-op and avoid needless re-renders.
 */
export function collapseEmptyNodes(node: LayoutNode): LayoutNode | null {
  if (node.kind === "tabs") {
    return node.tabs.length === 0 ? null : node;
  }
  let changed = false;
  const survivors: LayoutNode[] = [];
  const survivorSizes: number[] = [];
  node.children.forEach((child, i) => {
    const result = collapseEmptyNodes(child);
    if (result !== child) changed = true;
    if (result) {
      survivors.push(result);
      survivorSizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (survivors.length === 0) return null;
  if (survivors.length === 1) return survivors[0];
  if (!changed) return node;
  const total = survivorSizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children: survivors, sizes: survivorSizes.map((s) => s / total) };
}
