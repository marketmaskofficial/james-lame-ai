import { Fragment, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode } from "@/lib/workspace/types";

type TabsNode = Extract<LayoutNode, { kind: "tabs" }>;
type SplitNode = Extract<LayoutNode, { kind: "split" }>;

type LayoutTreeProps = {
  node: LayoutNode;
  /**
   * Renders one "tabs" leaf's entire region — chrome, tab strip, resize
   * handle, and content, all of it. UI-4f-1 kept every leaf's rendering
   * exactly as it was before this component existed; UI-4f-2 makes actual
   * pane sizing tree-driven (a split's own `sizes` field, via
   * react-resizable-panels) instead of separate pixel state, but leaf
   * content itself is still unchanged — only the resize MECHANISM moved.
   */
  renderLeaf: (node: TabsNode) => ReactNode;
  /**
   * Split node ids that should render as a plain (non-resizable) flex
   * container instead of a react-resizable-panels Group/Panel/Separator.
   * Used for collapsed/maximized region states, where a leaf's own CSS
   * (e.g. `flex-1`/`basis-14` when the dock is maximized, or the sidebar's
   * icon-rail collapse) must be free to size itself unconstrained by a
   * Panel's percentage-based layout — trying to reconcile both at once is
   * exactly the kind of conflict that risks a real visual regression, so
   * the caller (studio.tsx) opts specific splits out of resizing for
   * whichever render pass isn't in the plain "normal"/"expanded" state,
   * instead of LayoutTree guessing at region semantics itself.
   */
  nonResizableSplitIds?: ReadonlySet<string>;
  /**
   * Fires once after a user-driven drag finishes — never for programmatic
   * layout changes (mount, a preset switch setting `sizes` directly,
   * imperative resize) — with the split's new `sizes`, same order as its
   * `children`. The caller commits this into the persisted WorkspaceLayout;
   * the existing UI-4d autosave effect then picks it up like any other
   * layout change. Deliberately NOT called on every intermediate drag frame
   * (react-resizable-panels' `onLayoutChange`, without the "d") — only
   * `onLayoutChanged`, gated on `meta.isUserInteraction` — so a drag stays
   * smooth without spamming local/cloud persistence writes mid-gesture.
   */
  onResizeCommit?: (splitNodeId: string, sizes: number[]) => void;
  /** Per-child minimum pane size, e.g. `"180px"` — passed straight through
   * to Panel's own `minSize` prop (which understands px/%/em/rem/vh/vw
   * units natively), so a pane can't be dragged down to unusable. */
  minSizeForChild?: (childId: string) => string | number | undefined;
  /** Per-child maximum pane size, same units as `minSizeForChild` — e.g.
   * reproduces the sidebar's pre-UI-4f-2 420px upper clamp. */
  maxSizeForChild?: (childId: string) => string | number | undefined;
  /**
   * UI-4f-5: for a non-resizable ("plain") split that sits on the ancestor
   * path to a maximized/collapsed leaf, which of ITS children is the one
   * still on that path — the other child(ren) get visually suppressed
   * (`hidden`) instead of sharing space, the same "the other one shrinks to
   * nothing, this one gets everything" intent chart-area/bottom-dock's own
   * CSS already expresses for the two originally-anticipated regions, now
   * generalized so it still holds when edge-drop has inserted a new plain
   * split between a well-known leaf and its ancestor. A plain split NOT on
   * any active maximize/collapse path (this map has no entry for its id)
   * renders every child normally, unchanged from UI-4f-1/4f-2 behavior.
   */
  emphasizedChildOf?: ReadonlyMap<string, string>;
  /**
   * UI-4f-5: child ids that must never get the `emphasizedChildOf` hidden
   * treatment even when they're the non-emphasized sibling in a plain split
   * — chart-area is the one well-known leaf this can legitimately happen to
   * (it sits beside whatever's on the dock's maximize path), and it already
   * has its own deliberate, correct "shrink to a basis-14 sliver but stay
   * visible" CSS, driven by its own render function — this opt-out keeps
   * that intact instead of the new generic suppression silently overriding
   * it. Caller-supplied (studio.tsx knows well-known ids; LayoutTree stays
   * generic and doesn't hardcode any itself, per its own design principle).
   */
  neverSuppressChildIds?: ReadonlySet<string>;
};

