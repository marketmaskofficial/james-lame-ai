import { useEffect, useRef, useState } from "react";
import type { Bar, StrategyOut } from "@/lib/sgscript/types";
import type { AccountSnapshot, TradingAccount } from "@/lib/trading/types";
import { resolveOrderIntent, selectEligibleSignals, type ArmedContext, type StrategyExecutionMode } from "@/lib/trading/strategyExecution";

/**
 * Phase 5B-1/5B-4/5B-5 — owns Chart Studio's "Strategy Mode" (OFF/PAPER)
 * and Start/Stop arming for the CURRENT project, and is the ONE place that
 * turns an eligible strategy signal (from the pure
 * `src/lib/trading/strategyExecution.ts` adapter) into a real call to the
 * EXISTING OMS (`submitOrder`, via the caller-supplied `submitOrderFn` —
 * this hook never imports or wraps a server function itself, and never
 * writes to trade_orders/trade_positions/trade_executions directly).
 *
 * Deliberately does NOT own bars/strategy/account state itself — all of
 * that is Chart Studio's own existing state, passed in fresh on every
 * render, exactly like `useBuilderPreviewRefresh` reads `sgscript`/`bars`
 * from its caller rather than owning a second copy.
 */
export function useStrategyExecution({
  strategy,
  bars,
  symbol,
  timeframe,
  account,
  openPositionForSymbol,
  indicatorId,
  indicatorVersion,
  indicatorName,
  defaultQty,
  submitOrderFn,
}: {
  strategy: StrategyOut | null;
  bars: Bar[];
  symbol: string;
  timeframe: string;
  account: TradingAccount | null;
  /** The account's own current open position for `symbol`, if any —
   * re-derived by the caller from its existing trading snapshot on every
   * render. Never fetched by this hook itself (zero new network calls). */
  openPositionForSymbol: { side: "buy" | "sell"; qty: number } | null;
  indicatorId: string | null;
  indicatorVersion: number | null;
  indicatorName: string;
  defaultQty: number;
  /** The EXISTING `submitTradeOrder` server function, already bound via
   * `useServerFn` by the caller — this hook only calls it, never defines
   * or wraps a second one. */
  submitOrderFn: (input: {
    accountId: string;
    symbol: string;
    timeframe: string;
    side: "buy" | "sell";
    type: "market";
    qty: number;
    reduceOnly?: boolean;
    stopLoss?: number;
    takeProfit?: number;
    indicatorId?: string;
    indicatorVersion?: number;
    indicatorName?: string;
    signalId: string;
  }) => Promise<{ rejected?: string | null; snapshot?: AccountSnapshot }>;
}) {
  const [mode, setMode] = useState<StrategyExecutionMode>("off");
  const [armedContext, setArmedContext] = useState<ArmedContext | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [lastSignalError, setLastSignalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /** The permanent dedup ledger for THIS armed session (Phase 5B-7) — a
   * signalId, once added, is NEVER removed while armed. Cleared only when a
   * fresh Start captures a brand-new armedAt boundary, at which point old
   * entries are moot anyway (their bars are now historical relative to the
   * new boundary). Deliberately a ref, not state: adding to it must happen
   * synchronously, in the same tick `selectEligibleSignals` is called,
   * before the async OMS submission is even issued — a `useState` update
   * here would still be visible to a same-tick re-entrant call (refs are
   * read/written immediately, no batching), which is exactly what a second
   * effect firing before the first's state commits would otherwise slip
   * through. */
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const openPositionRef = useRef(openPositionForSymbol);
  openPositionRef.current = openPositionForSymbol;
  /** Synchronous re-entrancy guard — mirrors `useBuilderPreviewRefresh.ts`'s
   * own `isRunningRef` pattern exactly, for the same reason: a new bar can
   * close (bumping `bars`, re-running the execution effect below) WHILE a
   * previous batch is still mid-submission. Without this, the two async
   * loops could both call `selectEligibleSignals` against a
   * `processedSignalsRef` that the first loop hasn't finished updating yet,
   * and both resolve the SAME not-yet-marked signal — a genuine duplicate-
   * submission race, not a hypothetical one. When a run is skipped for this
   * reason, nothing is lost: the next bars/strategy update naturally
   * re-triggers the effect, and any signal not yet in
   * `processedSignalsRef` is still picked up then. */
  const isRunningRef = useRef(false);

  /** Phase 5B-6 — changing the symbol, timeframe, or account while armed
   * fundamentally changes what "this strategy" even means (a different
   * instrument, a different clock, a different account to bill fills
   * against) — auto-disarming is the safe default rather than silently
   * continuing to execute the OLD armedAt boundary against NEW data. The
   * user must explicitly re-arm for the new combination, which captures a
   * fresh boundary and can never replay anything from before the switch. */
  const armedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "paper") return;
    const key = `${account?.id ?? ""}:${symbol}:${timeframe}`;
    if (armedKeyRef.current === null) {
      armedKeyRef.current = key;
      return;
    }
    if (armedKeyRef.current !== key) {
      setMode("off");
      setArmedContext(null);
      armedKeyRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, account?.id]);

  function start() {
    setStartError(null);
    if (!account) {
      setStartError("Select a trading account first.");
      return;
    }
    if (account.environment !== "paper") {
      // Phase 5B-3 — structural guard, not just disabled button text: even
      // if this were somehow called for a live-environment account, it
      // refuses here, before any armedContext ever exists to drive a
      // submission.
      setStartError("Automated strategy execution is PAPER-only. Select a paper account.");
      return;
    }
    if (!strategy || !strategy.declared) {
      setStartError("This project has no declared strategy rules (strategy.long/short/close) — nothing to trade.");
      return;
    }
    if (bars.length === 0) {
      setStartError("Market data hasn't loaded yet.");
      return;
    }
    processedSignalsRef.current = new Set();
    armedKeyRef.current = `${account.id}:${symbol}:${timeframe}`;
    setArmedContext({
      armedAt: bars[bars.length - 1].time,
      indicatorId,
      indicatorVersion,
      indicatorName,
      accountId: account.id,
      symbol,
      timeframe,
    });
    setLastSignalError(null);
    setMode("paper");
  }

  function stop() {
    setMode("off");
    setArmedContext(null);
    armedKeyRef.current = null;
  }

  // Phase 5B-2/5B-6/5B-7 — the ONE place a strategy signal becomes a real
  // OMS submission. Runs whenever the strategy's own output or the bars it
  // was computed against change; `selectEligibleSignals`/dedup guarantee a
  // no-op unless something GENUINELY new (a bar that closed after armedAt)
  // exists. Signals are submitted strictly in bar order, one at a time —
  // each awaited before the next is resolved, so an exit followed by a
  // re-entry on a later bar always resolves the entry against the position
  // state the exit just produced, never a stale pre-exit snapshot.
  useEffect(() => {
    if (mode !== "paper" || !armedContext || !strategy || isRunningRef.current) return;
    const pending = selectEligibleSignals(strategy, bars, armedContext, processedSignalsRef.current);
    if (pending.length === 0) return;

    isRunningRef.current = true;
    setIsSubmitting(true);
    (async () => {
      try {
        for (const signal of pending) {
          // Marked BEFORE the await — see processedSignalsRef's own doc
          // comment for why this ordering is what makes it dedup-safe.
          processedSignalsRef.current.add(signal.signalId);
          const intent = resolveOrderIntent(signal, openPositionRef.current, defaultQty);
          if (!intent) continue; // e.g. an exit with nothing open to close — not an error, just a no-op
          try {
            const res = await submitOrderFn({
              accountId: armedContext.accountId,
              symbol: armedContext.symbol,
              timeframe: armedContext.timeframe,
              side: intent.side,
              type: intent.type,
              qty: intent.qty,
              reduceOnly: intent.reduceOnly,
              ...(intent.stopLoss !== undefined ? { stopLoss: intent.stopLoss } : {}),
              ...(intent.takeProfit !== undefined ? { takeProfit: intent.takeProfit } : {}),
              ...(armedContext.indicatorId ? { indicatorId: armedContext.indicatorId } : {}),
              ...(armedContext.indicatorVersion ? { indicatorVersion: armedContext.indicatorVersion } : {}),
              ...(armedContext.indicatorName ? { indicatorName: armedContext.indicatorName } : {}),
              signalId: intent.signalId,
            });
            if (res.rejected) {
              setLastSignalError(res.rejected);
            } else if (res.snapshot) {
              const updated = res.snapshot.positions.find((p) => p.symbol === armedContext.symbol && p.status === "open");
              openPositionRef.current = updated ? { side: updated.side, qty: updated.qty } : null;
            }
          } catch (e) {
            setLastSignalError(e instanceof Error ? e.message : "Paper order failed");
          }
        }
      } finally {
        isRunningRef.current = false;
        setIsSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, armedContext, strategy, bars]);

  return { mode, armedContext, start, stop, startError, lastSignalError, isSubmitting };
}
