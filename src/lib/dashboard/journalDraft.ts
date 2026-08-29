import type { TradingSession } from "./metrics";
import type { TradeGrade } from "./journalTaxonomy";

/**
 * Phase 4E-1/4E-2 — pure draft/dirty-state logic for the Trade Explorer's
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
export type JournalSingleTermValue = string | null;

export type JournalDraft = {
  notes: string;
  session: JournalSessionValue;
  grade: TradeGrade | null;
  setup: JournalSingleTermValue;
  strategy: JournalSingleTermValue;
  emotion: JournalSingleTermValue;
  /** Order-independent — see `sameLabelSet` below. */
  mistakes: string[];
  tags: string[];
};

/** Order-independent, exact-label set-equality (case-sensitive: a taxonomy
 * term's label is stored as the user typed it, so "London" and "london"
 * are genuinely different labels here — case-insensitive de-duplication
 * happens once, at write time, against existing terms). Re-selecting the
 * same mistakes/tags in a different order must stay clean. */
export function sameLabelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((label, i) => label === sortedB[i]);
}

/** Exact-value comparison on every field — no trimming, no whitespace
 * collapsing on notes, so a change consisting only of a trailing newline
 * still counts as dirty, and reverting to the exact saved text (including
 * line breaks) counts as clean again. */
export function isJournalDraftDirty(saved: JournalDraft, draft: JournalDraft): boolean {
  return (
    saved.notes !== draft.notes ||
    saved.session !== draft.session ||
    saved.grade !== draft.grade ||
    saved.setup !== draft.setup ||
    saved.strategy !== draft.strategy ||
    saved.emotion !== draft.emotion ||
    !sameLabelSet(saved.mistakes, draft.mistakes) ||
    !sameLabelSet(saved.tags, draft.tags)
  );
}

/** The `<select>` element's own value can't natively represent `null`, so
 * this is the one place that maps `null` (no session) to `""` and back. */
export function sessionToSelectValue(session: JournalSessionValue): string {
  return session ?? "";
}

export function selectValueToSession(value: string): JournalSessionValue {
  return value === "" ? null : (value as TradingSession);
}

/** Same `null` <-> `""` mapping, reused for grade/setup/strategy/emotion
 * single-value `<select>`s so there's one consistent convention across
 * every single-select journal field. */
export function singleTermToSelectValue(value: JournalSingleTermValue): string {
  return value ?? "";
}

export function selectValueToSingleTerm(value: string): JournalSingleTermValue {
  return value === "" ? null : value;
}
