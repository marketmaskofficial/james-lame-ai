/**
 * Phase 4E-2 — pure constants for the Trade Journal's taxonomy fields.
 * These are UI-level suggestions only, never seeded into the database —
 * a suggestion becomes a real `journal_taxonomy_terms` row only the first
 * time a user actually selects or types it for a trade (see the Phase 4E-2
 * architecture audit). Kept separate from `journalDraft.ts` so the pure
 * dirty-state logic doesn't need to know about suggestion lists.
 */

export type TaxonomyKind = "setup" | "strategy" | "mistake" | "emotion" | "tag";

/** Kinds where at most one term attaches to a journal entry — matches the
 * `journal_entry_terms_single_select` partial unique index. */
export const SINGLE_SELECT_KINDS: readonly TaxonomyKind[] = ["setup", "strategy", "emotion"];

/** Kinds where any number of terms may attach to a journal entry. */
export const MULTI_SELECT_KINDS: readonly TaxonomyKind[] = ["mistake", "tag"];

export const SETUP_SUGGESTIONS = ["Liquidity Sweep", "FVG", "Order Block", "Breakout", "Reversal", "Continuation"];

// Strategy is deliberately unseeded — a strategy/playbook is a distinct,
// fully user-defined concept (see the Phase 4E-2 brief: "Do not treat
// strategy as the same concept as Setup"), with no generic example list
// that would apply across trading styles the way setup patterns do.
export const STRATEGY_SUGGESTIONS: string[] = [];

export const MISTAKE_SUGGESTIONS = [
  "Early Entry",
  "Late Entry",
  "Chased Entry",
  "Overtrading",
  "Oversized Position",
  "Moved Stop",
  "Ignored Bias",
  "Revenge Trade",
  "No Confirmation",
  "Closed Early",
];

export const EMOTION_SUGGESTIONS = ["Calm", "Confident", "Focused", "Hesitant", "FOMO", "Fearful", "Frustrated", "Greedy", "Revenge"];

export const TAG_SUGGESTIONS = ["A+ Setup", "London", "NY Open", "News", "Countertrend", "High Conviction", "Scalp", "Runner"];

export const SUGGESTIONS_BY_KIND: Record<TaxonomyKind, string[]> = {
  setup: SETUP_SUGGESTIONS,
  strategy: STRATEGY_SUGGESTIONS,
  mistake: MISTAKE_SUGGESTIONS,
  emotion: EMOTION_SUGGESTIONS,
  tag: TAG_SUGGESTIONS,
};

/** Execution/process quality, independent of trade outcome — a losing
 * trade can be graded A+; a winning trade can be graded F. */
export const GRADE_VALUES = ["A+", "A", "B", "C", "D", "F"] as const;
export type TradeGrade = (typeof GRADE_VALUES)[number];

export function isTradeGrade(value: string): value is TradeGrade {
  return (GRADE_VALUES as readonly string[]).includes(value);
}
