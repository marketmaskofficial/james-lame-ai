import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
} from "@/lib/watchlists.functions";
import { resolveSymbol, searchSymbols } from "@/lib/symbols";
import { sortWatchlistRows } from "@/lib/workspace/watchlistSort";
import type { WidgetInstance, ChartInstanceOption } from "@/lib/workspace/types";

type Quote = {
  price: number;
  /** Since the fetched daily bar's own open — not an exchange-provided rolling 24h stat. */
  changePct: number;
  absChange: number;
  high: number;
  low: number;
  volume: number;
};

export type WatchlistConfig = NonNullable<WidgetInstance["watchlistConfig"]>;

export const DEFAULT_WATCHLIST_CONFIG: WatchlistConfig = {
  sortBy: "manual",
  sortDir: "asc",
  boundChartInstanceId: "active",
};

type SortBy = WatchlistConfig["sortBy"];

const SORT_OPTIONS: Array<{ id: SortBy; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "symbol", label: "Symbol" },
  { id: "price", label: "Price" },
  { id: "changePct", label: "Chg %" },
];

/**
 * Right-rail / dock watchlist (UI-4h-1 baseline, UI-4h-3 enhancement). Quotes
 * come from the same public market-data proxy the chart uses (`/api/klines`,
 * one batched poll for the whole list per interval, not one stream per row) —
 * price/abs-change/%-change/high/low/volume are all read straight off that
 * same already-fetched daily bar (open/high/low/close/volume), zero
 * additional endpoints. `changePct`/`absChange` are the bar's own
 * close-vs-open move, not an exchange 24h-ticker stat — labeled as such
 * below, never oversold as one.
 *
 * Singleton widget (like Scanner/Volume Profile — no `allowMultipleInstances`
 * in widgetRegistry.ts): a `boundChartInstanceId` config field, same
 * "active" | specific-instanceId convention Volume Profile already
 * established, lets this one instance target any open chart so a
 * multi-chart layout can park it on a specific chart's symbol/click-to-load
 * behavior independently of which chart currently has focus.
 */
