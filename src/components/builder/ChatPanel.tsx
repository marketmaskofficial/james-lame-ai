import { MessageSquare } from "lucide-react";

/**
 * Phase 5A-1 — AI Builder Chat, SHELL ONLY.
 *
 * This is structural UI for the eventual chat-driven indicator authoring
 * flow. It does NOT call any AI/server function, does NOT persist a
 * conversation, and does NOT fabricate a generated response — Phase 5A-2
 * wires the real `buildProject`/`translateToSgScript`/`repairSgScript`
 * pipeline (already canonical, already used by Chart Studio's own
 * `AiSidePanel.tsx` — never a second implementation) into this shell.
 */
export function ChatPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        AI Builder Chat
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
        <MessageSquare className="h-5 w-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Describe the indicator you want to build.</p>
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <textarea
          disabled
          rows={2}
          placeholder="e.g. 20/50 EMA crossover with an RSI filter…"
          aria-label="Describe the indicator you want to build"
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          disabled
          title="Build — available once AI generation is wired in a later phase"
          className="mt-2 w-full rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Build
        </button>
      </div>
    </div>
  );
}
