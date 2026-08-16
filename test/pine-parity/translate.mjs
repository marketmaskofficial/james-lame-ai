// Standalone Pine -> SGScript translator for the test harness.
//
// Mirrors src/lib/sgscript.functions.ts's translateToSgScript exactly (same
// system prompt, same validate-and-repair loop) but callable directly from
// Node, without the createServerFn/auth wrapper that function needs in the
// real app. If you change the prompt or the repair loop there, mirror the
// change here too, or this harness stops measuring what actually ships.

import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { validateSgScript, visualParity } from "../../src/lib/validate/sgscript.ts";
import { formatIssues } from "../../src/lib/validate/pine.ts";
import { SGSCRIPT_REFERENCE } from "../../src/lib/sgscript/examples.ts";

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envFile = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    for (const line of envFile.split("\n")) {
      const m = line.match(/^OPENAI_API_KEY=(.*)$/);
      if (m) return m[1].trim();
    }
  } catch {
    // fall through
  }
  throw new Error("OPENAI_API_KEY not set (checked env and .env.local)");
}

const openai = createOpenAI({ apiKey: loadApiKey() });
const fence = "```";
const MAX_REPAIRS = 2;

const SYSTEM = `You port trading indicators into SGScript, the Signal Goat runtime language. The source may be Pine Script v4/v5/v6, MQL, ThinkScript, EasyLanguage, pseudo-code, broken SGScript, or a plain-English description — always produce working SGScript.

${SGSCRIPT_REFERENCE}

Output ONLY the SGScript code inside a single ${fence}sgscript fenced block. No commentary.
Reproduce the source logic faithfully: same inputs, same conditions, same plots, boxes, labels and buy/sell signals.
If the source draws persistent zone rectangles (Pine's box.new/box.set_*), you MUST call box(top, bottom, from, to, {...}) in the port — never substitute a signal()/plotshape-style marker for a zone, that silently drops the visual.
Never emit Pine Script syntax. Never emit imports, fetch, DOM or timers.
Every array arithmetic must use add/sub/mul/div. Guard values with Number.isFinite before drawing.`;

function extract(text) {
  const fenced = /```(?:sgscript|js|javascript)?\s*\n([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Translates Pine (or any source) into SGScript, validating and self-repairing
 * exactly like the production path. Returns { code, attempts, report }.
 */
export async function translate(pineSource) {
  const { text: firstText } = await generateText({
    model: openai("gpt-5.6-sol"),
    temperature: 0.1,
    maxOutputTokens: 20000,
    system: SYSTEM,
    prompt: `Port this to SGScript.\n\n${pineSource}`,
  });

  let code = extract(firstText);
  if (!code) throw new Error("Translation produced no code");

  const check = () => {
    const base = validateSgScript(code);
    const parity = visualParity(pineSource, code);
    const issues = [...base.issues, ...parity];
    return { ok: !issues.some((i) => i.severity === "error"), issues };
  };

  let report = check();
  let attempts = 0;
  while (!report.ok && attempts < MAX_REPAIRS) {
    attempts++;
    const { text: retryText } = await generateText({
      model: openai("gpt-5.6-sol"),
      temperature: 0,
      maxOutputTokens: 20000,
      system: SYSTEM,
      prompt: `Your previous port fails validation. Fix ONLY these problems and return the full corrected SGScript again, same fenced format:\n\n${formatIssues(report.issues)}\n\nOriginal source:\n${pineSource}\n\nYour previous port:\n${code}`,
    });
    code = extract(retryText) || code;
    report = check();
  }

  return { code, attempts, report };
}
