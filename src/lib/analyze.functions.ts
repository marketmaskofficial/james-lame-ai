import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const inputSchema = z.object({
  code: z.string().min(1).max(20000),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]+$/)
    .max(20),
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
});

type Kline = { time: number; open: number; high: number; low: number; close: number; volume: number };

async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
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
      const raw = (await r.json()) as Array<[number, string, string, string, string, string, ...unknown[]]>;
      return raw.map((k) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Failed to fetch klines: ${lastErr}`);
}

function summarizeBars(candles: Kline[]) {
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  // Simple 14-period RSI on the tail
  const period = 14;
  let rsi: number | null = null;
  if (closes.length > period + 1) {
    let g = 0, l = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) g += d;
      else l -= d;
    }
    const avgG = g / period;
    const avgL = l / period;
    rsi = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return {
    bars: candles.length,
    first: { time: first.time, close: first.close },
    last: { time: last.time, close: last.close, high: last.high, low: last.low },
    windowHigh: hi,
    windowLow: lo,
    mean,
    changePct: ((last.close - first.close) / first.close) * 100,
    rsi14: rsi,
  };
}

/**
 * Lenient on purpose: a model that skips a bullet list or writes "BUY" should
 * still produce a usable analysis instead of a hard failure in the UI.
 */
const outputSchema = z.object({
  summary: z.string().default(""),
  strategyType: z.string().default("Unknown"),
  signal: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["buy", "sell", "neutral"]).catch("neutral"))
    .default("neutral"),
  confidence: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["low", "medium", "high"]).catch("low"))
    .default("low"),
  reasoning: z.string().default(""),
  keyLevels: z
    .array(
      z.object({
        label: z.string().default(""),
        price: z.coerce.number().finite(),
      }),
    )
    .default([]),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
});

/** Pulls the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string | undefined | null): unknown {
  if (!text) return null;
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type AnalyzeResult = z.infer<typeof outputSchema> & {
  symbol: string;
  interval: string;
  bars: number;
  lastClose: number;
};

export const analyzeIndicator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data }): Promise<AnalyzeResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const candles = await fetchKlines(data.symbol, data.interval, 200);
    if (candles.length < 30) throw new Error("Not enough historical data");
    const stats = summarizeBars(candles)!;

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-pro");

    const prompt = `Analyze the following TradingView Pine Script v5 indicator/strategy against recent market data for ${data.symbol} on the ${data.interval} timeframe.

=== Pine Script ===
${data.code}

=== Recent market snapshot (last ${stats.bars} bars) ===
- Window: ${new Date(stats.first.time).toISOString()} -> ${new Date(stats.last.time).toISOString()}
- First close: ${stats.first.close}
- Last close: ${stats.last.close}  (high ${stats.last.high} / low ${stats.last.low})
- Window high: ${stats.windowHigh}
- Window low:  ${stats.windowLow}
- Window mean: ${stats.mean.toFixed(4)}
- Change over window: ${stats.changePct.toFixed(2)}%
- Approx RSI(14) on last bar: ${stats.rsi14?.toFixed(2) ?? "n/a"}

Read the Pine Script carefully. Identify what it computes (indicator type, entry/exit rules). Then judge, using ONLY the snapshot above, whether the script would currently flag a buy, sell, or neutral state on ${data.symbol} ${data.interval}. Give an honest confidence.

Return:
- summary: 1-2 sentences describing what the script does.
- strategyType: e.g. "RSI mean reversion", "EMA crossover", "Bollinger breakout".
- signal: one of buy | sell | neutral for the current bar.
- confidence: low | medium | high.
- reasoning: 2-4 sentences explaining the current signal referencing the numbers above.
- keyLevels: up to 5 concrete price levels (support, resistance, stop, take-profit, etc.) with short labels.
- strengths: up to 4 short bullets on what the script does well.
- risks: up to 4 short bullets on failure modes / weaknesses.
- suggestions: up to 4 short bullets with concrete improvements.

Never invent numbers not derivable from the snapshot. If the script is not a trading indicator, set signal=neutral, confidence=low, and explain.`;

    try {
      const { output } = await generateText({
        model,
        prompt,
        output: Output.object({ schema: outputSchema }),
      });
      return {
        ...output,
        symbol: data.symbol,
        interval: data.interval,
        bars: candles.length,
        lastClose: stats.last.close,
      };
    } catch (err) {
      const finish = (parsed: z.infer<typeof outputSchema>) => ({
        ...parsed,
        symbol: data.symbol,
        interval: data.interval,
        bars: candles.length,
        lastClose: stats.last.close,
      });

      // 1. Salvage the JSON the model did emit (fences / trailing prose).
      if (NoObjectGeneratedError.isInstance(err)) {
        const salvaged = outputSchema.safeParse(extractJson(err.text));
        if (salvaged.success) return finish(salvaged.data);
      }

      // 2. Retry once in plain-text JSON mode, which most models handle even
      //    when structured-output tool calling fails.
      try {
        const { text } = await generateText({
          model,
          prompt: `${prompt}

Reply with ONLY a JSON object, no markdown fence, matching exactly:
{"summary":string,"strategyType":string,"signal":"buy"|"sell"|"neutral","confidence":"low"|"medium"|"high","reasoning":string,"keyLevels":[{"label":string,"price":number}],"strengths":[string],"risks":[string],"suggestions":[string]}`,
        });
        const retry = outputSchema.safeParse(extractJson(text));
        if (retry.success) return finish(retry.data);
      } catch {
        /* fall through to the error below */
      }

      throw new Error(
        "The analyzer could not produce a structured result for this script. Try again, or shorten the code.",
      );
    }
  });
