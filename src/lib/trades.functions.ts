import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLOSED_TRADE_VIEW_SELECT, mapClosedTradeViewRow, type ClosedTradeViewRow } from "@/lib/dashboard.functions";
import { isTruncated, queryClosedTrades, type Direction, type Outcome, type SessionFilter, type SortDir, type SortKey } from "@/lib/dashboard/tradeExplorer";

/**
 * Phase 4D — Trade Explorer server functions. Same rules as
 * `dashboard.functions.ts`: `requireSupabaseAuth` + `context.supabase`
 * only, RLS-scoped, never `supabaseAdmin`, never the OMS. Read-only with
 * respect to trading execution — nothing here writes to any OMS table.
 *
 * PAGINATION LIMITATION (disclosed, not silently papered over): `v_closed
 * _trades` has no computed `net_pnl`/`duration` column, so `direction`/
 * `outcome`/`session` filtering and `netPnl`/`duration` sorting cannot be
 * pushed down to SQL without a schema change — out of scope for this
 * phase. Account/date/symbol ARE real columns and are pushed to SQL
 * (`.eq`/`.gte`/`.lte`), which is what actually matters for scale: that
 * narrows the row set before anything reaches this function's JS layer.
 * What's fetched from SQL is then capped at `MAX_FETCH_ROWS` (2000,
 * ordered by `closed_at desc`) and the remaining filter/sort/paginate work
 * happens over that capped, already-narrowed set via
 * `queryClosedTrades` (`src/lib/dashboard/tradeExplorer.ts`). If a single
 * account/date-range/symbol combination ever exceeds 2000 closed trades,
 * `truncated: true` is returned so the UI can disclose that the result
 * set/count may be incomplete, rather than silently under-reporting.
 */

export const MAX_FETCH_ROWS = 2000;

const querySchema = z.object({
  accountId: z.string().uuid(),
  symbol: z.string().max(40).optional(),
  fromUtc: z.string().optional(),
  toUtc: z.string().optional(),
  direction: z.enum(["all", "long", "short"]).default("all"),
  outcome: z.enum(["all", "win", "loss", "breakeven"]).default("all"),
  session: z.enum(["all", "asia", "london", "overlap", "newYork", "offHours"]).default("all"),
  sortKey: z.enum(["closedAt", "symbol", "netPnl", "duration"]).default("closedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const listClosedTradesPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => querySchema.parse(i))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("v_closed_trades" as never)
      .select(CLOSED_TRADE_VIEW_SELECT)
      .eq("account_id", data.accountId)
      .order("closed_at", { ascending: false })
      .limit(MAX_FETCH_ROWS);
    if (data.symbol) q = q.eq("symbol", data.symbol);
    if (data.fromUtc) q = q.gte("closed_at", data.fromUtc);
    if (data.toUtc) q = q.lte("closed_at", data.toUtc);
    const { data: rows, error } = await q.returns<ClosedTradeViewRow[]>();
    if (error) throw new Error(error.message);

    const trades = (rows ?? []).map(mapClosedTradeViewRow);
    const truncated = isTruncated(trades.length, MAX_FETCH_ROWS);

    const result = queryClosedTrades(trades, {
      accountId: data.accountId,
      symbol: data.symbol,
      fromUtc: data.fromUtc,
      toUtc: data.toUtc,
      direction: data.direction as Direction,
      outcome: data.outcome as Outcome,
      session: data.session as SessionFilter,
      sortKey: data.sortKey as SortKey,
      sortDir: data.sortDir as SortDir,
      page: data.page,
      pageSize: data.pageSize,
    });

    return { ...result, truncated };
  });

/** Real fills for one closed position — used only by the Trade Explorer's
 * detail drawer, fetched on demand (not per table row). RLS on
 * `trade_executions` (`auth.uid() = user_id`) already scopes this to the
 * caller's own data; the explicit `.eq("user_id", ...)` is defense-in-depth
 * matching `listDashboardAccounts`'s own established convention, not the
 * actual security boundary. */
export type TradeExecutionRow = {
  id: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  commission: number;
  executed_at: string;
};

export const listExecutionsForPosition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trade_executions")
      .select("id, side, qty, price, commission, executed_at")
      .eq("position_id", data.positionId)
      .eq("user_id", context.userId)
      .order("executed_at", { ascending: true })
      .returns<TradeExecutionRow[]>();
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** The (at most one, in practice) real journal entry linked to a closed
 * position, read-only fields the Trade Explorer's editable journal editor
 * (`saveTradeJournalForPosition`, below) actually shows.
 * `journal_entries.position_id` has no uniqueness constraint (see the
 * Phase 4E audit — a partial unique index is deferred to a future
 * migration), so this reads the most recent match by `created_at` rather
 * than assuming exactly one row exists. */
export type JournalEntryForPosition = {
  id: string;
  notes: string;
  session: string | null;
  updated_at: string;
};

export const getJournalEntryForPosition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("journal_entries")
      .select("id, notes, session, updated_at")
      .eq("position_id", data.positionId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<JournalEntryForPosition[]>();
    if (error) throw new Error(error.message);
    return rows?.[0] ?? null;
  });

