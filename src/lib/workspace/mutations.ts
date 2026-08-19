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
