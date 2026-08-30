import { FileCode } from "lucide-react";

/**
 * Phase 5A-1 — Code Editor region, SHELL ONLY.
 *
 * Establishes the editor's structural regions (header/language label,
 * viewport, validation status strip) WITHOUT mounting the real editor.
 * This repo already has a working CodeMirror-based editor
 * (`src/components/studio/CodeEditor.tsx`, `@uiw/react-codemirror`) — Phase
 * 5A-3 wires that exact dependency in here. This shell deliberately does
 * NOT fake an editable textarea in its place, per the Phase 5A-1 brief: a
 * professional empty state is preferable to a fake finished editor.
 */
export function CodeEditorPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Code Editor</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">SGScript</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
        <FileCode className="h-5 w-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No indicator code yet.</p>
        <p className="text-xs text-muted-foreground/70">Describe an indicator in Chat to begin.</p>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">No validation yet.</div>
    </div>
  );
}
