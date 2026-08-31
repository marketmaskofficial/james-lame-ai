import {
  classifyTrade,
  netPnlForTrade,
  summarizeGroup,
  SESSION_LABELS,
  SESSION_ORDER,
  type ClosedTrade,
  type GroupSummary,
  type TradeClassification,
  type TradingSession,
} from "./metrics";
import { GRADE_VALUES, type TaxonomyKind, type TradeGrade } from "./journalTaxonomy";

/**
 * Phase 4F — Journal Analytics: pure aggregation engine. No React, no
 * Supabase, no I/O — operates entirely on `JournalAnalyticsTrade[]`, built
 * once (see `buildJournalAnalyticsTrades` below) from the real closed-trade
 * data (`ClosedTrade`, from `metrics.ts`/`v_closed_trades`) plus the Phase
 * 4E-2 journal tables. Net P&L and win/loss classification are never
 * reinvented here — every grouping function below calls the exact same
 * `netPnlForTrade`/`classifyTrade`/`summarizeGroup` primitives the Dashboard
 * and Trade Explorer already use, so Journal Analytics can never disagree
 * with either surface about what a trade made or whether it won.
 *
 * MISSING-DATA RULE (applies uniformly to every single-value grouping
 * below): a trade whose relevant field is `null` (no journal entry, or a
 * journal entry with that field unset) is EXCLUDED from that breakdown's
 * groups — never coerced into a fabricated "Unset"/"No Mistake"/"No Tag"
 * bucket. `journaledVsNonJournaled` is the one exception, by design: that
 * breakdown's entire purpose is to characterize trades with no journal
 * entry, so those trades are its "Non-Journaled" side rather than being
 * excluded.
 *
 * DOUBLE-COUNTING RULE: the base `JournalAnalyticsTrade[]` array always has
 * exactly one entry per closed position (enforced upstream by the DB's own
 * `journal_entries_one_per_position` unique index — see the Phase 4F audit).
 * Overall totals (`journaledVsNonJournaled`) always run over that base array
 * directly. Only the multi-select breakdowns (`byMistake`, `byTag`, and any
 * combination involving one of them) fan a trade out across more than one
 * bucket — once per distinct label it actually carries, via a `Set` per
 * trade so even a hypothetical duplicate label could never double-count a
 * trade into the SAME bucket twice.
 */

export type JournalAnalyticsTrade = ClosedTrade & {
  hasJournal: boolean;
  journalEntryId: string | null;
  /** The trader's manually-entered journal session — a DISTINCT concept
   * from `metrics.ts`'s computed UTC-hour `bySession`. Never derived from
   * the computed session; `null` whenever the journal entry didn't set one,
   * even if a computed session could technically be derived from
   * `closedAt`. */
  journalSession: TradingSession | null;
  grade: TradeGrade | null;
  /** At most one label each (DB-enforced single-select), or `null`. */
  setup: string | null;
  strategy: string | null;
  emotion: string | null;
  /** Zero or more distinct labels (DB-enforced multi-select, deduplicated
   * by the `(journal_entry_id, term_id)` primary key upstream). */
  mistakes: string[];
  tags: string[];
};

/** Raw shapes the server function fetches directly (batched, never per-
 * trade) and hands to `buildJournalAnalyticsTrades` below — kept as plain,
 * narrow row shapes (not full table types) so this assembly function stays
 * testable with hand-built fixtures and has no Supabase dependency. */
export type RawJournalEntryRow = { id: string; position_id: string; session: string | null; grade: string | null };
export type RawEntryTermRow = { journal_entry_id: string; term_id: string; kind: TaxonomyKind };
export type RawTaxonomyTermRow = { id: string; label: string };

/**
 * Assembles the unified `JournalAnalyticsTrade[]` from the four raw,
 * batch-fetched pieces — the one place trade ↔ journal-entry ↔ term ↔ label
 * joining happens. Pure and synchronous: the server function's only job is
 * fetching these four inputs (see `journalAnalytics.functions.ts`); every
 * actual join/assembly decision lives here where it's directly unit-
 * testable without a live database.
 *
 * A trade whose `positionId` has no matching `journalEntries` row gets
 * `hasJournal: false` and every journal field `null`/empty — never an
 * error, never a fabricated entry. `setup`/`strategy`/`emotion` take the
 * FIRST matching term for that kind, since the DB's own partial unique
 * index (`journal_entry_terms_single_select`) already guarantees at most
 * one such term can exist per entry.
 */
