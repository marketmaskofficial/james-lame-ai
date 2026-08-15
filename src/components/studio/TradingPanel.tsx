import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import type { AccountSnapshot } from "@/lib/trading/types";
import { getInstrument, pnlPerUnit } from "@/lib/trading/instruments";

export type OrderDraft = {
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
};

/**
 * A ticket populated from the chart (right-click level, or a position tool).
 * It never submits anything — the trader still presses buy/sell.
 */
export type TicketPrefill = {
  nonce: number;
  side?: "buy" | "sell";
  type?: OrderDraft["type"];
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  qty?: number;
};


const money = (n: number, ccy = "USD") =>
  `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 2,
  })}`;

function Field({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? "any"}
        value={value}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
      />
    </label>
  );
}

/**
 * Order ticket + account summary. Every fill it produces comes from the paper
 * engine, and the panel says so — nothing here is presented as a real fill.
 */
export function TradingPanel({
  symbol,
  timeframe,
  lastPrice,
  snapshot,
  busy,
  error,
  onSubmit,
  onFlatten,
  onReset,
  signedIn,
  prefill,
}: {
  symbol: string;
  timeframe: string;
  lastPrice: number | null;
  snapshot: AccountSnapshot | null;
  busy: boolean;
  error: string | null;
  onSubmit: (draft: OrderDraft) => void;
  onFlatten: () => void;
  onReset: () => void;
  signedIn: boolean;
  prefill?: TicketPrefill | null;
}) {
  const inst = getInstrument(symbol);
  const [type, setType] = useState<OrderDraft["type"]>("market");
  const [qty, setQty] = useState("0.01");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [bracket, setBracket] = useState(true);

  useEffect(() => {
    setLimitPrice("");
    setStopPrice("");
    setStopLoss("");
    setTakeProfit("");
  }, [symbol]);

  // Chart-driven ticket population (right-click levels, position tool).
  useEffect(() => {
    if (!prefill) return;
    const trim = (n: number) => String(Number(n.toFixed(8)));
    if (prefill.type) setType(prefill.type);
    if (prefill.qty !== undefined) setQty(trim(prefill.qty));
    if (prefill.limitPrice !== undefined) setLimitPrice(trim(prefill.limitPrice));
    if (prefill.stopPrice !== undefined) setStopPrice(trim(prefill.stopPrice));
    if (prefill.stopLoss !== undefined) {
      setBracket(true);
      setStopLoss(trim(prefill.stopLoss));
    }
    if (prefill.takeProfit !== undefined) {
      setBracket(true);
      setTakeProfit(trim(prefill.takeProfit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);



  const entryRef = useMemo(() => {
    if (type === "limit" && limitPrice) return Number(limitPrice);
    if ((type === "stop" || type === "stop_limit") && stopPrice)
      return Number(stopPrice);
    return lastPrice ?? 0;
  }, [type, limitPrice, stopPrice, lastPrice]);

  const q = Number(qty) || 0;
  const riskAmt =
    stopLoss && entryRef
      ? pnlPerUnit(inst, Math.abs(entryRef - Number(stopLoss))) * q
      : null;
  const rewardAmt =
    takeProfit && entryRef
      ? pnlPerUnit(inst, Math.abs(Number(takeProfit) - entryRef)) * q
      : null;
  const rr = riskAmt && rewardAmt && riskAmt > 0 ? rewardAmt / riskAmt : null;

  function send(side: "buy" | "sell") {
    const draft: OrderDraft = { side, type, qty: q };
    if (type === "limit" || type === "stop_limit")
      draft.limitPrice = Number(limitPrice) || undefined;
    if (type === "stop" || type === "stop_limit")
      draft.stopPrice = Number(stopPrice) || undefined;
    if (bracket) {
      if (stopLoss) draft.stopLoss = Number(stopLoss);
      if (takeProfit) draft.takeProfit = Number(takeProfit);
    }
    onSubmit(draft);
  }

  const acct = snapshot?.account;
  const equity = acct ? Number(acct.balance) + (snapshot?.openPnl ?? 0) : null;

  if (!signedIn) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Sign in to use the paper trading account.
      </div>
    );
  }

  const px = (n: number | null) =>
    n === null
      ? "—"
      : n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 6 });

  const stepQty = (dir: 1 | -1) => {
    const step = inst.qtyStep || 0.01;
    const decimals = (String(step).split(".")[1] ?? "").length;
    const next = Math.max(step, (Number(qty) || 0) + dir * step);
    setQty(next.toFixed(decimals));
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="rounded-lg border border-border bg-card/60 p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
            <ShieldAlert className="h-3 w-3" />
            {(acct?.environment ?? "paper").toUpperCase()} · {acct?.label ?? "account"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {acct?.account_number ?? "—"}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 font-mono">
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Equity</div>
            <div>{equity === null ? "—" : money(equity, acct?.currency)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Open P&L</div>
            <div
              className={
                (snapshot?.openPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {snapshot ? money(snapshot.openPnl, acct?.currency) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Daily P&L</div>
            <div
              className={
                (snapshot?.dailyPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {snapshot ? money(snapshot.dailyPnl, acct?.currency) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* prominent quick trade — market orders at the live last price */}
      <div>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy || q <= 0 || lastPrice === null}
            onClick={() => onSubmit({ side: "sell", type: "market", qty: q })}
            className="rounded-md bg-red-600 px-2 py-2 text-center text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            <div className="text-[10px] font-bold tracking-widest">SELL MKT</div>
            <div className="font-mono text-sm leading-tight">{px(lastPrice)}</div>
          </button>
          <button
            disabled={busy || q <= 0 || lastPrice === null}
            onClick={() => onSubmit({ side: "buy", type: "market", qty: q })}
            className="rounded-md bg-emerald-600 px-2 py-2 text-center text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <div className="text-[10px] font-bold tracking-widest">BUY MKT</div>
            <div className="font-mono text-sm leading-tight">{px(lastPrice)}</div>
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-2">
          <button
            onClick={() => stepQty(-1)}
            className="h-6 w-7 rounded border border-border text-muted-foreground hover:text-foreground"
          >
            −
          </button>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-20 rounded border border-border bg-background px-2 py-0.5 text-center font-mono text-xs outline-none focus:border-primary"
          />
          <button
            onClick={() => stepQty(1)}
            className="h-6 w-7 rounded border border-border text-muted-foreground hover:text-foreground"
          >
            +
          </button>
        </div>
        <p className="mt-1 text-center text-[9px] text-muted-foreground">
          Last traded price — no bid/ask feed connected, so this is not a real quote.
        </p>
      </div>


      <div className="flex items-center gap-1">
        {(["market", "limit", "stop", "stop_limit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 rounded-md px-1.5 py-1 text-[10px] font-medium capitalize transition ${
              type === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.replace("_", "-")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={`Qty (${inst.assetClass === "futures" ? "contracts" : "units"})`} value={qty} onChange={setQty} step={String(inst.qtyStep)} />
        {(type === "limit" || type === "stop_limit") && (
          <Field
            label="Limit"
            value={limitPrice}
            onChange={setLimitPrice}
            placeholder={lastPrice ? String(lastPrice) : ""}
          />
        )}
        {(type === "stop" || type === "stop_limit") && (
          <Field
            label="Stop trigger"
            value={stopPrice}
            onChange={setStopPrice}
            placeholder={lastPrice ? String(lastPrice) : ""}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={bracket}
          onChange={(e) => setBracket(e.target.checked)}
          className="accent-primary"
        />
        Attach stop loss / take profit
      </label>

      {bracket && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stop loss" value={stopLoss} onChange={setStopLoss} />
          <Field label="Take profit" value={takeProfit} onChange={setTakeProfit} />
        </div>
      )}

      {(riskAmt !== null || rewardAmt !== null) && (
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[10px]">
          <span className="text-red-400">
            Risk {riskAmt === null ? "—" : money(riskAmt)}
          </span>
          <span className="text-emerald-400">
            Reward {rewardAmt === null ? "—" : money(rewardAmt)}
          </span>
          <span className="text-muted-foreground">
            R:R {rr === null ? "—" : rr.toFixed(2)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={busy || q <= 0}
          onClick={() => send("buy")}
          className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          Place buy order
        </button>
        <button
          disabled={busy || q <= 0}
          onClick={() => send("sell")}
          className="flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-2 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingDown className="h-3.5 w-3.5" />}
          Place sell order
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (
              window.confirm(
                "Flatten every open position and cancel working orders on this account?",
              )
            )
              onFlatten();
          }}
          className="flex-1 rounded-md border border-red-500/40 px-2 py-1.5 text-[11px] text-red-300 transition hover:bg-red-500/10"
        >
          Flatten all
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                "Reset this paper account? Positions, orders, executions and P&L are cleared.",
              )
            )
              onReset();
          }}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          Reset account
        </button>
      </div>


      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {snapshot?.simulation ??
          "Paper engine — simulated fills at the live last price. Not a real broker."}{" "}
        Trading {symbol} · {timeframe}.
      </p>
    </div>
  );
}
