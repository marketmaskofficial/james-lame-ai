import type { TradingSession } from "./metrics";

/**
 * Phase 4E-1 — pure draft/dirty-state logic for the Trade Explorer's
 * in-drawer journal editor. No React, no Supabase, no I/O — mirrors the
 * style of `tradeExplorer.ts`.
 *
 * `session` here is the MANUAL journal field (`journal_entries.session`),
 * never the trade's own computed UTC session (`tradeSession()` in
 * `tradeExplorer.ts`). The two are deliberately kept separate — see the
 * Phase 4E audit and `metrics.ts`'s own note that the free-text journal
 * session field is sparse/unauthoritative and must not be conflated with
 * the computed session bucket.
 */

export type JournalSessionValue = TradingSession | null;

export type JournalDraft = {
  notes: string;
  session: JournalSessionValue;
};

/** Exact-value comparison — no trimming, no whitespace collapsing, so a
 * change consisting only of a trailing newline still counts as dirty, and
 * reverting to the exact saved text (including line breaks) counts as
 * clean again. */
export function isJournalDraftDirty(saved: JournalDraft, draft: JournalDraft): boolean {
  return saved.notes !== draft.notes || saved.session !== draft.session;
}

/** The `<select>` element's own value can't natively represent `null`, so
 * this is the one place that maps `null` (no session) to `""` and back. */
export function sessionToSelectValue(session: JournalSessionValue): string {
  return session ?? "";
}

export function selectValueToSession(value: string): JournalSessionValue {
  return value === "" ? null : (value as TradingSession);
}
