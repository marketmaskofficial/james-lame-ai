import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createOpenAiProvider } from "@/lib/ai-gateway.server";
import { recordAiUsage, accumulateUsage, type AiUsageTokens } from "@/lib/ai-usage.server";
import { CLOSED_TRADE_VIEW_SELECT, mapClosedTradeViewRow, type ClosedTradeViewRow } from "@/lib/dashboard.functions";
import {
  isTruncated,
  queryClosedTrades,
  type Direction,
  type Outcome,
  type SessionFilter,
  type SortDir,
  type SortKey,
  type JournalFilter,
} from "@/lib/dashboard/tradeExplorer";
import { SINGLE_SELECT_KINDS, type TaxonomyKind } from "@/lib/dashboard/journalTaxonomy";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 4D/4E — Trade Explorer server functions. Same rules throughout:
 * `requireSupabaseAuth` + `context.supabase` only, RLS-scoped, never
 * `supabaseAdmin`, never the OMS. Read-only with respect to trading
 * execution — nothing here writes to any OMS table.
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
 *
 * Several tables added in the Phase 4E-2 migration
 * (`journal_taxonomy_terms`, `journal_entry_terms`, `journal_screenshots`,
 * `journal_ai_reviews`) and the new `journal_entries.grade` column are not
 * reflected in the checked-in generated `Database` type (there is no
 * live-DB introspection tool available in this environment to regenerate
 * it), so every query against them casts the table name `as never` —
 * exactly the same pattern already used for `v_closed_trades` below,
 * disabling compile-time shape-checking for that call chain while every
 * actual row shape is still asserted via an explicit `.returns<T>()`.
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
  journal: z.enum(["all", "journaled", "notJournaled"]).default("all"),
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

    // ONE batched query for which of the fetched positions have a journal
    // entry — never per-row/N+1. Feeds both the "journaled/not journaled"
    // filter and the (paginated-row-only) journal indicator flag.
    const positionIds = trades.map((t) => t.positionId);
    let journaledIds = new Set<string>();
    if (positionIds.length > 0) {
      const { data: journalRows, error: journalError } = await context.supabase
        .from("journal_entries")
        .select("position_id")
        .eq("user_id", context.userId)
        .in("position_id", positionIds)
        .returns<{ position_id: string }[]>();
      if (journalError) throw new Error(journalError.message);
      journaledIds = new Set((journalRows ?? []).map((r) => r.position_id));
    }

    const result = queryClosedTrades(
      trades,
      {
        accountId: data.accountId,
        symbol: data.symbol,
        fromUtc: data.fromUtc,
        toUtc: data.toUtc,
        direction: data.direction as Direction,
        outcome: data.outcome as Outcome,
        session: data.session as SessionFilter,
        journalFilter: data.journal as JournalFilter,
        sortKey: data.sortKey as SortKey,
        sortDir: data.sortDir as SortDir,
        page: data.page,
        pageSize: data.pageSize,
      },
      journaledIds,
    );

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

// ---------------------------------------------------------------------
// Shared journal-entry helpers — used by every metadata/terms/screenshot/
// AI-review write path below so the position-ownership check and the
// "does an entry already exist for this position" lookup are never
// duplicated (and therefore never drift) across functions.
// ---------------------------------------------------------------------

/** Several Phase 4E-2 tables (and `journal_entries.grade`) aren't in the
 * generated `Database` type — there is no live-DB introspection tool
 * available in this environment to regenerate `types.ts` after applying
 * the migration. Casting the table NAME `as never` (the pattern already
 * used elsewhere in this file for read-only `v_closed_trades` queries)
 * works for `.select()` chains, but makes `.insert()`/`.update()` expect a
 * `never`-shaped payload — this helper casts the BUILDER itself instead,
 * narrowly, only for write calls against those tables. Every row shape
 * actually read back is still asserted via an explicit `.returns<T>()` or
 * type annotation at the call site, so this never silently trusts an
 * unchecked shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawTable(supabase: SupabaseClient, table: string): any {
  return supabase.from(table);
}

/** Explicit ownership check (belt-and-suspenders alongside RLS, matching
 * this codebase's own convention elsewhere): a position_id supplied by the
 * client is only ever accepted if it resolves to a row the caller actually
 * owns. RLS on `trade_positions` ("Users view own positions") already
 * makes a mismatched id resolve to zero rows regardless — this check makes
 * that guarantee explicit in the feature's own code. */
