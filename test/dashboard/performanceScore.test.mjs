// Coverage for the Phase 4B-2 Performance Score engine:
// src/lib/dashboard/performanceScore.ts. Pure, synchronous, no I/O — every
// test here either hand-builds a `DashboardMetrics`-shaped fixture (for
// tight control over edge cases) or exercises the exported sub-score
// functions directly. The 8 synthetic trader profiles from the Phase 4B-2
// audit are encoded as regression tests with sensible RANGES, not brittle
// exact decimals, per the implementation instructions.
//
// Usage: npx tsx test/dashboard/performanceScore.test.mjs

import {
  pfScoreFor,
  expectancyDetailFor,
  ddScoreFor,
  consistencyScoreFor,
  tradeQualityScoreFor,
  winRateScoreFor,
  confidenceFor,
  computePerformanceScore,
} from "../../src/lib/dashboard/performanceScore.ts";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}
function close(name, actual, expected, eps = 1e-6) {
  ok(`${name} (${actual} ~= ${expected})`, typeof actual === "number" && Math.abs(actual - expected) <= eps);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} (${a} === ${e})`, a === e);
}
function inRange(name, actual, lo, hi) {
  ok(`${name} (${actual} in [${lo}, ${hi}])`, typeof actual === "number" && actual >= lo && actual <= hi);
}
function isFiniteNum(name, actual) {
  ok(`${name} is a finite number, not Infinity/NaN (${actual})`, typeof actual === "number" && Number.isFinite(actual));
}

/** A minimal DashboardMetrics-shaped fixture — only the fields
 * performanceScore.ts actually reads. */
function metrics(overrides) {
  return {
    netPnl: 0,
    winRatePct: null,
    profitFactor: null,
    dayWinRatePct: null,
    avgWinningTrade: null,
    avgLosingTrade: null,
    avgWinLossRatio: null,
    totalTrades: 0,
    ...overrides,
  };
}

function days(values) {
  return values.map((netPnl, i) => ({ day: `2026-01-${String(i + 1).padStart(2, "0")}`, netPnl, tradeCount: 1 }));
}

// ==== pfScoreFor ============================================================
{
  eq("pfScoreFor: no decisive trades -> null", pfScoreFor(metrics({ winRatePct: null })), null);
  eq(
    "pfScoreFor: wins but zero losses -> 100",
    pfScoreFor(metrics({ winRatePct: 100, avgWinningTrade: 500, avgLosingTrade: null, profitFactor: null })),
    100,
  );
  close("pfScoreFor: PF=1.5 -> 50", pfScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, profitFactor: 1.5 })), 50);
  close("pfScoreFor: PF=3 (exactly at cap) -> 100", pfScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, profitFactor: 3 })), 100);
  close("pfScoreFor: PF=10 (far past cap) still clamps to 100", pfScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, profitFactor: 10 })), 100);
  close("pfScoreFor: PF=0 (no wins, only losses) -> 0", pfScoreFor(metrics({ winRatePct: 0, avgLosingTrade: -100, profitFactor: 0 })), 0);
}

// ==== expectancyDetailFor ====================================================
{
  eq("expectancyDetailFor: no decisive trades -> null score", expectancyDetailFor(metrics({ winRatePct: null })).score, null);
  eq(
    "expectancyDetailFor: wins but zero losses -> 100",
    expectancyDetailFor(metrics({ winRatePct: 100, avgWinningTrade: 500, avgLosingTrade: null })).score,
    100,
  );
  // winRate=50%, avgWin=100, avgLoss=-100 -> expectancy = 0.5*100 + 0.5*(-100) = 0 -> expectancyR=0 -> score=50
  close(
    "expectancyDetailFor: zero expectancy (breakeven system) -> score 50",
    expectancyDetailFor(metrics({ winRatePct: 50, avgWinningTrade: 100, avgLosingTrade: -100 })).score,
    50,
  );
  // winRate=70%, avgWin=200, avgLoss=-100 -> expectancy=0.7*200+0.3*(-100)=140-30=110 -> expectancyR=110/100=1.1 (clamped to 1) -> score=100
  close(
    "expectancyDetailFor: strongly positive expectancy clamps to 100",
    expectancyDetailFor(metrics({ winRatePct: 70, avgWinningTrade: 200, avgLosingTrade: -100 })).score,
    100,
  );
  // winRate=20%, avgWin=50, avgLoss=-300 -> expectancy=0.2*50+0.8*(-300)=10-240=-230 -> expectancyR=-230/300=-0.767 -> score=(−0.767+1)/2*100=11.67
  close(
    "expectancyDetailFor: negative expectancy scores below 50",
    expectancyDetailFor(metrics({ winRatePct: 20, avgWinningTrade: 50, avgLosingTrade: -300 })).score,
    ((-230 / 300 + 1) / 2) * 100,
  );
  // expectancyR is mathematically bounded at -1 (reached only in the limit
  // of winRatePct=0, covered by the "no wins at all" case below) since
  // expectancy = winRate*avgWin + (1-winRate)*avgLoss can never fall below
  // avgLoss itself — so a near-zero win rate approaches, but never clamps
  // past, the score-0 floor. Verify it stays in-bounds and never negative.
  const nearFloor = expectancyDetailFor(metrics({ winRatePct: 5, avgWinningTrade: 10, avgLosingTrade: -1000 })).score;
  inRange("expectancyDetailFor: near-zero win rate approaches the score-0 floor without going negative", nearFloor, 0, 5);
  // No wins at all (avgWinningTrade null), only losses -> avgWin treated as 0.
  const noWins = expectancyDetailFor(metrics({ winRatePct: 0, avgWinningTrade: null, avgLosingTrade: -100 }));
  close("expectancyDetailFor: no wins at all -> expectancy equals avgLoss", noWins.expectancy, -100);
  close("expectancyDetailFor: no wins at all -> score 0", noWins.score, 0);
}

// ==== ddScoreFor =============================================================
{
  close("ddScoreFor: 0% drawdown -> 100", ddScoreFor(0), 100);
  close("ddScoreFor: 25% drawdown -> 50", ddScoreFor(25), 50);
  close("ddScoreFor: 50% drawdown (at cap) -> 0", ddScoreFor(50), 0);
  close("ddScoreFor: 100% drawdown floors at 0, never negative", ddScoreFor(100), 0);
  close("ddScoreFor: 75% drawdown floors at 0", ddScoreFor(75), 0);
}

// ==== consistencyScoreFor ====================================================
{
  eq("consistencyScoreFor: fewer than 5 trading days -> neutral 50 regardless of values", consistencyScoreFor(days([500, -500])).score, 50);
  eq("consistencyScoreFor: zero trading days -> neutral 50", consistencyScoreFor([]).score, 50);

  const smooth = consistencyScoreFor(days([50, 60, 45, 55, 52, 48]));
  ok("consistencyScoreFor: smooth profitable days scores high", smooth.score > 80);

  // One giant outlier day among many small ones — must be materially penalized.
  const outlier = consistencyScoreFor(days([10, 12, 9, 11, 8, 5000, 10]));
  ok("consistencyScoreFor: one giant outlier day scores low (dominance penalty)", outlier.score < 30);
  ok("consistencyScoreFor: outlier day's dominanceRatio is high", outlier.dominanceRatio > 0.9);

  // Consistently losing (same value every day) -> perfectly "consistent" by
  // this formula's definition, even though the trader is unprofitable.
  // Consistency measures repeatability, not profitability — documented
  // Phase 4B-2 audit nuance, asserted explicitly here so it's never
  // mistaken for a bug later.
  const consistentLoser = consistencyScoreFor(days([-50, -50, -50, -50, -50]));
  close("consistencyScoreFor: identical losing days -> perfect consistency score (measures repeatability, not profit)", consistentLoser.score, 100);
}

// ==== tradeQualityScoreFor ====================================================
{
  eq("tradeQualityScoreFor: no decisive trades -> null", tradeQualityScoreFor(metrics({ winRatePct: null })), null);
  eq(
    "tradeQualityScoreFor: wins but zero losses -> 100",
    tradeQualityScoreFor(metrics({ winRatePct: 100, avgLosingTrade: null })),
    100,
  );
  close("tradeQualityScoreFor: W/L=1.5 -> 50", tradeQualityScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, avgWinLossRatio: 1.5 })), 50);
  close("tradeQualityScoreFor: W/L=3 (at cap) -> 100", tradeQualityScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, avgWinLossRatio: 3 })), 100);
  close(
    "tradeQualityScoreFor: W/L=8 (far past cap) still clamps to 100",
    tradeQualityScoreFor(metrics({ winRatePct: 50, avgLosingTrade: -1, avgWinLossRatio: 8 })),
    100,
  );
}

// ==== winRateScoreFor ========================================================
{
  eq("winRateScoreFor: no decisive trades -> null", winRateScoreFor(metrics({ winRatePct: null })), null);
  close("winRateScoreFor: passes decisive win rate straight through", winRateScoreFor(metrics({ winRatePct: 63 })), 63);
}

// ==== confidenceFor ===========================================================
{
  eq("confidenceFor: 0 trades -> Very Low", confidenceFor(0).label, "Very Low");
  eq("confidenceFor: 7 trades -> Very Low (the real hosted account today)", confidenceFor(7).label, "Very Low");
  eq("confidenceFor: 9 trades -> Very Low", confidenceFor(9).label, "Very Low");
  eq("confidenceFor: 10 trades -> Low", confidenceFor(10).label, "Low");
  eq("confidenceFor: 24 trades -> Low", confidenceFor(24).label, "Low");
  eq("confidenceFor: 25 trades -> Moderate", confidenceFor(25).label, "Moderate");
  eq("confidenceFor: 49 trades -> Moderate", confidenceFor(49).label, "Moderate");
  eq("confidenceFor: 50 trades -> Good", confidenceFor(50).label, "Good");
  eq("confidenceFor: 99 trades -> Good", confidenceFor(99).label, "Good");
  eq("confidenceFor: 100 trades -> Strong", confidenceFor(100).label, "Strong");
  eq("confidenceFor: 500 trades -> Strong", confidenceFor(500).label, "Strong");
  eq("confidenceFor: nextThreshold at Very Low", confidenceFor(3).nextThreshold, 10);
  eq("confidenceFor: nextThreshold is null once Strong", confidenceFor(200).nextThreshold, null);
  eq("confidenceFor: totalTrades echoed back", confidenceFor(42).totalTrades, 42);
}

// ==== computePerformanceScore: integration + null-overall gating ============
{
  // Zero decisive trades (e.g. every closed trade was an exact breakeven).
  const allBreakeven = metrics({ winRatePct: null, profitFactor: null, avgWinningTrade: null, avgLosingTrade: null, avgWinLossRatio: null, totalTrades: 10 });
  const r = computePerformanceScore(allBreakeven, [], 0, 0);
  eq("computePerformanceScore: zero decisive trades -> overallScoreRaw null", r.overallScoreRaw, null);
  eq("computePerformanceScore: zero decisive trades -> overallScoreDisplay null", r.overallScoreDisplay, null);
  eq("computePerformanceScore: zero decisive trades -> profitability category null", r.categories.profitability, null);
  eq("computePerformanceScore: zero decisive trades -> tradeQuality category null", r.categories.tradeQuality, null);
  eq("computePerformanceScore: zero decisive trades -> winRate category null", r.categories.winRate, null);
  ok("computePerformanceScore: risk/consistency still compute even with zero decisive trades", r.categories.riskManagement === 100 && r.categories.consistency === 50);

  // Perfect/capped inputs across every component -> overall exactly 100
  // (weights sum to 1.0, so 100*1.0 = 100 exactly).
  const perfect = metrics({ winRatePct: 100, avgWinningTrade: 500, avgLosingTrade: null, profitFactor: null, avgWinLossRatio: null, totalTrades: 50 });
  const perfectResult = computePerformanceScore(perfect, days([100, 100, 100, 100, 100]), 0, 0);
  close("computePerformanceScore: every capped/perfect input -> overall exactly 100", perfectResult.overallScoreRaw, 100);
  eq("computePerformanceScore: perfect inputs -> display score 100", perfectResult.overallScoreDisplay, 100);

  // No-Infinity/no-NaN sweep across a range of edge-case metric shapes.
  const edgeCases = [
    metrics({ winRatePct: 0, avgLosingTrade: -1, profitFactor: 0, avgWinLossRatio: 0, totalTrades: 5 }),
    metrics({ winRatePct: 100, avgWinningTrade: 1, avgLosingTrade: null, totalTrades: 1 }),
    metrics({ winRatePct: 50, avgWinningTrade: 0, avgLosingTrade: 0 === 0 ? -0.0001 : 0, profitFactor: 1, avgWinLossRatio: 1, totalTrades: 8 }),
    metrics({ winRatePct: null, totalTrades: 0 }),
  ];
  for (const [i, m] of edgeCases.entries()) {
    const res = computePerformanceScore(m, [], 100, 100);
    if (res.overallScoreRaw != null) isFiniteNum(`edge case ${i}: overallScoreRaw finite`, res.overallScoreRaw);
    isFiniteNum(`edge case ${i}: riskManagement finite`, res.categories.riskManagement);
    isFiniteNum(`edge case ${i}: consistency finite`, res.categories.consistency);
    if (res.overallScoreRaw != null) inRange(`edge case ${i}: overallScoreRaw in [0,100]`, res.overallScoreRaw, 0, 100);
  }
}

// ==== 8 synthetic trader profiles (Phase 4B-2 audit regression cases) ========
// Ranges, not exact decimals — these hand-derived approximations match the
// audit's own worked examples; the point is directional correctness, not a
// brittle pinned decimal.

// 1. High win rate, terrible risk/reward (80% WR, avg loss 8x avg win).
{
  const m = metrics({ winRatePct: 80, avgWinningTrade: 50, avgLosingTrade: -400, profitFactor: 0.5, avgWinLossRatio: 0.125, totalTrades: 10 });
  const r = computePerformanceScore(m, days([10, -20, 15]), 35, 20);
  inRange("Profile 1 (high WR, terrible R:R) scores poorly despite 80% win rate", r.overallScoreRaw, 0, 45);
}

// 2. Low win rate, strong profit factor / R:R (35% WR, PF 1.6, W/L 3.0).
{
  const m = metrics({ winRatePct: 35, avgWinningTrade: 600, avgLosingTrade: -200, profitFactor: 1.615, avgWinLossRatio: 3, totalTrades: 100 });
  const r = computePerformanceScore(m, days([10, -20, 15]), 15, 5);
  inRange("Profile 2 (low WR, strong R:R) scores well despite only 35% win rate", r.overallScoreRaw, 55, 100);
}

// 3. Consistent profitable trader.
let profile3Score;
{
  const m = metrics({ winRatePct: 55, avgWinningTrade: 300, avgLosingTrade: -200, profitFactor: 1.833, avgWinLossRatio: 1.5, totalTrades: 100 });
  const r = computePerformanceScore(m, days([50, 60, 45, 55, 52, 48]), 10, 2);
  inRange("Profile 3 (consistent profitable trader) scores in the good range", r.overallScoreRaw, 60, 90);
  profile3Score = r.overallScoreRaw;
}

// 4. One giant winning day, many mediocre days -> Consistency collapses.
{
  const m = metrics({ winRatePct: 60, avgWinningTrade: 300, avgLosingTrade: -150, profitFactor: 2.5, avgWinLossRatio: 2, totalTrades: 40 });
  const r = computePerformanceScore(m, days([10, 12, 9, 11, 8, 5000, 10]), 10, 5);
  ok("Profile 4 (one giant winning day) Consistency category scores materially low", r.categories.consistency < 30);
}

// 5. Strong returns but severe (45%) drawdown -> meaningfully lower than the
// otherwise-similar Profile 3 (which had only a 10% drawdown).
{
  const m = metrics({ winRatePct: 55, avgWinningTrade: 300, avgLosingTrade: -200, profitFactor: 1.833, avgWinLossRatio: 1.5, totalTrades: 100 });
  const r = computePerformanceScore(m, days([10, -20, 15]), 45, 10);
  inRange("Profile 5 (severe drawdown) overall score", r.overallScoreRaw, 30, 60);
  ok("Profile 5 (severe drawdown) scores materially lower than Profile 3's similar-but-low-drawdown profile", r.overallScoreRaw < profile3Score - 10);
}

// 6. Breakeven trader — every trade nets exactly zero.
{
  const m = metrics({ winRatePct: null, profitFactor: null, avgWinningTrade: null, avgLosingTrade: null, avgWinLossRatio: null, totalTrades: 15, netPnl: 0 });
  const r = computePerformanceScore(m, [], 0, 0);
  eq("Profile 6 (all-breakeven trader) -> overall null, never a fabricated number", r.overallScoreRaw, null);
}

// 7. Losing trader.
{
  const m = metrics({ winRatePct: 30, avgWinningTrade: 100, avgLosingTrade: -150, profitFactor: 0.2857, avgWinLossRatio: 0.667, totalTrades: 100 });
  const r = computePerformanceScore(m, days([10, -20, 15]), 40, 25);
  inRange("Profile 7 (losing trader) scores poorly", r.overallScoreRaw, 0, 40);
}

// 8. No-loss / very small sample (3 winning trades) — high raw score BUT
// confidence must remain Very Low. This is the single most important
// behavior the whole confidence system exists to demonstrate.
{
  const m = metrics({ winRatePct: 100, avgWinningTrade: 200, avgLosingTrade: null, profitFactor: null, avgWinLossRatio: null, totalTrades: 3 });
  const r = computePerformanceScore(m, days([100, 100]), 0, 0);
  ok("Profile 8 (3 all-winning trades) produces a high raw score", r.overallScoreRaw >= 80);
  eq("Profile 8 (3 all-winning trades) confidence remains Very Low despite the high score", r.confidence.label, "Very Low");
  eq("Profile 8 confidence.totalTrades reflects the tiny sample", r.confidence.totalTrades, 3);
}

// ==== deterministic 0-100 clamping sweep =====================================
{
  const sweepInputs = [
    metrics({ winRatePct: 100, avgWinningTrade: 999999, avgLosingTrade: null, totalTrades: 3 }),
    metrics({ winRatePct: 0, avgLosingTrade: -999999, profitFactor: 0, avgWinLossRatio: 0, totalTrades: 3 }),
    metrics({ winRatePct: 50, avgWinningTrade: 100, avgLosingTrade: -100, profitFactor: 1, avgWinLossRatio: 1, totalTrades: 20 }),
  ];
  const ddSweep = [0, 10, 25, 49, 50, 60, 100, 500];
  for (const m of sweepInputs) {
    for (const dd of ddSweep) {
      const r = computePerformanceScore(m, days([100, -50, 80, -30, 60]), dd, dd);
      if (r.overallScoreRaw != null) {
        inRange(`clamping sweep: overallScoreRaw always in [0,100] (dd=${dd})`, r.overallScoreRaw, 0, 100);
        isFiniteNum(`clamping sweep: overallScoreRaw finite (dd=${dd})`, r.overallScoreRaw);
      }
      inRange(`clamping sweep: riskManagement always in [0,100] (dd=${dd})`, r.categories.riskManagement, 0, 100);
    }
  }
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
