import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { SGSCRIPT_REFERENCE } from "@/lib/sgscript/examples";

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
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");
    const provider = createLovableAiGatewayProvider(apiKey);

    const { text } = await generateText({
      model: provider("google/gemini-3.1-pro-preview"),
      temperature: 0.1,
      maxOutputTokens: 12_000,
      system: `You port trading indicators into SGScript, the Signal Goat runtime language. The source may be Pine Script v4/v5/v6, MQL, ThinkScript, EasyLanguage, pseudo-code, broken SGScript, or a plain-English description — always produce working SGScript.

${SGSCRIPT_REFERENCE}

Output ONLY the SGScript code inside a single \`\`\`sgscript fenced block. No commentary.
Reproduce the source logic faithfully: same inputs, same conditions, same plots, boxes, labels and buy/sell signals.
Never emit Pine Script syntax. Never emit imports, fetch, DOM or timers.
Every array arithmetic must use add/sub/mul/div. Guard values with Number.isFinite before drawing.`,
      prompt: `Port this to SGScript.${data.note ? `\nExtra instruction: ${data.note}` : ""}\n\n${data.source}`,
    });

    const fenced = /```(?:sgscript|js|javascript)?\s*\n([\s\S]*?)```/i.exec(text);
    const code = (fenced ? fenced[1] : text).trim();
    if (!code) throw new Error("Translation produced no code");
    return { code };
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
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");
    const provider = createLovableAiGatewayProvider(apiKey);

    const { text } = await generateText({
      model: provider("google/gemini-3.1-pro-preview"),
      temperature: 0,
      maxOutputTokens: 12_000,
      system: `You fix broken SGScript for the Signal Goat runtime.

${SGSCRIPT_REFERENCE}

Return ONLY the corrected full script in a single \`\`\`sgscript fenced block. No commentary.
Keep the original intent, inputs, plots and signals. Remove anything the runtime cannot execute
(imports, fetch, DOM, timers, eval, Function, classes). Use add/sub/mul/div for series math.`,
      prompt: `This SGScript failed with:\n${data.error}\n\nFix it:\n\n${data.source}`,
    });

    const fenced = /```(?:sgscript|js|javascript)?\s*\n([\s\S]*?)```/i.exec(text);
    const code = (fenced ? fenced[1] : text).trim();
    if (!code) throw new Error("Repair produced no code");
    return { code };
  });
