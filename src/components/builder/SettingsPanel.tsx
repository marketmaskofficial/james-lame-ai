import { SlidersHorizontal } from "lucide-react";
import type { InputSpec, RunResult } from "@/lib/sgscript/types";
import type { SettingValue } from "@/lib/builder/generationState";

/**
 * Phase 5A-5C — real indicator-input controls, replacing the Phase 5A-1
 * placeholder. Reads from `previewResult.inputs` (`RunResult.inputs`) — the
 * RUNTIME's own post-run declaration of what this SGScript actually
 * accepts — never `spec.inputs` (the AI's pre-run intent), since a manual
 * code edit can add/remove/rename an input the spec never knew about; the
 * runtime is the only source that's guaranteed to match what's on screen.
 *
 * Per-type control rendering mirrors Chart Studio's
 * `IndicatorSettingsPopout.renderControl` (bool → checkbox, color → color
 * input, an input with `options` → select, else number/text) — reused
 * logic, deliberately WITHOUT that component's floating-popout chrome
 * (anchor positioning, visibility toggle, remove button), none of which
 * applies to Builder's single-always-visible-indicator context.
 *
 * Every change here is 100% local: `onChange` calls straight into
 * `useBuilderProject`'s `updateSetting`, which touches `state.settings`
 * only — no AI call, no DB write. Persistence happens exclusively through
 * Save/Save Version, exactly like a code edit or a rename.
 */
export function SettingsPanel({
  inputs,
  settings,
  onChange,
}: {
  inputs: InputSpec[] | undefined;
  settings: Record<string, SettingValue>;
  onChange: (name: string, value: SettingValue) => void;
}) {
  if (!inputs || inputs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          {inputs ? "This indicator has no configurable inputs." : "Indicator settings will appear here after a successful build."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="space-y-2.5 text-xs">
        {inputs.map((inp) => (
          <label key={inp.name} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-muted-foreground">{inp.label ?? inp.name}</span>
            <InputControl input={inp} value={settings[inp.name] ?? inp.value} onChange={(v) => onChange(inp.name, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function InputControl({ input, value, onChange }: { input: InputSpec; value: SettingValue; onChange: (value: SettingValue) => void }) {
  if (input.type === "bool") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (input.type === "color") {
    return (
      <input
        type="color"
        value={String(value ?? "#000000")}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-10 rounded border border-border bg-card p-0"
      />
    );
  }
  if (input.options && input.options.length > 0) {
    return (
      <select
        value={String(value ?? input.options[0])}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 shrink-0 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
      >
        {input.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={input.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      min={input.min}
      max={input.max}
      step={input.step}
      onChange={(e) => onChange(input.type === "number" ? Number(e.target.value) : e.target.value)}
      className="w-28 shrink-0 rounded border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
    />
  );
}

/** Exported purely so the desktop collapsible bar (`BuilderWorkspace.tsx`)
 * and this panel's own empty state can share one "has anything to show"
 * check without duplicating the `RunResult.inputs` access path. */
export function hasSettingsInputs(previewResult: RunResult | null): boolean {
  return Boolean(previewResult && previewResult.inputs.length > 0);
}
