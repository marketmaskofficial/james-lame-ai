import { useState } from "react";
import { ChevronUp } from "lucide-react";

/**
 * Phase 5A-1 — bottom diagnostics/build-status region, SHELL ONLY.
 *
 * Eventually surfaces validation issues, generation issues, repair-attempt
 * counts, and runtime/render failures (see the Phase 5A audit's
 * recommended error/diagnostic architecture) — none of that exists yet,
 * so this shows only an honest neutral state. Collapsible so it never
 * competes with the main workspace for vertical space when there is
 * nothing to show.
 */
export function DiagnosticsPanel() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="shrink-0 border-t border-border bg-sidebar">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Diagnostics</span>
        <ChevronUp className={`h-3 w-3 transition-transform ${collapsed ? "rotate-180" : ""}`} />
      </button>
      {!collapsed && <div className="px-4 pb-2.5 text-xs text-muted-foreground">No diagnostics.</div>}
    </div>
  );
}
