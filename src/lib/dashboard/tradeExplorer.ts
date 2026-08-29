import {
  classifyTrade,
  filterClosedTrades,
  netPnlForTrade,
  sessionForUtcHour,
  type ClosedTrade,
  type ClosedTradeFilter,
  type TradingSession,
} from "./metrics";

/**
 * Phase 4D — Trade Explorer: pure filter/sort/paginate/duration logic. No
 * React, no Supabase, no I/O — operates entirely on `ClosedTrade[]`, the
 * exact same model `dashboard.functions.ts`/`metrics.ts` already produce.
 *
 * Net P&L semantics are NOT reinvented here: every function that needs a
 * trade's net result calls the existing `netPnlForTrade`/`classifyTrade`
 * from `metrics.ts` (realized P&L minus commission), so the Trade Explorer
 * can never disagree with the Dashboard about whether a trade won or what
 * it made.
 *
 * `direction`/`outcome`/`session` and the `netPnl`/`duration` sort keys are
 * all computed classifications this schema cannot push down to SQL without
 * adding a computed column to `v_closed_trades` (out of scope for this
 * phase — see `trades.functions.ts`'s doc comment for the resulting,
 * disclosed pagination limitation). They are therefore all applied here,
 * uniformly, over whatever rows the server function already narrowed by
 * account/date/symbol/side at the database level.
 */

export type Direction = "all" | "long" | "short";
export type Outcome = "all" | "win" | "loss" | "breakeven";
export type SessionFilter = "all" | TradingSession;
export type SortKey = "closedAt" | "symbol" | "netPnl" | "duration";
export type SortDir = "asc" | "desc";

/** Long = `side === "buy"`, Short = `side === "sell"` — read directly off
 * the OMS's own side field, matching `byDirection` in `metrics.ts`, never
 * inferred from whether the trade won or lost. */
export function directionOf(t: ClosedTrade): "long" | "short" {
  return t.side === "buy" ? "long" : "short";
}

export function filterByDirection(trades: ClosedTrade[], direction: Direction): ClosedTrade[] {
  if (direction === "all") return trades;
  return trades.filter((t) => directionOf(t) === direction);
}

export function filterByOutcome(trades: ClosedTrade[], outcome: Outcome): ClosedTrade[] {
  if (outcome === "all") return trades;
  return trades.filter((t) => classifyTrade(t) === outcome);
}

/** Same fixed, disclosed-approximate UTC session windows `metrics.ts`
 * already defines for the Dashboard's session breakdown — not a second
 * session definition. */
export function tradeSession(t: ClosedTrade): TradingSession {
  return sessionForUtcHour(new Date(t.closedAt).getUTCHours());
}

export function filterBySession(trades: ClosedTrade[], session: SessionFilter): ClosedTrade[] {
  if (session === "all") return trades;
  return trades.filter((t) => tradeSession(t) === session);
}

/** Trade duration in whole milliseconds (`closedAt - openedAt`). Clamped at
 * 0 defensively — a real closed position's `closedAt` is always at or after
 * its `openedAt`, but this never displays a nonsensical negative duration
 * if that invariant were ever violated upstream. */
export function tradeDurationMs(t: ClosedTrade): number {
  const ms = new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime();
  return ms > 0 ? ms : 0;
}

/** Compact human duration — "<1m", "45m", "3h 12m", "2d 4h". Precision
 * drops to the next coarser unit once a finer one would be noise (no
 * "3d 4h 12m 30s"), and never invents a number that isn't in `ms`. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function sortTrades(trades: ClosedTrade[], sortKey: SortKey, sortDir: SortDir): ClosedTrade[] {
  const sorted = [...trades].sort((a, b) => {
    let cmp: number;
    switch (sortKey) {
      case "closedAt":
        // ISO-8601 strings in the same format compare correctly
        // lexicographically — the same safe assumption `metrics.ts`'s
        // `cumulativePnlSeries` already relies on.
        cmp = a.closedAt.localeCompare(b.closedAt);
        break;
      case "symbol":
        cmp = a.symbol.localeCompare(b.symbol);
        break;
      case "netPnl":
        cmp = netPnlForTrade(a) - netPnlForTrade(b);
        break;
      case "duration":
        cmp = tradeDurationMs(a) - tradeDurationMs(b);
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export type PaginatedTrades = {
  rows: ClosedTrade[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Page numbers are 1-based. A `page` past the last real page clamps to the
 * last page rather than returning an empty slice — e.g. if filters shrink
 * the result set while the user is on page 3, they land on the new last
 * page instead of a jarring blank table. */