export function buildJournalAnalyticsTrades(
  trades: ClosedTrade[],
  journalEntries: RawJournalEntryRow[],
  entryTerms: RawEntryTermRow[],
  taxonomyTerms: RawTaxonomyTermRow[],
): JournalAnalyticsTrade[] {
  const entryByPosition = new Map(journalEntries.map((e) => [e.position_id, e]));
  const labelByTermId = new Map(taxonomyTerms.map((t) => [t.id, t.label]));
  const termsByEntry = new Map<string, RawEntryTermRow[]>();
  for (const et of entryTerms) {
    const list = termsByEntry.get(et.journal_entry_id);
    if (list) list.push(et);
    else termsByEntry.set(et.journal_entry_id, [et]);
  }

  return trades.map((t) => {
    const entry = entryByPosition.get(t.positionId);
    if (!entry) {
      return {
        ...t,
        hasJournal: false,
        journalEntryId: null,
        journalSession: null,
        grade: null,
        setup: null,
        strategy: null,
        emotion: null,
        mistakes: [],
        tags: [],
      };
    }

    const terms = termsByEntry.get(entry.id) ?? [];
    const labelsFor = (kind: TaxonomyKind): string[] =>
      terms
        .filter((x) => x.kind === kind)
        .map((x) => labelByTermId.get(x.term_id))
        .filter((label): label is string => !!label);

    return {
      ...t,
      hasJournal: true,
      journalEntryId: entry.id,
      journalSession: (entry.session as TradingSession | null) ?? null,
      grade: (entry.grade as TradeGrade | null) ?? null,
      setup: labelsFor("setup")[0] ?? null,
      strategy: labelsFor("strategy")[0] ?? null,
      emotion: labelsFor("emotion")[0] ?? null,
      mistakes: labelsFor("mistake"),
      tags: labelsFor("tag"),
    };
  });
}

/** Superset of `GroupSummary` (reused, not reimplemented) with the
 * additional Avg Win / Avg Loss / Profit Factor / Breakeven-count fields
 * Phase 4F's breakdowns need beyond what the Phase 4B-1 Dashboard
 * breakdowns exposed. `tradeCount`/`wins`/`losses`/`winRatePct`/
 * `avgNetTrade`/`netPnl`/`isLowSample` all come directly from
 * `summarizeGroup` — this never redefines any of them. */
export type JournalGroupSummary = GroupSummary & {
  breakevens: number;
  /** Σ net P&L of winning trades / count(wins). `null` with no wins. */
  avgWin: number | null;
  /** Σ net P&L of losing trades / count(losses) — negative. `null` with no losses. */
  avgLoss: number | null;
  /** Gross profit / |gross loss|. `null` when there are no losing trades. */
  profitFactor: number | null;
};

export function summarizeJournalGroup(trades: ClosedTrade[]): JournalGroupSummary {
  const base = summarizeGroup(trades);
  let breakevens = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    const cls = classifyTrade(t);
    if (cls === "breakeven") breakevens++;
    else if (cls === "win") grossProfit += netPnlForTrade(t);
    else grossLoss += Math.abs(netPnlForTrade(t));
  }
  const avgWin = base.wins > 0 ? grossProfit / base.wins : null;
  const avgLoss = base.losses > 0 ? -grossLoss / base.losses : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  return { ...base, breakevens, avgWin, avgLoss, profitFactor };
}

/** Groups by a single-valued, nullable field — a trade with `null` is
 * excluded from the result entirely (see the missing-data rule above), and
 * only labels that actually occur produce a group (no fabricated buckets). */
