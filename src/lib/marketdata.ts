import type { Bar } from "@/lib/sgscript/types";
import { normalizeBars } from "@/lib/market/candles";

export const TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "1w",
  "1M",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Compact labels for the timeframe bar (1h -> 1H, 1d -> D). */
export const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6H",
  "12h": "12H",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

export const timeframeLabel = (tf: string) => TIMEFRAME_LABELS[tf] ?? tf;

export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "DOTUSDT",
  "ATOMUSDT",
  "ARBUSDT",
  "OPUSDT",
  "APTUSDT",
  "INJUSDT",
  "SUIUSDT",
  "TONUSDT",
  "NEARUSDT",
];

export async function fetchBars(
  symbol: string,
  interval: string,
  limit = 800,
  /** Load history strictly older than this epoch-ms cursor (progressive load). */
  endTimeMs?: number,
): Promise<Bar[]> {
  const res = await fetch(
    `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
      interval,
    )}&limit=${limit}${endTimeMs ? `&endTime=${Math.floor(endTimeMs)}` : ""}`,
  );
  if (!res.ok) throw new Error(`Market data unavailable (${res.status})`);
  const raw = (await res.json()) as Array<
    [number, string, string, string, string, string, ...unknown[]]
  >;
  if (!Array.isArray(raw)) throw new Error("Market data unavailable");
  const bars = raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
  return normalizeBars(bars);
}
