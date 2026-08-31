/**
 * Signal Goat Trading Dashboard — pure analytics functions (Phase 4A).
 *
 * Operates entirely on real, durable OMS data — a "trade" here is always one
 * `trade_positions` row with `status = 'closed'` (never a raw execution/fill,
 * never a Chart Studio runtime drawing, never a backtest trade). Nothing in
 * this file is estimated or randomized; every number is derived from the
 * same `realized_pnl`/`commission` fields the OMS itself wrote in
 * `src/lib/trading/oms.server.ts`.
 *
 * COMMISSION SEMANTICS (verified against `applyFill()` in oms.server.ts,
 * not inferred from field names): `trade_positions.realized_pnl` and
 * `trade_executions.realized_pnl` are GROSS — computed purely from
 * `(price - avgEntry) * direction`, with no commission involved
 * (oms.server.ts:295). Commission is only netted at the account-rollup
 * level (`trading_accounts.realized_pnl`/`balance`, oms.server.ts:397-398),
 * never on the position or execution row itself. Every "net" figure in this
 * file therefore explicitly subtracts the aggregated per-position
 * commission (see `ClosedTrade.commission`, sourced from the
 * `v_closed_trades` view) rather than assuming it is already included.
 *
 * Every trade-level and aggregate figure here is computed NET of commission
 * for consistency — a trade whose gross P&L was positive but fully eaten by
 * commission counts as a loss, matching how "Net P&L" is defined for the
 * whole metric suite. This is a deliberate, disclosed choice, not an
 * oversight.
 *
 * These formulas mirror `computeMetrics()` in `src/lib/backtest/engine.ts`
 * (win rate, profit factor, avg win/loss, drawdown) — reused semantics, not
 * a second implementation — adapted for real closed trades instead of
 * `BacktestTrade[]`, and for one deliberate difference: breakeven trades
 * (net P&L exactly zero) are EXCLUDED from the Win % denominator here (per
 * Phase 4A product decision), whereas the backtest engine folds them into
 * "losses". Total Trades always includes them.
 */

/** One row from the `v_closed_trades` Supabase view (see
 * supabase/migrations/20260828130000_v_closed_trades.sql) — camelCased. */
export type ClosedTrade = {
  positionId: string;
  userId: string;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  avgEntry: number;
  /** Gross realized P&L, commission-exclusive — see file doc comment. */
  realizedPnl: number;
  openedAt: string;
  closedAt: string;
  /** Aggregated across every execution linked to this position. */
  commission: number;
  fillCount: number;
  /** Qty-weighted average price of this position's closing fill(s). `null`
   * when it cannot be truthfully derived (see the view's own doc comment
   * for the one known OMS edge case — a flip-in-one-order close). */
  exitPrice: number | null;
};

/** Raw shapes this module can also derive `ClosedTrade[]` from directly —
 * used by the reference-model tests (no live Postgres in this test suite to
 * exercise the actual SQL view against), and available as a fallback if a
 * caller ever has `trade_positions`/`trade_executions` rows without going
 * through the view. Mirrors the view's SQL exactly; keep both in sync. */
export type RawPosition = {
  id: string;
  userId: string;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  avgEntry: number;
  realizedPnl: number;
  status: string;
  openedAt: string;
  closedAt: string | null;
};

export type RawExecution = {
  positionId: string | null;
  side: "buy" | "sell";
  qty: number;
  price: number;
  commission: number;
};

/** Mirrors `v_closed_trades`'s SQL exactly: closed positions only, per-
 * position commission/fill-count aggregation, and the same opposite-side
 * qty-weighted exit-price derivation. Kept here as a reference model the
 * test suite can exercise directly (see this file's doc comment) — the SQL
 * migration is hand-verified against this implementation. */
export function deriveClosedTrades(positions: RawPosition[], executions: RawExecution[]): ClosedTrade[] {
  const byPosition = new Map<string, RawExecution[]>();
  for (const e of executions) {
    if (!e.positionId) continue;
    const list = byPosition.get(e.positionId);
    if (list) list.push(e);
    else byPosition.set(e.positionId, [e]);
  }
  const out: ClosedTrade[] = [];
  for (const p of positions) {
    if (p.status !== "closed" || !p.closedAt) continue;
    const fills = byPosition.get(p.id) ?? [];
    const commission = fills.reduce((s, f) => s + f.commission, 0);
    const closingFills = fills.filter((f) => f.side !== p.side);
    const closingQty = closingFills.reduce((s, f) => s + f.qty, 0);
    const exitPrice = closingQty > 0 ? closingFills.reduce((s, f) => s + f.price * f.qty, 0) / closingQty : null;
    out.push({
      positionId: p.id,
      userId: p.userId,
      accountId: p.accountId,
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      avgEntry: p.avgEntry,
      realizedPnl: p.realizedPnl,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      commission,
      fillCount: fills.length,
      exitPrice,
    });
  }
  return out;
}

