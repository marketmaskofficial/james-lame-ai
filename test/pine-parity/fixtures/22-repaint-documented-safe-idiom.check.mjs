export const category = "repaint-classification";
export const description =
  "KNOWN GAP: this is the EXACT idiom pine-playbooks.ts's repainting-discipline section recommends as safe — request.security(sym, tf, close[1], lookahead=barmerge.lookahead_on) — but classifyRepaint() (validate/pine.ts) checks for lookahead_on FIRST and returns 'intentionally-repainting' immediately, before ever checking whether it's paired with a [1] confirm offset. So the system prompt teaches a pattern its own analyzer then flags as the worst possible classification. Left failing on purpose so this doesn't get silently forgotten.";

export function check() {
  return [];
}

export function checkPine(pineReport) {
  const issues = [];
  const c = pineReport.repaint.classification;
  if (c === "intentionally-repainting") {
    issues.push(
      `KNOWN GAP (see description): documented-safe [1]+lookahead_on idiom classified as "intentionally-repainting" instead of a safe classification. classifyRepaint() in src/lib/validate/pine.ts checks for lookahead_on before checking for a [1] confirm offset — fix by checking securityConfirmed first, or by only treating lookahead_on as unsafe when it's NOT paired with [1].`,
    );
  }
  return issues;
}
