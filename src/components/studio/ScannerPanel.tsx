import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { SYMBOLS } from "@/lib/marketdata";
import { resolveSymbol } from "@/lib/symbols";

type Quote = { price: number; changePct: number; volume: number };
type SortKey = "symbol" | "price" | "changePct" | "volume";

/**
 * Dock-only market scanner over the fixed SYMBOLS universe (same list the
 * rest of the app already treats as "the markets we cover" — no new data
 * vendor). Quotes come from the same public /api/klines proxy the chart and
 * WatchlistPanel already use: one batched poll across all rows per tick,
 * not one stream per row. Every column is a real OHLCV-derived number
 * (today's close, today's open/close % change, today's volume) — nothing
 * here is Level 2/orderflow/tick data, and nothing is fabricated.
 */
export function ScannerPanel({
  activeSymbol,
  onSelect,
}: {
  activeSymbol: string;
  onSelect: (ticker: string) => void;
}) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    const pull = async () => {
      const next: Record<string, Quote> = {};
      await Promise.all(
        SYMBOLS.map(async (s) => {
          try {
            const res = await fetch(
              `/api/klines?symbol=${encodeURIComponent(s)}&interval=1d&limit=2`,
            );
            if (!res.ok) return;
            const rows = (await res.json()) as Array<
              [number, string, string, string, string, string, ...unknown[]]
            >;
            const last = rows.at(-1);
            if (!last) return;
            const open = parseFloat(last[1]);
            const close = parseFloat(last[4]);
            const volume = parseFloat(last[5]);
            next[s] = { price: close, changePct: ((close - open) / open) * 100, volume };
          } catch {
            /* row keeps its previous quote */
          }
        }),
      );
      if (!stoppedRef.current) setQuotes((q) => ({ ...q, ...next }));
    };
    void pull();
    // 20s: slightly slower than WatchlistPanel's 15s (proven-safe for one
    // list) since this always polls the full 20-symbol universe rather than
    // however many a user happens to be watching; /api/klines itself already
    // caches each symbol server-side for 30s, so this stays well inside that.
    const t = setInterval(pull, 20_000);
    return () => {
      stoppedRef.current = true;
      clearInterval(t);
    };
  }, []);

  const rows = SYMBOLS.map((s) => ({ symbol: s, q: quotes[s] }));
  rows.sort((a, b) => {
    if (sortKey === "symbol") return sortDir * a.symbol.localeCompare(b.symbol);
    const av = a.q?.[sortKey] ?? Number.NEGATIVE_INFINITY;
    const bv = b.q?.[sortKey] ?? Number.NEGATIVE_INFINITY;
    return sortDir * (av - bv);
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  const columns: { key: SortKey; label: string; className: string }[] = [
    { key: "symbol", label: "Symbol", className: "flex-1 text-left" },
    { key: "price", label: "Price", className: "w-24 text-right" },
    { key: "changePct", label: "24h %", className: "w-16 text-right" },
    { key: "volume", label: "24h Vol", className: "w-24 text-right" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center border-b border-border px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Scanner
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {columns.map((c) => (
          <button
            key={c.key}
            onClick={() => toggleSort(c.key)}
            className={`flex items-center justify-end gap-0.5 hover:text-foreground ${c.className} ${
              c.key === "symbol" ? "justify-start" : ""
            }`}
          >
            {c.label}
            {sortKey === c.key &&
              (sortDir === 1 ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              ))}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-1">
        {rows.map(({ symbol, q }) => {
          const active = symbol === activeSymbol;
          return (
            <li key={symbol}>
              <button
                onClick={() => onSelect(symbol)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                  active ? "bg-accent" : "hover:bg-accent/60"
                }`}
              >
                <span className={`flex-1 truncate font-mono text-[11px] ${active ? "text-brand" : ""}`}>
                  {resolveSymbol(symbol).ticker}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-[11px] text-foreground">
                  {q ? q.price.toLocaleString("en-US", { maximumFractionDigits: q.price >= 100 ? 2 : 6 }) : "—"}
                </span>
                <span
                  className={`w-16 shrink-0 text-right font-mono text-[10px] ${
                    !q ? "text-muted-foreground" : q.changePct >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {q ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : ""}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                  {q
                    ? q.volume.toLocaleString("en-US", {
                        maximumFractionDigits: q.volume >= 1000 ? 0 : 2,
                        notation: q.volume >= 100_000 ? "compact" : "standard",
                      })
                    : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