export type ClosedTradeFilter = {
  accountId?: string;
  symbol?: string;
  /** Inclusive, compared against `closedAt` as ISO-8601 strings (safe:
   * lexicographic order matches chronological order for same-format ISO
   * timestamps). Phase 4A always filters by `closedAt`, never `openedAt`. */
  fromUtc?: string;
  toUtc?: string;
};

export function filterClosedTrades(trades: ClosedTrade[], filter: ClosedTradeFilter): ClosedTrade[] {
  return trades.filter((t) => {
    if (filter.accountId && t.accountId !== filter.accountId) return false;
    if (filter.symbol && t.symbol !== filter.symbol) return false;
    if (filter.fromUtc && t.closedAt < filter.fromUtc) return false;
    if (filter.toUtc && t.closedAt > filter.toUtc) return false;
    return true;
  });
}

/** Net P&L for one trade: gross realized P&L minus this trade's own
 * aggregated commission. The basis for every metric below. */
export function netPnlForTrade(t: ClosedTrade): number {
  return t.realizedPnl - t.commission;
}

export type TradeClassification = "win" | "loss" | "breakeven";

export function classifyTrade(t: ClosedTrade): TradeClassification {
  const net = netPnlForTrade(t);
  if (net > 0) return "win";
  if (net < 0) return "loss";
  return "breakeven";
}

/** UTC calendar-day key ("YYYY-MM-DD") for a timestamp — the ONLY day
 * boundary this module uses. Phase 4A has no per-account trading timezone
 * to group by (see the audit's point 5/17), so every day-based metric here
 * is computed in UTC, not the viewer's browser-local timezone. Uses
 * `Date#toISOString()` specifically (not string-slicing the raw input) so
 * the result is correct regardless of what timezone offset the source
 * timestamp happened to be serialized with. */
export function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export type DashboardMetrics = {
  /** Σ net P&L across every trade in the filtered set. */
  netPnl: number;
  /** wins / (wins + losses) × 100 — breakeven trades excluded from this
   * denominator. `null` when there are no decisive (non-breakeven) trades. */
  winRatePct: number | null;
  /** Gross profit / |gross loss|, both net-of-commission. `null` when there
   * are no losing trades (matches `engine.ts`'s convention exactly — never
   * `Infinity`). */
  profitFactor: number | null;
  /** Trading days (UTC) with net P&L > 0, divided by trading days with ≥1
   * closed trade. `null` when there are no closed trades at all. */
  dayWinRatePct: number | null;
  /** Σ net P&L of winning trades / count(winning trades). `null` with no wins. */
  avgWinningTrade: number | null;
  /** Σ net P&L of losing trades / count(losing trades) — negative. `null` with no losses. */
  avgLosingTrade: number | null;
  /** |avgWinningTrade| / |avgLosingTrade|. `null` when either side is unavailable. */
  avgWinLossRatio: number | null;
  /** count(all closed trades in range) — wins + losses + breakeven. */
  totalTrades: number;
};

export function computeDashboardMetrics(trades: ClosedTrade[]): DashboardMetrics {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      netPnl: 0,
      winRatePct: null,
      profitFactor: null,
      dayWinRatePct: null,
      avgWinningTrade: null,
      avgLosingTrade: null,
      avgWinLossRatio: null,
      totalTrades: 0,
    };
  }

  const nets = trades.map(netPnlForTrade);
  const netPnl = nets.reduce((s, n) => s + n, 0);

  const wins = trades.filter((t) => classifyTrade(t) === "win");
  const losses = trades.filter((t) => classifyTrade(t) === "loss");
  const decisive = wins.length + losses.length;

  const grossProfit = wins.reduce((s, t) => s + netPnlForTrade(t), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + netPnlForTrade(t), 0));

  const winRatePct = decisive > 0 ? (wins.length / decisive) * 100 : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const avgWinningTrade = wins.length > 0 ? grossProfit / wins.length : null;
  const avgLosingTrade = losses.length > 0 ? -grossLoss / losses.length : null;
  const avgWinLossRatio =
    avgWinningTrade != null && avgLosingTrade != null && avgLosingTrade !== 0
      ? Math.abs(avgWinningTrade) / Math.abs(avgLosingTrade)
      : null;

  return {
    netPnl,
    winRatePct,
    profitFactor,
    dayWinRatePct: dayWinRate(trades),
    avgWinningTrade,
    avgLosingTrade,
    avgWinLossRatio,
    totalTrades,
  };
}

