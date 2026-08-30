import type { BuildResult } from "@/lib/project.functions";

/**
 * Shared result-classification logic for a `buildProject` response — used
 * by both Chart Studio's `AiSidePanel` and the Indicator Builder, so the
 * definition of success/warning/error can never drift between the two
 * surfaces that consume the same canonical generation chain. Extracted
 * from `AiSidePanel.tsx` (Phase 5A-2) rather than duplicated a second time;
 * `AiSidePanel` itself now imports this instead of defining it locally.
 */

/** Real outcome of a build/fix attempt, derived only from the pipeline's own validation result — never optimistic. */
export type BuildOutcomeStatus = "success" | "warning" | "error";

export function classifyBuildResult(r: BuildResult): { status: BuildOutcomeStatus; totalIssues: number } {
  const hasError = !r.validation.pine.ok || !r.validation.sgscript.ok;
  const totalIssues = r.validation.pine.issues.length + r.validation.sgscript.issues.length;
  return { status: hasError ? "error" : totalIssues > 0 ? "warning" : "success", totalIssues };
}

export function formatBuildIssuesForRepair(r: BuildResult): string {
  return [...r.validation.pine.issues, ...r.validation.sgscript.issues]
    .map((i) => `[${i.severity}] ${i.code}: ${i.message}${i.line ? ` (line ${i.line})` : ""}`)
    .join("\n");
}
