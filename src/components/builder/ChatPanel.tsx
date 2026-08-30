import { useEffect, useRef } from "react";
import { Loader2, MessageSquare, Send, Wrench } from "lucide-react";
import { canSubmitFixError, canSubmitPrompt, repairPassesLabel, type BuilderProjectState } from "@/lib/builder/generationState";

/**
 * Phase 5A-2 — AI Builder Chat, now real. Deliberately presentational only:
 * every prop here is a plain value or callback from `useBuilderProject`
 * (`src/components/builder/useBuilderProject.ts`) — this file itself never
 * imports `buildProject`/any `*.functions` module/`useServerFn`, so the
 * canonical generation chain has exactly one entry point in this whole
 * feature, not one per component.
 *
 * Truthful language only: a successful build is described as "generated
 * successfully," never "added to the chart" or "plotted" — Phase 5A-2 has
 * no live chart execution at all (see the Preview panel, unchanged).
 */

function statusLine(status: "success" | "warning" | "error" | undefined, issues: number | undefined, repairPasses: number | undefined): string | null {
  if (!status) return null;
  const repairText = repairPassesLabel(repairPasses);
  if (status === "error") {
    return `${issues ?? 0} static-validation issue${(issues ?? 0) === 1 ? "" : "s"} — unresolved, not generated.`;
  }
  if (status === "warning") {
    return `${issues} static-validation note${issues === 1 ? "" : "s"}${repairText ? ` (${repairText})` : ""} · indicator generated.`;
  }
  return `Passed static validation${repairText ? ` after ${repairText}` : ""} · indicator generated successfully.`;
}

export function ChatPanel({
  project,
  prompt,
  onPromptChange,
  onSubmit,
  onFixError,
  signedIn,
}: {
  project: BuilderProjectState;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onFixError: () => void;
  signedIn: boolean;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const busy = project.status === "generating";

  useEffect(() => {
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
  }, [project.messages.length, busy]);

  const canBuild = canSubmitPrompt(prompt, project.status, signedIn);
  const canFix = canSubmitFixError(project.failedDraft, project.status, signedIn);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        AI Builder Chat
      </div>

      <div ref={logRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 text-xs">
        {project.messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Describe the indicator you want to build.</p>
          </div>
        )}

        {project.messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "rounded-md bg-accent px-2.5 py-1.5 leading-relaxed" : "leading-relaxed"}>
            {m.role === "ai" && <p className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-brand">Signal Goat</p>}
            <p>{m.text}</p>
            {m.role === "ai" && (
              <p
                className={`mt-0.5 text-[10px] ${
                  m.status === "error" ? "font-medium text-destructive" : m.status === "warning" ? "text-amber-500" : "text-muted-foreground"
                }`}
              >
                {statusLine(m.status, m.issues, m.repairPasses)}
              </p>
            )}
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating…
          </p>
        )}

        {project.status === "generationFailed" && project.error && (
          <p className="text-[11px] text-destructive">Could not generate: {project.error}</p>
        )}
      </div>

      {project.failedDraft && !busy && (
        <div className="mx-3 mb-2 space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <p className="text-[11px] font-medium text-destructive">Build has an unresolved validation error — nothing was generated.</p>
          <button
            type="button"
            disabled={!canFix}
            onClick={onFixError}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/50 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wrench className="h-3 w-3" /> Fix Error
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="shrink-0 space-y-2 border-t border-border p-2.5"
      >
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          disabled={busy}
          rows={3}
          placeholder={project.spec ? "Change something — e.g. use a 50-period EMA instead" : "e.g. 20/50 EMA crossover with an RSI filter…"}
          aria-label="Describe the indicator you want to build"
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canBuild}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {project.spec ? "Apply change" : "Build"}
        </button>
        {!signedIn && <p className="text-[10px] text-muted-foreground">Sign in to build with AI.</p>}
      </form>
    </div>
  );
}
