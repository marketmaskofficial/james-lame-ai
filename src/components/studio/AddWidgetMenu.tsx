import { useState } from "react";
import { Plus } from "lucide-react";
import { listWidgetDefs } from "@/lib/workspace/widgetRegistry";
import type { WidgetTypeId } from "@/lib/workspace/types";

type Props = {
  /** Which region this menu is adding into — filters to widgets that can actually render there. */
  region: "sidebar" | "dock";
  /** Widget types already open in the target region — excluded from the addable list. */
  openWidgetTypeIds: WidgetTypeId[];
  onAdd: (widgetTypeId: WidgetTypeId) => void;
};

/**
 * "+" trigger + popover listing widget types available for one region.
 * Same lightweight-dropdown idiom as ChartLegendStrip's "+ New indicator"
 * menu — a scoped popover, not a modal. Coming-soon widgets are shown
 * disabled with their reason as a tooltip so the roadmap stays honest and
 * discoverable, but they're inert: no click handler at all, not a handler
 * that silently does nothing. A widget whose `renderableRegions` doesn't
 * include this menu's `region` is excluded entirely — never shown, not
 * shown-and-disabled — since it isn't a "not built yet" roadmap item the
 * way coming-soon widgets are, it's simply not a valid destination.
 */
export function AddWidgetMenu({ region, openWidgetTypeIds, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const defs = listWidgetDefs().filter(
    (d) => d.id !== "chart" && !openWidgetTypeIds.includes(d.id) && d.renderableRegions.includes(region),
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Add widget"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-52 rounded-[8px] border border-border bg-popover p-1 shadow-xl">
            {defs.length === 0 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                Everything available is already open here.
              </p>
            )}
            {defs.map((d) =>
              d.availability === "available" ? (
                <button
                  key={d.id}
                  onClick={() => {
                    onAdd(d.id);
                    setOpen(false);
                  }}
                  className="block w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
                >
                  {d.label}
                </button>
              ) : (
                <div
                  key={d.id}
                  title={d.comingSoonReason}
                  className="block w-full cursor-not-allowed truncate rounded px-2 py-1 text-left text-[11px] text-muted-foreground/50"
                >
                  {d.label} <span className="italic">(coming soon)</span>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