/** Day Win % in isolation (also folded into `computeDashboardMetrics`) —
 * exported separately since the daily P&L chart needs the same per-day
 * buckets and callers may want just this one figure. */
export function dayWinRate(trades: ClosedTrade[]): number | null {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const key = utcDayKey(t.closedAt);
    byDay.set(key, (byDay.get(key) ?? 0) + netPnlForTrade(t));
  }
  if (byDay.size === 0) return null;
  const days = [...byDay.values()];
  const winningDays = days.filter((d) => d > 0).length;
  return (winningDays / days.length) * 100;
}

export type CumulativePnlPoint = { time: string; cumulative: number };

/** Running sum of net P&L ordered chronologically by `closedAt` — the
 * Cumulative P&L chart's data. */
export function cumulativePnlSeries(trades: ClosedTrade[]): CumulativePnlPoint[] {
  const sorted = [...trades].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  let running = 0;
  return sorted.map((t) => {
    running += netPnlForTrade(t);
    return { time: t.closedAt, cumulative: running };
  });
}

export type DailyPnlPoint = { day: string; netPnl: number; tradeCount: number };

/** Net P&L bucketed per UTC calendar day — the Daily Net P&L bar chart's
 * data (positive/negative/zero determines the bar's color in the UI). */
export function dailyPnlSeries(trades: ClosedTrade[]): DailyPnlPoint[] {
  const byDay = new Map<string, { netPnl: number; tradeCount: number }>();
  for (const t of trades) {
    const key = utcDayKey(t.closedAt);
    const cur = byDay.get(key) ?? { netPnl: 0, tradeCount: 0 };
    cur.netPnl += netPnlForTrade(t);
    cur.tradeCount += 1;
    byDay.set(key, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, netPnl: v.netPnl, tradeCount: v.tradeCount }));
}

export type BalancePoint = { time: string; balance: number };

/**
 * Derived trading-balance progression: `startingBalance + cumulative net
 * realized P&L`, ordered chronologically. Truthful only because no
 * out-of-band balance adjustment (deposit/withdrawal) mechanism exists in
 * the OMS today — if one is ever added without a corresponding ledger row,
 * this derivation would silently drift from the account's real balance (see
 * the Phase 4A audit's risk list). This is a derived trading-balance/equity
 * progression, NOT a full banking ledger — label it as such in the UI.
 */
export function derivedBalanceSeries(trades: ClosedTrade[], startingBalance: number): BalancePoint[] {
  return cumulativePnlSeries(trades).map((p) => ({ time: p.time, balance: startingBalance + p.cumulative }));
}

export type DrawdownPoint = { time: string; drawdown: number; drawdownPct: number };

export type DrawdownResult = {
  curve: DrawdownPoint[];
  maxDrawdown: number;
  maxDrawdownPct: number;
  currentDrawdown: number;
  currentDrawdownPct: number;
};

/** Running-peak-vs-current-equity drawdown — the exact same algorithm
 * `computeMetrics()` uses in `src/lib/backtest/engine.ts` (lines 224-236),
 * applied to the derived balance curve instead of a backtest equity curve.
 * Deliberately does NOT incorporate any prop-firm trailing-drawdown rule —
 * that is a Phase 4C concept (account-configurable, not universal) and
 * mixing it in here would misrepresent this as a real broker/prop
 * drawdown rule when it is not. */
