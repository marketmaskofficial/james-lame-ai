// Provider-aware symbol registry.
//
// Today every tradable instrument resolves to the Binance kline API through
// /api/klines, but the model already separates the *display* identity of an
// instrument (ticker, name, asset class, exchange) from the *data* identity
// (provider + providerSymbol). Adding futures/stocks/forex later means adding
// providers here and a fetcher branch in marketdata.ts — no UI changes.

export type AssetClass = "crypto" | "futures" | "stock" | "forex" | "index";
export type DataProvider = "binance";

export type MarketSymbol = {
  /** Stable id used in layouts and the URL. */
  id: string;
  /** What the trader types and sees, e.g. BTC or NQ. */
  ticker: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  provider: DataProvider;
  /** Symbol string the provider understands. */
  providerSymbol: string;
  /** Extra strings the search should match (aliases like "NQ", "nasdaq"). */
  aliases?: string[];
};

const crypto = (
  ticker: string,
  name: string,
  providerSymbol: string,
  aliases: string[] = [],
): MarketSymbol => ({
  id: `binance:${providerSymbol}`,
  ticker,
  name,
  assetClass: "crypto",
  exchange: "Binance",
  provider: "binance",
  providerSymbol,
  aliases,
});

export const SYMBOL_REGISTRY: MarketSymbol[] = [
  crypto("BTCUSDT", "Bitcoin / TetherUS", "BTCUSDT", ["BTC", "bitcoin", "xbt"]),
  crypto("ETHUSDT", "Ethereum / TetherUS", "ETHUSDT", ["ETH", "ether"]),
  crypto("SOLUSDT", "Solana / TetherUS", "SOLUSDT", ["SOL", "solana"]),
  crypto("BNBUSDT", "BNB / TetherUS", "BNBUSDT", ["BNB"]),
  crypto("XRPUSDT", "XRP / TetherUS", "XRPUSDT", ["XRP", "ripple"]),
  crypto("ADAUSDT", "Cardano / TetherUS", "ADAUSDT", ["ADA", "cardano"]),
  crypto("DOGEUSDT", "Dogecoin / TetherUS", "DOGEUSDT", ["DOGE"]),
  crypto("AVAXUSDT", "Avalanche / TetherUS", "AVAXUSDT", ["AVAX"]),
  crypto("LINKUSDT", "Chainlink / TetherUS", "LINKUSDT", ["LINK"]),
  crypto("LTCUSDT", "Litecoin / TetherUS", "LTCUSDT", ["LTC"]),
  crypto("DOTUSDT", "Polkadot / TetherUS", "DOTUSDT", ["DOT"]),
  crypto("ATOMUSDT", "Cosmos / TetherUS", "ATOMUSDT", ["ATOM"]),
  crypto("ARBUSDT", "Arbitrum / TetherUS", "ARBUSDT", ["ARB"]),
  crypto("OPUSDT", "Optimism / TetherUS", "OPUSDT", ["OP"]),
  crypto("APTUSDT", "Aptos / TetherUS", "APTUSDT", ["APT"]),
  crypto("INJUSDT", "Injective / TetherUS", "INJUSDT", ["INJ"]),
  crypto("SUIUSDT", "Sui / TetherUS", "SUIUSDT", ["SUI"]),
  crypto("TONUSDT", "Toncoin / TetherUS", "TONUSDT", ["TON"]),
  crypto("NEARUSDT", "NEAR Protocol / TetherUS", "NEARUSDT", ["NEAR"]),
  crypto("MATICUSDT", "Polygon / TetherUS", "MATICUSDT", ["MATIC", "polygon"]),
  crypto("ETHBTC", "Ethereum / Bitcoin", "ETHBTC", ["ETHBTC"]),
  crypto("BTCFDUSD", "Bitcoin / FDUSD", "BTCFDUSD", []),
];

const BY_TICKER = new Map(SYMBOL_REGISTRY.map((s) => [s.ticker, s]));

export function resolveSymbol(ticker: string): MarketSymbol {
  return (
    BY_TICKER.get(ticker.toUpperCase()) ??
    crypto(ticker.toUpperCase(), ticker.toUpperCase(), ticker.toUpperCase())
  );
}

export function searchSymbols(query: string, limit = 12): MarketSymbol[] {
  const q = query.trim().toLowerCase();
  if (!q) return SYMBOL_REGISTRY.slice(0, limit);
  const scored: Array<{ s: MarketSymbol; score: number }> = [];
  for (const s of SYMBOL_REGISTRY) {
    const hay = [s.ticker, s.name, ...(s.aliases ?? [])].map((v) =>
      v.toLowerCase(),
    );
    let score = -1;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q)) score = Math.max(score, 60);
      else if (h.includes(q)) score = Math.max(score, 25);
    }
    if (score >= 0) scored.push({ s, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.s);
}

// ---- recents & favorites (device-local, instant) ---------------------------

const RECENTS_KEY = "sg.symbols.recent";
const FAVS_KEY = "sg.symbols.fav";

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* storage blocked */
  }
}

export const getRecentSymbols = () => readList(RECENTS_KEY);
export function pushRecentSymbol(ticker: string) {
  writeList(RECENTS_KEY, [ticker, ...readList(RECENTS_KEY).filter((t) => t !== ticker)]);
}

export const getFavoriteSymbols = () => readList(FAVS_KEY);
export function toggleFavoriteSymbol(ticker: string): string[] {
  const cur = readList(FAVS_KEY);
  const next = cur.includes(ticker)
    ? cur.filter((t) => t !== ticker)
    : [ticker, ...cur];
  writeList(FAVS_KEY, next);
  return next;
}

// ---- favorite timeframes ---------------------------------------------------

const TF_FAVS_KEY = "sg.timeframes.fav";
export const DEFAULT_FAVORITE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function getFavoriteTimeframes(): string[] {
  const list = readList(TF_FAVS_KEY);
  return list.length ? list : DEFAULT_FAVORITE_TIMEFRAMES;
}

export function toggleFavoriteTimeframe(tf: string): string[] {
  const cur = getFavoriteTimeframes();
  const next = cur.includes(tf) ? cur.filter((t) => t !== tf) : [...cur, tf];
  writeList(TF_FAVS_KEY, next.length ? next : DEFAULT_FAVORITE_TIMEFRAMES);
  return next.length ? next : DEFAULT_FAVORITE_TIMEFRAMES;
}