export function WatchlistPanel({
  chartInstances,
  activeChartInstanceId,
  config,
  onConfigChange,
  onSelect,
  signedIn,
}: {
  chartInstances: ChartInstanceOption[];
  activeChartInstanceId: string;
  config: WatchlistConfig | undefined;
  onConfigChange: (next: WatchlistConfig) => void;
  onSelect: (ticker: string, targetChartInstanceId: string) => void;
  signedIn: boolean;
}) {
  const cfg = config ?? DEFAULT_WATCHLIST_CONFIG;
  const boundInstanceId =
    cfg.boundChartInstanceId !== "active" &&
    chartInstances.some((c) => c.instanceId === cfg.boundChartInstanceId)
      ? cfg.boundChartInstanceId
      : activeChartInstanceId;
  const bound = chartInstances.find((c) => c.instanceId === boundInstanceId);
  const boundSymbol = bound?.symbol;

  const qc = useQueryClient();
  const listFn = useServerFn(listWatchlist);
  const addFn = useServerFn(addToWatchlist);
  const removeFn = useServerFn(removeFromWatchlist);
  const reorderFn = useServerFn(reorderWatchlist);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [dragSymbol, setDragSymbol] = useState<string | null>(null);

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
  const reorderMut = useMutation({
    mutationFn: (symbols: string[]) => reorderFn({ data: { symbols } }),
    onError: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const rows = listQuery.data ?? [];
  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);

  // One poll for the visible rows; each row's quote comes from the same
  // single daily-bar fetch (open/high/low/close/volume all real, all from
  // one request per symbol).
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
              [number, string, string, string, string, string]
            >;
            const last = rows.at(-1);
            if (!last) return;
            const open = parseFloat(last[1]);
            const high = parseFloat(last[2]);
            const low = parseFloat(last[3]);
            const close = parseFloat(last[4]);
            const volume = parseFloat(last[5]);
            next[s] = {
              price: close,
              absChange: close - open,
              changePct: ((close - open) / open) * 100,
              high,
              low,
              volume,
            };
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

  const sortedRows = useMemo(
    () =>
      sortWatchlistRows(rows, quotes, cfg.sortBy, cfg.sortDir, (s) => resolveSymbol(s).ticker),
    [rows, quotes, cfg.sortBy, cfg.sortDir],
  );

  const suggestions = query.trim() ? searchSymbols(query, 6) : [];

  const setSortBy = (sortBy: SortBy) => {
    if (sortBy === cfg.sortBy) {
      onConfigChange({ ...cfg, sortDir: cfg.sortDir === "asc" ? "desc" : "asc" });
    } else {
      onConfigChange({ ...cfg, sortBy, sortDir: sortBy === "manual" ? "asc" : "desc" });
    }
  };

  const commitReorder = (fromSymbol: string, toSymbol: string) => {
    if (fromSymbol === toSymbol) return;
    const order = rows.map((r) => r.symbol);
    const fromIdx = order.indexOf(fromSymbol);
    const toIdx = order.indexOf(toSymbol);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...order];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromSymbol);
    qc.setQueryData(
      ["watchlist"],
      next.map((sym) => rows.find((r) => r.symbol === sym)!),
    );
    reorderMut.mutate(next);
  };

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
        {chartInstances.length > 1 && (
          <select
            title="Which chart clicking a symbol loads it into"
            value={cfg.boundChartInstanceId}
            onChange={(e) => onConfigChange({ ...cfg, boundChartInstanceId: e.target.value })}
            className="ml-2 h-6 rounded-[6px] border border-border bg-card px-1 text-[10px] outline-none focus:border-brand"
          >
            <option value="active">Active chart</option>
            {chartInstances.map((c) => (
              <option key={c.instanceId} value={c.instanceId}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setAdding((v) => !v)}
          title="Add symbol"
          className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {chartInstances.length > 1 && (
        <div className="border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          → targets <span className="text-brand">{bound?.label ?? "active chart"}</span>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <span>Sort:</span>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSortBy(opt.id)}
            className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 ${
              cfg.sortBy === opt.id ? "bg-accent text-foreground" : "hover:bg-accent/60"
            }`}
          >
            {opt.label}
            {cfg.sortBy === opt.id && opt.id !== "manual" && (
              cfg.sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />
            )}
          </button>
        ))}
      </div>

      {adding && (
        <div className="border-b border-border p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search market to add…"
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
        {sortedRows.map((row) => {
          const q = quotes[row.symbol];
          const active = row.symbol === boundSymbol;
          const draggable = cfg.sortBy === "manual";
          const tooltip = q
            ? `H: ${q.high.toLocaleString("en-US", { maximumFractionDigits: 6 })}  L: ${q.low.toLocaleString("en-US", { maximumFractionDigits: 6 })}  Vol: ${q.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })} (24h bar)`
            : undefined;
          return (
            <li
              key={row.id}
              title={tooltip}
              draggable={draggable}
              onDragStart={() => setDragSymbol(row.symbol)}
              onDragOver={(e) => {
                if (draggable) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggable && dragSymbol) commitReorder(dragSymbol, row.symbol);
                setDragSymbol(null);
              }}
              onDragEnd={() => setDragSymbol(null)}
            >
              <div
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
                  active ? "bg-accent" : "hover:bg-accent/60"
                } ${dragSymbol === row.symbol ? "opacity-50" : ""}`}
              >
                {draggable && (
                  <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground/50" />
                )}
                <button
                  onClick={() => onSelect(row.symbol, boundInstanceId)}
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
                    className={`w-14 shrink-0 text-right font-mono text-[9px] ${
                      !q ? "text-muted-foreground" : q.absChange >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {q ? `${q.absChange >= 0 ? "+" : ""}${q.absChange.toFixed(q.price >= 100 ? 2 : 6)}` : ""}
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
      <div className="border-t border-border px-2 py-1 text-[9px] leading-snug text-muted-foreground/80">
        Chg/Chg% is this bar's own close-vs-open move (daily bar), not an exchange 24h-ticker stat. H/L/Vol shown on hover, same daily bar.
      </div>
    </div>
  );
}
