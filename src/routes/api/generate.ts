import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { requireApiUser, rateLimit } from "@/lib/api-auth.server";

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
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response("LOVABLE_API_KEY not configured", { status: 500 });
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

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3.1-pro-preview");

        const result = streamText({
          model,
          system:
            SYSTEM_PROMPT +
            "\n\n" +
            V6_STRICT_MANDATE +
            "\n\n" +
            REASONING_PROTOCOL +
            "\n\n" +
            VISION_CHART_PLAYBOOK +
            "\n\n" +
            PINE_V6_UPGRADE +
            "\n\n" +
            SIGNAL_LABELS_PLAYBOOK +
            "\n\n" +
            COMMON_ERRORS_APPENDIX +
            "\n\n" +
            ICT_SMART_MONEY_PLAYBOOK +
            "\n\n" +
            ORDER_FLOW_PLAYBOOK +
            "\n\n" +
            PINE_COMPILER_GUARDRAILS,
          temperature: 0.1,
          maxOutputTokens: 32000,
          messages: messages as NonNullable<Parameters<typeof streamText>[0]["messages"]>,
        });

        // Line-buffered safety net: repair the handful of v5-isms that still slip
        // through the model, so pasted code always compiles as Pine v6.
        const sanitized = result.textStream.pipeThrough(createV6Sanitizer());
        return new Response(sanitized.pipeThrough(new TextEncoderStream()), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});

/** Rewrites a single line of streamed Pine so it is valid v6. */
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

function createV6Sanitizer(): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) controller.enqueue(fixPineLine(line) + "\n");
    },
    flush(controller) {
      if (buffer) controller.enqueue(fixPineLine(buffer));
    },
  });
}

