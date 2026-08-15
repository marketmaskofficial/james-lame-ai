import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SELECT =
  "id, account_id, position_id, symbol, timeframe, session, side, qty, entry_price, exit_price, realized_pnl, indicator_name, signal_id, notes, created_at";

export const listJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("journal_entries")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveJournalEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        accountId: z.string().uuid().optional(),
        positionId: z.string().uuid().optional(),
        symbol: z.string().trim().min(1).max(30),
        timeframe: z.string().trim().max(10).optional(),
        session: z.string().trim().max(40).optional(),
        side: z.enum(["buy", "sell"]).optional(),
        qty: z.number().positive().optional(),
        entryPrice: z.number().optional(),
        exitPrice: z.number().optional(),
        realizedPnl: z.number().optional(),
        indicatorName: z.string().trim().max(120).optional(),
        notes: z.string().max(8000).default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      account_id: data.accountId ?? null,
      position_id: data.positionId ?? null,
      symbol: data.symbol,
      timeframe: data.timeframe ?? null,
      session: data.session ?? null,
      side: data.side ?? null,
      qty: data.qty ?? null,
      entry_price: data.entryPrice ?? null,
      exit_price: data.exitPrice ?? null,
      realized_pnl: data.realizedPnl ?? null,
      indicator_name: data.indicatorName ?? null,
      notes: data.notes,
    };
    const q = data.id
      ? context.supabase.from("journal_entries").update(row).eq("id", data.id)
      : context.supabase.from("journal_entries").insert(row);
    const { data: saved, error } = await q.select(SELECT).single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteJournalEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("journal_entries")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
