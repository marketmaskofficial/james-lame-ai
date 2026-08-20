import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(20)
  .regex(/^[A-Z0-9]+$/, "Invalid symbol");

export const listWatchlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("watchlists")
      .select("id, symbol, label, position, created_at")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addToWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        symbol: symbolSchema,
        label: z.string().trim().max(40).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("watchlists")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (existing?.position ?? -1) + 1;

    const { data: row, error } = await supabase
      .from("watchlists")
      .insert({
        user_id: userId,
        symbol: data.symbol,
        label: data.label ?? null,
        position: nextPos,
      })
      .select("id, symbol, label, position, created_at")
      .single();
    if (error) {
      // 23505 = unique_violation (symbol already saved)
      if ((error as { code?: string }).code === "23505") {
        throw new Error("Symbol is already in your watchlist");
      }
      throw new Error(error.message);
    }
    return row;
  });

/**
 * UI-4h-3: persists a drag-reorder. Writes the existing `position` column
 * (already there for `listWatchlist`'s ordering — no migration) for every
 * symbol in the new order; anything not sent (there shouldn't be, the
 * caller always passes its full current list) is left untouched.
 */
export const reorderWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ symbols: z.array(symbolSchema).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const results = await Promise.all(
      data.symbols.map((symbol, position) =>
        supabase.from("watchlists").update({ position }).eq("symbol", symbol),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    return { ok: true };
  });

export const removeFromWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ symbol: symbolSchema })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("watchlists")
      .delete()
      .eq("symbol", data.symbol);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
