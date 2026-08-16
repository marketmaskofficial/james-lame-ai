export const category = "repaint-classification";
export const description =
  "The simplest safe HTF idiom: request.security(..., close[1]) with no lookahead trick — just a 1-bar-delayed, already-final value. Exercises validatePine()'s repaint classifier directly (this fixture's real assertion is in checkPine, not check).";

export function check() {
  return [];
}

/** Runs against the Pine source's own PineReport.repaint, independent of the SGScript translation. */
export function checkPine(pineReport) {
  const issues = [];
  const c = pineReport.repaint.classification;
  if (c !== "non-repainting" && c !== "confirmed-bar-only") {
    issues.push(
      `expected a safe classification (non-repainting or confirmed-bar-only) for a [1]-offset security call, got "${c}": ${pineReport.repaint.reasons.join("; ")}`,
    );
  }
  return issues;
}
