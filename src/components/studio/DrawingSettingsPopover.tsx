import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
  X,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import type { Drawing, DrawStyle } from "./StudioChart";
import { DEFAULT_FIB_LEVELS, addFibLevel, removeFibLevel, type FibLevel } from "@/lib/drawing/calc";
import { TOOL_BY_ID } from "@/lib/drawing/registry";
import { setToolStyleDefaults } from "@/lib/drawing/styleDefaults";

/**
 * One reusable, CAPABILITY-DRIVEN settings popover for the currently-
 * selected drawing — every section below (Style/Fill/Text/Fib levels/
 * Position metrics/Anchor label) is gated on `TOOL_BY_ID[drawing.tool]
 * .capabilities`, read from the same registry the toolbar renders from, not
 * a second hardcoded per-tool list living in this file. Adding a capability
 * to a NEW tool in registry.ts is what turns its matching section on here —
 * no per-tool settings component to write.
 *
 * NOT `IndicatorSettingsPopout` reused directly (that edits an indicator's
 * script-defined `InputSpec[]`, a completely different state shape/concept
 * from a drawing's color/width/style/fill/settings bag), but built with the
 * same floating-panel visual language (rounded-[8px] popover, header +
 * click-away + Escape, footer action row) so the two don't look like two
 * different products bolted together.
 *
 * Positioned `fixed` to the VIEWPORT (not `absolute` inside the chart pane)
 * so it can never be clipped by a pane's `overflow-hidden` in a 2/4-up grid,
 * never resizes the chart (fixed elements are out of layout flow entirely),
 * and its click-away backdrop covers the whole screen — not just the active
 * chart pane — so clicking the toolbar/sidebar/another pane closes it too.
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
  /** VIEWPORT coordinates (clientX/clientY) of the double-click / open
   * action — clamped below so the popover always stays fully on-screen. */
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

  const caps = TOOL_BY_ID[drawing.tool]?.capabilities ?? {};

  const set = (patch: Partial<Drawing>) => {
    onChange({ ...drawing, ...patch, updatedAt: Date.now() });
    // Per-tool "last used style" memory — only for genuinely stylistic
    // fields, never for geometry (p1/p2/stop) or identity (locked/hidden/
    // text content), so restyling one Trend Line doesn't quietly change
    // where the NEXT one gets drawn.
    if ("color" in patch || "width" in patch || "style" in patch) {
      setToolStyleDefaults(drawing.tool, { color: patch.color ?? drawing.color, width: patch.width ?? drawing.width, style: patch.style ?? drawing.style });
    }
  };
  const setSetting = (key: string, value: unknown) => {
    onChange({ ...drawing, settings: { ...drawing.settings, [key]: value }, updatedAt: Date.now() });
    setToolStyleDefaults(drawing.tool, { settings: { [key]: value } });
  };

  const fibLevels = (drawing.settings?.fibLevels as FibLevel[] | undefined) ?? DEFAULT_FIB_LEVELS;

  // Clamp so the popover (fixed width, roughly-bounded height) never renders
  // partly off-screen — "must stay inside viewport" per the phase brief.
  const POPOVER_W = 264;
  const EST_H = 460;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(8, anchor.x - 220), Math.max(8, vw - POPOVER_W - 8));
  const top = Math.min(Math.max(8, anchor.y), Math.max(8, vh - EST_H - 8));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`${label} settings`}
        onClick={(e) => e.stopPropagation()}
        className="fixed z-50 w-64 overflow-hidden rounded-[8px] border border-border bg-popover shadow-2xl"
        style={{ left, top }}
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

          {caps.stroke && (
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
              {caps.extendRight && (
                <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(drawing.settings?.extendRight)}
                    onChange={(e) => setSetting("extendRight", e.target.checked)}
                  />
                  Extend right
                </label>
              )}
            </div>
          )}

          {caps.fill && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Fill</p>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{caps.volumeProfile ? "Histogram opacity" : "Fill opacity"}</span>
                <input
                  type="range"
                  min={0}
                  max={caps.volumeProfile ? 100 : 60}
                  // Volume Profile's histogram bars ARE the content of the
                  // drawing (unlike a background fill behind a shape's own
                  // stroked outline) — the shared 0.14 default every other
                  // fill-capable tool uses would render them almost
                  // invisible, so this seeds a much more visible 50% default
                  // for exactly this capability, matching the same fallback
                  // StudioChart's own renderer uses when no setting exists
                  // yet (see StudioChart.tsx's `fillOpacityVp`).
                  value={Math.round(((drawing.settings?.fillOpacity as number | undefined) ?? (caps.volumeProfile ? 0.5 : 0.14)) * 100)}
                  onChange={(e) => setSetting("fillOpacity", Number(e.target.value) / 100)}
                  className="w-24 accent-[var(--brand,#e6b800)]"
                />
              </label>
            </div>
          )}

          {caps.volumeProfile && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Volume Profile</p>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Rows</span>
                <select
                  value={(drawing.settings?.vpRows as number | undefined) ?? 24}
                  onChange={(e) => setSetting("vpRows", Number(e.target.value))}
                  className="rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                >
                  {[10, 16, 24, 32, 48, 64, 100].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Value area</span>
                <select
                  value={(drawing.settings?.vpValueAreaPct as number | undefined) ?? 0.7}
                  onChange={(e) => setSetting("vpValueAreaPct", Number(e.target.value))}
                  className="rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                >
                  {[0.6, 0.68, 0.7, 0.8, 0.9].map((p) => (
                    <option key={p} value={p}>{Math.round(p * 100)}%</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Width</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={(drawing.settings?.vpWidthPct as number | undefined) ?? 60}
                  onChange={(e) => setSetting("vpWidthPct", Number(e.target.value))}
                  className="w-24 accent-[var(--brand,#e6b800)]"
                />
              </label>
              <div className="flex items-center gap-1">
                {(["left", "right"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setSetting("vpPlacement", p)}
                    className={`flex-1 rounded border px-1 py-0.5 capitalize ${
                      ((drawing.settings?.vpPlacement as string | undefined) ?? "right") === p
                        ? "border-brand text-brand"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Histogram color</span>
                <input
                  type="color"
                  value={drawing.color ?? "#4da3ff"}
                  onChange={(e) => set({ color: e.target.value })}
                  className="h-6 w-10 rounded border border-border bg-card p-0"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={drawing.settings?.vpShowHistogram !== false}
                  onChange={(e) => setSetting("vpShowHistogram", e.target.checked)}
                />
                Show histogram
              </label>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={drawing.settings?.vpShowLabels !== false}
                  onChange={(e) => setSetting("vpShowLabels", e.target.checked)}
                />
                Show price labels
              </label>
              <div className="flex items-center gap-1">
                {(["dashed", "solid"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSetting("vpLevelLineStyle", s)}
                    className={`flex-1 rounded border px-1 py-0.5 capitalize ${
                      ((drawing.settings?.vpLevelLineStyle as string | undefined) ?? "dashed") === s
                        ? "border-brand text-brand"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s} lines
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <input type="checkbox" checked={drawing.settings?.vpShowPoc !== false} onChange={(e) => setSetting("vpShowPoc", e.target.checked)} />
                    POC
                  </span>
                  <input
                    type="color"
                    value={(drawing.settings?.vpPocColor as string | undefined) ?? "#e6b800"}
                    onChange={(e) => setSetting("vpPocColor", e.target.value)}
                    className="h-6 w-10 rounded border border-border bg-card p-0"
                  />
                </label>
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <input type="checkbox" checked={drawing.settings?.vpShowVah !== false} onChange={(e) => setSetting("vpShowVah", e.target.checked)} />
                    VAH
                  </span>
                  <input
                    type="color"
                    value={(drawing.settings?.vpVahColor as string | undefined) ?? "#22c55e"}
                    onChange={(e) => setSetting("vpVahColor", e.target.value)}
                    className="h-6 w-10 rounded border border-border bg-card p-0"
                  />
                </label>
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <input type="checkbox" checked={drawing.settings?.vpShowVal !== false} onChange={(e) => setSetting("vpShowVal", e.target.checked)} />
                    VAL
                  </span>
                  <input
                    type="color"
                    value={(drawing.settings?.vpValColor as string | undefined) ?? "#ef4444"}
                    onChange={(e) => setSetting("vpValColor", e.target.value)}
                    className="h-6 w-10 rounded border border-border bg-card p-0"
                  />
                </label>
              </div>
            </div>
          )}

          {caps.text && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Text</p>
              <input
                value={drawing.text ?? ""}
                placeholder="Label"
                onChange={(e) => set({ text: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
              />
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-muted-foreground">Size</span>
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
                <button
                  title="Bold"
                  onClick={() => setSetting("bold", !drawing.settings?.bold)}
                  className={`flex h-6 w-6 items-center justify-center rounded border ${drawing.settings?.bold ? "border-brand text-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <Bold className="h-3 w-3" />
                </button>
                <button
                  title="Italic"
                  onClick={() => setSetting("italic", !drawing.settings?.italic)}
                  className={`flex h-6 w-6 items-center justify-center rounded border ${drawing.settings?.italic ? "border-brand text-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <Italic className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
                  <button
                    key={a}
                    title={`Align ${a}`}
                    onClick={() => setSetting("align", a)}
                    className={`flex flex-1 items-center justify-center rounded border py-1 ${
                      ((drawing.settings?.align as string | undefined) ?? "left") === a ? "border-brand text-brand" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input type="checkbox" checked={Boolean(drawing.settings?.background)} onChange={(e) => setSetting("background", e.target.checked)} />
                Background fill
              </label>
              {Boolean(drawing.settings?.background) && (
                <input
                  type="color"
                  value={(drawing.settings?.backgroundColor as string | undefined) ?? "#0b0d12"}
                  onChange={(e) => setSetting("backgroundColor", e.target.value)}
                  className="h-6 w-10 rounded border border-border bg-card p-0"
                />
              )}
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input type="checkbox" checked={Boolean(drawing.settings?.border)} onChange={(e) => setSetting("border", e.target.checked)} />
                Border
              </label>
              {Boolean(drawing.settings?.border) && (
                <input
                  type="color"
                  value={(drawing.settings?.borderColor as string | undefined) ?? drawing.color ?? "#e6b800"}
                  onChange={(e) => setSetting("borderColor", e.target.value)}
                  className="h-6 w-10 rounded border border-border bg-card p-0"
                />
              )}
            </div>
          )}

          {caps.anchorLabel && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Anchor</p>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={drawing.settings?.showAnchorLabel !== false}
                  onChange={(e) => setSetting("showAnchorLabel", e.target.checked)}
                />
                Show anchor marker + label
              </label>
            </div>
          )}

          {caps.levels && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Levels</p>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={drawing.settings?.fibShowLabel !== false} onChange={(e) => setSetting("fibShowLabel", e.target.checked)} />
                  % label
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={drawing.settings?.fibShowPrice !== false} onChange={(e) => setSetting("fibShowPrice", e.target.checked)} />
                  Price
                </label>
              </div>
              <ul className="max-h-32 space-y-0.5 overflow-auto">
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
                    <input
                      type="color"
                      value={lvl.color ?? drawing.color ?? "#e6b800"}
                      onChange={(e) =>
                        setSetting(
                          "fibLevels",
                          fibLevels.map((l) => (l.value === lvl.value ? { ...l, color: e.target.value } : l)),
                        )
                      }
                      className="h-4 w-6 shrink-0 rounded border border-border bg-card p-0"
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

          {caps.positionMetrics && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Position</p>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Entry</span>
                <input
                  type="number"
                  value={drawing.p1.price}
                  onChange={(e) => set({ p1: { ...drawing.p1, price: Number(e.target.value) } })}
                  className="w-24 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Target</span>
                <input
                  type="number"
                  value={drawing.p2.price}
                  onChange={(e) => set({ p2: { ...drawing.p2, price: Number(e.target.value) } })}
                  className="w-24 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Stop</span>
                <input
                  type="number"
                  value={drawing.stop ?? drawing.p1.price}
                  onChange={(e) => set({ stop: Number(e.target.value) })}
                  className="w-24 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
                />
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  Target
                  <input type="color" value={(drawing.settings?.targetColor as string | undefined) ?? "#22c55e"} onChange={(e) => setSetting("targetColor", e.target.value)} className="h-6 w-10 rounded border border-border bg-card p-0" />
                </label>
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  Entry
                  <input type="color" value={(drawing.settings?.entryColor as string | undefined) ?? "#e6b800"} onChange={(e) => setSetting("entryColor", e.target.value)} className="h-6 w-10 rounded border border-border bg-card p-0" />
                </label>
                <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  Stop
                  <input type="color" value={(drawing.settings?.stopColor as string | undefined) ?? "#ef4444"} onChange={(e) => setSetting("stopColor", e.target.value)} className="h-6 w-10 rounded border border-border bg-card p-0" />
                </label>
              </div>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input type="checkbox" checked={drawing.settings?.showLabels !== false} onChange={(e) => setSetting("showLabels", e.target.checked)} />
                Show row labels
              </label>
              <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <input type="checkbox" checked={drawing.settings?.showRR !== false} onChange={(e) => setSetting("showRR", e.target.checked)} />
                Show R:R
              </label>
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
