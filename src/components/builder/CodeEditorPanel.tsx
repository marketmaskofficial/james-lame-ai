import { FileCode } from "lucide-react";
import { CodeEditor } from "@/components/studio/CodeEditor";

/**
 * Phase 5A-3 — the real Code Editor region. Reuses the SAME leaf CodeMirror
 * component Chart Studio already uses (`src/components/studio/CodeEditor.tsx`)
 * — never a second editor implementation — as a fully controlled input over
 * Builder's ONE canonical `sgscript` value (`useBuilderProject`'s
 * `state.sgscript`, threaded down through `BuilderWorkspace`). There is no
 * editor-local draft here: `onChange` writes straight back into that same
 * canonical state via `setManualSgscript`, so the value this component
 * renders and the value `buildRequestPayload`/Validate read are always the
 * literal same field.
 *
 * `readOnly` is driven by `status === "generating"` (see `BuilderWorkspace`)
 * — the code stays visible during an in-flight AI request but can't be
 * edited, which is what prevents a manual edit from racing a build result
 * that would otherwise silently overwrite it.
 */
export function CodeEditorPanel({
  sgscript,
  hasValidationResult,
  onChange,
  readOnly,
}: {
  sgscript: string;
  hasValidationResult: boolean;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Code Editor</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">SGScript</span>
      </div>

      {sgscript ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor value={sgscript} onChange={onChange} readOnly={readOnly} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
          <FileCode className="h-5 w-5 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No indicator code yet.</p>
          <p className="text-xs text-muted-foreground/70">Describe an indicator in Chat to begin.</p>
        </div>
      )}

      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        {hasValidationResult ? "See Diagnostics for the latest static validation result." : "No validation yet."}
      </div>
    </div>
  );
}