const JOURNAL_SESSION_VALUES = ["asia", "london", "overlap", "newYork", "offHours"] as const;

const saveTradeJournalSchema = z.object({
  positionId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(30),
  notes: z.string().max(8000),
  session: z.enum(JOURNAL_SESSION_VALUES).nullable(),
});

/**
 * Phase 4E-1 — the Trade Explorer journal editor's dedicated write path.
 * Deliberately NOT a thin wrapper around the generic `saveJournalEntry`
 * (`journal.functions.ts`), which performs a full-row overwrite (every
 * column, including ones this editor has no opinion on, gets rewritten to
 * `null` if omitted) and has no position-ownership check of its own — both
 * wrong for this narrow, position-scoped feature. See the Phase 4E audit.
 *
 * This editor owns exactly two fields: `notes` and `session`. On UPDATE it
 * writes ONLY those two columns — `timeframe`, `side`, `qty`,
 * `entry_price`, `exit_price`, `realized_pnl`, `indicator_name`,
 * `signal_id`, and `chart_state` are never touched, so a future phase that
 * starts populating those via a different path can never be silently
 * clobbered by a Trade Explorer journal save. On INSERT it additionally
 * sets the required linkage/identity fields (`user_id`, `account_id`,
 * `position_id`, `symbol`).
 *
 * DUPLICATE PREVENTION (application-level, per the audit): the database
 * has no unique constraint on `(user_id, position_id)` yet — a future
 * partial unique index (`WHERE position_id IS NOT NULL`) is the real,
 * race-proof fix and is deliberately deferred, not added here. Until then,
 * this handler enforces "one entry per position" itself: it looks up the
 * most recent existing row for `(user_id, position_id)` and UPDATEs it if
 * found, INSERTs only if none exists. This does not close a race between
 * two concurrent saves for a brand-new position (both could pass the
 * "none exists" check before either inserts), but it does guarantee that
 * repeatedly pressing Save on an already-loaded entry never creates a
 * second row — the actual failure mode this phase must prevent.
 */
export type TradeJournalEntry = {
  id: string;
  notes: string;
  session: string | null;
  updated_at: string;
};

export const saveTradeJournalForPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => saveTradeJournalSchema.parse(i))
  .handler(async ({ data, context }) => {
    // Explicit ownership check (belt-and-suspenders alongside RLS, matching
    // this codebase's own convention elsewhere): a position_id supplied by
    // the client is only ever accepted if it resolves to a row the caller
    // actually owns. RLS on `trade_positions` ("Users view own positions")
    // already makes a mismatched id resolve to zero rows here regardless —
    // this check makes that guarantee explicit in the feature's own code
    // rather than relying solely on the table-level policy.
    const { data: position, error: positionError } = await context.supabase
      .from("trade_positions")
      .select("id")
      .eq("id", data.positionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (positionError) throw new Error(positionError.message);
    if (!position) throw new Error("Position not found for the current user.");

    const { data: existingRows, error: existingError } = await context.supabase
      .from("journal_entries")
      .select("id")
      .eq("position_id", data.positionId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    const existing = existingRows?.[0];

    if (existing) {
      const { data: saved, error } = await context.supabase
        .from("journal_entries")
        .update({ notes: data.notes, session: data.session })
        .eq("id", existing.id)
        .eq("user_id", context.userId)
        .select("id, notes, session, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return saved as TradeJournalEntry;
    }

    const { data: saved, error } = await context.supabase
      .from("journal_entries")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        position_id: data.positionId,
        symbol: data.symbol,
        notes: data.notes,
        session: data.session,
      })
      .select("id, notes, session, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return saved as TradeJournalEntry;
  });
