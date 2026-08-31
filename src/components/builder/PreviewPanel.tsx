import { useMemo } from "react";
import { AlertTriangle, LineChart, Loader2, RefreshCw } from "lucide-react";
import { StudioChart, type Drawing, type LoadedIndicator } from "@/components/studio/StudioChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeframeLabel, type Timeframe } from "@/lib/marketdata";
import { SYMBOL_REGISTRY } from "@/lib/symbols";
import type { Bar, RunResult } from "@/lib/sgscript/types";
import type { PreviewStatus } from "@/lib/builder/generationState";
import { BUILDER_TIMEFRAMES } from "./useBuilderMarketData";
import type { PreviewContext } from "./useBuilderPreviewRefresh";

/**
 * Phase 5A-4c/5A-4d/5A-4e — Live Preview region: the real canonical
 * renderer (`StudioChart`, the exact same component Chart Studio uses —
 * never a copy, never a second lightweight-charts setup) plus real
 * historical market data, kept automatically fresh. Presentation only:
 * every value it renders comes from `BuilderWorkspace`, which owns
 * `useBuilderMarketData`, `useBuilderProject`, and `useBuilderPreviewRefresh`;
 * this component makes no fetch, no server/AI call, no `runIndicator` call,
 * and owns no Builder state of its own.
 *
 * Once real bars exist, the chart shows REAL candles even before any
 * indicator has been run (`indicators=[]`, never a fabricated placeholder).
 *
 * `previewContext` (Phase 5A-4e, `{symbol, timeframe, sgscript}` — owned by
 * `useBuilderPreviewRefresh.ts`) disambiguates "which symbol/timeframe/code
 * the visible `previewResult` was actually computed against" from "what's
 * currently selected/typed." Two distinct staleness tiers:
 *   - MARKET stale (symbol or timeframe differs): the indicator is hidden
 *     entirely — its plotted values are timestamped against a DIFFERENT
 *     symbol's bars, so drawing it over the new candles would be actively
 *     wrong, not just outdated. A banner discloses exactly what to do.
 *   - CODE stale (only `sgscript` differs, symbol/timeframe still match):
 *     the last-good indicator STAYS visible — it's still valid against the
 *     current bars, just computed from slightly older code, which is
 *     exactly the "never blank a valid chart while an automatic rerun is
 *     pending/running" behavior Phase 5A-4e requires. A subtle "Updating
 *     preview…" hint communicates it without hiding anything.
 *
 * `StudioChart` is mounted unconditionally with respect to Preview
 * STATUS — idle/running/error/success/code-stale all reuse the SAME
 * instance, only the overlay caption/banner changes. It IS deliberately
 * remounted (`key={selectedSymbol:selectedTimeframe}`) on a symbol or
 * timeframe change: `StudioChart`'s own candle-update effect uses a
 * `sameSet` heuristic (matching the new bars' first timestamp against the
 * previous dataset's, by design, to `update()` just the live bar instead of
 * reloading everything every tick) that its own source comments already
 * flag as "fooled by coincidence" — two different symbols fetched via the
 * same `fetchBars(symbol, timeframe, 500)` shape at the same real-world
 * moment routinely share an IDENTICAL first-bar timestamp (wall-clock-
 * aligned 15m/1h/etc. boundaries are the same regardless of symbol), which
 * fools the heuristic into patching just the last bar instead of replacing
 * the whole series — leaving hundreds of stale old-symbol-priced candles
 * mixed with one new-symbol-priced one, and a badly distorted price axis.
 * Forcing a remount on symbol/timeframe change is a normal React pattern,
 * touches nothing inside `StudioChart.tsx`, and sidesteps the heuristic
 * entirely by giving it no "previous dataset" to be fooled by.
 */

const EMPTY_DRAWINGS: Drawing[] = [];
function noopAddDrawing(): void {}
function noopRemoveDrawing(): void {}
function noopSelectDrawing(): void {}

