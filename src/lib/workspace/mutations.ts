/**
 * Pure, immutable mutations over a WorkspaceLayout tree (UI-4c). No React, no
 * DOM — each function takes a layout and returns a new one, so callers own
 * how/when to setState and can unit-test these directly (see
 * test/workspace/tree.test.mjs).
 *
 * Lives in its own file rather than types.ts because these need the widget
 * registry (to enforce "coming-soon widgets can never be added" inside the
 * mutator itself, not just the UI) — types.ts stays registry-agnostic per its
 * own header comment, and widgetRegistry.ts already imports types.ts, so
 * having types.ts import back from widgetRegistry.ts would be circular.
 */

import type { LayoutNode, WidgetInstance, WidgetTypeId, WorkspaceLayout } from "./types";
import { collapseEmptyNodes, findNodeById, isProtectedLeaf, regionKindForNodeId } from "./types";
import { getWidgetDef } from "./widgetRegistry";

function mapNode(node: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (node.id === id) return fn(node);
  if (node.kind === "split") {
    return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) };
  }
  return node;
}

function withRoot(layout: WorkspaceLayout, root: LayoutNode): WorkspaceLayout {
  return { ...layout, root };
}

/**
 * After a mutation that may have collapsed nodes out of the tree (UI-4f-3),
 * drops any now-dangling `maximizedNodeId`/`collapsedNodeIds` reference so
 * the layout never points at a node that no longer exists.
 */
function withCollapsedRoot(layout: WorkspaceLayout, root: LayoutNode): WorkspaceLayout {
  const maximizedNodeId =
    layout.maximizedNodeId && findNodeById(root, layout.maximizedNodeId) ? layout.maximizedNodeId : null;
  const collapsedNodeIds = layout.collapsedNodeIds.filter((id) => findNodeById(root, id) !== null);
  return { ...layout, root, maximizedNodeId, collapsedNodeIds };
}

/** Picks a sensible neighbor to become active after removing `removedIndex` from `tabs`. */
function neighborAfterRemoval(tabs: WidgetInstance[], removedIndex: number): string {
  const fallbackIndex = removedIndex > 0 ? removedIndex - 1 : 0;
  return tabs[fallbackIndex]?.instanceId ?? "";
}

/**
 * Appends a new instance of `widgetTypeId` to the "tabs" node `nodeId` and
 * makes it active. No-op (returns the same layout unchanged) if the widget
 * type is "coming-soon", or if `nodeId` maps to a region the widget isn't
 * in `renderableRegions` for — both enforced here, not just in the UI, so
 * neither can be bypassed by calling this directly.
 */
export function addWidgetToNode(
  layout: WorkspaceLayout,
  nodeId: string,
  widgetTypeId: WidgetTypeId,
): WorkspaceLayout {
  const def = getWidgetDef(widgetTypeId);
  if (def.availability !== "available") return layout;
  const region = regionKindForNodeId(nodeId);
  if (region && !def.renderableRegions.includes(region)) return layout;
  const instanceId = `${widgetTypeId}-${crypto.randomUUID()}`;
  const root = mapNode(layout.root, nodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (n.tabs.some((t) => t.widgetTypeId === widgetTypeId)) return n; // already open here
    return { ...n, tabs: [...n.tabs, { instanceId, widgetTypeId }], activeInstanceId: instanceId };
  });
  return withRoot(layout, root);
}

/**
 * Removes `instanceId` from the "tabs" node `nodeId`. No-op if the instance
 * is pinned. If `nodeId` is a protected leaf (chart-area, right-sidebar,
 * bottom-dock — see `isProtectedLeaf`), also a no-op when it's the last tab,
 * same structural floor as before UI-4f-3. Any other leaf may legitimately
 * be emptied — doing so collapses it (and, cascading, its parent split if
 * that leaves it with one child) out of the tree via `collapseEmptyNodes`,
 * rather than leaving a dangling empty pane.
 */
export function removeWidgetFromNode(
  layout: WorkspaceLayout,
  nodeId: string,
  instanceId: string,
): WorkspaceLayout {
  const protectedLeaf = isProtectedLeaf(nodeId);
  let removedSomething = false;
  const root = mapNode(layout.root, nodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (protectedLeaf && n.tabs.length <= 1) return n;
    const idx = n.tabs.findIndex((t) => t.instanceId === instanceId);
    if (idx === -1) return n;
    if (n.tabs[idx].pinned) return n;
    const tabs = n.tabs.filter((t) => t.instanceId !== instanceId);
    const activeInstanceId =
      n.activeInstanceId === instanceId ? neighborAfterRemoval(n.tabs, idx) : n.activeInstanceId;
    removedSomething = true;
    return { ...n, tabs, activeInstanceId };
  });
  if (!removedSomething) return layout;
  const collapsedRoot = collapseEmptyNodes(root) ?? root; // the root itself can never legitimately vanish
  return withCollapsedRoot(layout, collapsedRoot);
}