function PlainSplit({
  node,
  renderLeaf,
  nonResizableSplitIds,
  onResizeCommit,
  minSizeForChild,
  maxSizeForChild,
  emphasizedChildOf,
  neverSuppressChildIds,
}: LayoutTreeProps & { node: SplitNode }) {
  const emphasized = emphasizedChildOf?.get(node.id);
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 ${
        node.direction === "row" ? "flex-row" : "flex-col"
      }`}
    >
      {node.children.map((child) => (
        <div
          key={child.id}
          className={
            emphasized && child.id !== emphasized && !neverSuppressChildIds?.has(child.id)
              ? "hidden"
              : "flex min-h-0 min-w-0 flex-1 flex-col"
          }
        >
          <LayoutTree
            node={child}
            renderLeaf={renderLeaf}
            nonResizableSplitIds={nonResizableSplitIds}
            onResizeCommit={onResizeCommit}
            minSizeForChild={minSizeForChild}
            maxSizeForChild={maxSizeForChild}
            emphasizedChildOf={emphasizedChildOf}
            neverSuppressChildIds={neverSuppressChildIds}
          />
        </div>
      ))}
    </div>
  );
}

function ResizableSplit({
  node,
  renderLeaf,
  nonResizableSplitIds,
  onResizeCommit,
  minSizeForChild,
  maxSizeForChild,
  emphasizedChildOf,
  neverSuppressChildIds,
}: LayoutTreeProps & { node: SplitNode }) {
  const isRow = node.direction === "row";
  const equalShare = 100 / node.children.length;
  return (
    <Group
      orientation={isRow ? "horizontal" : "vertical"}
      className="flex min-h-0 min-w-0 flex-1"
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction || !onResizeCommit) return;
        const sizes = node.children.map((c) => (layout[c.id] ?? equalShare) / 100);
        onResizeCommit(node.id, sizes);
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 &&
            (isRow ? (
              <Separator className="hidden w-1.5 shrink-0 cursor-col-resize hover:bg-brand/10 lg:block" />
            ) : (
              <Separator className="group/resize flex h-2.5 w-full shrink-0 cursor-row-resize items-center justify-center hover:bg-brand/10">
                <div className="h-1 w-10 rounded-full bg-border transition-colors group-hover/resize:bg-brand/70" />
              </Separator>
            ))}
          <Panel
            id={child.id}
            defaultSize={`${(node.sizes[i] ?? equalShare / 100) * 100}%`}
            minSize={minSizeForChild?.(child.id)}
            maxSize={maxSizeForChild?.(child.id)}
            className="flex min-h-0 min-w-0 flex-col"
          >
            <LayoutTree
              node={child}
              renderLeaf={renderLeaf}
              nonResizableSplitIds={nonResizableSplitIds}
              onResizeCommit={onResizeCommit}
              minSizeForChild={minSizeForChild}
              maxSizeForChild={maxSizeForChild}
              emphasizedChildOf={emphasizedChildOf}
              neverSuppressChildIds={neverSuppressChildIds}
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

/**
 * Generic recursive renderer for a WorkspaceLayout's LayoutNode tree.
 * Proven generic by construction: a "split" node becomes either a
 * react-resizable-panels Group (drag-resizable, UI-4f-2) or a plain flex
 * container (when its id is in `nonResizableSplitIds`), recursing into its
 * children in order either way; a "tabs" leaf is handed to `renderLeaf`.
 * Nothing here is keyed to a specific node id — `nonResizableSplitIds`,
 * `minSizeForChild`, and `renderLeaf` are all caller-supplied, so if the
 * tree had a different shape (more nesting, a third region, reordered
 * children) this component would reproduce it without changes.
 */
export function LayoutTree(props: LayoutTreeProps): ReactNode {
  const { node } = props;
  if (node.kind === "tabs") return props.renderLeaf(node);
  if (props.nonResizableSplitIds?.has(node.id)) {
    return <PlainSplit {...props} node={node} />;
  }
  return <ResizableSplit {...props} node={node} />;
}
