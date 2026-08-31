import { Code2, Loader2, Play, PlusSquare, Save, ShieldCheck } from "lucide-react";

/**
 * Phase 5A-1/5A-3/5A-4d — the top Builder toolbar.
 *
 * Reserves the permanent locations for indicator name / draft state /
 * version indicator / Save / Validate / Run Preview / Add to Chart. Save and
 * Add to Chart stay unconditionally disabled — never a fake-success stub —
 * until the phase that actually wires them (Save/version history in 5A-6,
 * Add to Chart in 5A-7). Validate (5A-3) and Run Preview (5A-4d) are both
 * activated via `canX` booleans computed from the canonical Builder state in
 * `src/lib/builder/generationState.ts` — never a hardcoded `true`.
 *
 * Run Preview sits beside Validate deliberately: both are manual,
 * non-AI, non-persisting actions that operate on the current canonical
 * `state.sgscript` — Run Preview additionally requires real historical bars
 * to already be loaded (`canRunPreview`'s `hasBars` parameter), so a click
 * here is never able to trigger the runtime's own "No market data loaded"
 * failure through a state the button should have already prevented.
 *
 * Below `sm` (640px) the four actions collapse to icon-only (label still
 * available via `title`) — at 375px wide, four full-text buttons plus the
 * indicator-name area do not both fit, and since the name side is the one
 * that must never disappear, the action buttons are the side that shrinks.
 */
export function BuilderToolbar({
  canValidate,
  validationPending,
  onValidate,
  canRunPreview,
  previewRunning,
  onRunPreview,
}: {
  canValidate: boolean;
  validationPending: boolean;
  onValidate: () => void;
  canRunPreview: boolean;
  previewRunning: boolean;
  onRunPreview: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Code2 className="h-4 w-4 shrink-0 text-brand" />
        <span className="truncate text-sm font-semibold">Untitled Indicator</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Draft</span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">No version</span>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <button
          type="button"
          disabled
          title="Save — available once indicator persistence is wired in a later phase"
          aria-label="Save"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Save</span>
        </button>
        <button
          type="button"
          disabled={!canValidate}
          onClick={onValidate}
          title={canValidate ? "Validate — run static validation on the current code" : "Validate — describe and build an indicator first"}
          aria-label="Validate"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          {validationPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{validationPending ? "Validating…" : "Validate"}</span>
        </button>
        <button
          type="button"
          disabled={!canRunPreview}
          onClick={onRunPreview}
          title={canRunPreview ? "Run Preview — execute the current code against the loaded historical bars" : "Run Preview — needs real code and loaded market data"}
          aria-label="Run Preview"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          {previewRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{previewRunning ? "Running…" : "Run Preview"}</span>
        </button>
        <button
          type="button"
          disabled
          title="Add to Chart — available once the Chart Studio hand-off is wired in a later phase"
          aria-label="Add to Chart"
          className="flex items-center gap-1.5 rounded-md bg-brand px-1.5 py-1 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          <PlusSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add to Chart</span>
        </button>
      </div>
    </header>
  );
}
