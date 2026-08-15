import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star, X } from "lucide-react";
import {
  getFavoriteSymbols,
  getRecentSymbols,
  resolveSymbol,
  searchSymbols,
  toggleFavoriteSymbol,
  type MarketSymbol,
} from "@/lib/symbols";

const CLASS_LABEL: Record<string, string> = {
  crypto: "Crypto",
  futures: "Futures",
  stock: "Stock",
  forex: "FX",
  index: "Index",
};

/**
 * Keyboard-first instrument picker. Shows favorites and recents when empty and
 * ranked matches while typing; every row carries its asset class and venue so
 * the same list works once non-crypto providers are wired in.
 */
export function SymbolSearch({
  symbol,
  onSelect,
  onClose,
}: {
  symbol: string;
  onSelect: (s: MarketSymbol) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setFavorites(getFavoriteSymbols());
    setRecents(getRecentSymbols());
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (query.trim()) return searchSymbols(query, 14);
    const pinned = [...favorites, ...recents.filter((r) => !favorites.includes(r))];
    const fromPinned = pinned.map(resolveSymbol);
    const rest = searchSymbols("", 14).filter(
      (s) => !pinned.includes(s.ticker),
    );
    return [...fromPinned, ...rest].slice(0, 14);
  }, [query, favorites, recents]);

  const choose = (s: MarketSymbol) => {
    onSelect(s);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(560px,92vw)] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown")
                setCursor((c) => Math.min(c + 1, results.length - 1));
              else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
              else if (e.key === "Enter" && results[cursor]) choose(results[cursor]);
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search markets — BTC, ETH, SOL…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!query.trim() && (favorites.length > 0 || recents.length > 0) && (
          <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Favorites &amp; recent
          </p>
        )}

        <ul className="max-h-[52vh] overflow-auto p-1.5">
          {results.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              No markets match “{query}”. More venues are coming as providers are
              connected.
            </li>
          )}
          {results.map((s, i) => (
            <li key={s.id}>
              <div
                onMouseEnter={() => setCursor(i)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                  i === cursor ? "bg-accent" : ""
                }`}
              >
                <button
                  onClick={() => {
                    setFavorites(toggleFavoriteSymbol(s.ticker));
                  }}
                  title="Favorite"
                  className={
                    favorites.includes(s.ticker)
                      ? "text-brand"
                      : "text-muted-foreground hover:text-foreground"
                  }
                >
                  <Star
                    className="h-3.5 w-3.5"
                    fill={favorites.includes(s.ticker) ? "currentColor" : "none"}
                  />
                </button>
                <button
                  onClick={() => choose(s)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`w-28 shrink-0 truncate font-mono text-xs ${
                      s.ticker === symbol ? "text-brand" : "text-foreground"
                    }`}
                  >
                    {s.ticker}
                  </span>
                  <span className="flex-1 truncate text-[11px] text-muted-foreground">
                    {s.name}
                  </span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[9.5px] uppercase text-muted-foreground">
                    {CLASS_LABEL[s.assetClass] ?? s.assetClass}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                    {s.exchange}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
