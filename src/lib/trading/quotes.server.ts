/** Server-side last-price lookup. Prices are never trusted from the client. */

import { getInstrument } from "./instruments";

const HOSTS = [
  "https://api.binance.com",
  "https://api.binance.us",
  "https://data-api.binance.vision",
];

const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 1500;

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  for (const host of HOSTS) {
    try {
      const r = await fetch(
        `${host}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
      );
      if (!r.ok) continue;
      const j = (await r.json()) as { price?: string };
      const p = Number(j.price);
      if (Number.isFinite(p) && p > 0) return p;
    } catch {
      /* try next host */
    }
  }
  // Fallbacks for regions/IPs where Binance is blocked (403).
  try {
    const r = await fetch(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`,
    );
    if (r.ok) {
      const j = (await r.json()) as {
        result?: { list?: Array<{ lastPrice?: string }> };
      };
      const p = Number(j.result?.list?.[0]?.lastPrice);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    /* try next provider */
  }
  try {
    const r = await fetch(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    );
    if (r.ok) {
      const j = (await r.json()) as { price?: string };
      const p = Number(j.price);
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {
    /* give up */
  }
  return null;
}


export async function getLastPrice(symbol: string): Promise<number | null> {
  const inst = getInstrument(symbol);
  if (inst.dataProvider !== "binance") return null;
  const hit = cache.get(inst.dataSymbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price;
  const price = await fetchBinancePrice(inst.dataSymbol);
  if (price !== null) cache.set(inst.dataSymbol, { price, at: Date.now() });
  return price;
}

export async function getLastPrices(
  symbols: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const out: Record<string, number> = {};
  await Promise.all(
    unique.map(async (s) => {
      const p = await getLastPrice(s);
      if (p !== null) out[s] = p;
    }),
  );
  return out;
}