export function paginate(trades: ClosedTrade[], page: number, pageSize: number): PaginatedTrades {
  const totalCount = trades.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  const rows = trades.slice(start, start + pageSize);
  return { rows, totalCount, page: clampedPage, pageSize, totalPages };
}

/** True when the SQL fetch hit `cap` exactly — the signal that there may be
 * more matching trades beyond what reached this function's in-memory
 * filter/sort/paginate pipeline (see `trades.functions.ts`'s
 * `MAX_FETCH_ROWS` doc comment). A fetch landing exactly on the cap by
 * coincidence (rather than being cut off) is indistinguishable from a real
 * truncation with a `.limit()`-based fetch, so this errs toward disclosing
 * possible truncation rather than silently under-reporting. */
export function isTruncated(fetchedCount: number, cap: number): boolean {
  return fetchedCount >= cap;
}

export type TradeExplorerQuery = ClosedTradeFilter & {
  direction: Direction;
  outcome: Outcome;
  session: SessionFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
  pageSize: number;
};

/**
 * The one entry point `listClosedTradesPage` (and this file's own tests)
 * use to go from a raw `ClosedTrade[]` all the way to a final page:
 * account/symbol/date (via `metrics.ts`'s own `filterClosedTrades` — not a
 * second implementation of those filters) → direction → outcome → session
 * → sort → paginate, in that fixed order, every time.
 *
 * The server function ALSO pushes account/date/symbol down to SQL for real
 * scale (see `trades.functions.ts`), so in production this step re-applies
 * filters the database already enforced — deliberate defense-in-depth, the
 * same "belt and suspenders" pattern `listDashboardAccounts` already uses
 * with its explicit `.eq("user_id", ...)` alongside RLS. It also means
 * every filter type is exercised by a single, fully pure, fully tested
 * code path with no live database required.
 */
export function queryClosedTrades(trades: ClosedTrade[], query: TradeExplorerQuery): PaginatedTrades {
  let result = filterClosedTrades(trades, query);
  result = filterByDirection(result, query.direction);
  result = filterByOutcome(result, query.outcome);
  result = filterBySession(result, query.session);
  result = sortTrades(result, query.sortKey, query.sortDir);
  return paginate(result, query.page, query.pageSize);
}

export type ExplorerSummary = {
  netPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** wins / (wins + losses) × 100, breakeven excluded — same convention as
   * `computeDashboardMetrics`. `null` when there are no decisive trades. */
  winRatePct: number | null;
  /** Average net trade across ALL trades in the set, breakevens included. */
  avgTrade: number | null;
};

/** The Trade Explorer's own compact summary strip — deliberately NOT the
 * Performance Score (no weighted 0-100 score here, just the current
 * filtered set's real totals) so the two surfaces complement rather than
 * duplicate each other. */
export function summarizeTrades(trades: ClosedTrade[]): ExplorerSummary {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { netPnl: 0, totalTrades: 0, wins: 0, losses: 0, breakevens: 0, winRatePct: null, avgTrade: null };
  }
  let netPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  for (const t of trades) {
    const net = netPnlForTrade(t);
    netPnl += net;
    const cls = classifyTrade(t);
    if (cls === "win") wins++;
    else if (cls === "loss") losses++;
    else breakevens++;
  }
  const decisive = wins + losses;
  return {
    netPnl,
    totalTrades,
    wins,
    losses,
    breakevens,
    winRatePct: decisive > 0 ? (wins / decisive) * 100 : null,
    avgTrade: netPnl / totalTrades,
  };
}
