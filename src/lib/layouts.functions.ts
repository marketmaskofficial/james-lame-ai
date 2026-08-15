import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const keySchema = z.object({
  layout: z.string().trim().min(1).max(40).default("default"),
  symbol: z.string().trim().min(1).max(30),
  timeframe: z.string().trim().min(1).max(10),
});

export const loadChartDrawings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => keySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("chart_drawings")
      .select("drawings")
      .eq("layout", data.layout)
      .eq("symbol", data.symbol)
      .eq("timeframe", data.timeframe)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Drawings are opaque to the server, so they cross the RPC boundary as JSON text.
    return { json: JSON.stringify(row?.drawings ?? []) };
  });

export const saveChartDrawings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    keySchema.extend({ json: z.string().max(400_000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let parsed: Json;
    try {
      parsed = JSON.parse(data.json) as Json;
    } catch {
      throw new Error("Invalid drawings payload");
    }
    if (!Array.isArray(parsed)) throw new Error("Invalid drawings payload");
    const { error } = await context.supabase.from("chart_drawings").upsert(
      {
        user_id: context.userId,
        layout: data.layout,
        symbol: data.symbol,
        timeframe: data.timeframe,
        drawings: parsed,
      },
      { onConflict: "user_id,layout,symbol,timeframe" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