export function computeDrawdown(balanceSeries: BalancePoint[]): DrawdownResult {
  if (balanceSeries.length === 0) {
    return { curve: [], maxDrawdown: 0, maxDrawdownPct: 0, currentDrawdown: 0, currentDrawdownPct: 0 };
  }
  let peak = balanceSeries[0].balance;
  let maxDd = 0;
  let maxDdPct = 0;
  const curve: DrawdownPoint[] = balanceSeries.map((p) => {
    if (p.balance > peak) peak = p.balance;
    const dd = peak - p.balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = ddPct;
    }
    return { time: p.time, drawdown: dd, drawdownPct: ddPct };
  });
  const last = curve[curve.length - 1];
  return {
    curve,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    currentDrawdown: last.drawdown,
    currentDrawdownPct: last.drawdownPct,
  };
}

/**
 * Phase 4B-1: Trading Calendar + Performance Breakdowns.
 *
 * Every function below is a pure grouping over `ClosedTrade[]`, built on the
 * exact same `netPnlForTrade`/`classifyTrade`/`utcDayKey` primitives Phase 4A
 * already established — no second P&L or win/loss definition is introduced
 * here. `summarizeGroup` is the one shared aggregation used by every
 * breakdown so "net P&L", "win rate", etc. can never drift between them.
 */

export type GroupSummary = {
  netPnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses) × 100, breakeven excluded — same convention as
   * `computeDashboardMetrics`. `null` when there are no decisive trades. */
  winRatePct: number | null;
  avgNetTrade: number;
  /** Fewer than 5 trades — see the Phase 4B-1 audit's "low-sample safety"
   * requirement. Never hides or fabricates data, only flags it. Always
   * `false` for an empty (zero-trade) group — "no trades" is a distinct
   * state from "too few trades to trust". */
  isLowSample: boolean;
};

/** Exported so `src/lib/dashboard/journalAnalytics.ts` (Phase 4F) can reuse
 * this exact aggregation as the base of its own `summarizeJournalGroup`,
 * rather than reimplementing net P&L / win-loss-breakeven counting a second
 * time. */
export function summarizeGroup(trades: ClosedTrade[]): GroupSummary {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return { netPnl: 0, tradeCount: 0, wins: 0, losses: 0, winRatePct: null, avgNetTrade: 0, isLowSample: false };
  }
  let netPnl = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const net = netPnlForTrade(t);
    netPnl += net;
    const cls = classifyTrade(t);
    if (cls === "win") wins++;
    else if (cls === "loss") losses++;
  }
  const decisive = wins + losses;
  return {
    netPnl,
    tradeCount,
    wins,
    losses,
    winRatePct: decisive > 0 ? (wins / decisive) * 100 : null,
    avgNetTrade: netPnl / tradeCount,
    isLowSample: tradeCount < 5,
  };
}

export type CalendarDayBucket = GroupSummary & { day: string };

/** One bucket per UTC calendar day that has at least one closed trade,
 * sorted ascending. Days with zero trades are simply absent — the calendar
 * UI fills the rest of the month grid itself. Reuses `utcDayKey`, the same
 * UTC day boundary `dailyPnlSeries`/`dayWinRate` already use. */
export function calendarDayBuckets(trades: ClosedTrade[]): CalendarDayBucket[] {
  const byDay = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const key = utcDayKey(t.closedAt);
    const list = byDay.get(key);
    if (list) list.push(t);
    else byDay.set(key, [t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, ...summarizeGroup(list) }));
}

export type SymbolPerformance = GroupSummary & { symbol: string };

