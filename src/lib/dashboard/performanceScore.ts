import type { DailyPnlPoint, DashboardMetrics } from "./metrics";

/**
 * Signal Goat Performance Score (Phase 4B-2) — a transparent, explainable
 * 0-100 score built entirely from the Dashboard's own already-computed real
 * closed-trade analytics (`computeDashboardMetrics`, `dailyPnlSeries`,
 * `computeDrawdown`). Nothing in this file reads Supabase, calls a server
 * function, or renders anything — it is a pure function of numbers the
 * Dashboard has already loaded, so it can be unit-tested and reasoned about
 * in complete isolation from data fetching.
 *
 * Every component formula, weight, and normalization constant here matches
 * the Phase 4B-2 audit exactly (see the conversation history / PR
 * description) — nothing was invented ad hoc during implementation.
 *
 * Design principles carried through every formula below:
 *  - Never `Infinity`/`NaN`: every ratio has an explicit null-or-cap branch
 *    before division, mirroring the same convention `computeDashboardMetrics`
 *    already established for `profitFactor`/`avgWinLossRatio`.
 *  - Zero decisive trades (wins + losses === 0, i.e. `metrics.winRatePct ===
 *    null`) means the WHOLE score is undefined, not a fabricated 0/50 — see
 *    `overallScoreRaw: null` and the confidence/UI contract around it.
 *  - Confidence (sample size) is a SEPARATE signal from the score itself —
 *    it is never multiplied into any score. A 3-trade all-winning account
 *    can legitimately produce a raw score near 100 while simultaneously
 *    reporting "Very Low" confidence; both facts are true and both must be
 *    shown, not blended into one misleading number.
 */

const PF_CAP = 3;
const WL_CAP = 3;
const DD_CAP = 50;
const CV_CAP = 2;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Profit Factor sub-score (18% of the overall weight).
 * `metrics.profitFactor` is `null` in two distinct real-world cases —
 * "no decisive trades at all" and "wins exist but zero losses" — which this
 * function must tell apart (the audit requires 100 for the latter, `null`
 * for the former), using the same signals `computeDashboardMetrics` already
 * exposes: `winRatePct` is `null` exactly when there are no decisive
 * trades, and `avgLosingTrade` is `null` exactly when there are no losses. */
export function pfScoreFor(metrics: DashboardMetrics): number | null {
  if (metrics.winRatePct === null) return null;
  if (metrics.avgLosingTrade === null) return 100;
  const pf = metrics.profitFactor ?? 0;
  return (clamp(pf, 0, PF_CAP) / PF_CAP) * 100;
}

export type ExpectancyDetail = {
  expectancy: number | null;
  expectancyR: number | null;
  score: number | null;
};

/**
 * Expectancy sub-score (12% of the overall weight), normalized against the
 * average realized losing-trade size as an "R" proxy.
 *
 * NOTE — this is a deliberate, disclosed simplification: `v_closed_trades`
 * carries no planned stop-distance-based risk unit (unlike the backtest
 * engine's `rMultiple`, which comes from an actual stop price). Average
 * REALIZED loss size is the best real-data proxy available today for "how
 * much this trader typically risks," not a true planned-risk R-multiple. A
 * discretionary trader with inconsistent stop placement could see this
 * proxy drift from their real risk profile — a known limitation, not a bug.
 */
export function expectancyDetailFor(metrics: DashboardMetrics): ExpectancyDetail {
  if (metrics.winRatePct === null) return { expectancy: null, expectancyR: null, score: null };
  if (metrics.avgLosingTrade === null) return { expectancy: null, expectancyR: null, score: 100 };
  const winRateFrac = metrics.winRatePct / 100;
  const avgWin = metrics.avgWinningTrade ?? 0;
  const avgLoss = metrics.avgLosingTrade; // strictly negative here (losses > 0 by the branch above)
  const expectancy = winRateFrac * avgWin + (1 - winRateFrac) * avgLoss;
  const expectancyR = expectancy / Math.abs(avgLoss);
  const score = ((clamp(expectancyR, -1, 1) + 1) / 2) * 100;
  return { expectancy, expectancyR, score };
}

/** Max/current drawdown sub-scores (20% / 5% of the overall weight) —
 * linear and monotonically decreasing ("progressive" degradation), floored
 * at 0 once drawdown reaches `DD_CAP` (50%). */
