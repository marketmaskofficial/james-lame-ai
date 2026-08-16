// Static + semantic validation for generated Pine Script v6.
//
// IMPORTANT HONESTY RULE: this is *static* analysis. It never compiles Pine.
// Nothing in this module may be presented to a user as "TradingView
// compilation" — only as "static validation".

export type Severity = "error" | "warning" | "info";

export type Issue = {
  severity: Severity;
  code: string;
  message: string;
  line?: number;
};

export type RepaintClass =
  | "non-repainting"
  | "confirmed-bar-only"
  | "realtime-changing"
  | "intentionally-repainting"
  | "potentially-repainting"
  | "unknown";

export type PineReport = {
  ok: boolean;
  issues: Issue[];
  repaint: { classification: RepaintClass; reasons: string[] };
  stats: { lines: number; plots: number; drawings: number };
};

const STRING_RE = /"(?:[^"\\]|\\.)*"/g;

/** Strips strings and comments so token scanning doesn't trip on prose. */
function strip(line: string): string {
  return line.replace(STRING_RE, '""').replace(/\/\/.*$/, "");
}

function balanced(code: string): Issue[] {
  const issues: Issue[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[" };
  const stack: Array<{ ch: string; line: number }> = [];
  const lines = code.split("\n");
  lines.forEach((raw, i) => {
    for (const ch of strip(raw)) {
      if (ch === "(" || ch === "[") stack.push({ ch, line: i + 1 });
      else if (ch === ")" || ch === "]") {
        const top = stack.pop();
        if (!top || top.ch !== pairs[ch]) {
          issues.push({
            severity: "error",
            code: "unbalanced",
            message: `Unmatched "${ch}"`,
            line: i + 1,
          });
        }
      }
    }
  });
  for (const left of stack) {
    issues.push({
      severity: "error",
      code: "unbalanced",
      message: `Unclosed "${left.ch}"`,
      line: left.line,
    });
  }
  return issues;
}

/**
 * Pine's block structure is indentation-significant, like Python: the body of
 * an `if`/`else`/`for`/`while` header or a multi-line `=>` function must be
 * indented deeper than the header, or the compiler either errors or silently
 * treats the block as empty. The prompt tells the model this; nothing here
 * used to actually check it.
 */
function blockIndentation(code: string): Issue[] {
  const issues: Issue[] = [];
  const raw = code.split("\n");
  const stripped = raw.map(strip);

  const indentOf = (line: string) => line.length - line.replace(/^[ \t]*/, "").length;
  const isHeader = (line: string) => {
    const t = line.trim();
    if (!t) return false;
    if (/=>\s*$/.test(t)) return true; // multi-line function/lambda def
    if (/^(if|else\s+if)\b/.test(t)) return true;
    if (/^else\s*$/.test(t)) return true;
    if (/^for\b.*\bto\b|^for\b.*\bin\b/.test(t)) return true;
    if (/^while\b/.test(t)) return true;
    return false;
  };

  for (let i = 0; i < stripped.length; i++) {
    const line = stripped[i];
    if (!line.trim() || !isHeader(line)) continue;
    const headerIndent = indentOf(raw[i]);

    let j = i + 1;
    while (j < stripped.length && !stripped[j].trim()) j++; // skip blanks/comment-only lines
    if (j >= stripped.length) continue; // header is the last thing in the file

    const bodyIndent = indentOf(raw[j]);
    if (bodyIndent <= headerIndent) {
      issues.push({
        severity: "error",
        code: "block-indent",
        message: `Line ${i + 1} opens a block ("${line.trim()}") but line ${j + 1} is not indented deeper — Pine treats unindented lines as outside the block`,
        line: j + 1,
      });
    }
  }
  return issues;
}

const V5_ISMS: Array<[RegExp, string, string]> = [
  [/(^|[^.\w])study\s*\(/, "v5-study", "study() is v4 — use indicator()"],
  [/(^|[^.\w])security\s*\(/, "v5-security", "security() must be request.security()"],
  [/(^|[^.\w])iff\s*\(/, "v5-iff", "iff() was removed — use a ternary"],
  [/(^|[^.\w])(financial|quandl|splits|dividends|earnings)\s*\(/, "v5-request", "Use the request.* namespace"],
  [/(^|[^.\w])(rsi|sma|ema|atr|macd|stoch|wma|rma|vwma|highest|lowest|crossover|crossunder|change|stdev)\s*\(/,
    "v5-ta", "Built-ins live in the ta.* namespace in v5/v6"],
  [/(^|[^.\w])(abs|max|min|round|floor|pow|sqrt|log|avg|sum)\s*\(/, "v5-math",
    "Math built-ins live in the math.* namespace"],
  [/(^|[^.\w])(tostring|tonumber|tickerid|syminfo\.tickerid\s*\()/, "v5-str",
    "Use str.tostring / str.tonumber"],
];

export function validatePine(code: string): PineReport {
  const issues: Issue[] = [];
  const lines = code.split("\n");
  const source = lines.map(strip).join("\n");

  if (!/^\s*\/\/\s*@version\s*=\s*6\s*$/m.test(code)) {
    issues.push({
      severity: "error",
      code: "version",
      message: "Missing //@version=6 on the first line",
      line: 1,
    });
  }
  const isStrategy = /(^|[^.\w])strategy\s*\(/.test(source);
  const isIndicator = /(^|[^.\w])indicator\s*\(/.test(source);
  if (!isStrategy && !isIndicator) {
    issues.push({
      severity: "error",
      code: "declaration",
      message: "No indicator() or strategy() declaration found",
    });
  }
  if (isStrategy && isIndicator) {
    issues.push({
      severity: "error",
      code: "declaration",
      message: "A script cannot declare both indicator() and strategy()",
    });
  }

  issues.push(...balanced(code));
  issues.push(...blockIndentation(code));

  lines.forEach((raw, i) => {
    const l = strip(raw);
    if (!l.trim()) return;

    for (const [re, code2, msg] of V5_ISMS) {
      if (re.test(l)) issues.push({ severity: "error", code: code2, message: msg, line: i + 1 });
    }

    // Pine has no compound assignment.
    if (/^\s*[A-Za-z_][A-Za-z0-9_.\[\]]*\s*[+\-*/%]=\s*\S/.test(l)) {
      issues.push({
        severity: "error",
        code: "compound-assign",
        message: "Pine has no += -= *= /= — expand to `x := x + (...)`",
        line: i + 1,
      });
    }
    // `=` used to reassign an existing var inside a block should be `:=`.
    if (/^\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=]/.test(l) && /^\s{4,}/.test(l) === false) {
      // indentation-sensitive; only informational
    }
    // plot() family cannot be called in local scope.
    if (/^\s+/.test(raw) && /(^|[^.\w])(plot|plotshape|plotchar|hline|fill|bgcolor|plotcandle|plotbar)\s*\(/.test(l)) {
      issues.push({
        severity: "error",
        code: "plot-scope",
        message: "plot*/hline/fill/bgcolor must be called at global scope, never inside if/for",
        line: i + 1,
      });
    }
    if (/request\.security\s*\([^)]*lookahead_on/.test(l)) {
      issues.push({
        severity: "warning",
        code: "lookahead",
        message: "lookahead_on leaks future data on historical bars",
        line: i + 1,
      });
    }
    if (/\bvar\s+var\b|\bvarip\s+var\b/.test(l)) {
      issues.push({ severity: "error", code: "var", message: "Malformed var declaration", line: i + 1 });
    }
  });

  // Object budget: Pine v6 allows up to 500 default / 10 000 declared drawings.
  const drawingCalls = (source.match(/\b(label|line|box|table|polyline)\.new\s*\(/g) ?? []).length;
  const plotCalls = (source.match(/(^|[^.\w])plot\w*\s*\(/g) ?? []).length;
  const declaresMax = /max_(labels|lines|boxes|polylines)_count\s*=/.test(source);
  if (drawingCalls > 0 && !declaresMax) {
    issues.push({
      severity: "warning",
      code: "object-limit",
      message:
        "Script creates drawing objects but does not declare max_labels_count / max_lines_count / max_boxes_count",
    });
  }
  if (plotCalls === 0 && drawingCalls === 0 && !isStrategy) {
    issues.push({
      severity: "error",
      code: "no-output",
      message: "Indicator produces no visible output (no plot and no drawings)",
    });
  }
  if (isStrategy && !/strategy\.(entry|order)\s*\(/.test(source)) {
    issues.push({
      severity: "error",
      code: "strategy-logic",
      message: "strategy() declared but no strategy.entry/strategy.order call found",
    });
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    issues,
    repaint: classifyRepaint(code),
    stats: { lines: lines.length, plots: plotCalls, drawings: drawingCalls },
  };
}

const CONFIRM_OFFSET_RE = /\[1\]|\[\s*barstate\.isrealtime\s*\?\s*1\s*:\s*0\s*\]/;

/**
 * True if any request.security(...) call's argument list contains a [1] (or
 * the ternary realtime-safe) confirm offset anywhere within it — not just
 * immediately before the closing paren, which misses both a trailing named
 * arg (`..., close[1], lookahead=barmerge.lookahead_on)`) and a [1] applied
 * to a nested call (`ta.ema(close, len)[1]`). Scans each call's balanced
 * parens by hand since a single regex can't track nesting depth.
 */
function anySecurityCallConfirmed(src: string): boolean {
  const marker = "request.security";
  let searchFrom = 0;
  for (;;) {
    const idx = src.indexOf(marker, searchFrom);
    if (idx === -1) return false;
    const parenStart = src.indexOf("(", idx);
    if (parenStart === -1) return false;
    let depth = 1;
    let i = parenStart + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const args = src.slice(parenStart + 1, i - 1);
    if (CONFIRM_OFFSET_RE.test(args)) return true;
    searchFrom = i;
  }
}

/** Conservative repaint classification — never claims safety it can't prove. */
export function classifyRepaint(code: string): {
  classification: RepaintClass;
  reasons: string[];
} {
  const src = code
    .split("\n")
    .map(strip)
    .join("\n");
  const reasons: string[] = [];

  const usesSecurity = /request\.security\s*\(/.test(src);
  const securityConfirmed = usesSecurity && anySecurityCallConfirmed(src);

  // lookahead_on without a [1]-style confirm offset genuinely leaks an
  // unclosed future value on historical bars — always unsafe, flagged
  // immediately. Paired with a confirm offset, it's the documented-safe
  // "already-closed value, no extra lag" idiom instead (see
  // pine-playbooks.ts's repainting-discipline section), so it falls through
  // to the normal classification below rather than being flagged here.
  if (/lookahead\s*=\s*barmerge\.lookahead_on/.test(src) && !securityConfirmed) {
    reasons.push("request.security uses lookahead_on without a [1] confirm offset (future data on history)");
    return { classification: "intentionally-repainting", reasons };
  }

  const usesRealtime = /barstate\.isrealtime|barstate\.islast/.test(src);
  const usesPivots = /ta\.pivot(high|low)\s*\(/.test(src);
  const confirmGate = /barstate\.isconfirmed/.test(src);

  if (usesSecurity && !securityConfirmed) {
    reasons.push("request.security() without a [1] confirmed-bar offset can change intrabar");
  }
  if (usesPivots) {
    reasons.push("ta.pivothigh/low confirm only after the right-side bars complete");
  }
  if (usesRealtime) {
    reasons.push("script branches on realtime bar state");
  }

  if (confirmGate && reasons.length === 0) {
    return { classification: "confirmed-bar-only", reasons: ["signals gated on barstate.isconfirmed"] };
  }
  if (reasons.length === 0) {
    return {
      classification: "non-repainting",
      reasons: ["no HTF requests, pivots or realtime branching detected"],
    };
  }
  if (usesRealtime && !confirmGate) return { classification: "realtime-changing", reasons };
  return { classification: "potentially-repainting", reasons };
}

export function formatIssues(issues: Issue[], limit = 20): string {
  return issues
    .slice(0, limit)
    .map((i) => `[${i.severity}] ${i.line ? `line ${i.line}: ` : ""}${i.code} — ${i.message}`)
    .join("\n");
}
