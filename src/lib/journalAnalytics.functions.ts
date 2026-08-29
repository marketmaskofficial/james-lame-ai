import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLOSED_TRADE_VIEW_SELECT, mapClosedTradeViewRow, type ClosedTradeViewRow } from "@/lib/dashboard.functions";
import {
  buildJournalAnalyticsTrades,
  type JournalAnalyticsTrade,
  type RawEntryTermRow,
  type RawJournalEntryRow,
  type RawTaxonomyTermRow,
} from "@/lib/dashboard/journalAnalytics";
import type { ClosedTrade } from "@/lib/dashboard/metrics";

/**
 * Phase 4F — Journal Analytics server data path. Same security posture as
 * every prior phase: `requireSupabaseAuth` + `context.supabase` only,
 * RLS-scoped, explicit `user_id` scoping on every query, never
 * `supabaseAdmin`, never the OMS. Deliberately its OWN module rather than a
 * further extension of `trades.functions.ts` (already ~750 lines after
 * Phase 4E-2) — this file owns exactly one job: assembling the full,
 * untruncated `JournalAnalyticsTrade[]` dataset for a given account/date/
 * symbol filter, via a small fixed number of BATCHED query groups.
 *
 * PAGINATION (the Phase 4F audit's explicit requirement): Phase 4D's
 * `listClosedTradesPage` caps its fetch at `MAX_FETCH_ROWS` (2000) and
 * discloses `truncated: true` beyond that — acceptable for a paginated
 * trade-by-trade table, wrong for analytics that claims to summarize
 * "every" trade. This module instead PAGES through `v_closed_trades` in
 * fixed-size batches (`ANALYTICS_TRADE_BATCH_SIZE`) with a stable sort
 * (`closed_at desc, position_id asc` — the tiebreaker matters: without it,
 * rows sharing an identical `closed_at` could be split unpredictably across
 * page boundaries, silently duplicating or dropping a row), continuing
 * until a page comes back short (exhausted) or the result would exceed
 * `ANALYTICS_TRADE_HARD_CEILING` — a safety ceiling nearly 10x higher than
 * Phase 4D's, which should never be reached by a real account at today's
 * scale and only exists so a pathological account degrades with an honest
 * `truncated: true` rather than an unbounded server-side loop.
 *
 * The journal-side batched lookups (`journal_entries`, `journal_entry_
 * terms`, `journal_taxonomy_terms`) are each ONE logical query group, but
 * chunked internally via `fetchByIdsInChunks` when the id list is large —
 * PostgREST's `.in()` filter is passed as a URL query parameter, so an
 * unbounded id list risks exceeding practical URL-length limits at real
 * scale. This is still O(batches), never O(trades): a 5,000-trade account
 * costs a small constant number of extra requests per stage, never one
 * request per trade.
 */

export const ANALYTICS_TRADE_BATCH_SIZE = 1000;
/** Nearly 10x Phase 4D's 2000-row Trade Explorer cap, per the Phase 4F
 * audit's explicit instruction that any hard ceiling here must sit
 * significantly above that figure. */
export const ANALYTICS_TRADE_HARD_CEILING = 20000;
const ID_CHUNK_SIZE = 500;

const querySchema = z.object({
  accountId: z.string().uuid(),
  symbol: z.string().max(40).optional(),
  fromUtc: z.string().optional(),
  toUtc: z.string().optional(),
});

/** Splits `ids` into chunks of `ID_CHUNK_SIZE` and issues one `.in(...)`
 * query per chunk, concatenating the results — never one query per id. */
async function fetchByIdsInChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    out.push(...(await fetchChunk(chunk)));
  }
  return out;
}

type FetchAllClosedTradesArgs = { accountId: string; symbol?: string; fromUtc?: string; toUtc?: string };

/** Pages through `v_closed_trades` with a stable `(closed_at desc,
 * position_id asc)` order until exhausted or `ANALYTICS_TRADE_HARD_CEILING`
 * is reached. Returns every matching row (never silently capped at Phase
 * 4D's 2000) plus an honest `truncated` flag for the pathological-scale
 * case. */
