import { useState } from "react";
import { ChevronUp } from "lucide-react";
import type { BuildValidation } from "@/lib/builder/generationState";

/**
 * Phase 5A-2/5A-3 — surfaces the SAME `state.validation` an AI build OR an
 * explicit Validate click populates (Pine and SGScript issues kept
 * distinct, exactly as the canonical result already distinguishes them) —
 * never a second validation format, never fabricated issues. `pending`/
 * `error` cover Validate's own transient states (its request in flight, or
 * the request itself failing) without inventing a second diagnostics
 * shape — they're just what's shown instead of `validation` while true.
 * Falls back to the honest neutral state when nothing has been generated
 * or validated yet.
 */

type Issue = BuildValidation["pine"]["issues"][number];

function IssueGroup({ title, issues }: { title: string; issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="mt-0.5 space-y-0.5">
        {issues.map((issue, i) => (
          <li key={i} className={issue.severity === "error" ? "text-destructive" : "text-amber-500"}>
            [{issue.severity}] {issue.code}: {issue.message}
            {issue.line ? ` (line ${issue.line})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiagnosticsPanel({
  validation,
  pending,
  error,
}: {
  validation: BuildValidation | null;
  pending?: boolean;
  error?: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pineIssues = validation?.pine.issues ?? [];
  const sgIssues = validation?.sgscript.issues ?? [];
  const hasIssues = pineIssues.length > 0 || sgIssues.length > 0;

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
      {!collapsed && (
        <div className="max-h-40 space-y-2 overflow-y-auto px-4 pb-2.5 text-xs text-muted-foreground">
          {pending && "Validating…"}
          {!pending && error && <span className="text-destructive">Validation request failed: {error}</span>}
          {!pending && !error && !validation && "No diagnostics."}
          {!pending && !error && validation && !hasIssues && "Passed static validation — no issues."}
          {!pending && !error && validation && hasIssues && (
            <>
              <IssueGroup title="Pine" issues={pineIssues} />
              <IssueGroup title="SGScript" issues={sgIssues} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
