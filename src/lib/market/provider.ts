/**
 * Historical-bar provider abstraction.
 *
 * Today there is exactly one real implementation (crypto, via Binance and
 * its mirrors behind /api/klines). This interface exists so that seam is
 * explicit and swappable — a future futures/stocks/forex provider is a new
 * registerProvider() call, not a rewrite of every Bar[] consumer (chart
 * rendering, runScript(), the backtest engine already only ever see plain
 * Bar[] and don't care where it came from).
 *
 * Deliberately NOT built yet: futures/stocks/forex implementations, any
 * live/streaming provider concept, broker execution. This is the
 * backtesting-scoped historical-data seam only.
 */

import type { Bar } from "@/lib/sgscript/types";

export type AssetClass = "crypto" | "futures" | "stocks" | "forex";

export type HistoricalBarParams = {
  symbol: string;
  timeframe: string;
  limit?: number;
  /** Load history strictly older than this epoch-ms cursor (progressive load). */
  endTimeMs?: number;
};

export interface HistoricalBarProvider {
  /** Stable identifier, e.g. "binance". Not shown to users. */
  readonly id: string;
  readonly assetClass: AssetClass;
  fetchHistoricalBars(params: HistoricalBarParams): Promise<Bar[]>;
}

const registry = new Map<AssetClass, HistoricalBarProvider>();

export function registerProvider(provider: HistoricalBarProvider): void {
  registry.set(provider.assetClass, provider);
}

/**
 * Throws with a specific, honest message when no provider is registered for
 * the asset class — never silently falls back to a different market's data.
 */
export function getProvider(assetClass: AssetClass): HistoricalBarProvider {
  const provider = registry.get(assetClass);
  if (!provider) {
    throw new Error(`No historical data provider is connected for ${assetClass} yet`);
  }
  return provider;
}

export function hasProvider(assetClass: AssetClass): boolean {
  return registry.has(assetClass);
}