export function PreviewPanel({
  bars,
  barsLoading,
  marketDataError,
  selectedSymbol,
  selectedTimeframe,
  onSymbolChange,
  onTimeframeChange,
  sgscript,
  previewStatus,
  previewResult,
  previewError,
  previewContext,
}: {
  bars: Bar[];
  barsLoading: boolean;
  marketDataError: string | null;
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: Timeframe) => void;
  sgscript: string;
  previewStatus: PreviewStatus;
  previewResult: RunResult | null;
  previewError: string | null;
  previewContext: PreviewContext | null;
}) {
  const marketStale =
    previewResult !== null &&
    previewContext !== null &&
    (previewContext.symbol !== selectedSymbol || previewContext.timeframe !== selectedTimeframe);

  const codeStale = previewResult !== null && previewContext !== null && !marketStale && previewContext.sgscript !== sgscript;

  const indicators = useMemo<LoadedIndicator[]>(() => {
    if (!previewResult || marketStale) return [];
    return [{ key: "builder-preview", name: previewResult.meta.name, visible: true, result: previewResult }];
  }, [previewResult, marketStale]);

  const hasOscPane = useMemo(
    () => (previewResult && !marketStale ? previewResult.plots.some((p) => p.pane === "osc") : false),
    [previewResult, marketStale],
  );

  const headerStatus = barsLoading
    ? "Loading bars…"
    : previewStatus === "running"
      ? "Running preview…"
      : codeStale && previewStatus !== "error"
        ? "Updating preview…"
        : null;

  const overlayMode:
    | "loading"
    | "marketError"
    | "runtimeErrorNoResult"
    | "marketStale"
    | "runtimeErrorBanner"
    | "codeStale"
    | "idleReal"
    | "idleEmpty"
    | "none" = barsLoading
    ? "loading"
    : marketDataError
      ? "marketError"
      : previewError && !previewResult
        ? "runtimeErrorNoResult"
        : marketStale
          ? "marketStale"
          : previewError && previewResult
            ? "runtimeErrorBanner"
            : codeStale
              ? "codeStale"
              : !previewResult && bars.length > 0
                ? "idleReal"
                : !previewResult
                  ? "idleEmpty"
                  : "none";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Live Preview</span>
          {headerStatus && (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-brand">
              <Loader2 className="h-3 w-3 animate-spin" />
              {headerStatus}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Select value={selectedSymbol} onValueChange={onSymbolChange}>
            <SelectTrigger
              aria-label="Symbol"
              className="h-5 w-auto gap-1 border-none bg-transparent px-1 py-0 text-[10px] font-medium text-muted-foreground/70 shadow-none hover:text-foreground focus:ring-0 [&>svg]:h-3 [&>svg]:w-3"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SYMBOL_REGISTRY.map((s) => (
                <SelectItem key={s.ticker} value={s.ticker} className="text-xs">
                  {s.ticker}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span aria-hidden="true" className="text-[10px] text-muted-foreground/40">
            ·
          </span>
          <Select value={selectedTimeframe} onValueChange={(v) => onTimeframeChange(v as Timeframe)}>
            <SelectTrigger
              aria-label="Timeframe"
              className="h-5 w-auto gap-1 border-none bg-transparent px-1 py-0 text-[10px] font-medium text-muted-foreground/70 shadow-none hover:text-foreground focus:ring-0 [&>svg]:h-3 [&>svg]:w-3"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {BUILDER_TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf} className="text-xs">
                  {timeframeLabel(tf)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <StudioChart
          key={`${selectedSymbol}:${selectedTimeframe}`}
          bars={bars}
          indicators={indicators}
          tool="cursor"
          drawings={EMPTY_DRAWINGS}
          onAddDrawing={noopAddDrawing}
          onRemoveDrawing={noopRemoveDrawing}
          selectedId={null}
          onSelectDrawing={noopSelectDrawing}
          hasOscPane={hasOscPane}
        />

        {overlayMode === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Loading {selectedSymbol} candles…</p>
          </div>
        )}

        {overlayMode === "marketError" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Market data unavailable</p>
            <p className="text-xs text-muted-foreground">{marketDataError}</p>
          </div>
        )}

        {overlayMode === "runtimeErrorNoResult" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{previewError}</p>
          </div>
        )}

        {overlayMode === "idleReal" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <LineChart className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Real candles loaded. Click Run Preview to see your indicator.</p>
          </div>
        )}

        {overlayMode === "idleEmpty" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <LineChart className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Chart preview will appear after a successful build.</p>
          </div>
        )}

        {overlayMode === "runtimeErrorBanner" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{previewError}</span>
          </div>
        )}

        {overlayMode === "marketStale" && previewContext && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">
              Preview is stale (last run: {previewContext.symbol} · {timeframeLabel(previewContext.timeframe)}) — updates automatically once{" "}
              {selectedSymbol} · {timeframeLabel(selectedTimeframe)} bars are ready
            </span>
          </div>
        )}

        {overlayMode === "codeStale" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand">
            <RefreshCw className="h-3 w-3 shrink-0" />
            <span className="truncate">Preview update pending — showing the previous result</span>
          </div>
        )}
      </div>
    </div>
  );
}
