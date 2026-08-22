import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AiUsageSummary {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  last30dCalls: number;
  recent: Array<{
    id: string;
    operation: string;
    success: boolean;
    model: string | null;
    total_tokens: number | null;
    created_at: string;
  }>;
}

/**
 * Read-only summary for the Account -> Usage panel (UI-8 task 4). Reads
 * straight from `ai_usage_events` (see
 * supabase/migrations/20260822100001_ai_usage_events.sql, not applied as of
 * this phase) via the caller's own RLS-scoped client, so a user only ever
 * sees their own usage. Accounting/display only — nothing here enforces a
 * limit or blocks a request.
 *
 * Fails open to an all-zero summary if the table doesn't exist yet (or any
 * other read error), so the Account page never breaks because this
 * foundation's migration hasn't landed.
 */
export const getAiUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiUsageSummary> => {
    const empty: AiUsageSummary = {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      last30dCalls: 0,
      recent: [],
    };
    try {
      const { data, error } = await context.supabase
        .from("ai_usage_events")
        .select("id, operation, success, model, total_tokens, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = data ?? [];
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let successCount = 0;
      let totalTokens = 0;
      let last30dCalls = 0;
      for (const r of rows) {
        if (r.success) successCount++;
        if (typeof r.total_tokens === "number") totalTokens += r.total_tokens;
        if (new Date(r.created_at).getTime() >= thirtyDaysAgo) last30dCalls++;
      }
      return {
        totalCalls: rows.length,
        successCount,
        failureCount: rows.length - successCount,
        totalTokens,
        last30dCalls,
        recent: rows.slice(0, 20),
      };
    } catch (e) {
      console.warn("[ai-usage] summary read failed — returning empty summary", e);
      return empty;
    }
  });
