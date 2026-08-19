export type DropZone = "center" | "top" | "bottom" | "left" | "right";

/**
 * Pure geometry: given a drop target's rect and the pointer's client
 * coordinates, picks one of 5 zones — a ~56% center band, four ~22% edge
 * bands around it. Cheap arithmetic only, safe to call on every dragover
 * frame (no state, no allocation beyond the return value).
 */
export function pickDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const edge = 0.22;
  if (x < edge) return "left";
  if (x > 1 - edge) return "right";
  if (y < edge) return "top";
  if (y > 1 - edge) return "bottom";
  return "center";
}

const ZONE_STYLE: Record<DropZone, string> = {
  center: "inset-[18%]",
  top: "inset-x-0 top-0 h-[28%]",
  bottom: "inset-x-0 bottom-0 h-[28%]",
  left: "inset-y-0 left-0 w-[28%]",
  right: "inset-y-0 right-0 w-[28%]",
};

/**
 * Lightweight highlight for whichever of the 5 zones a cross-leaf drag is
 * currently hovering — the dragged widget's destination if dropped now.
 * Purely presentational; the caller owns computing `zone` (via
 * `pickDropZone`) and deciding what a drop in it means.
 */
export function DockZone({ zone }: { zone: DropZone | null }) {
  if (!zone) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className={`absolute rounded-[6px] border-2 border-brand bg-brand/20 transition-none ${ZONE_STYLE[zone]}`} />
    </div>
  );
}