export function ddScoreFor(drawdownPct: number): number {
  return clamp(1 - drawdownPct / DD_CAP, 0, 1) * 100;
}

export type ConsistencyDetail = {
  tradingDays: number;
  cv: number | null;
  cvScore: number | null;
  dominanceRatio: number | null;
  dominanceScore: number | null;
  score: number;
};

/**
 * Consistency sub-score (20% of the overall weight) — real UTC trading-day
 * net P&L only (`dailyPnlSeries`'s output), never raw trade-level P&L.
 *
 * Two independent checks, combined with `min()` (not an average) so EITHER
 * a scale-normalized day-to-day volatility problem OR a single-day-
 * dominance problem caps the score — an average would let one bad signal
 * hide behind a good one, which would defeat the point of a consistency
 * check.
 *
 * Fewer than 5 distinct trading days returns a neutral 50, NOT a reward for
 * trading less and NOT a claim that the trader is "consistent" — sample
 * confidence communicates the lack of history separately (see
 * `confidenceFor`).
 */
export function consistencyScoreFor(dailyPnls: DailyPnlPoint[]): ConsistencyDetail {
  const tradingDays = dailyPnls.length;
  if (tradingDays < 5) {
    return { tradingDays, cv: null, cvScore: null, dominanceRatio: null, dominanceScore: null, score: 50 };
  }

  const values = dailyPnls.map((d) => d.netPnl);
  const meanAbsDay = values.reduce((s, v) => s + Math.abs(v), 0) / values.length;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdevDay = Math.sqrt(variance);
  const cv = meanAbsDay > 0 ? stdevDay / meanAbsDay : 0;
  const cvScore = clamp(1 - cv / CV_CAP, 0, 1) * 100;

  const positiveDayPnls = values.filter((v) => v > 0);
  const totalPositivePnl = positiveDayPnls.reduce((s, v) => s + v, 0);
  const largestPositiveDay = positiveDayPnls.length > 0 ? Math.max(...positiveDayPnls) : 0;
  const dominanceRatio = totalPositivePnl > 0 ? largestPositiveDay / totalPositivePnl : 0;
  const dominanceScore = clamp(1 - Math.max(0, dominanceRatio - 0.3) / 0.7, 0, 1) * 100;

  return { tradingDays, cv, cvScore, dominanceRatio, dominanceScore, score: Math.min(cvScore, dominanceScore) };
}

/** Trade Quality sub-score (15% of the overall weight) — average Win/Loss
 * ratio ONLY, deliberately excluding win rate (which has its own separate
 * 10% category) to avoid double-weighting the same underlying statistic. */
export function tradeQualityScoreFor(metrics: DashboardMetrics): number | null {
  if (metrics.winRatePct === null) return null;
  if (metrics.avgLosingTrade === null) return 100;
  const ratio = metrics.avgWinLossRatio ?? 0;
  return (clamp(ratio, 0, WL_CAP) / WL_CAP) * 100;
}

/** Win Rate sub-score (10% of the overall weight) — the Dashboard's own
 * decisive win rate, already 0-100, breakeven trades already excluded from
 * its denominator by `computeDashboardMetrics`. No further transformation. */
export function winRateScoreFor(metrics: DashboardMetrics): number | null {
  return metrics.winRatePct;
}

export type ConfidenceLabel = "Very Low" | "Low" | "Moderate" | "Good" | "Strong";

export type ConfidenceInfo = {
  label: ConfidenceLabel;
  totalTrades: number;
  /** Trades still needed to reach the next confidence band, or `null` once
   * already at the top ("Strong"). */
  nextThreshold: number | null;
};

const CONFIDENCE_BANDS: { max: number; label: ConfidenceLabel }[] = [
  { max: 9, label: "Very Low" },
  { max: 24, label: "Low" },
  { max: 49, label: "Moderate" },
  { max: 99, label: "Good" },
];

/**
 * Sample-size confidence — kept STRICTLY SEPARATE from the Performance
 * Score. Uses `totalTrades` (every closed trade, including breakevens —
 * confidence is about how much closed-trade history exists, not how many
 * of those trades happened to be decisive). Never multiplies into the score.
 */
