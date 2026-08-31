// Phase 5B-1/5B-2 — the smallest possible adapter between a running
// Chart Studio strategy (`RunResult.strategy`, the SAME `StrategyOut` the
// backtest engine already reads — never a second strategy format) and the
// existing OMS (`submitOrder`/`submitTradeOrder`). Pure, synchronous, no
// I/O — the same "generationState.ts"-style module this codebase already
// established for Builder: every decision here is a plain function over
// plain data, fully testable without mocking React, network, or Supabase.
//
// This file answers exactly one question: "given the strategy's declared
// entries/exits and the bars they were computed against, which of them are
// BOTH new (not historical relative to when the user armed paper trading)
// AND not already submitted (deterministic dedup, never a random id)?" —
// and a second, closely related question: "what exact OMS order does a
// given eligible signal resolve to, given whatever position is currently
// open?" Nothing here ever calls submitOrder/submitTradeOrder itself, ever
// writes to trade_orders/trade_positions/trade_executions, and never
// computes P&L/commission/balance — those remain exclusively the OMS's
// job. The React hook that actually calls the OMS lives in
// src/components/studio/useStrategyExecution.ts.

import type { Bar, StrategyOut } from "@/lib/sgscript/types";

export type StrategyExecutionMode = "off" | "paper";

/** The identity of one armed paper-trading session. Captured once, at the
 * moment the user clicks Start — never recomputed implicitly, since that
 * would silently change what counts as "historical" mid-session. */
export type ArmedContext = {
  /** The LAST bar's time (unix seconds) at the moment of arming. Only a
   * strategy event on a STRICTLY LATER bar is ever eligible — this is what
   * guarantees historical/replayed signals (everything the strategy already
   * "saw" before the user pressed Start) can never submit an order, no
   * matter how many times the strategy is recomputed afterward. */
  armedAt: number;
  indicatorId: string | null;
  indicatorVersion: number | null;
  indicatorName: string;
  accountId: string;
  symbol: string;
  timeframe: string;
};

export type PendingStrategySignal = {
  /** Deterministic — see strategySignalId. Never random: the ONLY thing
   * that lets a settings change, resize, remount, or repeated evaluation
   * recognize "I already handled this exact signal" instead of resubmitting. */
  signalId: string;
  kind: "entry" | "exit";
  /** For an entry: the side being opened. For an exit: which open side this
   * exit targets, or null to close whichever side is open ("flatten
   * anything" — matches StrategyExitOut.side's own documented meaning). */
  declaredSide: "long" | "short" | null;
  barTime: number;
  qty: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
};

/** Deterministic execution-identity key — indicator + symbol + timeframe +
 * the exact bar the signal fired on + what kind of event + which side.
 * Two evaluations of the SAME strategy against the SAME bars (a settings
 * tweak, a resize, a remount, a duplicate effect run) always produce the
 * SAME id for the SAME real-world signal, which is what makes a plain
 * "already processed" set a correct dedup guard rather than a random one. */
export function strategySignalId(ctx: ArmedContext, barTime: number, kind: "entry" | "exit", side: "long" | "short" | null): string {
  return [ctx.indicatorId ?? "adhoc", ctx.symbol, ctx.timeframe, barTime, kind, side ?? "flatten"].join(":");
}

/**
 * Phase 5B-6/5B-7 — the historical/new-bar boundary AND the dedup guard, in
 * one pass. A strategy event is eligible for automatic paper execution only
 * when ALL of:
 *   1. its bar's time is strictly after armedAt (never historical/replay —
 *      the entire reason armedAt is captured once at Start and never
 *      silently advanced),
 *   2. its bar is not the CURRENTLY FORMING last bar in `bars` — the
 *      runtime documents entries/exits as "always a confirmed bar" from
 *      its own point of view, but it has no concept of "still live" vs
 *      "historical"; requiring a NEWER bar to already exist is what
 *      actually guarantees the signal's own bar has genuinely closed,
 *      never a mid-formation repaint,
 *   3. its deterministic signalId is not already in `alreadyProcessed` —
 *      the caller's job is to record every signalId this function returns
 *      BEFORE the async OMS submission resolves, so a second call before
 *      that happens (rapid re-render, duplicate effect fire) sees it as
 *      already handled.
 * Returned in bar-chronological order so exits/entries on earlier bars are
 * always submitted before later ones.
 */
