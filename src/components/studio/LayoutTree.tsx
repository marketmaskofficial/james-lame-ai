import type { ReactNode } from "react";
import type { LayoutNode } from "@/lib/workspace/types";

type TabsNode = Extract<LayoutNode, { kind: "tabs" }>;

type LayoutTreeProps = {
  node: LayoutNode;
  /**
   * Renders one "tabs" leaf's entire region — chrome, tab strip, resize
   * handle, and content, all of it. UI-4f-1 keeps every leaf's rendering
   * exactly as it was before this component existed (same DOM, same
   * classNames, same handlers) — only the STRUCTURE connecting leaves
   * (which split contains which children, in which direction) is actually
   * tree-driven now. Later UI-4f sub-phases generalize leaf rendering
   * itself (resize via `sizes`, drag-to-dock, drag-to-split); this
   * component's recursive shape doesn't need to change for that.
   */
  renderLeaf: (node: TabsNode) => ReactNode;
};

/**
 * Generic recursive renderer for a WorkspaceLayout's LayoutNode tree.
 * Proven generic by construction: a "split" node becomes a transparent flex
 * container (row/column per `direction`) recursing into its children in
 * order; a "tabs" leaf is handed to `renderLeaf`. Nothing here is keyed to
 * a specific node id — if the tree had a different shape (more nesting, a
 * third region, reordered children), this component would reproduce it
 * without changes; only `renderLeaf`'s caller decides what a *specific*
 * well-known leaf id actually renders.
 */
export function LayoutTree({ node, renderLeaf }: LayoutTreeProps): ReactNode {
  if (node.kind === "tabs") return renderLeaf(node);
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 ${
        node.direction === "row" ? "flex-row" : "flex-col"
      }`}
    >
      {node.children.map((child) => (
        <LayoutTree key={child.id} node={child} renderLeaf={renderLeaf} />
      ))}
    </div>
  );
}
