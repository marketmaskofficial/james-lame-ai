import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+$/)
    .max(20),
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  strategy: z.enum(["rsi", "ma_cross"]),
  // RSI params
  rsiPeriod: z.number().int().min(2).max(100).optional(),
  rsiOversold: z.number().min(1).max(99).optional(),
  rsiOverbought: z.number().min(1).max(99).optional(),
  // MA cross params
  fastLen: z.number().int().min(2).max(200).optional(),
  slowLen: z.number().int().min(3).max(400).optional(),
});

type Kline = { time: number; open: number; high: number; low: number; close: number };

async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const sources = [
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  ];
  let lastErr = "";
  for (const src of sources) {
    try {
      const r = await fetch(src);
      if (!r.ok) {
        lastErr = `${src} -> ${r.status}`;
        continue;
      }
      const raw = (await r.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
      return raw.map((k) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Failed to fetch klines: ${lastErr}`);
}

function computeRSI(closes: number[], period: number): number[] {
  const out: number[] = Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function computeSMA(closes: number[], period: number): number[] {
  const out: number[] = Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

type Trade = {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnlPct: number;
};

function simulate(
  candles: Kline[],
  signals: Array<"long" | "flat">,
): { trades: Trade[]; equityCurve: Array<{ time: number; equity: number }> } {
  const trades: Trade[] = [];
  const equityCurve: Array<{ time: number; equity: number }> = [];
  let equity = 1;
  let position: { entryTime: number; entryPrice: number } | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const desired = signals[i];
    // Enter on transition flat -> long, exit on long -> flat, using this bar's close.
    if (!position && desired === "long") {
      position = { entryTime: c.time, entryPrice: c.close };
    } else if (position && desired === "flat") {
      const pnl = (c.close - position.entryPrice) / position.entryPrice;
      equity *= 1 + pnl;
      trades.push({
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        exitTime: c.time,
        exitPrice: c.close,
        pnlPct: pnl * 100,
      });
      position = null;
    }
    // Mark-to-market equity
    const mtm = position
      ? equity * (1 + (c.close - position.entryPrice) / position.entryPrice)
      : equity;
    equityCurve.push({ time: c.time, equity: mtm });
  }
  // Close open position at last candle
  if (position && candles.length > 0) {
    const last = candles[candles.length - 1];
    const pnl = (last.close - position.entryPrice) / position.entryPrice;
    equity *= 1 + pnl;
    trades.push({
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime: last.time,
      exitPrice: last.close,
      pnlPct: pnl * 100,
    });
  }
  return { trades, equityCurve };
}

export const runBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data }) => {
    const candles = await fetchKlines(data.symbol, data.interval, 500);
    if (candles.length < 30) throw new Error("Not enough historical data");
    const closes = candles.map((c) => c.close);

    let signals: Array<"long" | "flat">;
    let label: string;

    if (data.strategy === "rsi") {
      const period = data.rsiPeriod ?? 14;
      const os = data.rsiOversold ?? 30;
      const ob = data.rsiOverbought ?? 70;
      const rsi = computeRSI(closes, period);
      let state: "long" | "flat" = "flat";
      signals = rsi.map((v) => {
        if (!Number.isFinite(v)) return "flat";
        if (state === "flat" && v < os) state = "long";
        else if (state === "long" && v > ob) state = "flat";
        return state;
      });
      label = `RSI(${period}) < ${os} long / > ${ob} exit`;
    } else {
      const fast = data.fastLen ?? 20;
      const slow = data.slowLen ?? 50;
      if (fast >= slow) throw new Error("fastLen must be less than slowLen");
      const fastMA = computeSMA(closes, fast);
      const slowMA = computeSMA(closes, slow);
      let state: "long" | "flat" = "flat";
      signals = closes.map((_, i) => {
        const f = fastMA[i];
        const s = slowMA[i];
        if (!Number.isFinite(f) || !Number.isFinite(s)) return "flat";
        state = f > s ? "long" : "flat";
        return state;
      });
      label = `MA cross ${fast}/${slow}`;
    }

    const { trades, equityCurve } = simulate(candles, signals);
    const wins = trades.filter((t) => t.pnlPct > 0);
    const losses = trades.filter((t) => t.pnlPct <= 0);
    const totalPct =
      equityCurve.length > 0
        ? (equityCurve[equityCurve.length - 1].equity - 1) * 100
        : 0;
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const avgWin =
      wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length
        : 0;
    // Max drawdown on equity curve
    let peak = 1;
    let maxDD = 0;
    for (const p of equityCurve) {
      if (p.equity > peak) peak = p.equity;
      const dd = (p.equity - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }

    return {
      label,
      symbol: data.symbol,
      interval: data.interval,
      bars: candles.length,
      startTime: candles[0]?.time ?? null,
      endTime: candles[candles.length - 1]?.time ?? null,
      totalPct,
      trades: trades.length,
      winRate,
      avgWinPct: avgWin,
      avgLossPct: avgLoss,
      maxDrawdownPct: maxDD * 100,
      tradeList: trades.slice(-25).reverse(),
    };
  });
