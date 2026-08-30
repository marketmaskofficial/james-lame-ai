import { FileCode } from "lucide-react";

/**
 * Phase 5A-2 — Code Editor region. Still NOT the real editor: this phase
 * only stores the generated SGScript in Builder state and displays it as
 * inert, read-only text (a plain `<pre>`, never an editable `<textarea>`
 * pretending to be a finished editor) so Phase 5A-3 can swap in the real
 * CodeMirror instance (`src/components/studio/CodeEditor.tsx`, already
 * used by Chart Studio) against the exact same `sgscript` data without any
 * change to where that data comes from.
 */
export function CodeEditorPanel({ sgscript, hasValidationResult }: { sgscript: string; hasValidationResult: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Code Editor</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">SGScript</span>
      </div>

      {sgscript ? (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground/90">{sgscript}</pre>
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