async function fetchAllClosedTrades(supabase: SupabaseClient, args: FetchAllClosedTradesArgs): Promise<{ trades: ClosedTrade[]; truncated: boolean }> {
  const rows: ClosedTradeViewRow[] = [];
  let offset = 0;
  let truncated = false;

  for (;;) {
    let q = supabase
      .from("v_closed_trades" as never)
      .select(CLOSED_TRADE_VIEW_SELECT)
      .eq("account_id", args.accountId)
      .order("closed_at", { ascending: false })
      .order("position_id", { ascending: true })
      .range(offset, offset + ANALYTICS_TRADE_BATCH_SIZE - 1);
    if (args.symbol) q = q.eq("symbol", args.symbol);
    if (args.fromUtc) q = q.gte("closed_at", args.fromUtc);
    if (args.toUtc) q = q.lte("closed_at", args.toUtc);

    const { data, error } = await q.returns<ClosedTradeViewRow[]>();
    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);

    if (page.length < ANALYTICS_TRADE_BATCH_SIZE) break; // exhausted: last page was short
    if (rows.length >= ANALYTICS_TRADE_HARD_CEILING) {
      truncated = true;
      break;
    }
    offset += ANALYTICS_TRADE_BATCH_SIZE;
  }

  return { trades: rows.map(mapClosedTradeViewRow), truncated };
}

export type JournalAnalyticsResult = { trades: JournalAnalyticsTrade[]; truncated: boolean };

/**
 * The complete, untruncated (barring the pathological-scale ceiling above)
 * Journal Analytics dataset for one account/date/symbol filter — four
 * logical batched query groups regardless of trade count:
 *   1. Closed trades (paged, see `fetchAllClosedTrades`)
 *   2. `journal_entries` for the fetched positions
 *   3. `journal_entry_terms` for the resulting journal entries
 *   4. `journal_taxonomy_terms` for the resulting term ids (label lookup)
 * then assembled into `JournalAnalyticsTrade[]` by the pure
 * `buildJournalAnalyticsTrades` (`src/lib/dashboard/journalAnalytics.ts`) —
 * no join/assembly logic lives in this function itself, so it stays a thin,
 * readable I/O shell around a fully unit-tested pure core.
 */
export const listJournalAnalyticsTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => querySchema.parse(i))
  .handler(async ({ data, context }): Promise<JournalAnalyticsResult> => {
    const { trades, truncated } = await fetchAllClosedTrades(context.supabase, data);

    const positionIds = trades.map((t) => t.positionId);
    const journalEntries: RawJournalEntryRow[] =
      positionIds.length === 0
        ? []
        : await fetchByIdsInChunks(positionIds, async (chunk) => {
            const { data: rows, error } = await context.supabase
              .from("journal_entries" as never)
              .select("id, position_id, session, grade")
              .eq("user_id", context.userId)
              .in("position_id", chunk)
              .returns<RawJournalEntryRow[]>();
            if (error) throw new Error(error.message);
            return rows ?? [];
          });

    const entryIds = journalEntries.map((e) => e.id);
    const entryTerms: RawEntryTermRow[] =
      entryIds.length === 0
        ? []
        : await fetchByIdsInChunks(entryIds, async (chunk) => {
            const { data: rows, error } = await context.supabase
              .from("journal_entry_terms" as never)
              .select("journal_entry_id, term_id, kind")
              .eq("user_id", context.userId)
              .in("journal_entry_id", chunk)
              .returns<RawEntryTermRow[]>();
            if (error) throw new Error(error.message);
            return rows ?? [];
          });

    const termIds = [...new Set(entryTerms.map((et) => et.term_id))];
    const taxonomyTerms: RawTaxonomyTermRow[] =
      termIds.length === 0
        ? []
        : await fetchByIdsInChunks(termIds, async (chunk) => {
            const { data: rows, error } = await context.supabase
              .from("journal_taxonomy_terms" as never)
              .select("id, label")
              .eq("user_id", context.userId)
              .in("id", chunk)
              .returns<RawTaxonomyTermRow[]>();
            if (error) throw new Error(error.message);
            return rows ?? [];
          });

    return { trades: buildJournalAnalyticsTrades(trades, journalEntries, entryTerms, taxonomyTerms), truncated };
  });