function groupBySingleField(
  trades: JournalAnalyticsTrade[],
  key: (t: JournalAnalyticsTrade) => string | null,
): { label: string; group: JournalGroupSummary }[] {
  const buckets = new Map<string, JournalAnalyticsTrade[]>();
  for (const t of trades) {
    const label = key(t);
    if (label == null) continue;
    const list = buckets.get(label);
    if (list) list.push(t);
    else buckets.set(label, [t]);
  }
  return [...buckets.entries()].map(([label, list]) => ({ label, group: summarizeJournalGroup(list) }));
}

/** Groups by a multi-valued field (Mistakes/Tags) — a trade contributes
 * once to EACH of its own distinct labels (deduplicated per-trade via a
 * `Set`, so a trade can never count twice toward the SAME label even in a
 * hypothetical malformed input), and never at all if the array is empty. */
function groupByMultiField(
  trades: JournalAnalyticsTrade[],
  key: (t: JournalAnalyticsTrade) => string[],
): { label: string; group: JournalGroupSummary }[] {
  const buckets = new Map<string, JournalAnalyticsTrade[]>();
  for (const t of trades) {
    const labels = new Set(key(t));
    for (const label of labels) {
      const list = buckets.get(label);
      if (list) list.push(t);
      else buckets.set(label, [t]);
    }
  }
  return [...buckets.entries()].map(([label, list]) => ({ label, group: summarizeJournalGroup(list) }));
}

export type SetupPerformance = JournalGroupSummary & { setup: string };
/** Sorted by net P&L descending by default — same convention `bySymbol` in
 * `metrics.ts` already established (best performer first). UI sorting (see
 * `sortJournalGroups`) can re-sort by any other column. */
