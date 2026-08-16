import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "@/lib/ai-gateway.server";
import { PROJECT_SYSTEM_PROMPT } from "@/lib/ai/project-prompt";
import { coerceSpec, type IndicatorSpec } from "@/lib/spec/types";
import { validatePine, formatIssues, type PineReport } from "@/lib/validate/pine";
import { validateSgScript, visualParity } from "@/lib/validate/sgscript";

const MODEL = "gpt-5.6-sol";
const MAX_REPAIRS = 3;

export type BuildResult = {
  spec: IndicatorSpec;
  pine: string;
  sgscript: string;
  summary: string;
  changelog: string;
  validation: {
    pine: PineReport;
    sgscript: { ok: boolean; issues: PineReport["issues"] };
    repairPasses: number;
    // Honest label: this is static analysis, never a TradingView compile.
    method: "static-validation";
  };
};

/**
 * Repairs the JS-isms models routinely emit around a large JSON payload:
 * `undefined` values, trailing commas and // comments outside strings.
 * Applied only after a strict parse fails, so valid output is never touched.
 */
function repairJsonish(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (input.startsWith("undefined", i)) {
      out += "null";
      i += "undefined".length - 1;
      continue;
    }
    if (ch === "," ) {
      // drop trailing commas before } or ]
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON project");
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    return JSON.parse(repairJsonish(slice)) as Record<string, unknown>;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Builds (or patches) a complete indicator project: specification, Pine twin
 * and SGScript runtime version — validated with a bounded self-correction loop.
 */
export const buildProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        request: z.string().min(1).max(20_000),
        currentSpec: z.record(z.string(), z.unknown()).optional(),
        currentPine: z.string().max(200_000).optional(),
        currentSgscript: z.string().max(200_000).optional(),
        symbol: z.string().max(40).optional(),
        timeframe: z.string().max(10).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }): Promise<BuildResult> => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured");
    const provider = createOpenAiProvider(apiKey);
    const model = provider(MODEL);

    const context = [
      data.symbol ? `Chart symbol: ${data.symbol}` : "",
      data.timeframe ? `Chart timeframe: ${data.timeframe}` : "",
      data.currentSpec
        ? `Existing specification to PATCH (change only what the instruction touches):\n${JSON.stringify(data.currentSpec)}`
        : "",
      data.currentSgscript
        ? `Existing SGScript:\n${data.currentSgscript.slice(0, 20_000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const call = async (prompt: string) => {
      const { text } = await generateText({
        model,
        temperature: 0.1,
        // Sol is a reasoning model: its internal "thinking" tokens are billed
        // from this same budget before any visible output, so this needs
        // real headroom above what the final Pine/SGScript text alone needs.
        maxOutputTokens: 32_000,
        system: PROJECT_SYSTEM_PROMPT,
        prompt,
      });
      return extractJson(text);
    };

    let json = await call(
      `${context ? `${context}\n\n` : ""}Trader request:\n${data.request}`,
    );

    let spec = coerceSpec(json["spec"]);
    let pine = str(json["pine"]);
    let sgscript = str(json["sgscript"]);
    let summary = str(json["summary"]);
    let changelog = str(json["changelog"]) || "Updated";

    // Static validation + Pine<->runtime visual parity in one report.
    const check = (pineSrc: string, sgSrc: string) => {
      const base = validateSgScript(sgSrc);
      const parity = visualParity(pineSrc, sgSrc);
      const issues = [...base.issues, ...parity];
      return { ok: !issues.some((i) => i.severity === "error"), issues };
    };

    let pineReport = validatePine(pine);
    let sgReport = check(pine, sgscript);
    let passes = 0;

    while ((!pineReport.ok || !sgReport.ok) && passes < MAX_REPAIRS) {
      passes++;
      const problems = [
        pineReport.ok ? "" : `Pine issues:\n${formatIssues(pineReport.issues)}`,
        sgReport.ok ? "" : `SGScript issues:\n${formatIssues(sgReport.issues)}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      json = await call(
        `The previous project failed static validation. Fix ONLY these problems and return the full JSON object again with the same specification intent.\n\n${problems}\n\nSpecification:\n${JSON.stringify(spec)}\n\nPine:\n${pine}\n\nSGScript:\n${sgscript}`,
      );

      spec = coerceSpec(json["spec"]);
      pine = str(json["pine"]) || pine;
      sgscript = str(json["sgscript"]) || sgscript;
      summary = str(json["summary"]) || summary;
      changelog = str(json["changelog"]) || changelog;
      pineReport = validatePine(pine);
      sgReport = check(pine, sgscript);
    }

    // The auditor's own classification is advisory; the static analyzer wins.
    spec = { ...spec, repaint: pineReport.repaint.classification };

    return {
      spec,
      pine,
      sgscript,
      summary,
      changelog,
      validation: {
        pine: pineReport,
        sgscript: sgReport,
        repairPasses: passes,
        method: "static-validation",
      },
    };
  });

/** Re-validates code the user edited by hand, without calling the model. */
export const validateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        pine: z.string().max(200_000).optional(),
        sgscript: z.string().max(200_000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => ({
    pine: data.pine ? validatePine(data.pine) : null,
    sgscript: data.sgscript
      ? (() => {
          const base = validateSgScript(data.sgscript!);
          const parity = data.pine ? visualParity(data.pine, data.sgscript!) : [];
          const issues = [...base.issues, ...parity];
          return { ok: !issues.some((i) => i.severity === "error"), issues };
        })()
      : null,
    method: "static-validation" as const,
  }));
