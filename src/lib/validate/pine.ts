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

  if (/lookahead\s*=\s*barmerge\.lookahead_on/.test(src)) {
    reasons.push("request.security uses lookahead_on (future data on history)");
    return { classification: "intentionally-repainting", reasons };
  }

  const usesSecurity = /request\.security\s*\(/.test(src);
  const securityConfirmed = /\[\s*barstate\.isrealtime\s*\?\s*1\s*:\s*0\s*\]|\[1\]\s*\)/.test(src);
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
