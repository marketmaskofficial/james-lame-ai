import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlists.functions";
import { resolveSymbol, searchSymbols } from "@/lib/symbols";

type Quote = { price: number; changePct: number };

/**
 * Right-rail watchlist. Quotes come from the same public market-data proxy the
 * chart uses (one batched poll for the whole list, not one stream per row).
 */
export function WatchlistPanel({
  activeSymbol,
  onSelect,
  signedIn,
}: {
  activeSymbol: string;
  onSelect: (ticker: string) => void;
  signedIn: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWatchlist);
  const addFn = useServerFn(addToWatchlist);
  const removeFn = useServerFn(removeFromWatchlist);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  const listQuery = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => listFn(),
    enabled: signedIn,
  });

  const addMut = useMutation({
    mutationFn: (symbol: string) => addFn({ data: { symbol } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
  const removeMut = useMutation({
    mutationFn: (symbol: string) => removeFn({ data: { symbol } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const symbols = useMemo(
    () => (listQuery.data ?? []).map((r) => r.symbol),
    [listQuery.data],
  );

  // One poll for the visible rows; 24h ticker is a single public request.
  const symbolsKey = symbols.join(",");
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;
  useEffect(() => {
    if (symbols.length === 0) return;
    let stopped = false;
    const pull = async () => {
      const next: Record<string, Quote> = {};
      await Promise.all(
        symbolsRef.current.map(async (s) => {
          try {
            const res = await fetch(
              `/api/klines?symbol=${encodeURIComponent(s)}&interval=1d&limit=2`,
            );
            if (!res.ok) return;
            const rows = (await res.json()) as Array<
              [number, string, string, string, string, ...unknown[]]
            >;
            const last = rows.at(-1);
            if (!last) return;
            const close = parseFloat(last[4]);
            const open = parseFloat(last[1]);
            next[s] = { price: close, changePct: ((close - open) / open) * 100 };
          } catch {
            /* row keeps its previous quote */
          }
        }),
      );
      if (!stopped) setQuotes((q) => ({ ...q, ...next }));
    };
    void pull();
    const t = setInterval(pull, 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [symbolsKey, symbols.length]);

  const suggestions = query.trim() ? searchSymbols(query, 6) : [];

  if (!signedIn) {
    return (
      <div className="p-3 text-[11px] text-muted-foreground">
        <Link to="/auth" className="text-brand underline">
          Sign in
        </Link>{" "}
        to keep a watchlist that follows you across devices.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Watchlist
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          title="Add symbol"
          className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {adding && (
        <div className="border-b border-border p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add market…"
            className="w-full rounded-md border border-border bg-card px-2 py-1 text-[11px] outline-none focus:border-brand"
          />
          <ul className="mt-1 space-y-0.5">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    addMut.mutate(s.ticker);
                    setQuery("");
                    setAdding(false);
                  }}
                  className="w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
                >
                  <span className="font-mono">{s.ticker}</span>{" "}
                  <span className="text-muted-foreground">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-auto p-1">
        {listQuery.isLoading && (
          <li className="px-2 py-2 text-[11px] text-muted-foreground">Loading…</li>
        )}
        {listQuery.data?.length === 0 && (
          <li className="px-2 py-2 text-[11px] text-muted-foreground">
            Nothing here yet — add the markets you trade.
          </li>
        )}
        {listQuery.data?.map((row) => {
          const q = quotes[row.symbol];
          const active = row.symbol === activeSymbol;
          return (
            <li key={row.id}>
              <div
                className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
                  active ? "bg-accent" : "hover:bg-accent/60"
                }`}
              >
                <button
                  onClick={() => onSelect(row.symbol)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span
                    className={`truncate font-mono text-[11px] ${active ? "text-brand" : ""}`}
                  >
                    {resolveSymbol(row.symbol).ticker}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-foreground">
                    {q ? q.price.toLocaleString("en-US", { maximumFractionDigits: q.price >= 100 ? 2 : 6 }) : "—"}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right font-mono text-[10px] ${
                      !q
                        ? "text-muted-foreground"
                        : q.changePct >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                    }`}
                  >
                    {q ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : ""}
                  </span>
                </button>
                <button
                  onClick={() => removeMut.mutate(row.symbol)}
                  title="Remove"
                  className="opacity-0 transition group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