async function requireOwnedPosition(supabase: SupabaseClient, positionId: string, userId: string): Promise<void> {
  const { data: position, error } = await supabase.from("trade_positions").select("id").eq("id", positionId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!position) throw new Error("Position not found for the current user.");
}

/** Most recent existing journal entry id for `(user_id, position_id)`, or
 * `null` if none exists. `journal_entries.position_id` had no uniqueness
 * constraint before the Phase 4E-2 migration's
 * `journal_entries_one_per_position` partial unique index — this still
 * orders by `created_at desc` defensively in case any pre-migration
 * duplicate ever existed (none did, per the migration's own safety audit,
 * but this keeps the read correct even if that ever changed). */
async function findExistingJournalEntryId(supabase: SupabaseClient, positionId: string, userId: string): Promise<string | null> {
  const { data: rows, error } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("position_id", positionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return rows?.[0]?.id ?? null;
}

/** Finds the existing journal entry for this position, or creates a blank
 * one (empty notes, no session/grade/metadata) so terms/screenshots have
 * something to attach to even if the user adds a Setup or a screenshot
 * before ever typing a note. */
async function ensureJournalEntryId(
  supabase: SupabaseClient,
  params: { positionId: string; userId: string; accountId: string; symbol: string },
): Promise<string> {
  const existing = await findExistingJournalEntryId(supabase, params.positionId, params.userId);
  if (existing) return existing;
  const { data: saved, error } = await rawTable(supabase, "journal_entries")
    .insert({ user_id: params.userId, account_id: params.accountId, position_id: params.positionId, symbol: params.symbol })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (saved as { id: string }).id;
}

/** Escapes Postgres `LIKE`/`ILIKE` wildcard characters so `ilike` can be
 * used for an exact, case-insensitive string match (matching the
 * `journal_taxonomy_terms` unique index's `lower(label)` semantics)
 * without treating a user-typed `%` or `_` as a pattern wildcard. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** The (at most one, since the Phase 4E-2 migration's partial unique
 * index) real journal entry linked to a closed position — the fields the
 * Trade Explorer's editable journal editor (`saveTradeJournalForPosition`,
 * below) shows directly. */
export type JournalEntryForPosition = {
  id: string;
  notes: string;
  session: string | null;
  grade: string | null;
  updated_at: string;
};

export const getJournalEntryForPosition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("journal_entries" as never)
      .select("id, notes, session, grade, updated_at")
      .eq("position_id", data.positionId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<JournalEntryForPosition[]>();
    if (error) throw new Error(error.message);
    return rows?.[0] ?? null;
  });

const JOURNAL_SESSION_VALUES = ["asia", "london", "overlap", "newYork", "offHours"] as const;
const GRADE_VALUES = ["A+", "A", "B", "C", "D", "F"] as const;

const saveTradeJournalSchema = z.object({
  positionId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(30),
  notes: z.string().max(8000),
  session: z.enum(JOURNAL_SESSION_VALUES).nullable(),
  grade: z.enum(GRADE_VALUES).nullable(),
});

/**
 * Phase 4E-1/4E-2 — the Trade Explorer journal editor's dedicated write
 * path. Deliberately NOT a thin wrapper around the generic
 * `saveJournalEntry` (`journal.functions.ts`), which performs a full-row
 * overwrite (every column, including ones this editor has no opinion on,
 * gets rewritten to `null` if omitted) and has no position-ownership check
 * of its own — both wrong for this narrow, position-scoped feature. See
 * the Phase 4E audit.
 *
 * This editor owns `notes`, `session`, and (as of Phase 4E-2) `grade` — a
 * plain, fixed-enum column on the same row, not a taxonomy term, so it
 * belongs in this same narrow save alongside notes/session rather than a
 * separate function. On UPDATE it writes ONLY those three columns —
 * `timeframe`, `side`, `qty`, `entry_price`, `exit_price`, `realized_pnl`,
 * `indicator_name`, `signal_id`, and `chart_state` are never touched, so a
 * future phase that starts populating those via a different path can never
 * be silently clobbered by a Trade Explorer journal save. On INSERT it
 * additionally sets the required linkage/identity fields (`user_id`,
 * `account_id`, `position_id`, `symbol`).
 *
 * DUPLICATE PREVENTION: the Phase 4E-2 migration added
 * `journal_entries_one_per_position`, a partial unique index on
 * `(user_id, position_id) WHERE position_id IS NOT NULL`, closing the race
 * the Phase 4E-1 audit had deferred. This handler still does its own
 * existing-row lookup first (via `findExistingJournalEntryId`) so the
 * common case (edit an already-loaded entry) is a plain UPDATE rather than
 * relying on the constraint to reject a would-be duplicate INSERT.
 */
