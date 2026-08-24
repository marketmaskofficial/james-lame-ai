import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, Lock, Plus, Trash2, Unlock, X } from "lucide-react";
import type { Drawing, DrawStyle } from "./StudioChart";
import { DEFAULT_FIB_LEVELS, addFibLevel, removeFibLevel, type FibLevel } from "@/lib/drawing/calc";

const HAS_LINE_STYLE = new Set<Drawing["tool"]>([
  "trend", "ray", "hray", "channel", "hline", "vline", "rect", "circle", "triangle", "fib", "measure", "price-range", "date-range", "arrow", "vwap",
]);
const HAS_FILL = new Set<Drawing["tool"]>(["rect", "circle", "triangle", "channel"]);
const HAS_TEXT = new Set<Drawing["tool"]>(["text", "marker"]);

/**
 * One reusable settings popover for the currently-selected drawing — NOT
 * `IndicatorSettingsPopout` reused directly (that edits an indicator's
 * script-defined `InputSpec[]`, a completely different state shape/concept
 * from a drawing's color/width/style/fill/settings bag), but built with the
 * same floating-panel visual language (rounded-[8px] popover, header +
 * click-away + Escape, footer action row) so the two don't look like two
 * different products bolted together.
 */
export function DrawingSettingsPopover({
  drawing,
  label,
  anchor,
  onChange,
  onDuplicate,
  onRemove,
  onClose,
}: {
  drawing: Drawing;
  label: string;
  anchor: { x: number; y: number };
  onChange: (next: Drawing) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [customLevel, setCustomLevel] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<Drawing>) => onChange({ ...drawing, ...patch, updatedAt: Date.now() });
  const setSetting = (key: string, value: unknown) =>
    onChange({ ...drawing, settings: { ...drawing.settings, [key]: value }, updatedAt: Date.now() });

  const fibLevels = (drawing.settings?.fibLevels as FibLevel[] | undefined) ?? DEFAULT_FIB_LEVELS;

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`${label} settings`}
        onClick={(e) => e.stopPropagation()}
        className="absolute z-50 w-64 overflow-hidden rounded-[8px] border border-border bg-popover shadow-2xl"
        style={{ left: Math.max(4, anchor.x - 220), top: anchor.y }}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: drawing.color ?? "#e6b800", opacity: drawing.opacity ?? 1 }}
          />
          <span className="flex-1 truncate text-[12px] font-medium">{label}</span>
          <button onClick={onClose} title="Close" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-80 overflow-auto p-2.5 text-[11px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground">Visibility</span>
            <button
              onClick={() => set({ hidden: !drawing.hidden })}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
            >
              {drawing.hidden ? (<><EyeOff className="h-3 w-3" /> Hidden</>) : (<><Eye className="h-3 w-3" /> Visible</>)}
            </button>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground">Lock</span>
            <button
              onClick={() => set({ locked: !drawing.locked })}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
            >
              {drawing.locked ? (<><Lock className="h-3 w-3" /> Locked</>) : (<><Unlock className="h-3 w-3" /> Unlocked</>)}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Style</p>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Line color</span>
              <input
                type="color"
                value={drawing.color ?? "#e6b800"}
                onChange={(e) => set({ color: e.target.value })}
                className="h-6 w-10 rounded border border-border bg-card p-0"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Line width</span>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={drawing.width ?? 1.5}
                onChange={(e) => set({ width: Number(e.target.value) })}
                className="w-16 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Opacity</span>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round((drawing.opacity ?? 1) * 100)}
                onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                className="w-24 accent-[var(--brand,#e6b800)]"
              />
            </label>
            {HAS_LINE_STYLE.has(drawing.tool) && (
              <div className="flex items-center gap-1">
                {(["solid", "dashed", "dotted"] as DrawStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => set({ style: s })}
                    className={`flex-1 rounded border px-1 py-0.5 capitalize ${
                      (drawing.style ?? "solid") === s ? "border-brand text-brand" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {HAS_FILL.has(drawing.tool) && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Fill</p>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Fill opacity</span>
                <input
                  type="range"
                  min={0}
                  max={60}
                  value={Math.round(((drawing.settings?.fillOpacity as number | undefined) ?? 0.14) * 100)}
                  onChange={(e) => setSetting("fillOpacity", Number(e.target.value) / 100)}
                  className="w-24 accent-[var(--brand,#e6b800)]"
                />
              </label>
            </div>
          )}

          {HAS_TEXT.has(drawing.tool) && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Text</p>
              <input
                value={drawing.text ?? ""}
                placeholder="Label"
                onChange={(e) => set({ text: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
              />
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Font size</span>
                <select
                  value={(drawing.settings?.fontSize as string | undefined) ?? "normal"}
                  onChange={(e) => setSetting("fontSize", e.target.value)}
                  className="rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                >
                  {["tiny", "small", "normal", "large"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {drawing.tool === "fib" && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Levels</p>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(drawing.settings?.extendRight)}
                    onChange={(e) => setSetting("extendRight", e.target.checked)}
                  />
                  Extend right
                </label>
              </div>
              <ul className="max-h-28 space-y-0.5 overflow-auto">
                {fibLevels.map((lvl) => (
                  <li key={lvl.value} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={lvl.enabled !== false}
                      onChange={() =>
                        setSetting(
                          "fibLevels",
                          fibLevels.map((l) => (l.value === lvl.value ? { ...l, enabled: l.enabled === false } : l)),
                        )
                      }
                    />
                    <span className="flex-1 font-mono">{(lvl.value * 100).toFixed(1)}%</span>
                    <button
                      title="Remove level"
                      onClick={() => setSetting("fibLevels", removeFibLevel(fibLevels, lvl.value))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-1">
                <input
                  value={customLevel}
                  onChange={(e) => setCustomLevel(e.target.value)}
                  placeholder="e.g. 1.272"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
                />
                <button
                  title="Add level"
                  onClick={() => {
                    const v = Number(customLevel);
                    if (!Number.isFinite(v)) return;
                    setSetting("fibLevels", addFibLevel(fibLevels, v));
                    setCustomLevel("");
                  }}
                  className="shrink-0 rounded border border-border p-1 text-muted-foreground hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <button
                onClick={() => set({ p1: drawing.p2, p2: drawing.p1 })}
                className="w-full rounded border border-border py-1 text-[10.5px] hover:bg-accent"
              >
                Reverse anchors
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-t border-border p-2">
          <button
            onClick={onDuplicate}
            title="Duplicate"
            className="flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-border py-1 text-[10.5px] hover:bg-accent"
          >
            <Copy className="h-3 w-3" /> Duplicate
          </button>
          <button
            onClick={onRemove}
            title="Delete drawing"
            className="flex items-center justify-center gap-1 rounded-[6px] border border-border px-2 py-1 text-[10.5px] text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      </div>
    </>
  );
}
