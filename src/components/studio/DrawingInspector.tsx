import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";
import type { Drawing, DrawStyle } from "./StudioChart";

const TOOL_LABEL: Record<string, string> = {
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fib retracement",
  text: "Text",
  arrow: "Arrow",
  marker: "Marker",
  measure: "Measure",
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
  onClose,
}: {
  drawings: Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (d: Drawing) => void;
  onRemove: (id: string) => void;
  onDuplicate: (d: Drawing) => void;
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
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Color</span>
            <input
              type="color"
              value={selected.color ?? "#e6b800"}
              onChange={(e) => onUpdate({ ...selected, color: e.target.value })}
              className="h-5 w-8 rounded border border-border bg-transparent"
            />
            <span className="ml-auto text-muted-foreground">Width</span>
            <input
              type="number"
              min={1}
              max={8}
              step={0.5}
              value={selected.width ?? 1.5}
              onChange={(e) =>
                onUpdate({ ...selected, width: Number(e.target.value) })
              }
              className="w-12 rounded border border-border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round((selected.opacity ?? 1) * 100)}
              onChange={(e) =>
                onUpdate({ ...selected, opacity: Number(e.target.value) / 100 })
              }
              className="flex-1 accent-[var(--brand,#e6b800)]"
            />
          </div>
          <div className="flex items-center gap-1">
            {(["solid", "dashed", "dotted"] as DrawStyle[]).map((s) => (
              <button
                key={s}
                onClick={() => onUpdate({ ...selected, style: s })}
                className={`flex-1 rounded border px-1 py-0.5 capitalize ${
                  (selected.style ?? "solid") === s
                    ? "border-brand text-brand"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {(selected.tool === "text" || selected.tool === "marker") && (
            <input
              value={selected.text ?? ""}
              placeholder="Label"
              onChange={(e) => onUpdate({ ...selected, text: e.target.value })}
              className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
            />
          )}
        </div>
      )}
    </div>
  );
}
