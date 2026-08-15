import { useState } from "react";
import { X } from "lucide-react";
import type { AccountSnapshot } from "@/lib/trading/types";

const num = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const cell = "px-2 py-1.5 whitespace-nowrap";
const head =
  "px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

export type TradingTab = "positions" | "orders" | "history";

export function TradingTables({
  snapshot,
  onClosePosition,
  onCancelOrder,
  onSelectSymbol,
  busy,
  tab: controlledTab,
  onTabChange,
  showTabs = true,
  onBreakeven,
  onReverse,
  onModifyOrder,
  onFlattenAll,
  onCancelAll,
}: {
  snapshot: AccountSnapshot | null;
  onClosePosition: (id: string) => void;
  onCancelOrder: (id: string) => void;
  onSelectSymbol: (symbol: string) => void;
  busy: boolean;
  tab?: TradingTab;
  onTabChange?: (t: TradingTab) => void;
  showTabs?: boolean;
  onBreakeven?: (id: string) => void;
  onReverse?: (id: string) => void;
  onModifyOrder?: (id: string) => void;
  onFlattenAll?: () => void;
  onCancelAll?: () => void;
}) {
  const [localTab, setLocalTab] = useState<TradingTab>("positions");
  const tab = controlledTab ?? localTab;
  const setTab = (t: TradingTab) => {
    setLocalTab(t);
    onTabChange?.(t);
  };
  const orders = (snapshot?.orders ?? []).filter((o) =>
    ["working", "accepted", "created", "partially_filled"].includes(o.status),
  );
  const done = snapshot?.history ?? [];

  const tabs = [
    { id: "positions" as const, label: `Positions (${snapshot?.positions.length ?? 0})` },
    { id: "orders" as const, label: `Orders (${orders.length})` },
    { id: "history" as const, label: "History" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {showTabs &&
          tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-1.5">
          {tab === "positions" && onFlattenAll && (
            <button
              disabled={busy || !snapshot?.positions.length}
              onClick={onFlattenAll}
              className="rounded border border-border px-2 py-0.5 text-[10px] hover:border-red-500 hover:text-red-400 disabled:opacity-40"
            >
              Flatten all
            </button>
          )}
          {tab === "orders" && onCancelAll && (
            <button
              disabled={busy || !orders.length}
              onClick={onCancelAll}
              className="rounded border border-border px-2 py-0.5 text-[10px] hover:border-red-500 hover:text-red-400 disabled:opacity-40"
            >
              Cancel all
            </button>
          )}
          <span className="text-[10px] text-muted-foreground">
            Paper · simulated fills
          </span>
        </div>
      </div>


      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" && (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/60">
                <th className={head}>Symbol</th>
                <th className={head}>Side</th>
                <th className={head}>Qty</th>
                <th className={head}>Avg entry</th>
                <th className={head}>Last</th>
                <th className={head}>Stop</th>
                <th className={head}>Target</th>
                <th className={head}>Open P&L</th>
                <th className={head}>Source</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {(snapshot?.positions ?? []).map((p) => (
                <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className={cell}>
                    <button
                      className="text-primary hover:underline"
                      onClick={() => onSelectSymbol(p.symbol)}
                    >
                      {p.symbol}
                    </button>
                  </td>
                  <td
                    className={`${cell} ${p.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {p.side === "buy" ? "LONG" : "SHORT"}
                  </td>
                  <td className={cell}>{num(p.qty, 4)}</td>
                  <td className={cell}>{num(p.avg_entry, 4)}</td>
                  <td className={cell}>{num(p.last, 4)}</td>
                  <td className={cell}>{num(p.stop_price, 4)}</td>
                  <td className={cell}>{num(p.target_price, 4)}</td>
                  <td
                    className={`${cell} ${p.unrealized >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {num(p.unrealized)}
                  </td>
                  <td className={`${cell} text-muted-foreground`}>
                    {p.indicator_name ?? "manual"}
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={busy}
                        onClick={() => onClosePosition(p.id)}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                      >
                        Close
                      </button>
                      {onBreakeven && (
                        <button
                          disabled={busy}
                          onClick={() => onBreakeven(p.id)}
                          title="Move stop to average entry"
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-brand hover:text-brand disabled:opacity-50"
                        >
                          B/E
                        </button>
                      )}
                      {onReverse && (
                        <button
                          disabled={busy}
                          onClick={() => onReverse(p.id)}
                          title="Close and open the opposite side"
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-brand hover:text-brand disabled:opacity-50"
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  </td>

                </tr>
              ))}
              {!snapshot?.positions.length && (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-muted-foreground">
                    No open positions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "orders" && (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/60">
                <th className={head}>Symbol</th>
                <th className={head}>Side</th>
                <th className={head}>Type</th>
                <th className={head}>Purpose</th>
                <th className={head}>Qty</th>
                <th className={head}>Limit</th>
                <th className={head}>Stop</th>
                <th className={head}>Status</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className={cell}>{o.symbol}</td>
                  <td
                    className={`${cell} ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {o.side.toUpperCase()}
                  </td>
                  <td className={cell}>{o.order_type.replace("_", "-")}</td>
                  <td className={`${cell} text-muted-foreground`}>{o.purpose}</td>
                  <td className={cell}>{num(o.qty, 4)}</td>
                  <td className={cell}>{num(o.limit_price, 4)}</td>
                  <td className={cell}>{num(o.stop_price, 4)}</td>
                  <td className={`${cell} text-amber-400`}>{o.status}</td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      {onModifyOrder && (
                        <button
                          disabled={busy}
                          onClick={() => onModifyOrder(o.id)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-brand hover:text-brand disabled:opacity-50"
                        >
                          Modify
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => onCancelOrder(o.id)}
                        className="rounded border border-border p-0.5 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                        title="Cancel order"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </td>

                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    No working orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === "history" && (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="border-b border-border/60">
                <th className={head}>Time</th>
                <th className={head}>Symbol</th>
                <th className={head}>Side</th>
                <th className={head}>Qty</th>
                <th className={head}>Price</th>
                <th className={head}>Fees</th>
                <th className={head}>Realized</th>
              </tr>
            </thead>
            <tbody>
              {done.map((e) => (
                <tr key={e.id} className="border-b border-border/30 hover:bg-muted/20">
                  <td className={`${cell} text-muted-foreground`}>
                    {new Date(e.executed_at).toLocaleString()}
                  </td>
                  <td className={cell}>{e.symbol}</td>
                  <td
                    className={`${cell} ${e.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {e.side.toUpperCase()}
                  </td>
                  <td className={cell}>{num(e.qty, 4)}</td>
                  <td className={cell}>{num(e.price, 4)}</td>
                  <td className={cell}>{num(e.commission)}</td>
                  <td
                    className={`${cell} ${Number(e.realized_pnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {num(e.realized_pnl)}
                  </td>
                </tr>
              ))}
              {!done.length && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-muted-foreground">
                    No fills yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
