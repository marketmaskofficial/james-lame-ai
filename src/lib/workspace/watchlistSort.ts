/**
 * Pure sort helper for the Watchlist widget (UI-4h-3) — split out of
 * WatchlistPanel.tsx so it's unit-testable without React/DOM (same rationale
 * as volumeProfileMath.ts for the Volume Profile widget). "manual" returns
 * rows unchanged (the caller's own DB `position` order); the other modes sort
 * by a value read from the row's live quote, missing quotes always sorting
 * last regardless of direction (an unknown price is never "highest" or
 * "lowest", it's just unknown).
 */

export type WatchlistRow = { symbol: string };
export type WatchlistQuote = { price: number; changePct: number };
export type WatchlistSortBy = "manual" | "symbol" | "price" | "changePct";
export type WatchlistSortDir = "asc" | "desc";

export function sortWatchlistRows<T extends WatchlistRow>(
  rows: T[],
  quotes: Record<string, WatchlistQuote | undefined>,
  sortBy: WatchlistSortBy,
  sortDir: WatchlistSortDir,
  tickerOf: (symbol: string) => string,
): T[] {
  if (sortBy === "manual") return rows;
  const dir = sortDir === "desc" ? -1 : 1;
  const withQuote = rows.map((row) => ({ row, q: quotes[row.symbol] }));
  withQuote.sort((a, b) => {
    if (sortBy === "symbol") {
      return dir * tickerOf(a.row.symbol).localeCompare(tickerOf(b.row.symbol));
    }
    const av = sortBy === "price" ? a.q?.price : a.q?.changePct;
    const bv = sortBy === "price" ? b.q?.price : b.q?.changePct;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir * (av - bv);
  });
  return withQuote.map((w) => w.row);
}
