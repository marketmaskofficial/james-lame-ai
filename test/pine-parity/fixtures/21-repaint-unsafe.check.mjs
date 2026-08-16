export const category = "repaint-classification";
export const description =
  "A genuinely unsafe HTF request: no [1] offset, no confirm gate — the value can change intrabar. The classifier should NOT call this safe.";

export function check() {
  return [];
}

export function checkPine(pineReport) {
  const issues = [];
  const c = pineReport.repaint.classification;
  if (c === "non-repainting" || c === "confirmed-bar-only") {
    issues.push(`a request.security(...close) call with no offset or confirm gate was classified as safe ("${c}") — that's a false negative, this genuinely can repaint intrabar`);
  }
  return issues;
}
