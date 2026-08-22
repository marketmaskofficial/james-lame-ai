import { useEffect, useRef } from "react";
import { Eye, EyeOff, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import type { InputSpec } from "@/lib/sgscript/types";

type SettingValue = number | boolean | string;

type Props = {
  name: string;
  visible: boolean;
  inputs: InputSpec[];
  settings: Record<string, SettingValue>;
  /** Which chart this instance lives on — shown read-only so it's always
   * clear which chart a change targets, without inventing a second
   * per-instance settings store: the popout edits the exact same
   * `settings`/`activeInputs` state the bottom Code panel used to. */
  chartLabel: string | null;
  /** Screen position (relative to the chart leaf) of the gear button that
   * opened this popout, so it floats right beside it. */
  anchor: { x: number; y: number };
  onChangeSetting: (name: string, value: SettingValue) => void;
  onToggleVisible: () => void;
  onReset: () => void;
  onRemove: () => void;
  onClose: () => void;
};

/**
 * UI-5d: the floating settings panel that replaces the old always-on
 * "Settings" block inside the bottom Code panel. Opening it no longer
 * touches the bottom dock at all — it's a chart overlay, closes with X /
 * Escape / click-away, and never permanently consumes vertical chart space.
 * Every input still reads/writes the exact same settings state the Code
 * panel's inline form used to (passed in as props) — this is not a second
 * settings engine, just a different surface for the same one.
 */
export function IndicatorSettingsPopout({
  name,
  visible,
  inputs,
  settings,
  chartLabel,
  anchor,
  onChangeSetting,
  onToggleVisible,
  onReset,
  onRemove,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const styleInputs = inputs.filter((i) => i.type === "color");
  const plainInputs = inputs.filter((i) => i.type !== "color");

  const renderControl = (inp: InputSpec) => {
    const value = settings[inp.name] ?? inp.value;
    if (inp.type === "bool") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChangeSetting(inp.name, e.target.checked)}
        />
      );
    }
    if (inp.type === "color") {
      return (
        <input
          type="color"
          value={String(value ?? "#000000")}
          onChange={(e) => onChangeSetting(inp.name, e.target.value)}
          className="h-6 w-10 rounded border border-border bg-card p-0"
        />
      );
    }
    if (inp.options && inp.options.length > 0) {
      return (
        <select
          value={String(value ?? inp.options[0])}
          onChange={(e) => onChangeSetting(inp.name, e.target.value)}
          className="w-28 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
        >
          {inp.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={inp.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        min={inp.min}
        max={inp.max}
        step={inp.step}
        onChange={(e) =>
          onChangeSetting(
            inp.name,
            inp.type === "number" ? Number(e.target.value) : e.target.value,
          )
        }
        className="w-28 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
      />
    );
  };

  return (
    <>
      {/* Click-away layer — sits under the panel, over everything else in
       * the chart leaf, so any click outside the panel closes it without
       * intercepting clicks meant for the panel itself. */}
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`${name} settings`}
        onClick={(e) => e.stopPropagation()}
        className="absolute z-50 w-64 overflow-hidden rounded-[8px] border border-border bg-popover shadow-2xl"
        style={{ left: Math.max(4, anchor.x - 220), top: anchor.y }}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1 truncate text-[12px] font-medium">{name}</span>
          <button
            onClick={onClose}
            title="Close"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {chartLabel && (
          <p className="border-b border-border px-2.5 py-1 text-[10px] text-muted-foreground">
            Applies to {chartLabel}
          </p>
        )}

        <div className="max-h-80 overflow-auto p-2.5 text-[11px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground">Visibility</span>
            <button
              onClick={onToggleVisible}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10.5px] hover:bg-accent"
            >
              {visible ? (
                <>
                  <Eye className="h-3 w-3" /> Visible
                </>
              ) : (
                <>
                  <EyeOff className="h-3 w-3" /> Hidden
                </>
              )}
            </button>
          </div>

          {plainInputs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Inputs
              </p>
              {plainInputs.map((inp) => (
                <label
                  key={inp.name}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-muted-foreground">{inp.label ?? inp.name}</span>
                  {renderControl(inp)}
                </label>
              ))}
            </div>
          )}

          {styleInputs.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Style
              </p>
              {styleInputs.map((inp) => (
                <label
                  key={inp.name}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-muted-foreground">{inp.label ?? inp.name}</span>
                  {renderControl(inp)}
                </label>
              ))}
            </div>
          )}

          {plainInputs.length === 0 && styleInputs.length === 0 && (
            <p className="text-muted-foreground">
              This indicator has no configurable inputs.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 border-t border-border p-2">
          <button
            onClick={onReset}
            title="Reset to defaults"
            className="flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-border py-1 text-[10.5px] hover:bg-accent"
          >
            <RotateCcw className="h-3 w-3" /> Reset to defaults
          </button>
          <button
            onClick={onRemove}
            title="Remove indicator"
            className="flex items-center justify-center gap-1 rounded-[6px] border border-border px-2 py-1 text-[10.5px] text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        </div>
      </div>
    </>
  );
}
