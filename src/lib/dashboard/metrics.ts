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
