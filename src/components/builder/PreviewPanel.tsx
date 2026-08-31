import { useMemo } from "react";
import { AlertTriangle, LineChart, Loader2 } from "lucide-react";
import { StudioChart, type Drawing, type LoadedIndicator } from "@/components/studio/StudioChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeframeLabel, type Timeframe } from "@/lib/marketdata";
import { SYMBOL_REGISTRY } from "@/lib/symbols";
import type { Bar, RunResult } from "@/lib/sgscript/types";
import type { PreviewStatus } from "@/lib/builder/generationState";
import { BUILDER_TIMEFRAMES } from "./useBuilderMarketData";

/**
 * Phase 5A-4c/5A-4d — Live Preview region: the real canonical renderer
 * (`StudioChart`, the exact same component Chart Studio uses — never a
 * copy, never a second lightweight-charts setup) plus real historical
 * market data. Presentation only: every value it renders (`bars`,
 * `previewStatus`, `previewResult`, `previewError`, the market-data fields)
 * comes from `BuilderWorkspace`, which owns `useBuilderMarketData` and
 * `useBuilderProject`; this component makes no fetch, no server/AI call,
 * and owns no Builder state of its own.
 *
 * Phase 5A-4d wires real `bars` (`useBuilderMarketData`, reusing the exact
 * canonical `fetchBars` every other market-data consumer in this app
 * already uses) and a symbol/timeframe selector into the header slot Phase
 * 5A-4c reserved. Per the Phase 5A-4d audit: once real bars exist, the
 * chart shows REAL candles even before any indicator has been run
 * (`indicators=[]`, never a fabricated placeholder) — Run Preview then adds
 * the generated indicator on top, still through the exact same
 * `submitRunPreview` → `runIndicator` → `previewResult` chain Phase 5A-4b
 * built.
 *
 * `previewContext` disambiguates "which symbol/timeframe was the visible
 * `previewResult` actually computed against" from "what's currently
 * selected" — changing symbol/timeframe never re-runs SGScript
 * automatically (Phase 5A-4e's job), so a stale `previewResult` computed
 * against a DIFFERENT symbol's bars must never be drawn as if it belongs to
 * the new selection (its plotted values are timestamped against the old
 * symbol's bars entirely). When stale, the indicator is hidden (never
 * mismatched onto the new candles) and a compact banner discloses exactly
 * what to do about it.
 *
 * `StudioChart` is mounted unconditionally (idle/loading/error/stale/
 * running/success all use the SAME instance) so it never remounts on a
 * status transition — only the overlay caption/banner on top of it changes.
 */

const EMPTY_DRAWINGS: Drawing[] = [];
function noopAddDrawing(): void {}
function noopRemoveDrawing(): void {}
function noopSelectDrawing(): void {}

export type PreviewContext = { symbol: string; timeframe: Timeframe };

export function PreviewPanel({
  bars,
  barsLoading,
  marketDataError,
  selectedSymbol,
  selectedTimeframe,
  onSymbolChange,
  onTimeframeChange,
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
  previewStatus: PreviewStatus;
  previewResult: RunResult | null;
  previewError: string | null;
  previewContext: PreviewContext | null;
}) {
  const isStale =
    previewResult !== null &&
    previewContext !== null &&
    (previewContext.symbol !== selectedSymbol || previewContext.timeframe !== selectedTimeframe);

  const indicators = useMemo<LoadedIndicator[]>(() => {
    if (!previewResult || isStale) return [];
    return [{ key: "builder-preview", name: previewResult.meta.name, visible: true, result: previewResult }];
  }, [previewResult, isStale]);

  const hasOscPane = useMemo(
    () => (previewResult && !isStale ? previewResult.plots.some((p) => p.pane === "osc") : false),
    [previewResult, isStale],
  );

  const headerStatus = barsLoading ? "Loading bars…" : previewStatus === "running" ? "Running preview…" : null;

  const overlayMode: "loading" | "marketError" | "runtimeErrorNoResult" | "runtimeErrorBanner" | "stale" | "idleReal" | "idleEmpty" | "none" =
    barsLoading
      ? "loading"
      : marketDataError
        ? "marketError"
        : previewError && !previewResult
          ? "runtimeErrorNoResult"
          : previewError && previewResult
            ? "runtimeErrorBanner"
            : isStale
              ? "stale"
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

        {overlayMode === "stale" && previewContext && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">
              Preview is stale (last run: {previewContext.symbol} · {timeframeLabel(previewContext.timeframe)}) — run again for {selectedSymbol} ·{" "}
              {timeframeLabel(selectedTimeframe)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
