import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SELECT = "id, strategy_name, code, symbol, interval, settings, report, label, created_at";

const jsonRecord = z.record(z.string(), z.unknown());

/**
 * Saves a completed backtest run with enough attached to reproduce or
 * compare it later: the exact SGScript source (a strategy's risk/target
 * parameters are usually baked into the script, not just the run settings),
 * the settings used, and the full computed report so past results can be
 * browsed without re-running anything.
 */
export const saveBacktestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        strategyName: z.string().min(1).max(200),
        code: z.string().min(1).max(60_000),
        symbol: z.string().min(1).max(40),
        interval: z.string().min(1).max(10),
        settings: jsonRecord,
        report: jsonRecord,
        label: z.string().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("backtest_runs").insert({
      user_id: context.userId,
      strategy_name: data.strategyName,
      code: data.code,
      symbol: data.symbol,
      interval: data.interval,
      settings: data.settings as never,
      report: data.report as never,
      label: data.label ?? null,
    });
    if (error) throw new Error("Could not save this backtest run");
    return { ok: true };
  });

export const listBacktestRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("backtest_runs")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteBacktestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("backtest_runs")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
