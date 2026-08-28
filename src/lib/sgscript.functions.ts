import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "@/lib/ai-gateway.server";
import { SGSCRIPT_REFERENCE } from "@/lib/sgscript/examples";
import { validateSgScript, visualParity } from "@/lib/validate/sgscript";
import { formatIssues } from "@/lib/validate/pine";
import { recordAiUsage, accumulateUsage, type AiUsageTokens } from "@/lib/ai-usage.server";

const MAX_TRANSLATE_REPAIRS = 2;
const SGSCRIPT_MODEL = "gpt-5.6-sol";

// Translates a Pine Script (or a plain-English description) into SGScript so
// it can execute in the Signal Goat runtime. Pine itself is never executed —
// this is a semantic port into our own language.
export const translateToSgScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        source: z.string().min(1).max(60_000),
        note: z.string().max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");
    const provider = createOpenAiProvider(apiKey);
    let usage: AiUsageTokens = {};

    const system = `You port trading indicators into SGScript, the Signal Goat runtime language. The source may be Pine Script v4/v5/v6, MQL, ThinkScript, EasyLanguage, pseudo-code, broken SGScript, or a plain-English description — always produce working SGScript.

${SGSCRIPT_REFERENCE}

Output ONLY the SGScript code inside a single \`\`\`sgscript fenced block. No commentary.
Reproduce the source logic faithfully: same inputs, same conditions, same plots, boxes, labels and buy/sell signals.
If the source draws persistent zone rectangles (Pine's box.new/box.set_*), you MUST call box(top, bottom, from, to, {...}) in the port — never substitute a signal()/plotshape-style marker for a zone, that silently drops the visual.
Never emit Pine Script syntax. Never emit imports, fetch, DOM or timers.
Every array arithmetic must use add/sub/mul/div. Guard values with Number.isFinite before drawing.`;

    const extract = (text: string) => {
      const fenced = /```(?:sgscript|js|javascript)?\s*\n([\s\S]*?)```/i.exec(text);
      return (fenced ? fenced[1] : text).trim();
    };

    try {
      const first = await generateText({
        model: provider(SGSCRIPT_MODEL),
        temperature: 0.1,
        maxOutputTokens: 20_000, // headroom for Sol's reasoning tokens, drawn from the same budget
        system,
        prompt: `Port this to SGScript.${data.note ? `\nExtra instruction: ${data.note}` : ""}\n\n${data.source}`,
      });
      usage = accumulateUsage(usage, first.usage);

      let code = extract(first.text);
      if (!code) throw new Error("Translation produced no code");

      // The source is real Pine (or another language) we never re-derive, so we
      // can check the port against it directly: same failure mode buildProject
      // guards against (box.new zones silently downgraded to signal() markers),
      // just on the paste-a-script path instead of the describe-a-strategy path.
      const check = () => {
        const base = validateSgScript(code);
        const parity = visualParity(data.source, code);
        const issues = [...base.issues, ...parity];
        return { ok: !issues.some((i) => i.severity === "error"), issues };
      };

      let report = check();
      let attempts = 0;
      while (!report.ok && attempts < MAX_TRANSLATE_REPAIRS) {
        attempts++;
        const retry = await generateText({
          model: provider(SGSCRIPT_MODEL),
          temperature: 0,
          maxOutputTokens: 20_000,
          system,
          prompt: `Your previous port fails validation. Fix ONLY these problems and return the full corrected SGScript again, same fenced format:\n\n${formatIssues(report.issues)}\n\nOriginal source:\n${data.source}\n\nYour previous port:\n${code}`,
        });
        usage = accumulateUsage(usage, retry.usage);
        code = extract(retry.text) || code;
        report = check();
      }

      await recordAiUsage(context.supabase, {
        userId: context.userId,
        operation: "translate",
        success: true,
        model: SGSCRIPT_MODEL,
        usage,
      });
      return { code };
    } catch (e) {
      await recordAiUsage(context.supabase, {
        userId: context.userId,
        operation: "translate",
        success: false,
        model: SGSCRIPT_MODEL,
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        usage,
      });
      throw e;
    }
  });

// Repairs SGScript that failed to execute. The runtime error message is fed
// back to the model so a paste -> add-to-chart flow can self-heal instead of
// dead-ending on a syntax slip.
export const repairSgScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        source: z.string().min(1).max(60_000),
        error: z.string().max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");
    const provider = createOpenAiProvider(apiKey);

    try {
      const result = await generateText({
        model: provider(SGSCRIPT_MODEL),
        temperature: 0,
        maxOutputTokens: 20_000, // headroom for Sol's reasoning tokens, drawn from the same budget
        system: `You fix broken SGScript for the Signal Goat runtime.

${SGSCRIPT_REFERENCE}

Return ONLY the corrected full script in a single \`\`\`sgscript fenced block. No commentary.
Keep the original intent, inputs, plots and signals. Remove anything the runtime cannot execute
(imports, fetch, DOM, timers, eval, Function, classes). Use add/sub/mul/div for series math.`,
        prompt: `This SGScript failed with:\n${data.error}\n\nFix it:\n\n${data.source}`,
      });

      const fenced = /```(?:sgscript|js|javascript)?\s*\n([\s\S]*?)```/i.exec(result.text);
      const code = (fenced ? fenced[1] : result.text).trim();
      if (!code) throw new Error("Repair produced no code");

      await recordAiUsage(context.supabase, {
        userId: context.userId,
        operation: "repair",
        success: true,
        model: SGSCRIPT_MODEL,
        usage: {
          promptTokens: result.usage.inputTokens ?? null,
          completionTokens: result.usage.outputTokens ?? null,
          totalTokens: result.usage.totalTokens ?? null,
        },
      });
      return { code };
    } catch (e) {
      await recordAiUsage(context.supabase, {
        userId: context.userId,
        operation: "repair",
        success: false,
        model: SGSCRIPT_MODEL,
        errorMessage: e instanceof Error ? e.message : "Unknown error",
      });
      throw e;
    }
  });