/** Splices `tabs` in the "tabs" node `nodeId` from `fromIndex` to `toIndex`. Active instance identity is unaffected by position. */
export function reorderWithinNode(
  layout: WorkspaceLayout,
  nodeId: string,
  fromIndex: number,
  toIndex: number,
): WorkspaceLayout {
  const root = mapNode(layout.root, nodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (
      fromIndex < 0 ||
      fromIndex >= n.tabs.length ||
      toIndex < 0 ||
      toIndex >= n.tabs.length ||
      fromIndex === toIndex
    )
      return n;
    const tabs = n.tabs.slice();
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    return { ...n, tabs };
  });
  return withRoot(layout, root);
}

/**
 * Updates a "split" node's `sizes` (relative weights, same order/length as
 * `children`) after a user-driven pane resize (UI-4f-2). No-op if `nodeId`
 * doesn't resolve to a "split" node or `sizes`' length doesn't match its
 * children count.
 */
export function updateSplitSizes(
  layout: WorkspaceLayout,
  nodeId: string,
  sizes: number[],
): WorkspaceLayout {
  const root = mapNode(layout.root, nodeId, (n) => {
    if (n.kind !== "split") return n;
    if (sizes.length !== n.children.length) return n;
    return { ...n, sizes };
  });
  return withRoot(layout, root);
}

/**
 * Sets `instanceId` active within the "tabs" node `nodeId`. No-op if that
 * node isn't a "tabs" leaf or doesn't contain that instance — used by
 * generically-rendered leaves (UI-4f-4) that read their active tab straight
 * from the tree instead of the legacy `dock`/`rightTab` state variables the
 * two well-known regions still use.
 */
export function setActiveTab(
  layout: WorkspaceLayout,
  nodeId: string,
  instanceId: string,
): WorkspaceLayout {
  const root = mapNode(layout.root, nodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (!n.tabs.some((t) => t.instanceId === instanceId)) return n;
    return { ...n, activeInstanceId: instanceId };
  });
  return withRoot(layout, root);
}

