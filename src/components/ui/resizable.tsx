import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

// `data-[panel-group-direction=vertical]:flex-col` was removed here (Phase
// 5A-4a) — the installed `react-resizable-panels` never sets that
// data-attribute; `Group` already applies `flexDirection` via its own
// inline style keyed off the `orientation` prop, so the selector never did
// anything. See `ResizableHandle` below for the real, working equivalent.
const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof Group>) => (
  <Group className={cn("flex h-full w-full", className)} {...props} />
);

const ResizablePanel = Panel;

/**
 * Phase 5A-4a fix: the installed `react-resizable-panels` (v4) never sets a
 * `data-panel-group-direction` attribute on anything — that selector was
 * dead CSS inherited from a template written against a different API
 * (verified directly against `node_modules/react-resizable-panels/dist/
 * react-resizable-panels.js`, which sets `flexDirection` via an inline
 * style on the Group, not a data-attribute). It never mattered because no
 * vertical `ResizablePanelGroup` existed anywhere in this app until now.
 *
 * The library DOES render a real, usable attribute on the separator itself:
 * `aria-orientation`, which is the OPPOSITE of the group's own orientation
 * (a separator inside a horizontal-flowing group is itself a vertical
 * dividing line, and vice versa). So a vertical group's separator carries
 * `aria-orientation="horizontal"` — that's the correct selector for "this
 * separator should render as a horizontal resize handle."
 */
const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) => (
  <Separator
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0 [&[aria-orientation=horizontal]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
