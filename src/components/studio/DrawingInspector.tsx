import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  Settings2,
  Trash2,
  Unlock,
} from "lucide-react";
import type { Drawing } from "./StudioChart";

const TOOL_LABEL: Record<string, string> = {
  trend: "Trend line",
  ray: "Ray",
  hray: "Horizontal ray",
  channel: "Parallel channel",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  circle: "Circle",
  triangle: "Triangle",
  fib: "Fib retracement",
  text: "Text",
  arrow: "Arrow",
  marker: "Note",
  brush: "Brush",
  highlighter: "Highlighter",
  measure: "Date + price range",
  "price-range": "Price range",
  "date-range": "Date range",
  vwap: "Anchored VWAP",
  long: "Long position",
  short: "Short position",
};

/**
 * Object tree + style controls for chart drawings. Everything edits the same
 * drawing objects the chart renders, so changes are instantly visible.
 */
export function DrawingInspector({
  drawings,
  selectedId,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  onOpenSettings,
  onClose,
}: {
  drawings: Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (d: Drawing) => void;
  onRemove: (id: string) => void;
  onDuplicate: (d: Drawing) => void;
  /** Opens the full DrawingSettingsPopover for this drawing — the actual
   * settings surface; this panel stays a lightweight object list + quick
   * visibility/lock/duplicate/delete actions. */
  onOpenSettings: (d: Drawing) => void;
  onClose: () => void;
}) {
  const selected = drawings.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="absolute left-2 top-2 z-30 w-60 rounded-md border border-border bg-popover/95 p-2 text-[11px] shadow-xl backdrop-blur">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Objects ({drawings.length})
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <ul className="max-h-40 space-y-0.5 overflow-auto">
        {drawings.length === 0 && (
          <li className="px-1 py-1 text-muted-foreground">
            Draw something to see it here.
          </li>
        )}
        {drawings.map((d) => (
          <li
            key={d.id}
            className={`flex items-center gap-1 rounded px-1 py-0.5 ${
              d.id === selectedId ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: d.color ?? "#e6b800", opacity: d.opacity ?? 1 }}
            />
            <button
              onClick={() => onSelect(d.id)}
              className="flex-1 truncate text-left"
            >
              {d.text ? d.text : (TOOL_LABEL[d.tool] ?? d.tool)}
            </button>
            <button
              title={d.hidden ? "Show" : "Hide"}
              onClick={() => onUpdate({ ...d, hidden: !d.hidden })}
              className="text-muted-foreground hover:text-foreground"
            >
              {d.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
            <button
              title={d.locked ? "Unlock" : "Lock"}
              onClick={() => onUpdate({ ...d, locked: !d.locked })}
              className="text-muted-foreground hover:text-foreground"
            >
              {d.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            </button>
            <button
              title="Settings"
              onClick={() => {
                onSelect(d.id);
                onOpenSettings(d);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            <button
              title="Duplicate"
              onClick={() => onDuplicate(d)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              title="Delete"
              onClick={() => onRemove(d.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <button
          onClick={() => onOpenSettings(selected)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-border py-1 text-[10.5px] hover:bg-accent"
        >
          <Settings2 className="h-3 w-3" /> Open settings
        </button>
      )}
    </div>
  );
}
