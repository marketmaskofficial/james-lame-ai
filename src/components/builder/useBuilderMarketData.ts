import { useEffect, useRef, useState } from "react";
import { fetchBars, type Timeframe } from "@/lib/marketdata";
import { DEFAULT_FAVORITE_TIMEFRAMES } from "@/lib/symbols";
import type { Bar } from "@/lib/sgscript/types";

/**
 * Phase 5A-4d — Indicator Builder's market-data state. Deliberately its own
 * hook, never folded into `BuilderProjectState`/`generationState.ts`:
 * symbol/timeframe/historical-bars is a fourth, orthogonal concern from AI
 * generation, static validation, and preview execution — it doesn't change
 * what SGScript is or what a run produced, only what real market data a run
 * would be executed against. Mirrors Chart Studio's own market-data
 * ownership shape (`chartStatesMap[id].{symbol,interval,bars,barsLoading,
 * barsError}` in `src/routes/studio.tsx`) at Builder's much smaller scale —
 * one symbol/timeframe pair, not a multi-instance map.
 *
 * Reuses the exact canonical fetch path every other market-data consumer in
 * this app already uses (`fetchBars` from `@/lib/marketdata`) — no second
 * provider call, no direct `getProvider("crypto")` reach, no new API route.
 *
 * Fetch lifecycle deliberately mirrors Studio's own bars-fetch effect: a
 * plain `useEffect` keyed on `[selectedSymbol, selectedTimeframe]` (so a
 * selection change is exactly what triggers a refetch — never a debounce,
 * never automatic SGScript execution), with a sequence-ref stale-response
 * guard (the same weight-class already used for `runSeqRef` in
 * `useBuilderProject.ts` and the `cancelled`-flag in Studio's own effect) —
 * not `AbortController` (confirmed unused anywhere in this repo), not React
 * Query (confirmed unused for market data anywhere in this repo either).
 */

export const BUILDER_TIMEFRAMES: Timeframe[] = DEFAULT_FAVORITE_TIMEFRAMES as Timeframe[];
export const DEFAULT_BUILDER_SYMBOL = "BTCUSDT";
export const DEFAULT_BUILDER_TIMEFRAME: Timeframe = "15m";

/** Matches Chart Studio's own default historical load (`fetchBars(inst.symbol,
 * inst.interval, 500)` in `src/routes/studio.tsx`) — reusing an already
 * production-proven number rather than inventing a new one. */
const HISTORICAL_BAR_COUNT = 500;

export function useBuilderMarketData() {
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_BUILDER_SYMBOL);
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(DEFAULT_BUILDER_TIMEFRAME);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [marketDataError, setMarketDataError] = useState<string | null>(null);

  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const fetchId = ++fetchSeqRef.current;
    setBarsLoading(true);
    setMarketDataError(null);
    // Clear immediately rather than leaving the previous selection's candles
    // on screen — an old symbol's bars staying visible under a new symbol's
    // label would be exactly the kind of mislabeling the Phase 5A-4d audit
    // requires avoiding, even for the brief loading window.
    setBars([]);

    fetchBars(selectedSymbol, selectedTimeframe, HISTORICAL_BAR_COUNT)
      .then((result) => {
        if (fetchId !== fetchSeqRef.current) return;
        if (result.length === 0) {
          setMarketDataError("No market data returned.");
          return;
        }
        setBars(result);
      })
      .catch((e: unknown) => {
        if (fetchId !== fetchSeqRef.current) return;
        setMarketDataError(e instanceof Error ? e.message : "Market data unavailable");
      })
      .finally(() => {
        if (fetchId !== fetchSeqRef.current) return;
        setBarsLoading(false);
      });
  }, [selectedSymbol, selectedTimeframe]);

  return {
    selectedSymbol,
    setSelectedSymbol,
    selectedTimeframe,
    setSelectedTimeframe,
    bars,
    barsLoading,
    marketDataError,
  };
}
