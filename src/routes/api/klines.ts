import { createFileRoute } from "@tanstack/react-router";

/** Binance-shaped kline row: [openTime, o, h, l, c, v, ...] */
type Kline = [number, string, string, string, string, string];

const BYBIT_INTERVAL: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

const GATE_INTERVAL: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "12h": "12h",
  "1d": "1d",
  "1w": "7d",
  "1M": "30d",
};

const MEXC_INTERVAL: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "4h": "4h",
  "1d": "1d",
  "1M": "1M",
};

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "signal-goat/1.0" },
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/** Binance and MEXC already return the canonical array shape. */
async function fromBinanceLike(
  host: string,
  symbol: string,
  interval: string,
  limit: number,
  endTime: number | null,
  map?: Record<string, string>,
): Promise<Kline[]> {
  const iv = map ? map[interval] : interval;
  if (!iv) throw new Error("interval unsupported");
  const qs = `symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${limit}${
    endTime ? `&endTime=${endTime}` : ""
  }`;
  const raw = (await getJson(`${host}/api/v3/klines?${qs}`)) as unknown[];
  if (!Array.isArray(raw)) throw new Error("bad payload");
  return raw.map((k) => {
    const a = k as unknown[];
    return [
      Number(a[0]),
      String(a[1]),
      String(a[2]),
      String(a[3]),
      String(a[4]),
      String(a[5]),
    ] as Kline;
  });
}

async function fromBybit(
  symbol: string,
  interval: string,
  limit: number,
  endTime: number | null,
): Promise<Kline[]> {
  const iv = BYBIT_INTERVAL[interval];
  if (!iv) throw new Error("interval unsupported");
  const qs = `category=spot&symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${Math.min(
    1000,
    limit,
  )}${endTime ? `&end=${endTime}` : ""}`;
  const j = (await getJson(`https://api.bybit.com/v5/market/kline?${qs}`)) as {
    retCode?: number;
    result?: { list?: string[][] };
  };
  const list = j.result?.list;
  if (j.retCode !== 0 || !Array.isArray(list) || list.length === 0)
    throw new Error("bybit empty");
  // Bybit returns newest-first: [start, open, high, low, close, volume, turnover]
  return list
    .map((r) => [Number(r[0]), r[1], r[2], r[3], r[4], r[5]] as Kline)
    .sort((a, b) => a[0] - b[0]);
}

async function fromGate(
  symbol: string,
  interval: string,
  limit: number,
  endTime: number | null,
): Promise<Kline[]> {
  const iv = GATE_INTERVAL[interval];
  if (!iv) throw new Error("interval unsupported");
  const pair = symbol.toUpperCase().endsWith("USDT")
    ? `${symbol.toUpperCase().slice(0, -4)}_USDT`
    : symbol.toUpperCase().replace(/(BTC|USD|FDUSD)$/, "_$1");
  const qs = `currency_pair=${pair}&interval=${iv}&limit=${Math.min(1000, limit)}${
    endTime ? `&to=${Math.floor(endTime / 1000)}` : ""
  }`;
  const raw = (await getJson(
    `https://api.gateio.ws/api/v4/spot/candlesticks?${qs}`,
  )) as string[][];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("gate empty");
  // [t(sec), quoteVolume, close, high, low, open, baseVolume, closed]
  return raw
    .map((r) => [Number(r[0]) * 1000, r[5], r[3], r[4], r[2], r[6]] as Kline)
    .sort((a, b) => a[0] - b[0]);
}

export const Route = createFileRoute("/api/klines")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
        const interval = url.searchParams.get("interval") ?? "15m";
        const rawLimit = Number(url.searchParams.get("limit") ?? "300");
        const limit = Math.min(
          1000,
          Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 300),
        );
        const endTimeRaw = Number(url.searchParams.get("endTime") ?? "");
        const endTime =
          Number.isFinite(endTimeRaw) && endTimeRaw > 0 ? Math.floor(endTimeRaw) : null;

        const sources: Array<{ name: string; run: () => Promise<Kline[]> }> = [
          {
            name: "binance",
            run: () =>
              fromBinanceLike("https://api.binance.com", symbol, interval, limit, endTime),
          },
          {
            name: "binance-vision",
            run: () =>
              fromBinanceLike(
                "https://data-api.binance.vision",
                symbol,
                interval,
                limit,
                endTime,
              ),
          },
          { name: "bybit", run: () => fromBybit(symbol, interval, limit, endTime) },
          {
            name: "mexc",
            run: () =>
              fromBinanceLike(
                "https://api.mexc.com",
                symbol,
                interval,
                limit,
                endTime,
                MEXC_INTERVAL,
              ),
          },
          { name: "gate", run: () => fromGate(symbol, interval, limit, endTime) },
          {
            name: "binance-us",
            run: () =>
              fromBinanceLike("https://api.binance.us", symbol, interval, limit, endTime),
          },
        ];

        const errors: string[] = [];
        for (const src of sources) {
          try {
            const rows = await src.run();
            if (!rows.length) {
              errors.push(`${src.name}: empty`);
              continue;
            }
            return new Response(JSON.stringify(rows.slice(-limit)), {
              status: 200,
              headers: {
                "content-type": "application/json",
                "cache-control": "public, max-age=30",
                "x-data-source": src.name,
              },
            });
          } catch (e) {
            errors.push(`${src.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return new Response(
          JSON.stringify({ error: "upstream_failed", detail: errors.join(" | ") }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