/** Sorted by net P&L descending — best-performing symbol first. */
export function bySymbol(trades: ClosedTrade[]): SymbolPerformance[] {
  const bySym = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const list = bySym.get(t.symbol);
    if (list) list.push(t);
    else bySym.set(t.symbol, [t]);
  }
  return [...bySym.entries()]
    .map(([symbol, list]) => ({ symbol, ...summarizeGroup(list) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export type TradeDirection = "long" | "short";
export type DirectionPerformance = GroupSummary & { direction: TradeDirection };

/** Long = `side === "buy"`, Short = `side === "sell"` — read directly off
 * the OMS's own side field, never inferred from whether the trade won or
 * lost. Always returns both entries, even at zero trades, so the UI has a
 * stable Long/Short layout regardless of data. */
export function byDirection(trades: ClosedTrade[]): DirectionPerformance[] {
  const longs = trades.filter((t) => t.side === "buy");
  const shorts = trades.filter((t) => t.side === "sell");
  return [
    { direction: "long", ...summarizeGroup(longs) },
    { direction: "short", ...summarizeGroup(shorts) },
  ];
}

export type DayOfWeekPerformance = GroupSummary & { dayOfWeek: number; label: string };

const DOW_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** `Date#getUTCDay()` values (0=Sunday..6=Saturday) reordered to Monday-first
 * to match `DOW_LABELS`. */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Monday through Sunday, UTC — always 7 entries in that fixed order, even
 * for days with zero trades, so the calendar-day ordering never reshuffles
 * based on which days happen to have data. */
export function byDayOfWeek(trades: ClosedTrade[]): DayOfWeekPerformance[] {
  const buckets = new Map<number, ClosedTrade[]>();
  for (const t of trades) {
    const dow = new Date(t.closedAt).getUTCDay();
    const list = buckets.get(dow);
    if (list) list.push(t);
    else buckets.set(dow, [t]);
  }
  return DOW_ORDER.map((dow, i) => ({
    dayOfWeek: dow,
    label: DOW_LABELS[i],
    ...summarizeGroup(buckets.get(dow) ?? []),
  }));
}

export type HourOfDayPerformance = GroupSummary & { hourUtc: number };

/** All 24 UTC hours (0-23), always present so a 24-bar visualization stays
 * continuous — hours with no closed trades simply show a zero/empty bucket.
 * Explicitly UTC; there is no per-account trading timezone in this schema
 * (see the Phase 4B audit), so this must never be presented as the viewer's
 * local time. */
export function byHourOfDay(trades: ClosedTrade[]): HourOfDayPerformance[] {
  const buckets = new Map<number, ClosedTrade[]>();
  for (const t of trades) {
    const hour = new Date(t.closedAt).getUTCHours();
    const list = buckets.get(hour);
    if (list) list.push(t);
    else buckets.set(hour, [t]);
  }
  return Array.from({ length: 24 }, (_, hourUtc) => ({
    hourUtc,
    ...summarizeGroup(buckets.get(hourUtc) ?? []),
  }));
}

export type TradingSession = "asia" | "london" | "overlap" | "newYork" | "offHours";
export type SessionPerformance = GroupSummary & { session: TradingSession; label: string };

export const SESSION_LABELS: Record<TradingSession, string> = {
  asia: "Asia",
  london: "London",
  overlap: "London / New York Overlap",
  newYork: "New York",
  offHours: "Off Hours",
};

/** Exported so `src/lib/dashboard/journalAnalytics.ts` (Phase 4F) can lay
 * out the manually-entered journal session breakdown in the exact same
 * fixed order, without redeclaring this list a second time. */
export const SESSION_ORDER: TradingSession[] = ["asia", "london", "overlap", "newYork", "offHours"];

/**
 * Fixed, mutually-exclusive UTC-hour session windows — Asia 00:00–06:59,
 * London 07:00–11:59, London/New York Overlap 12:00–15:59, New York
 * 16:00–20:59, Off Hours 21:00–23:59. This schema has no authoritative
 * per-account/per-exchange timezone (confirmed by the Phase 4B audit), so
 * these boundaries are a deliberate, disclosed APPROXIMATION — real session
 * hours shift with US/UK daylight-saving transitions, which this function
 * does not account for. Every trade falls into exactly one bucket; buckets
 * never overlap.
 */
export function sessionForUtcHour(hourUtc: number): TradingSession {
  if (hourUtc <= 6) return "asia";
  if (hourUtc <= 11) return "london";
  if (hourUtc <= 15) return "overlap";
  if (hourUtc <= 20) return "newYork";
  return "offHours";
}

/** Classified by `closedAt`'s UTC hour — deliberately not sourced from the
 * optional, sparsely-populated free-text `journal_entries.session` field
 * (see the Phase 4B audit: most closed trades have no linked journal entry
 * at all, so building this on top of it would silently under-report). */
export function bySession(trades: ClosedTrade[]): SessionPerformance[] {
  const buckets = new Map<TradingSession, ClosedTrade[]>();
  for (const t of trades) {
    const session = sessionForUtcHour(new Date(t.closedAt).getUTCHours());
    const list = buckets.get(session);
    if (list) list.push(t);
    else buckets.set(session, [t]);
  }
  return SESSION_ORDER.map((session) => ({
    session,
    label: SESSION_LABELS[session],
    ...summarizeGroup(buckets.get(session) ?? []),
  }));
}