/** Read-only lookup of a "tabs" node's instance by id, without mutating anything. */
function findInstance(node: LayoutNode, nodeId: string, instanceId: string): WidgetInstance | null {
  const n = mapNodeReadOnly(node, nodeId);
  if (!n || n.kind !== "tabs") return null;
  return n.tabs.find((t) => t.instanceId === instanceId) ?? null;
}
function mapNodeReadOnly(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.kind === "split") {
    for (const child of node.children) {
      const found = mapNodeReadOnly(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Moves `instanceId` from the "tabs" node `fromNodeId` to `toNodeId`,
 * becoming active in the destination. No-op if: the instance can't be
 * found, the destination doesn't resolve to a real "tabs" node, it's
 * pinned, the destination region isn't in the widget's `renderableRegions`
 * (checked BEFORE anything is removed from the source, so a rejected move
 * never loses the widget), or the widget type is already open in the
 * destination.
 *
 * On the source side (UI-4f-3): protected leaves (chart-area, right-sidebar,
 * bottom-dock) keep the pre-UI-4f-3 floor — a move that would empty one is
 * rejected, same as `removeWidgetFromNode`. Any other leaf may legitimately
 * be dragged empty; doing so collapses it (and, cascading, its parent split)
 * out of the tree via `collapseEmptyNodes` rather than leaving a dangling
 * empty pane — this is dormant for today's two reachable leaves (both
 * protected) and becomes load-bearing once UI-4f-4 can create new ones.
 */
export function moveWidgetBetweenNodes(
  layout: WorkspaceLayout,
  instanceId: string,
  fromNodeId: string,
  toNodeId: string,
): WorkspaceLayout {
  if (fromNodeId === toNodeId) return layout;

  const instance = findInstance(layout.root, fromNodeId, instanceId);
  if (!instance) return layout;
  const destination = mapNodeReadOnly(layout.root, toNodeId);
  if (!destination || destination.kind !== "tabs") return layout; // invalid/nonexistent destination
  const toRegion = regionKindForNodeId(toNodeId);
  if (toRegion && !getWidgetDef(instance.widgetTypeId).renderableRegions.includes(toRegion)) return layout;
  if (destination.tabs.some((t) => t.widgetTypeId === instance.widgetTypeId)) {
    return layout; // already open in the destination
  }

  const protectedSource = isProtectedLeaf(fromNodeId);
  let moving: WidgetInstance | null = null;
  const afterRemoval = mapNode(layout.root, fromNodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (protectedSource && n.tabs.length <= 1) return n;
    const idx = n.tabs.findIndex((t) => t.instanceId === instanceId);
    if (idx === -1) return n;
    if (n.tabs[idx].pinned) return n;
    moving = n.tabs[idx];
    const tabs = n.tabs.filter((t) => t.instanceId !== instanceId);
    const activeInstanceId =
      n.activeInstanceId === instanceId ? neighborAfterRemoval(n.tabs, idx) : n.activeInstanceId;
    return { ...n, tabs, activeInstanceId };
  });
  if (!moving) return layout; // rejected by the source's own protections

  const afterInsert = mapNode(afterRemoval, toNodeId, (n) => {
    if (n.kind !== "tabs") return n;
    return { ...n, tabs: [...n.tabs, moving as WidgetInstance], activeInstanceId: instanceId };
  });
  const collapsedRoot = collapseEmptyNodes(afterInsert) ?? afterInsert;
  return withCollapsedRoot(layout, collapsedRoot);
}

export type DropEdge = "top" | "bottom" | "left" | "right";

/**
 * UI-4f-4: whether a widget type's content is known-safe to render inside a
 * brand-new, freshly-created split leaf. Reuses the EXACT existing
 * `renderableRegions.includes("sidebar")` signal rather than inventing a new
 * one — that flag already means "this widget's content is self-contained,
 * proven to render correctly outside its original dock-only context" (only
 * watchlist/trade/ai-builder/alerts carry it, per widgetRegistry.ts). The
 * other 8 available widgets (code-editor, strategy-tester, positions,
 * orders, history, journal, saved-indicators, reference) have real rendering
 * ONLY wired into the two well-known regions today — building genuinely new
 * cross-context rendering for them is out of this sub-phase's scope, same
 * "don't fake it, don't build untested rendering" principle UI-4c already
 * applied to the sidebar-capability gap. Edge-drop for those 8 stays
 * unavailable until a later phase does that rendering work; this is a real,
 * deliberate scope boundary, not an oversight.
 */
export function isPortableForNewLeaf(widgetTypeId: WidgetTypeId): boolean {
  return getWidgetDef(widgetTypeId).renderableRegions.includes("sidebar");
}

/**
 * Moves `instanceId` out of `fromNodeId` and wraps `targetNodeId` in a new
 * "split" node containing the original target leaf and a fresh leaf holding
 * just the dragged widget, as its only (active) tab. Direction is "column"
 * for a top/bottom edge-drop, "row" for left/right; the new leaf becomes the
 * FIRST child for top/left, second for bottom/right — price of the
 * geometry, not an arbitrary choice.
 *
 * No-op (same rejection rules as `moveWidgetBetweenNodes`, checked before
 * anything is touched): source/target the same node, instance not found,
 * target isn't a real "tabs" leaf, the widget isn't `isPortableForNewLeaf`
 * (see above), or the source-side protections (pinned instance, or emptying
 * a protected leaf) apply. On success, any node emptied by the removal is
 * collapsed away via the same `collapseEmptyNodes` every other mutator here
 * uses — a self-contained pane can itself later collapse the same way once
 * closed, this isn't special-cased.
 */
export function splitLeafWithWidget(
  layout: WorkspaceLayout,
  instanceId: string,
  fromNodeId: string,
  targetNodeId: string,
  edge: DropEdge,
): WorkspaceLayout {
  if (fromNodeId === targetNodeId) return layout;

  const instance = findInstance(layout.root, fromNodeId, instanceId);
  if (!instance) return layout;
  if (!isPortableForNewLeaf(instance.widgetTypeId)) return layout;
  const target = mapNodeReadOnly(layout.root, targetNodeId);
  if (!target || target.kind !== "tabs") return layout;

  const protectedSource = isProtectedLeaf(fromNodeId);
  let moving: WidgetInstance | null = null;
  const afterRemoval = mapNode(layout.root, fromNodeId, (n) => {
    if (n.kind !== "tabs") return n;
    if (protectedSource && n.tabs.length <= 1) return n;
    const idx = n.tabs.findIndex((t) => t.instanceId === instanceId);
    if (idx === -1) return n;
    if (n.tabs[idx].pinned) return n;
    moving = n.tabs[idx];
    const tabs = n.tabs.filter((t) => t.instanceId !== instanceId);
    const activeInstanceId =
      n.activeInstanceId === instanceId ? neighborAfterRemoval(n.tabs, idx) : n.activeInstanceId;
    return { ...n, tabs, activeInstanceId };
  });
  if (!moving) return layout; // rejected by the source's own protections

  const movedInstance = moving as WidgetInstance;
  const newLeaf: LayoutNode = {
    kind: "tabs",
    id: `pane-${crypto.randomUUID()}`,
    tabs: [movedInstance],
    activeInstanceId: instanceId,
  };
  const direction: "row" | "column" = edge === "left" || edge === "right" ? "row" : "column";
  const newLeafFirst = edge === "left" || edge === "top";

  function replaceTargetWithSplit(node: LayoutNode): LayoutNode {
    if (node.kind === "tabs") return node;
    let changed = false;
    const children = node.children.map((c) => {
      if (c.id === targetNodeId) {
        changed = true;
        const targetNow = mapNodeReadOnly(afterRemoval, targetNodeId) as LayoutNode;
        const pair = newLeafFirst ? [newLeaf, targetNow] : [targetNow, newLeaf];
        const split: LayoutNode = {
          kind: "split",
          id: `split-${crypto.randomUUID()}`,
          direction,
          sizes: [0.5, 0.5],
          children: pair,
        };
        return split;
      }
      const next = replaceTargetWithSplit(c);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  }

  const afterSplit = replaceTargetWithSplit(afterRemoval);
  const collapsedRoot = collapseEmptyNodes(afterSplit) ?? afterSplit;
  return withCollapsedRoot(layout, collapsedRoot);
}
