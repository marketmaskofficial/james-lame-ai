import type { PerformanceScoreResult } from "@/lib/dashboard/performanceScore";

/**
 * Phase 4B-2 Performance Score card. Score ring/gauge on the left, five
 * weighted component bars on the right (never a radar chart — see the
 * Phase 4B-2 audit for why), plus a collapsible "How it's calculated"
 * disclosure so the score never reads as a black box. Purely a renderer of
 * `PerformanceScoreResult` — every number it shows was computed by
 * `computePerformanceScore` in `src/lib/dashboard/performanceScore.ts`;
 * nothing here recomputes or estimates anything.
 */

const RING_SIZE = 124;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type Tone = "good" | "medium" | "poor" | "neutral";

function toneFor(score: number | null): Tone {
  if (score == null) return "neutral";
  if (score >= 70) return "good";
  if (score >= 40) return "medium";
  return "poor";
}

const RING_TONE_STROKE: Record<Tone, string> = {
  good: "stroke-emerald-400",
  medium: "stroke-amber-400",
  poor: "stroke-red-400",
  neutral: "stroke-muted",
};

const TEXT_TONE_CLASS: Record<Tone, string> = {
  good: "text-emerald-400",
  medium: "text-amber-400",
  poor: "text-red-400",
  neutral: "text-muted-foreground",
};

const BAR_TONE_CLASS: Record<Tone, string> = {
  good: "bg-emerald-400",
  medium: "bg-amber-400",
  poor: "bg-red-400",
  neutral: "bg-muted-foreground/40",
};

const CONFIDENCE_TONE_CLASS: Record<string, string> = {
  "Very Low": "border-red-900/60 bg-red-950/30 text-red-300",
  Low: "border-amber-900/60 bg-amber-950/30 text-amber-300",
  Moderate: "border-amber-800/50 bg-amber-950/20 text-amber-200",
  Good: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
  Strong: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function ratio(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}
function money(n: number | null): string {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function ScoreRing({ result }: { result: PerformanceScoreResult }) {
  // Tone, arc fill, and the shown number all derive from the same rounded
  // `overallScoreDisplay` value — never the unrounded `overallScoreRaw` —
  // so a displayed "70" can never render with the tier color for "69.6".
  // `overallScoreRaw` remains the source of truth for the actual
  // calculation and the "How it's calculated" transparency panel below.
  const score = result.overallScoreDisplay;
  const tone = toneFor(score);
  const offset = RING_CIRCUMFERENCE * (1 - (score ?? 0) / 100);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} strokeWidth={RING_STROKE} className="fill-none stroke-muted" />
          {score != null && (
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
              className={`fill-none transition-all ${RING_TONE_STROKE[tone]}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score == null ? (
            <span className="text-3xl font-bold tabular-nums text-muted-foreground">—</span>
          ) : (
            <span className={`text-3xl font-bold tabular-nums ${TEXT_TONE_CLASS[tone]}`}>{score}</span>
          )}
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {score == null ? "Not enough decisive trades" : "Performance Score"}
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
              CONFIDENCE_TONE_CLASS[result.confidence.label] ?? "border-border bg-muted/30 text-muted-foreground"
            }`}
          >
            {result.confidence.label} confidence
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{result.confidence.totalTrades} trades</span>
        </div>
      </div>
    </div>
  );
}

function CategoryBar({ label, weight, score }: { label: string; weight: string; score: number | null }) {
  // Same rounded-consistency rule as ScoreRing: the displayed integer, the
  // bar's fill width, and its tone all derive from one rounded value so
  // they can never disagree with each other.
  const displayScore = score == null ? null : Math.round(score);
  const tone = toneFor(displayScore);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">
          {label} <span className="text-muted-foreground">· {weight}</span>
        </span>
        <span className={`tabular-nums font-semibold ${TEXT_TONE_CLASS[tone]}`}>{displayScore == null ? "—" : displayScore}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        <div className={`h-full rounded-full ${BAR_TONE_CLASS[tone]}`} style={{ width: `${displayScore ?? 0}%` }} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className="font-medium">{value}</span>
        {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
      </span>
    </div>
  );
}

export function PerformanceScore({ result }: { result: PerformanceScoreResult }) {
  const { categories, detail } = result;
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex justify-center sm:shrink-0">
          <ScoreRing result={result} />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2">
          <CategoryBar label="Profitability" weight="30%" score={categories.profitability} />
          <CategoryBar label="Risk Management" weight="25%" score={categories.riskManagement} />
          <CategoryBar label="Consistency" weight="20%" score={categories.consistency} />
          <CategoryBar label="Trade Quality" weight="15%" score={categories.tradeQuality} />
          <CategoryBar label="Win Rate" weight="10%" score={categories.winRate} />
        </div>
      </div>

      <details className="group mt-2 border-t border-border/60 pt-1.5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
          How it&apos;s calculated
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-x-6 divide-y divide-border/40 sm:grid-cols-2 sm:divide-y-0">
          <div className="divide-y divide-border/40">
            <DetailRow label="Profit Factor" value={ratio(detail.profitFactor)} note="gross profit ÷ gross loss" />
            <DetailRow
              label="Expectancy"
              value={money(detail.expectancy)}
              note={detail.expectancyR == null ? undefined : `${detail.expectancyR.toFixed(2)}R avg`}
            />
            <DetailRow label="Avg Win/Loss Ratio" value={ratio(detail.avgWinLossRatio)} note="avg win ÷ avg loss" />
            <DetailRow label="Win Rate" value={pct(detail.winRatePct)} note="decisive trades only" />
          </div>
          <div className="divide-y divide-border/40">
            <DetailRow label="Max Drawdown" value={pct(detail.maxDrawdownPct)} />
            <DetailRow label="Current Drawdown" value={pct(detail.currentDrawdownPct)} />
            <DetailRow label="Trading Days" value={String(detail.tradingDays)} />
            <DetailRow
              label="Largest Day Concentration"
              value={detail.dominanceRatio == null ? "—" : `${(detail.dominanceRatio * 100).toFixed(0)}%`}
              note={detail.dominanceRatio == null ? undefined : "of profitable days' P&L"}
            />
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Profitability = Profit Factor (18%) + Expectancy (12%). Risk Management = Max Drawdown (20%) + Current Drawdown (5%). Consistency
          rewards steady day-to-day results and penalizes one outlier day dominating total profit. Trade Quality uses Avg Win/Loss ratio only
          (Win Rate is scored separately so it isn't counted twice). Expectancy is normalized against average realized loss size as a risk
          proxy, not a planned stop-based R-multiple.
        </p>
      </details>
    </div>
  );
}