export function confidenceFor(totalTrades: number): ConfidenceInfo {
  for (const band of CONFIDENCE_BANDS) {
    if (totalTrades <= band.max) {
      return { label: band.label, totalTrades, nextThreshold: band.max + 1 };
    }
  }
  return { label: "Strong", totalTrades, nextThreshold: null };
}

export type PerformanceScoreCategories = {
  profitability: number | null;
  riskManagement: number;
  consistency: number;
  tradeQuality: number | null;
  winRate: number | null;
};

export type PerformanceScoreDetail = {
  profitFactor: number | null;
  pfScore: number | null;
  expectancy: number | null;
  expectancyR: number | null;
  expectancyScore: number | null;
  maxDrawdownPct: number;
  maxDdScore: number;
  currentDrawdownPct: number;
  currentDdScore: number;
  avgWinLossRatio: number | null;
  tradeQualityScore: number | null;
  winRatePct: number | null;
  winRateScore: number | null;
  tradingDays: number;
  consistencyScore: number;
  dominanceRatio: number | null;
};

export type PerformanceScoreResult = {
  /** Exact unrounded 0-100 value, or `null` when there are zero decisive
   * (win or loss) trades — never a fabricated 0/50 in that case. */
  overallScoreRaw: number | null;
  /** Rounded to the nearest integer for display, or `null`. */
  overallScoreDisplay: number | null;
  categories: PerformanceScoreCategories;
  confidence: ConfidenceInfo;
  detail: PerformanceScoreDetail;
};

/**
 * The single entry point — pure, synchronous, no I/O. Consumes exactly the
 * analytics the Dashboard route already computes:
 * `computeDashboardMetrics(trades)`, `dailyPnlSeries(trades)`, and
 * `computeDrawdown(derivedBalanceSeries(...))`'s `maxDrawdownPct`/
 * `currentDrawdownPct` — never re-derives P&L or drawdown itself.
 */
export function computePerformanceScore(
  metrics: DashboardMetrics,
  dailyPnls: DailyPnlPoint[],
  maxDrawdownPct: number,
  currentDrawdownPct: number,
): PerformanceScoreResult {
  const pfScore = pfScoreFor(metrics);
  const { expectancy, expectancyR, score: expectancyScore } = expectancyDetailFor(metrics);
  const maxDdScore = ddScoreFor(maxDrawdownPct);
  const currentDdScore = ddScoreFor(currentDrawdownPct);
  const { tradingDays, dominanceRatio, score: consistencyScore } = consistencyScoreFor(dailyPnls);
  const tradeQualityScore = tradeQualityScoreFor(metrics);
  const winRateScore = winRateScoreFor(metrics);

  // Category display scores — normalized back to a 0-100 scale within their
  // own weight budget, purely for the UI's category bars. The overall score
  // below uses the real 18/12/20/5/... weights directly, never this display
  // re-normalization.
  const riskManagement = (0.2 * maxDdScore + 0.05 * currentDdScore) / 0.25;
  const profitability = pfScore == null || expectancyScore == null ? null : (0.18 * pfScore + 0.12 * expectancyScore) / 0.3;

  const noDecisiveTrades = metrics.winRatePct === null;
  const overallScoreRaw = noDecisiveTrades
    ? null
    : clamp(
        0.18 * (pfScore as number) +
          0.12 * (expectancyScore as number) +
          0.2 * maxDdScore +
          0.05 * currentDdScore +
          0.2 * consistencyScore +
          0.15 * (tradeQualityScore as number) +
          0.1 * (winRateScore as number),
        0,
        100,
      );

  return {
    overallScoreRaw,
    overallScoreDisplay: overallScoreRaw == null ? null : Math.round(overallScoreRaw),
    categories: {
      profitability,
      riskManagement,
      consistency: consistencyScore,
      tradeQuality: tradeQualityScore,
      winRate: winRateScore,
    },
    confidence: confidenceFor(metrics.totalTrades),
    detail: {
      profitFactor: metrics.profitFactor,
      pfScore,
      expectancy,
      expectancyR,
      expectancyScore,
      maxDrawdownPct,
      maxDdScore,
      currentDrawdownPct,
      currentDdScore,
      avgWinLossRatio: metrics.avgWinLossRatio,
      tradeQualityScore,
      winRatePct: metrics.winRatePct,
      winRateScore,
      tradingDays,
      consistencyScore,
      dominanceRatio,
    },
  };
}
