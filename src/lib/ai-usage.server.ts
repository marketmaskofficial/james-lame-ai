import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every distinct AI-generation call site in the app, matching the
 * `ai_usage_events.operation` CHECK constraint in
 * supabase/migrations/20260822100001_ai_usage_events.sql:
 *   - build / modify / fix_error -> Chart Studio's AI Builder (all three
 *     route through `buildProject` in src/lib/project.functions.ts; the
 *     caller tells it which one this call is for)
 *   - translate / repair -> the paste-a-script flows in
 *     src/lib/sgscript.functions.ts
 *   - analyze -> src/lib/analyze.functions.ts
 *   - generate -> the legacy /api/generate route
 * "explain" is deliberately NOT here: AiSidePanel's Explain turn
 * (src/lib/spec/explain.ts) is pure client-side templating over the
 * existing spec, it never calls the model, so there is no AI usage to
 * record for it.
 */
export type AiOperation =
  | "build"
  | "modify"
  | "fix_error"
  | "translate"
  | "repair"
  | "analyze"
  | "generate";

export interface AiUsageTokens {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

/**
 * Best-effort accounting write for the AI usage foundation (UI-8 task 4).
 * This is intentionally NEVER allowed to affect the AI request it's
 * recording: any failure (including the `ai_usage_events` table not
 * existing yet, since its migration is created but not applied as of this
 * phase — see supabase/migrations/20260822100001_ai_usage_events.sql) is
 * swallowed and logged, not thrown. Accounting only — no limits/credits are
 * read or enforced from here.
 *
 * Always insert with the CALLER's own RLS-scoped Supabase client (never a
 * service-role client) so a user can only ever write usage rows attributed
 * to themselves, matching the table's RLS policy.
 */
export async function recordAiUsage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    operation: AiOperation;
    success: boolean;
    model?: string | null;
    errorMessage?: string | null;
    usage?: AiUsageTokens | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage_events").insert({
      user_id: params.userId,
      operation: params.operation,
      success: params.success,
      model: params.model ?? null,
      error_message: params.errorMessage?.slice(0, 2000) ?? null,
      prompt_tokens: params.usage?.promptTokens ?? null,
      completion_tokens: params.usage?.completionTokens ?? null,
      total_tokens: params.usage?.totalTokens ?? null,
    });
    if (error) throw error;
  } catch (e) {
    console.warn("[ai-usage] failed to record usage event (non-fatal)", e);
  }
}

/** Sums per-call `LanguageModelUsage`-shaped token counts across a bounded
 * self-correction loop (build/translate retries) into one usage event per
 * logical user-facing request, treating any missing field as unknown rather
 * than zero so a provider that never reports usage doesn't get recorded as
 * "0 tokens". */
export function accumulateUsage(
  totals: AiUsageTokens,
  next: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
): AiUsageTokens {
  if (!next) return totals;
  return {
    promptTokens: addOrKeep(totals.promptTokens, next.inputTokens),
    completionTokens: addOrKeep(totals.completionTokens, next.outputTokens),
    totalTokens: addOrKeep(totals.totalTokens, next.totalTokens),
  };
}

function addOrKeep(current: number | null | undefined, add: number | undefined): number | null {
  if (add === undefined) return current ?? null;
  return (current ?? 0) + add;
}
