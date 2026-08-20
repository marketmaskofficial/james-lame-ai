import { useMemo } from "react";
import { volumeProfile } from "@/lib/sgscript/stdlib";
import { computeValueArea } from "@/lib/workspace/volumeProfileMath";
import type { WidgetInstance, ChartInstanceOption } from "@/lib/workspace/types";

export type VolumeProfileConfig = NonNullable<WidgetInstance["volumeProfileConfig"]>;

export const DEFAULT_VOLUME_PROFILE_CONFIG: VolumeProfileConfig = {
  bins: 24,
  lookbackBars: 300,
  valueAreaPct: 0.7,
  boundChartInstanceId: "active",
};

const LOOKBACK_OPTIONS = [50, 100, 200, 300, 500, 1000];
const BIN_OPTIONS = [10, 16, 24, 32, 48, 64];

export type { ChartInstanceOption };

type Props = {
  chartInstances: ChartInstanceOption[];
  activeChartInstanceId: string;
  config: VolumeProfileConfig | undefined;
  onConfigChange: (next: VolumeProfileConfig) => void;
};

/**
 * Dock widget (UI-4h-2): a real Volume Profile — POC / Value Area / a
 * price-binned volume histogram — computed entirely from a bound chart's
 * already-real OHLCV bars via `volumeProfile()` (src/lib/sgscript/stdlib.ts,
 * the same engine SGScript's own `volumeProfile(...)` primitive already
 * exposes to indicator scripts; reused here, not reimplemented).
 *
 * This is an honest OHLCV-bar-range approximation, NOT tick-level
 * volume-at-price: each bar's volume is distributed across whichever price
 * bins its own high-low range spans (see stdlib.ts's `volumeProfile` for the
 * exact distribution), which is the standard, real technique for deriving a
 * volume profile from candle data — never fabricated bid/ask, footprint, or
 * delta data. The caption at the bottom of this component says so plainly;
 * don't remove or soften it.
 *
 * Single dock-only instance (like ScannerPanel) rather than a
 * multi-instance-per-chart widget — the dock/sidebar tab-strip rendering
 * this app has today (studio.tsx's `dock`/`rightTab` state) is a single
 * globally-active-tab-per-region model with no per-instance content
 * dispatch, true for every existing non-chart widget, not something UI-4h-2
 * should generalize. Independent binding is still real: the `boundChart
 * InstanceId` selector below can pin this one widget to ANY currently open
 * chart instance (not just whichever one has focus), so a 2-chart/4-chart
 * layout can park it on a specific chart and it stays there even as the user
 * clicks around between charts.
 */
export function VolumeProfilePanel({
  chartInstances,
  activeChartInstanceId,
  config,
  onConfigChange,
}: Props) {
  const cfg = config ?? DEFAULT_VOLUME_PROFILE_CONFIG;

  const boundInstanceId =
    cfg.boundChartInstanceId !== "active" &&
    chartInstances.some((c) => c.instanceId === cfg.boundChartInstanceId)
      ? cfg.boundChartInstanceId
      : activeChartInstanceId;
  const bound = chartInstances.find((c) => c.instanceId === boundInstanceId);
  const bars = bound?.bars ?? [];

  const { bins, valueArea } = useMemo(() => {
    if (bars.length < 2) return { bins: [], valueArea: computeValueArea([], cfg.valueAreaPct) };
    const to = bars.length - 1;
    const from = Math.max(0, bars.length - cfg.lookbackBars);
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);
    const volume = bars.map((b) => b.volume);
    const computedBins = volumeProfile(high, low, volume, from, to, cfg.bins);
    return { bins: computedBins, valueArea: computeValueArea(computedBins, cfg.valueAreaPct) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, cfg.bins, cfg.lookbackBars, cfg.valueAreaPct]);

  const maxVolume = bins.reduce((max, b) => Math.max(max, b.volume), 0);
  // Same magnitude-based precision convention ScannerPanel already uses for
  // price columns — a sub-$100 asset (many altcoins) needs more decimals to
  // show distinct bin edges at all.
  const lastClose = bars.at(-1)?.close ?? 0;
  const priceDecimals = lastClose >= 100 ? 2 : 6;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Volume Profile</span>
        {chartInstances.length > 1 && (
          <select
            title="Which chart this Volume Profile is bound to"
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

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[10px]">
        <label className="flex items-center gap-1 text-muted-foreground">
          Bins
          <select
            value={cfg.bins}
            onChange={(e) => onConfigChange({ ...cfg, bins: Number(e.target.value) })}
            className="h-6 rounded-[6px] border border-border bg-card px-1 outline-none focus:border-brand"
          >
            {BIN_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">
          Lookback
          <select
            value={cfg.lookbackBars}
            onChange={(e) => onConfigChange({ ...cfg, lookbackBars: Number(e.target.value) })}
            className="h-6 rounded-[6px] border border-border bg-card px-1 outline-none focus:border-brand"
          >
            {LOOKBACK_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} bars
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-muted-foreground">
          Value area
          <select
            value={cfg.valueAreaPct}
            onChange={(e) => onConfigChange({ ...cfg, valueAreaPct: Number(e.target.value) })}
            className="h-6 rounded-[6px] border border-border bg-card px-1 outline-none focus:border-brand"
          >
            {[0.6, 0.68, 0.7, 0.8, 0.9].map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)}%
              </option>
            ))}
          </select>
        </label>
      </div>

      {bars.length < 2 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
          Waiting for bars to load on {bound?.label ?? "the bound chart"}…
        </div>
      ) : bins.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
          Not enough price range in the lookback window to build a profile.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 border-b border-border px-2 py-1.5 font-mono text-[10px]">
            <div>
              <div className="text-muted-foreground">POC</div>
              <div className="text-brand">{valueArea.poc.toFixed(priceDecimals)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">VAH</div>
              <div className="text-foreground">{valueArea.vah.toFixed(priceDecimals)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">VAL</div>
              <div className="text-foreground">{valueArea.val.toFixed(priceDecimals)}</div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <div className="flex h-full flex-col-reverse gap-px">
              {bins.map((b, i) => {
                const withinVA =
                  b.bottom >= valueArea.val - 1e-9 && b.top <= valueArea.vah + 1e-9;
                const isPoc = i === valueArea.pocIndex;
                const widthPct = maxVolume > 0 ? (b.volume / maxVolume) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-1.5" style={{ flex: "1 1 0" }}>
                    <span className="w-14 shrink-0 truncate text-right font-mono text-[9px] text-muted-foreground">
                      {b.top.toFixed(priceDecimals)}
                    </span>
                    <div className="relative h-full min-w-0 flex-1 bg-border/20">
                      <div
                        className={`h-full rounded-r-sm ${
                          isPoc ? "bg-brand" : withinVA ? "bg-brand/50" : "bg-muted-foreground/40"
                        }`}
                        style={{ width: `${Math.max(widthPct, b.volume > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border px-2 py-1.5 text-[9px] leading-snug text-muted-foreground/80">
            OHLCV-derived approximation — each bar's volume is spread across the price bins its own high-low
            range spans. This is not tick-level volume-at-price data.
          </div>
        </>
      )}
    </div>
  );
}