export function bySetup(trades: JournalAnalyticsTrade[]): SetupPerformance[] {
  return groupBySingleField(trades, (t) => t.setup)
    .map(({ label, group }) => ({ setup: label, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type StrategyPerformance = JournalGroupSummary & { strategy: string };
export function byStrategy(trades: JournalAnalyticsTrade[]): StrategyPerformance[] {
  return groupBySingleField(trades, (t) => t.strategy)
    .map(({ label, group }) => ({ strategy: label, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type EmotionPerformance = JournalGroupSummary & { emotion: string };
export function byEmotion(trades: JournalAnalyticsTrade[]): EmotionPerformance[] {
  return groupBySingleField(trades, (t) => t.emotion)
    .map(({ label, group }) => ({ emotion: label, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type TagPerformance = JournalGroupSummary & { tag: string };
export function byTag(trades: JournalAnalyticsTrade[]): TagPerformance[] {
  return groupByMultiField(trades, (t) => t.tags)
    .map(({ label, group }) => ({ tag: label, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type MistakeImpact = JournalGroupSummary & { mistake: string };
/** Default-sorted by net P&L ASCENDING (most costly first) per the Phase 4F
 * scope decision — the one breakdown whose default order is inverted from
 * every other "best first" table, because its whole purpose is answering
 * "which mistakes cost me the most." */
export function byMistake(trades: JournalAnalyticsTrade[]): MistakeImpact[] {
  return groupByMultiField(trades, (t) => t.mistakes)
    .map(({ label, group }) => ({ mistake: label, ...group }))
    .sort((a, b) => a.netPnl - b.netPnl);
}

export type GradePerformance = JournalGroupSummary & { grade: TradeGrade };
/** Always all six grades in fixed A+→F order, including zero-trade grades —
 * a Trade Grade is a fixed, non-extensible enum (see `journalTaxonomy.ts`),
 * the same reasoning `bySession`/`byDirection` in `metrics.ts` already use
 * to always show every fixed bucket. This is what makes a "grade
 * distribution" bar chart possible without the UI inventing empty slots
 * itself. */
export function byGrade(trades: JournalAnalyticsTrade[]): GradePerformance[] {
  const buckets = new Map<TradeGrade, JournalAnalyticsTrade[]>();
  for (const t of trades) {
    if (t.grade == null) continue;
    const list = buckets.get(t.grade);
    if (list) list.push(t);
    else buckets.set(t.grade, [t]);
  }
  return GRADE_VALUES.map((grade) => ({ grade, ...summarizeJournalGroup(buckets.get(grade) ?? []) }));
}

export type JournalSessionPerformance = JournalGroupSummary & { session: TradingSession; label: string };
/** The manually-entered journal `session` field — always all five fixed
 * session buckets in the same order `metrics.ts`'s `bySession` (computed
 * UTC session) uses, but built from a DISTINCT source field. Never merged
 * with or derived from the computed session — see this file's doc comment
 * and the Phase 4F scope decision. */
export function byJournalSession(trades: JournalAnalyticsTrade[]): JournalSessionPerformance[] {
  const buckets = new Map<TradingSession, JournalAnalyticsTrade[]>();
  for (const t of trades) {
    if (t.journalSession == null) continue;
    const list = buckets.get(t.journalSession);
    if (list) list.push(t);
    else buckets.set(t.journalSession, [t]);
  }
  return SESSION_ORDER.map((session) => ({
    session,
    label: SESSION_LABELS[session],
    ...summarizeJournalGroup(buckets.get(session) ?? []),
  }));
}

export type JournaledComparison = { journaled: JournalGroupSummary; nonJournaled: JournalGroupSummary };
/** The minimal shape `journaledVsNonJournaled` actually needs — deliberately
 * narrower than `JournalAnalyticsTrade` so Phase 4G's Trade Explorer can
 * reuse this exact function against its own already-loaded
 * `TradeExplorerRow[]` (`ClosedTrade & { hasJournal }`, from
 * `tradeExplorer.ts`) without fetching or fabricating the full taxonomy
 * join (setup/strategy/emotion/mistakes/tags) that page never needs. Every
 * `JournalAnalyticsTrade` already satisfies this structurally, so `/journal`
 * itself needs no change. */
export type JournaledTrade = ClosedTrade & { hasJournal: boolean };

/**
 * Journaled vs. Non-Journaled — the ONE breakdown that includes trades with
 * no journal entry (as "Non-Journaled") rather than excluding them. Always
 * partitions the full base array, so `journaled.tradeCount +
 * nonJournaled.tradeCount === trades.length` by construction (a trade is
 * either `hasJournal` or it isn't, never both, never neither).
 */
export function journaledVsNonJournaled(trades: JournaledTrade[]): JournaledComparison {
  const journaled: ClosedTrade[] = [];
  const nonJournaled: ClosedTrade[] = [];
  for (const t of trades) (t.hasJournal ? journaled : nonJournaled).push(t);
  return { journaled: summarizeJournalGroup(journaled), nonJournaled: summarizeJournalGroup(nonJournaled) };
}

function toLabelArray(value: string | string[] | null): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? [...new Set(value)] : [value];
}

/**
 * Generic two-key combination engine — the ONE mechanism behind every
 * Phase 4F combination breakdown (Grade×Setup, Emotion×Outcome,
 * Mistake×Setup), so a future approved combination is a new ~3-line wrapper
 * around this function, never a rewrite of the aggregation engine. Each key
 * function may return a single value (most fields), `null` (excluded, per
 * the missing-data rule), or a string array (Mistakes/Tags — fanned out the
 * same way `groupByMultiField` fans out a single-key grouping). A trade
 * missing EITHER side of the pair contributes to no cell at all — combination
 * analytics never fabricates one side to keep the other.
 *
 * This is deliberately NOT exposed as an arbitrary key-name query builder —
 * only the three named wrappers below are part of the public surface, per
 * the Phase 4F scope decision.
 */
function combineBy<T>(
  trades: T[],
  keyA: (t: T) => string | string[] | null,
  keyB: (t: T) => string | string[] | null,
): { a: string; b: string; group: JournalGroupSummary }[] {
  const buckets = new Map<string, { a: string; b: string; trades: T[] }>();
  for (const t of trades) {
    const as = toLabelArray(keyA(t));
    const bs = toLabelArray(keyB(t));
    if (as.length === 0 || bs.length === 0) continue;
    for (const a of as) {
      for (const b of bs) {
        const cellKey = `${a} ${b}`;
        let bucket = buckets.get(cellKey);
        if (!bucket) {
          bucket = { a, b, trades: [] };
          buckets.set(cellKey, bucket);
        }
        bucket.trades.push(t);
      }
    }
  }
  return [...buckets.values()].map((b) => ({ a: b.a, b: b.b, group: summarizeJournalGroup(b.trades as unknown as ClosedTrade[]) }));
}

export type GradeSetupCombo = JournalGroupSummary & { grade: string; setup: string };
/** "Does better execution grading actually correlate with better results
 * within a given setup?" */
export function byGradeAndSetup(trades: JournalAnalyticsTrade[]): GradeSetupCombo[] {
  return combineBy(trades, (t) => t.grade, (t) => t.setup)
    .map(({ a, b, group }) => ({ grade: a, setup: b, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type EmotionOutcomeCombo = JournalGroupSummary & { emotion: string; outcome: TradeClassification };
/** "Which emotions actually precede losses?" — `outcome` is
 * `classifyTrade`'s own real win/loss/breakeven classification, not a
 * second outcome definition. */
export function byEmotionAndOutcome(trades: JournalAnalyticsTrade[]): EmotionOutcomeCombo[] {
  return combineBy(trades, (t) => t.emotion, (t) => classifyTrade(t))
    .map(({ a, b, group }) => ({ emotion: a, outcome: b as TradeClassification, ...group }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type MistakeSetupCombo = JournalGroupSummary & { mistake: string; setup: string };
/** "Which setups tempt me into which mistakes?" — `mistake` fans out like
 * `byMistake` (a trade with 2 mistakes on 1 setup contributes to 2 cells,
 * never twice to the same cell). */
export function byMistakeAndSetup(trades: JournalAnalyticsTrade[]): MistakeSetupCombo[] {
  return combineBy(trades, (t) => t.mistakes, (t) => t.setup)
    .map(({ a, b, group }) => ({ mistake: a, setup: b, ...group }))
    .sort((a, b) => a.netPnl - b.netPnl);
}

export type JournalSortKey = "tradeCount" | "winRatePct" | "netPnl" | "avgNetTrade" | "profitFactor";

/** UI-driven re-sort of an already-computed breakdown — every table
 * supports at least these five columns (Trade Count, Win Rate, Net P&L,
 * Average Trade, Profit Factor) per the Phase 4F scope decision. `null`
 * values (e.g. `profitFactor` with no losses recorded, `winRatePct` with no
 * decisive trades) always sort to the end regardless of direction, rather
 * than being coerced to 0 or ±Infinity and silently misordering the table. */
export function sortJournalGroups<T extends JournalGroupSummary>(groups: T[], key: JournalSortKey, dir: "asc" | "desc"): T[] {
  return [...groups].sort((x, y) => {
    const xv = x[key];
    const yv = y[key];
    if (xv == null && yv == null) return 0;
    if (xv == null) return 1;
    if (yv == null) return -1;
    const cmp = xv - yv;
    return dir === "asc" ? cmp : -cmp;
  });
}

export type JournalFocusKind = "setup" | "strategy" | "grade" | "emotion" | "mistake" | "tag" | "session";
export type JournalFocusFilter = { kind: JournalFocusKind; value: string } | null;

/**
 * The at-most-one-active metadata drill-down filter (Phase 4F scope
 * decision — NOT a multi-select filter bar). Narrows the base trade set
 * BEFORE every breakdown/combination function above runs, the same
 * "drill-down narrows the shared dataset" idiom the Dashboard's Trading
 * Calendar day-click already established for date filtering.
 */
export function applyJournalFocusFilter(trades: JournalAnalyticsTrade[], focus: JournalFocusFilter): JournalAnalyticsTrade[] {
  if (!focus) return trades;
  switch (focus.kind) {
    case "setup":
      return trades.filter((t) => t.setup === focus.value);
    case "strategy":
      return trades.filter((t) => t.strategy === focus.value);
    case "grade":
      return trades.filter((t) => t.grade === focus.value);
    case "emotion":
      return trades.filter((t) => t.emotion === focus.value);
    case "mistake":
      return trades.filter((t) => t.mistakes.includes(focus.value));
    case "tag":
      return trades.filter((t) => t.tags.includes(focus.value));
    case "session":
      return trades.filter((t) => t.journalSession === focus.value);
  }
}
