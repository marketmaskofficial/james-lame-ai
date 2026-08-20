import { useMemo } from "react";
import { computeMarketStats, SESSION_LABELS, type SessionId } from "@/lib/workspace/marketStats";
import type { WidgetInstance, ChartInstanceOption } from "@/lib/workspace/types";

export type MarketStatsConfig = NonNullable<WidgetInstance["marketStatsConfig"]>;

export const DEFAULT_MARKET_STATS_CONFIG: MarketStatsConfig = {
  session: "day",
  boundChartInstanceId: "active",
};

const SESSION_OPTIONS: SessionId[] = ["day", "asia", "london", "newyork"];

type Props = {
  chartInstances: ChartInstanceOption[];
  activeChartInstanceId: string;
  config: MarketStatsConfig | undefined;
  onConfigChange: (next: MarketStatsConfig) => void;
};

/**
 * Dock widget (UI-4h-5): a compact, real market/session statistics readout —
 * current price, a selectable UTC-session's open/high/low/range/%chg/volume,
 * previous UTC day's high/low/close, distance from the session's high/low,
 * and ATR(14) — computed entirely from a bound chart's already-real OHLCV
 * bars (see src/lib/workspace/marketStats.ts for the exact math and the
 * documented UTC hour ranges each session label uses). Zero new fetch, zero
 * fabricated data: every number here is derived from the same bars the chart
 * itself renders. ATR reuses stdlib's existing `atr()` (src/lib/sgscript/
 * stdlib.ts) rather than a new implementation.
 *
 * Same singleton + `boundChartInstanceId` binding convention as Volume
 * Profile/Watchlist/Alerts — defaults to whichever chart currently has
 * focus, or pins to a specific open chart instance independently of focus.
 */
export function MarketStatsPanel({ chartInstances, activeChartInstanceId, config, onConfigChange }: Props) {
  const cfg = config ?? DEFAULT_MARKET_STATS_CONFIG;

  const boundInstanceId =
    cfg.boundChartInstanceId !== "active" &&
    chartInstances.some((c) => c.instanceId === cfg.boundChartInstanceId)
      ? cfg.boundChartInstanceId
      : activeChartInstanceId;
  const bound = chartInstances.find((c) => c.instanceId === boundInstanceId);
  const bars = bound?.bars ?? [];

  const stats = useMemo(() => computeMarketStats(bars, cfg.session), [bars, cfg.session]);

  const lastClose = bars.at(-1)?.close ?? 0;
  const decimals = lastClose >= 100 ? 2 : 6;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: decimals });
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  if (bars.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
        Waiting for bars to load on {bound?.label ?? "the bound chart"}…
      </div>
    );
  }

  const Row = ({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) => (
    <div className="flex items-center justify-between px-2 py-1 font-mono text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Market Stats</span>
        {chartInstances.length > 1 && (
          <select
            title="Which chart this is bound to"
            value={cfg.boundChartInstanceId}
            onChange={(e) => onConfigChange({ ...cfg, boundChartInstanceId: e.target.value })}
            className="h-6 rounded-[6px] border border-border bg-card px-1 text-[10px] outline-none focus:border-brand"
          >
            <option value="active">Active chart</option>
            {chartInstances.map((c) => (
              <option key={c.instanceId} value={c.instanceId}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-[10px]">
        <span className="text-muted-foreground">Session</span>
        <select
          value={cfg.session}
          onChange={(e) => onConfigChange({ ...cfg, session: e.target.value as SessionId })}
          className="h-6 rounded-[6px] border border-border bg-card px-1 outline-none focus:border-brand"
        >
          {SESSION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SESSION_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-border px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Current price</div>
          <div className="font-mono text-base text-foreground">{fmt(stats.currentPrice)}</div>
        </div>

        <div className="border-b border-border py-0.5">
          <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            {SESSION_LABELS[cfg.session]} session
          </div>
          {stats.session ? (
            <>
              <Row label="Open" value={fmt(stats.session.open)} />
              <Row label="High" value={fmt(stats.session.high)} />
              <Row label="Low" value={fmt(stats.session.low)} />
              <Row label="Range" value={fmt(stats.session.range)} />
              <Row
                label="% Change"
                value={fmtPct(stats.session.changePct)}
                tone={stats.session.changePct >= 0 ? "up" : "down"}
              />
              <Row label="Volume" value={fmt(stats.session.volume)} />
              {stats.distanceFromSessionHighPct !== null && (
                <Row
                  label="Dist. from high"
                  value={fmtPct(stats.distanceFromSessionHighPct)}
                  tone={stats.distanceFromSessionHighPct >= 0 ? "up" : "down"}
                />
              )}
              {stats.distanceFromSessionLowPct !== null && (
                <Row
                  label="Dist. from low"
                  value={fmtPct(stats.distanceFromSessionLowPct)}
                  tone={stats.distanceFromSessionLowPct >= 0 ? "up" : "down"}
                />
              )}
            </>
          ) : (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              No bars in this session yet.
            </div>
          )}
        </div>

        <div className="border-b border-border py-0.5">
          <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">Previous day</div>
          {stats.prevDay ? (
            <>
              <Row label="High" value={fmt(stats.prevDay.high)} />
              <Row label="Low" value={fmt(stats.prevDay.low)} />
              <Row label="Close" value={fmt(stats.prevDay.close)} />
            </>
          ) : (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              No prior-day bars available in the loaded history.
            </div>
          )}
        </div>

        {stats.atr !== null && (
          <div className="py-0.5">
            <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">Volatility</div>
            <Row label="ATR (14)" value={fmt(stats.atr)} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-2 py-1.5 text-[9px] leading-snug text-muted-foreground/80">
        Asia/London/New York are UTC time-block conventions (00–09 / 08–17 / 13–22 UTC) applied to real
        bars, not literal regional exchange hours — this app trades 24/7 crypto markets.
      </div>
    </div>
  );
}
