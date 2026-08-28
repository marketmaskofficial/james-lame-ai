import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ClosedTrade } from "@/lib/dashboard/metrics";

/**
 * Trading Dashboard server functions (Phase 4A). Reads real, durable OMS
 * data through the authenticated user's own RLS-scoped Supabase client
 * (`context.supabase`, from `requireSupabaseAuth` — never a service-role
 * client) — nothing here can read another user's trades, and nothing here
 * writes to any OMS table. Dashboard is read-only with respect to trading
 * execution.
 *
 * The account list itself is NOT duplicated here — `listTradingAccounts`
 * (`src/lib/trading.functions.ts`) already returns every field the
 * dashboard's account selector needs (label, environment, starting_balance,
 * balance, realized_pnl), and it's the exact same list Chart Studio's own
 * `AccountBar` renders, so the two surfaces can never disagree about which
 * accounts exist.
 */

const SELECT =
  "position_id, user_id, account_id, symbol, side, qty, avg_entry, realized_pnl, opened_at, closed_at, commission, fill_count, exit_price";

/**
 * The `v_closed_trades` view's exact row shape (Supabase migration
 * `20260828130000_v_closed_trades.sql`), verified column-for-column against
 * the live Lovable Cloud project by direct SQL Editor query. This is the
 * dashboard's own narrow, explicit, hand-written substitute for what
 * `src/integrations/supabase/types.ts` would normally provide — that file
 * is machine-generated from Lovable Cloud's schema introspection, which
 * this repo has no way to trigger for itself (there is no direct Supabase
 * CLI/project link; Lovable Cloud is the source of truth and regenerates
 * that file on its own workflow). Numeric Postgres columns are typed
 * `number | string` because `numeric`/`bigint` can come back over the wire
 * as either depending on the client/PostgREST version — every consumer
 * goes through `listClosedTrades` below, which normalizes with `Number(...)`
 * before this type is ever exposed further, so nothing downstream (the
 * `ClosedTrade` model in `src/lib/dashboard/metrics.ts`, or any dashboard
 * component) ever has to deal with that ambiguity itself.
 */
export type ClosedTradeViewRow = {
  position_id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number | string;
  avg_entry: number | string;
  realized_pnl: number | string;
  opened_at: string;
  closed_at: string;
  commission: number | string;
  fill_count: number | string;
  exit_price: number | string | null;
};

/**
 * Real closed trades for one account, optionally narrowed by symbol/date
 * range — queries the `v_closed_trades` view, never `trade_executions`
 * directly and never a backtest table. Date filtering is always against
 * `closed_at` per the Phase 4A product decision (never `opened_at`).
 *
 * `"v_closed_trades" as never`: the ONE relation-name cast this whole
 * feature needs, deliberately isolated to this single `.from(...)` call —
 * see `ClosedTradeViewRow` just above for why `types.ts` doesn't know this
 * view yet, and note that everything past this line (the `.returns<...>()`
 * call, the mapping into `ClosedTrade`, every dashboard component) is fully
 * and normally typed with no further casts. Remove this cast the next time
 * Lovable Cloud regenerates `src/integrations/supabase/types.ts` and that
 * regeneration includes `v_closed_trades` (it now exists in the live
 * schema, confirmed by direct SQL Editor query — it's purely a matter of
 * this repo's generated types catching up).
 */
export const listClosedTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        symbol: z.string().max(40).optional(),
        fromUtc: z.string().optional(),
        toUtc: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("v_closed_trades" as never)
      .select(SELECT)
      .eq("account_id", data.accountId)
      .order("closed_at", { ascending: true });
    if (data.symbol) q = q.eq("symbol", data.symbol);
    if (data.fromUtc) q = q.gte("closed_at", data.fromUtc);
    if (data.toUtc) q = q.lte("closed_at", data.toUtc);
    const { data: rows, error } = await q.returns<ClosedTradeViewRow[]>();
    if (error) throw new Error(error.message);
    return (rows ?? []).map(
      (r): ClosedTrade => ({
        positionId: r.position_id,
        userId: r.user_id,
        accountId: r.account_id,
        symbol: r.symbol,
        side: r.side,
        qty: Number(r.qty),
        avgEntry: Number(r.avg_entry),
        realizedPnl: Number(r.realized_pnl),
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        commission: Number(r.commission),
        fillCount: Number(r.fill_count),
        exitPrice: r.exit_price == null ? null : Number(r.exit_price),
      }),
    );
  });