export type TradeJournalEntry = {
  id: string;
  notes: string;
  session: string | null;
  grade: string | null;
  updated_at: string;
};

export const saveTradeJournalForPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => saveTradeJournalSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requireOwnedPosition(context.supabase, data.positionId, context.userId);
    const existingId = await findExistingJournalEntryId(context.supabase, data.positionId, context.userId);

    if (existingId) {
      const { data: saved, error } = await rawTable(context.supabase, "journal_entries")
        .update({ notes: data.notes, session: data.session, grade: data.grade })
        .eq("id", existingId)
        .eq("user_id", context.userId)
        .select("id, notes, session, grade, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return saved as TradeJournalEntry;
    }

    const { data: saved, error } = await rawTable(context.supabase, "journal_entries")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        position_id: data.positionId,
        symbol: data.symbol,
        notes: data.notes,
        session: data.session,
        grade: data.grade,
      })
      .select("id, notes, session, grade, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return saved as TradeJournalEntry;
  });

// ---------------------------------------------------------------------
// Taxonomy (Setup / Strategy / Mistakes / Emotion / Tags) — Phase 4E-2.
// See supabase/migrations/20260829140000_journal_taxonomy_and_reviews.sql
// for the unified `journal_taxonomy_terms` + `journal_entry_terms` design.
// ---------------------------------------------------------------------

export type JournalTerm = { kind: TaxonomyKind; label: string };

/** Terms currently attached to one position's journal entry. Two simple
 * queries (link rows, then their labels) rather than a Supabase embedded
 * relation select — avoids depending on generated-type-aware relation
 * inference for tables `types.ts` doesn't know about yet. */
export const listJournalEntryTerms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const entryId = await findExistingJournalEntryId(context.supabase, data.positionId, context.userId);
    if (!entryId) return [] as JournalTerm[];

    const { data: linkRows, error: linkError } = await context.supabase
      .from("journal_entry_terms" as never)
      .select("term_id, kind")
      .eq("journal_entry_id", entryId)
      .eq("user_id", context.userId)
      .returns<{ term_id: string; kind: TaxonomyKind }[]>();
    if (linkError) throw new Error(linkError.message);
    if (!linkRows || linkRows.length === 0) return [] as JournalTerm[];

    const { data: termRows, error: termError } = await context.supabase
      .from("journal_taxonomy_terms" as never)
      .select("id, label")
      .in(
        "id",
        linkRows.map((r) => r.term_id),
      )
      .eq("user_id", context.userId)
      .returns<{ id: string; label: string }[]>();
    if (termError) throw new Error(termError.message);

    const labelById = new Map((termRows ?? []).map((t) => [t.id, t.label]));
    return linkRows.map((r) => ({ kind: r.kind, label: labelById.get(r.term_id) ?? "" })).filter((t) => t.label);
  });

/** The user's own full taxonomy across every kind — merged client-side
 * with the seeded suggestion constants (`journalTaxonomy.ts`) to build
 * each field's autocomplete list. Never seeded server-side: a term only
 * exists here once a user has actually used it once (see the migration's
 * own doc comment). */
export const listJournalTaxonomySuggestions = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: rows, error } = await context.supabase
    .from("journal_taxonomy_terms" as never)
    .select("kind, label")
    .eq("user_id", context.userId)
    .order("label", { ascending: true })
    .returns<JournalTerm[]>();
  if (error) throw new Error(error.message);
  return rows ?? [];
});

const saveJournalTermsSchema = z.object({
  positionId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(30),
  kind: z.enum(["setup", "strategy", "mistake", "emotion", "tag"]),
  labels: z.array(z.string().trim().min(1).max(60)).max(50),
});