export function selectEligibleSignals(strategy: StrategyOut, bars: Bar[], ctx: ArmedContext, alreadyProcessed: ReadonlySet<string>): PendingStrategySignal[] {
  if (!strategy.declared || bars.length < 2) return [];
  const lastConfirmedIndex = bars.length - 2; // bars.length - 1 is still forming/unconfirmed
  const out: PendingStrategySignal[] = [];

  for (const entry of strategy.entries) {
    if (entry.bar < 0 || entry.bar > lastConfirmedIndex) continue;
    const bar = bars[entry.bar];
    if (!bar || bar.time <= ctx.armedAt) continue;
    const signalId = strategySignalId(ctx, bar.time, "entry", entry.side);
    if (alreadyProcessed.has(signalId)) continue;
    out.push({ signalId, kind: "entry", declaredSide: entry.side, barTime: bar.time, qty: entry.qty, stopLoss: entry.stop, takeProfit: entry.target });
  }

  for (const exit of strategy.exits) {
    if (exit.bar < 0 || exit.bar > lastConfirmedIndex) continue;
    const bar = bars[exit.bar];
    if (!bar || bar.time <= ctx.armedAt) continue;
    const signalId = strategySignalId(ctx, bar.time, "exit", exit.side);
    if (alreadyProcessed.has(signalId)) continue;
    out.push({ signalId, kind: "exit", declaredSide: exit.side, barTime: bar.time, qty: null, stopLoss: null, takeProfit: null });
  }

  out.sort((a, b) => a.barTime - b.barTime);
  return out;
}

/** The narrow slice of a live OMS position this module needs — deliberately
 * NOT importing PositionRow/AccountSnapshot from trading/types.ts, so this
 * pure module has zero dependency on the OMS's own row shape and can't
 * accidentally start reading (or, worse, writing) more of it than this one
 * field set. */
export type OpenPositionForSymbol = { side: "buy" | "sell"; qty: number } | null;

export type ResolvedOrderIntent = {
  signalId: string;
  side: "buy" | "sell";
  type: "market";
  qty: number;
  reduceOnly: boolean;
  purpose: "entry" | "exit";
  stopLoss?: number;
  takeProfit?: number;
};

/**
 * Phase 5B-13/5B-14 — turns one eligible signal into the exact OMS order to
 * submit, or `null` when there is genuinely nothing to do (never a
 * fabricated order). An entry always resolves (its own declared qty, or the
 * caller's configured default) — OMS's existing native single-fill
 * long<->short flip (confirmed in the architecture audit) handles a
 * reversal signal without this adapter inventing close-then-open
 * accounting. An exit only resolves against a REAL currently-open position
 * matching the declared side (or any open position when declaredSide is
 * null, per StrategyExitOut's own "null = flatten anything" contract);
 * closing is always a reduceOnly order sized to the position's own qty —
 * never the strategy's entry qty, which could be stale relative to a
 * partial fill or manual adjustment.
 */
export function resolveOrderIntent(pending: PendingStrategySignal, openPosition: OpenPositionForSymbol, defaultQty: number): ResolvedOrderIntent | null {
  if (pending.kind === "entry") {
    const qty = pending.qty && pending.qty > 0 ? pending.qty : defaultQty;
    if (!(qty > 0)) return null;
    return {
      signalId: pending.signalId,
      side: pending.declaredSide === "short" ? "sell" : "buy",
      type: "market",
      qty,
      reduceOnly: false,
      purpose: "entry",
      ...(pending.stopLoss !== null ? { stopLoss: pending.stopLoss } : {}),
      ...(pending.takeProfit !== null ? { takeProfit: pending.takeProfit } : {}),
    };
  }

  // exit
  if (!openPosition || !(openPosition.qty > 0)) return null;
  const openDeclaredSide: "long" | "short" = openPosition.side === "buy" ? "long" : "short";
  if (pending.declaredSide !== null && pending.declaredSide !== openDeclaredSide) return null;
  return {
    signalId: pending.signalId,
    side: openPosition.side === "buy" ? "sell" : "buy",
    type: "market",
    qty: openPosition.qty,
    reduceOnly: true,
    purpose: "exit",
  };
}
