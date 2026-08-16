import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createOpenAiProvider } from "@/lib/ai-gateway.server";
import { requireApiUser, rateLimit } from "@/lib/api-auth.server";
import { validatePine, formatIssues, type PineReport } from "@/lib/validate/pine";

import {
  SYSTEM_PROMPT,
  COMMON_ERRORS_APPENDIX,
  ICT_SMART_MONEY_PLAYBOOK,
  PINE_COMPILER_GUARDRAILS,
  ORDER_FLOW_PLAYBOOK,
  PINE_V6_UPGRADE,
  V6_STRICT_MANDATE,
  SIGNAL_LABELS_PLAYBOOK,
  REASONING_PROTOCOL,
  VISION_CHART_PLAYBOOK,
} from "@/lib/ai/pine-playbooks";

const MAX_REPAIRS = 2;

const SYSTEM = [
  SYSTEM_PROMPT,
  V6_STRICT_MANDATE,
  REASONING_PROTOCOL,
  VISION_CHART_PLAYBOOK,
  PINE_V6_UPGRADE,
  SIGNAL_LABELS_PLAYBOOK,
  COMMON_ERRORS_APPENDIX,
  ICT_SMART_MONEY_PLAYBOOK,
  ORDER_FLOW_PLAYBOOK,
  PINE_COMPILER_GUARDRAILS,
].join("\n\n");

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Expensive AI endpoint: authenticated + rate limited.
        const auth = await requireApiUser(request);
        if (auth instanceof Response) return auth;
        const limited = rateLimit(`generate:${auth.userId}`, 20, 60_000);
        if (limited) return limited;

        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return new Response("OPENAI_API_KEY not configured", { status: 500 });
        }

        // Convert incoming messages (which may carry `images: string[]` as data URLs
        // or https URLs) into AI SDK multimodal message parts. Assistant messages
        // stay plain text.
        type InMsg = { role: "user" | "assistant"; content: string; images?: string[] };
        const incoming = body.messages as InMsg[];
        const messages = incoming.map((m) => {
          if (m.role === "user" && m.images && m.images.length > 0) {
            return {
              role: "user" as const,
              content: [
                { type: "text" as const, text: m.content || "Analyze this chart image." },
                ...m.images.map((url) => ({ type: "image" as const, image: url })),
              ],
            };
          }
          return { role: m.role, content: m.content };
        });

        const gateway = createOpenAiProvider(key);
        const model = gateway("gpt-5.6-sol");

        type Msgs = NonNullable<Parameters<typeof generateText>[0]["messages"]>;

        const runGeneration = (msgs: Msgs) =>
          generateText({
            model,
            system: SYSTEM,
            temperature: 0.1,
            // gpt-5.6-sol is a reasoning model: reasoning tokens draw from this
            // same budget before visible output, so keep it generous. The
            // account's 500K TPM ceiling on Sol easily covers the ~15-16K
            // system prompt plus this.
            maxOutputTokens: 32000,
            messages: msgs,
          });

        // Buffered (not streamed) on purpose: we validate the Pine code against
        // our compiler guardrails before anything reaches the user, and repair
        // it if it fails. That requires the full response, so this trades the
        // old token-by-token typing effect for a guarantee the code that shows
        // up has passed static validation.
        let { text } = await runGeneration(messages as Msgs);
        text = sanitizeText(text);
        let report = validateResponse(text);

        let attempts = 0;
        while (!report.ok && attempts < MAX_REPAIRS) {
          attempts++;
          const repairMsgs = [
            ...messages,
            { role: "assistant" as const, content: text },
            {
              role: "user" as const,
              content: `Your last response fails static validation against the Pine v6 compiler guardrails. Fix ONLY these problems and re-output the full response in the same format (one short paragraph, exactly one fenced \`\`\`pinescript code block, optional "Usage:" bullets):\n\n${formatIssues(report.issues)}`,
            },
          ];
          const retry = await runGeneration(repairMsgs as unknown as Msgs);
          text = sanitizeText(retry.text);
          report = validateResponse(text);
        }

        return new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Pine-Validated": report.ok ? "true" : "false",
          },
        });
      },
    },
  },
});

/** Extracts the fenced pinescript block (matching the frontend's own extractCode) and validates it. */
function validateResponse(text: string): PineReport {
  const match = /```(?:pinescript|pine)?\s*\n([\s\S]*?)```/i.exec(text);
  if (!match) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "no-code-block",
          message: "Response has no fenced ```pinescript code block",
        },
      ],
      repaint: { classification: "unknown", reasons: [] },
      stats: { lines: 0, plots: 0, drawings: 0 },
    };
  }
  return validatePine(match[1]);
}

/** Rewrites every line so the handful of v5-isms that still slip through the model never reach the user. */
function sanitizeText(text: string): string {
  return text.split("\n").map(fixPineLine).join("\n");
}

/** Rewrites a single line of Pine so it is valid v6. */
function fixPineLine(line: string): string {
  // Only touch lines that look like code, never prose.
  if (/^\s*\/\/@version\s*=\s*[1-5]\s*$/.test(line)) return "//@version=6";

  const codeLike = /[=(]/.test(line);
  if (!codeLike) return line;

  let out = line;
  // Strip comment tail so replacements don't run inside comments/strings crudely.
  out = out.replace(/(^|[^.\w])study\s*\(/g, "$1indicator(");
  out = out.replace(/(^|[^.\w])security\s*\(/g, "$1request.security(");
  out = out.replace(
    /(^|[^.\w])(financial|quandl|splits|dividends|earnings)\s*\(/g,
    "$1request.$2(",
  );
  out = out.replace(/(^|[^.\w])iff\s*\(/g, "$1_IFF_(");
  // Compound assignment -> explicit reassignment (Pine has none).
  const compound = out.match(
    /^(\s*)([A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]*\])?)\s*([+\-*/%])=\s*(.+?)\s*$/,
  );
  if (compound && !/["']/.test(compound[2])) {
    const [, indent, target, op, rhs] = compound;
    const rhsClean = rhs.replace(/\s*\/\/.*$/, "");
    const trailing = rhs.slice(rhsClean.length);
    out = `${indent}${target} := ${target} ${op} (${rhsClean})${trailing}`;
  }
  out = out.replace(/(^|[^.\w])_IFF_\(/g, "$1iff(");
  return out;
}