/** Replaces the full set of terms attached to one (entry, kind) pair —
 * find-or-create a canonical `journal_taxonomy_terms` row for every
 * desired label (case-insensitive match against the user's own existing
 * terms for that kind), then delete+reinsert the `journal_entry_terms`
 * links for that kind. Simple delete-then-reinsert is correct and fast
 * enough here since a trade realistically has at most a handful of
 * mistakes/tags. For `setup`/`strategy`/`emotion` (single-select), `labels`
 * must contain 0 or 1 entries — enforced here as a friendly error in
 * addition to the DB's own `journal_entry_terms_single_select` partial
 * unique index. */
export const saveJournalTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => saveJournalTermsSchema.parse(i))
  .handler(async ({ data, context }) => {
    if ((SINGLE_SELECT_KINDS as readonly string[]).includes(data.kind) && data.labels.length > 1) {
      throw new Error(`Only one ${data.kind} may be selected per trade.`);
    }

    await requireOwnedPosition(context.supabase, data.positionId, context.userId);
    const entryId = await ensureJournalEntryId(context.supabase, {
      positionId: data.positionId,
      userId: context.userId,
      accountId: data.accountId,
      symbol: data.symbol,
    });

    const desiredLabels = Array.from(new Map(data.labels.map((l) => [l.toLowerCase(), l])).values());

    const termIds: string[] = [];
    for (const label of desiredLabels) {
      const { data: existingTerm, error: findErr } = await context.supabase
        .from("journal_taxonomy_terms" as never)
        .select("id")
        .eq("user_id", context.userId)
        .eq("kind", data.kind)
        .ilike("label", escapeLikePattern(label))
        .maybeSingle()
        .returns<{ id: string } | null>();
      if (findErr) throw new Error(findErr.message);

      if (existingTerm) {
        termIds.push(existingTerm.id);
      } else {
        const { data: createdTerm, error: createErr } = await rawTable(context.supabase, "journal_taxonomy_terms")
          .insert({ user_id: context.userId, kind: data.kind, label })
          .select("id")
          .single();
        if (createErr) throw new Error(createErr.message);
        termIds.push((createdTerm as { id: string }).id);
      }
    }

    const { error: deleteError } = await context.supabase
      .from("journal_entry_terms" as never)
      .delete()
      .eq("journal_entry_id", entryId)
      .eq("user_id", context.userId)
      .eq("kind", data.kind);
    if (deleteError) throw new Error(deleteError.message);

    if (termIds.length > 0) {
      const { error: insertError } = await rawTable(context.supabase, "journal_entry_terms").insert(
        termIds.map((termId) => ({ journal_entry_id: entryId, term_id: termId, user_id: context.userId, kind: data.kind })),
      );
      if (insertError) throw new Error(insertError.message);
    }

    return { kind: data.kind, labels: desiredLabels };
  });

// ---------------------------------------------------------------------
// Screenshots — Phase 4E-2. The client uploads the file directly to
// Supabase Storage (see src/lib/storage/journalScreenshots.ts, mirroring
// the existing chart-images pattern) and then calls
// `recordJournalScreenshot` with the resulting path; only the PATH is ever
// persisted, never raw bytes.
// ---------------------------------------------------------------------

const JOURNAL_SCREENSHOTS_BUCKET = "journal-screenshots";
const SCREENSHOT_SIGNED_URL_TTL_SECONDS = 60 * 60;

export type JournalScreenshot = { id: string; signedUrl: string };

export const listJournalScreenshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const entryId = await findExistingJournalEntryId(context.supabase, data.positionId, context.userId);
    if (!entryId) return [] as JournalScreenshot[];

    const { data: rows, error } = await context.supabase
      .from("journal_screenshots" as never)
      .select("id, storage_path")
      .eq("journal_entry_id", entryId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .returns<{ id: string; storage_path: string }[]>();
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];

    const results: JournalScreenshot[] = [];
    for (const row of rows) {
      const { data: signed, error: signError } = await context.supabase.storage
        .from(JOURNAL_SCREENSHOTS_BUCKET)
        .createSignedUrl(row.storage_path, SCREENSHOT_SIGNED_URL_TTL_SECONDS);
      // Skip (rather than fail the whole list) a screenshot whose
      // underlying object can't be signed — e.g. removed out-of-band.
      if (signError || !signed?.signedUrl) continue;
      results.push({ id: row.id, signedUrl: signed.signedUrl });
    }
    return results;
  });

