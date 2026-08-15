// Static validation for SGScript before it ever reaches the worker.
// Catches unsafe constructs and obviously broken scripts so the runtime never
// has to defend against them alone.

import type { Issue } from "./pine";

const BANNED: Array<[RegExp, string]> = [
  [/\beval\s*\(/, "eval() is not allowed"],
  [/\bnew\s+Function\b|\bFunction\s*\(/, "Function() is not allowed"],
  [/\bimport\s*\(|\bimport\s+[\w{*]/, "imports are not allowed"],
  [/\brequire\s*\(/, "require() is not allowed"],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket\b/, "network access is not allowed"],
  [/\bdocument\b|\bwindow\b|localStorage|indexedDB/, "DOM/storage access is not allowed"],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, "timers are not allowed"],
  [/\bpostMessage\s*\(|importScripts\s*\(/, "worker APIs are not allowed"],
  [/\bprocess\b|globalThis|\bself\b/, "host globals are not allowed"],
  [/\.constructor\b/, "constructor access is not allowed"],
  [/\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/, "infinite loops are not allowed"],
];

const OUTPUT_CALL =
  /(^|[^.\w])(plot|plotOsc|hist|hline|box|line|label|signal|fill)\s*\(/;

export type SgReport = { ok: boolean; issues: Issue[] };

export function validateSgScript(code: string): SgReport {
  const issues: Issue[] = [];
  const lines = code.split("\n");
  const src = lines.map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  if (!code.trim()) {
    return { ok: false, issues: [{ severity: "error", code: "empty", message: "Script is empty" }] };
  }

  if (/^\s*\/\/\s*@version\s*=\s*\d/m.test(code) || /\bindicator\s*\(\s*["']/.test(src)) {
    issues.push({
      severity: "error",
      code: "pine-detected",
      message: "This looks like Pine Script, not SGScript — it must be ported first",
    });
  }

  lines.forEach((raw, i) => {
    const l = raw.replace(/\/\/.*$/, "");
    if (!l.trim()) return;
    for (const [re, msg] of BANNED) {
      if (re.test(l)) {
        issues.push({ severity: "error", code: "unsafe", message: msg, line: i + 1 });
      }
    }
    // Series arithmetic must go through the helpers.
    if (/\b(close|open|high|low|volume|hl2|hlc3|ohlc4)\s*[+\-*/]\s*[\w.(]/.test(l)) {
      issues.push({
        severity: "warning",
        code: "series-math",
        message: "Use add/sub/mul/div for series arithmetic — raw operators produce NaN on arrays",
        line: i + 1,
      });
    }
  });

  if (!OUTPUT_CALL.test(src)) {
    issues.push({
      severity: "error",
      code: "no-output",
      message: "Script draws nothing — call plot/hist/box/label/signal at least once",
    });
  }

  // Cheap brace/paren balance check.
  let depth = 0;
  for (const ch of src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) {
    issues.push({
      severity: "error",
      code: "unbalanced",
      message: "Unbalanced brackets or braces",
    });
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Pine <-> runtime visual parity check.
 *
 * The Pine twin and the SGScript runtime version must draw the SAME kinds of
 * objects. Historically the model would emit `box.new` FVG zones in Pine but
 * only a `signal()` marker in SGScript, and the chart silently looked nothing
 * like TradingView. Any missing object family is reported as an error so the
 * build's repair pass regenerates it instead of quietly downgrading visuals.
 */
export function visualParity(pine: string, sgscript: string): Issue[] {
  const p = pine.replace(/\/\/.*$/gm, "");
  const s = sgscript.replace(/\/\/.*$/gm, "");
  const has = (src: string, re: RegExp) => re.test(src);
  const checks: Array<[boolean, boolean, string, string]> = [
    [
      has(p, /\bbox\.new\s*\(/),
      has(s, /(^|[^.\w])(box|zones)\s*\(/m),
      "box",
      "Pine draws boxes/zones but the SGScript version draws none — use box(top, bottom, from, to, {...}) or zones(...)",
    ],
    [
      has(p, /\blabel\.new\s*\(/),
      has(s, /(^|[^.\w])label\s*\(/m),
      "label",
      "Pine draws labels but the SGScript version draws none — use label(index, price, text, {...}) with the same text",
    ],
    [
      has(p, /\bline\.new\s*\(/),
      has(s, /(^|[^.\w])line\s*\(/m),
      "line",
      "Pine draws lines but the SGScript version draws none — use line(price1, i1, price2, i2, {...})",
    ],
    [
      has(p, /\bhline\s*\(/),
      has(s, /(^|[^.\w])hline\s*\(/m),
      "hline",
      "Pine draws horizontal levels but the SGScript version draws none — use hline(price, {...})",
    ],
    [
      has(p, /(^|[^.\w])plot\s*\(/m),
      has(s, /(^|[^.\w])(plot|plotOsc|hist)\s*\(/m),
      "plot",
      "Pine plots a series but the SGScript version plots none — use plot()/plotOsc()/hist()",
    ],
    [
      has(p, /\bplotshape\s*\(|\bplotchar\s*\(/),
      has(s, /(^|[^.\w])signal\s*\(/m),
      "marker",
      "Pine plots shapes but the SGScript version emits no signals — use signal(cond, side, text)",
    ],
    [
      has(p, /\bfill\s*\(/),
      has(s, /(^|[^.\w])fill\s*\(/m),
      "fill",
      "Pine fills between plots but the SGScript version does not — use fill(plotA, plotB, color, opacity)",
    ],
  ];

  const issues: Issue[] = [];
  for (const [inPine, inSg, code, message] of checks) {
    if (inPine && !inSg) {
      issues.push({ severity: "error", code: `parity-${code}`, message });
    }
  }
  // Constructs the renderer cannot reproduce: warn, never pretend.
  if (/\btable\.new\s*\(/.test(p)) {
    issues.push({
      severity: "warning",
      code: "parity-table",
      message: "Pine tables are not reproduced by the Signal Goat renderer yet",
    });
  }
  if (/\bbgcolor\s*\(/.test(p)) {
    issues.push({
      severity: "warning",
      code: "parity-bgcolor",
      message: "bgcolor() is not reproduced by the Signal Goat renderer yet",
    });
  }
  return issues;
}