const recordScreenshotSchema = z.object({
  positionId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(30),
  storagePath: z.string().min(1).max(500),
});

export const recordJournalScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => recordScreenshotSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requireOwnedPosition(context.supabase, data.positionId, context.userId);
    const entryId = await ensureJournalEntryId(context.supabase, {
      positionId: data.positionId,
      userId: context.userId,
      accountId: data.accountId,
      symbol: data.symbol,
    });

    const { data: saved, error } = await rawTable(context.supabase, "journal_screenshots")
      .insert({ journal_entry_id: entryId, user_id: context.userId, storage_path: data.storagePath })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const savedId = (saved as { id: string }).id;

    const { data: signed, error: signError } = await context.supabase.storage
      .from(JOURNAL_SCREENSHOTS_BUCKET)
      .createSignedUrl(data.storagePath, SCREENSHOT_SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) throw new Error(signError?.message ?? "Uploaded, but could not create a preview URL.");

    return { id: savedId, signedUrl: signed.signedUrl } as JournalScreenshot;
  });

export const deleteJournalScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ screenshotId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error: findError } = await context.supabase
      .from("journal_screenshots" as never)
      .select("id, storage_path")
      .eq("id", data.screenshotId)
      .eq("user_id", context.userId)
      .maybeSingle()
      .returns<{ id: string; storage_path: string } | null>();
    if (findError) throw new Error(findError.message);
    if (!row) throw new Error("Screenshot not found for the current user.");

    const { error: removeError } = await context.supabase.storage.from(JOURNAL_SCREENSHOTS_BUCKET).remove([row.storage_path]);
    if (removeError) throw new Error(removeError.message);

    const { error: deleteError } = await context.supabase.from("journal_screenshots" as never).delete().eq("id", row.id).eq("user_id", context.userId);
    if (deleteError) throw new Error(deleteError.message);

    return { ok: true };
  });

// ---------------------------------------------------------------------
// AI Trade Review — Phase 4E-2. Same model/provider/usage-accounting
// convention as every other AI call site in this codebase
// (src/lib/analyze.functions.ts, project.functions.ts, sgscript.functions.ts):
// `createOpenAiProvider` + `generateText`/`Output.object` + `recordAiUsage`.
// Text-only: no existing call site in this codebase sends image input to
// the model, so this phase does not either — screenshots are not analyzed,
// per the Phase 4E-2 brief's own instruction not to fabricate a capability
// that isn't confirmed safe.
// ---------------------------------------------------------------------

const JOURNAL_REVIEW_MODEL = "gpt-5.6-sol";

const journalReviewInputSchema = z.object({
  positionId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(["buy", "sell"]),
  qty: z.number(),
  avgEntry: z.number(),
  exitPrice: z.number().nullable(),
  realizedPnl: z.number(),
  commission: z.number(),
  openedAt: z.string(),
  closedAt: z.string(),
  durationLabel: z.string().max(40),
  computedSession: z.string().max(40),
  notes: z.string().max(8000),
  manualSession: z.string().max(40).nullable(),
  grade: z.string().max(4).nullable(),
  setup: z.string().max(60).nullable(),
  strategy: z.string().max(60).nullable(),
  emotion: z.string().max(60).nullable(),
  mistakes: z.array(z.string().max(60)).max(50),
  tags: z.array(z.string().max(60)).max(50),
  executions: z.array(z.object({ side: z.enum(["buy", "sell"]), qty: z.number(), price: z.number(), executedAt: z.string() })).max(200),
});

// Every field is a required plain string, not `.default("")`. OpenAI's
// structured-output (strict JSON schema) mode requires the `required`
// array to list every property in `properties` — a Zod `.default(...)`
// makes the generated JSON schema mark that property optional instead,
// which OpenAI's API rejects outright ("'required' is required to be
// supplied and to be an array including every key in properties"). The
// prompt already instructs the model to always fill in all six parts, so
// nothing is lost by requiring them here instead of silently defaulting
// to an empty string.
const journalReviewOutputSchema = z.object({
  didWell: z.string(),
  couldImprove: z.string(),
  executionReview: z.string(),
  riskDiscipline: z.string(),
  keyLesson: z.string(),
  focusNext: z.string(),
});

export type JournalAiReviewContent = z.infer<typeof journalReviewOutputSchema>;
export type JournalAiReview = { id: string; model: string | null; content: JournalAiReviewContent; created_at: string };

export const generateJournalAiReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => journalReviewInputSchema.parse(i))
  .handler(async ({ data, context }): Promise<JournalAiReview> => {
    await requireOwnedPosition(context.supabase, data.positionId, context.userId);

    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not configured");

    const net = data.realizedPnl - data.commission;
    const prompt = `You are a professional trading coach reviewing ONE closed trade for a disciplined trader's journal.
Use ONLY the facts given below — never invent market context, news, or price action you were not supplied.

Trade facts:
- Symbol: ${data.symbol}
- Direction: ${data.side === "buy" ? "Long" : "Short"}
- Quantity: ${data.qty}
- Entry: ${data.avgEntry}
- Exit: ${data.exitPrice ?? "unknown"}
- Gross realized P&L: ${data.realizedPnl}
- Commission: ${data.commission}
- Net P&L: ${net}
- Opened: ${data.openedAt}
- Closed: ${data.closedAt}
- Duration: ${data.durationLabel}
- Computed session (fixed UTC-hour bucket): ${data.computedSession}
- Executions: ${data.executions.map((e) => `${e.side} ${e.qty} @ ${e.price} (${e.executedAt})`).join("; ") || "none recorded"}

The trader's own journal for this trade:
- Manual session label: ${data.manualSession ?? "none given"}
- Setup: ${data.setup ?? "none given"}
- Strategy: ${data.strategy ?? "none given"}
- Emotion: ${data.emotion ?? "none given"}
- Mistakes noted: ${data.mistakes.length ? data.mistakes.join(", ") : "none given"}
- Tags: ${data.tags.length ? data.tags.join(", ") : "none given"}
- Notes: ${data.notes || "none given"}

Write a compact, honest review with exactly these six parts, each 1-3 sentences:
- didWell: what the trader did well in this trade.
- couldImprove: what could have been better.
- executionReview: entry/exit timing and execution quality.
- riskDiscipline: risk management and discipline — position sizing, stops, whether they followed their own stated setup/strategy.
- keyLesson: the single most important lesson from this trade.
- focusNext: one concrete thing to focus on next trade.

Judge EXECUTION QUALITY, not just outcome — a losing trade can still show excellent process, and a winning trade can show poor process. Never fabricate details not given above.`;

    const gateway = createOpenAiProvider(key);
    const model = gateway(JOURNAL_REVIEW_MODEL);
    let usage: AiUsageTokens = {};
    const finishUsage = (success: boolean, errorMessage?: string) =>
      recordAiUsage(context.supabase, {
        userId: context.userId,
        operation: "journal_review",
        success,
        model: JOURNAL_REVIEW_MODEL,
        errorMessage,
        usage,
      });

    let content: JournalAiReviewContent;
    try {
      const result = await generateText({ model, prompt, output: Output.object({ schema: journalReviewOutputSchema }) });
      usage = accumulateUsage(usage, result.usage);
      content = result.output;
      await finishUsage(true);
    } catch (err) {
      await finishUsage(false, err instanceof Error ? err.message : "Unknown error");
      throw new Error("Could not generate an AI review right now. Try again.");
    }

    const entryId = await ensureJournalEntryId(context.supabase, {
      positionId: data.positionId,
      userId: context.userId,
      accountId: data.accountId,
      symbol: data.symbol,
    });

    const { data: saved, error } = await rawTable(context.supabase, "journal_ai_reviews")
      .insert({ journal_entry_id: entryId, user_id: context.userId, model: JOURNAL_REVIEW_MODEL, content })
      .select("id, model, content, created_at")
      .single();
    if (error) throw new Error(error.message);
    return saved as JournalAiReview;
  });

export const getLatestJournalAiReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ positionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const entryId = await findExistingJournalEntryId(context.supabase, data.positionId, context.userId);
    if (!entryId) return null;

    const { data: rows, error } = await context.supabase
      .from("journal_ai_reviews" as never)
      .select("id, model, content, created_at")
      .eq("journal_entry_id", entryId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<JournalAiReview[]>();
    if (error) throw new Error(error.message);
    return rows?.[0] ?? null;
  });
