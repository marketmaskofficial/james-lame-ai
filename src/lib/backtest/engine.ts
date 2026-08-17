/**
 * Signal Goat backtest engine.
 *
 * Deterministic, chronological, and fed by exactly the same run output that
 * draws the chart: the script declares its rules with `strategy.long/short/
 * close`, the runtime records them, and this engine executes them. There is no
 * second implementation of the trading logic anywhere.
 *
 * Nothing here is estimated, modelled by an AI, or smoothed. Every number in
 * the report comes from walking the bar array forward once.
 */

import type { Bar } from "@/lib/sgscript/types";
import type { StrategyOut } from "@/lib/sgscript/types";
import { getInstrument, pnlPerUnit, roundToTick, type Instrument } from "@/lib/trading/instruments";

/** Documented execution model, shown in the UI so results are never oversold. */
export const EXECUTION_SEMANTICS = [
  "Signals are read on the close of the bar that produced them (confirmed bar only).",
  "Entries and strategy exits fill at the NEXT bar's open, adjusted by slippage.",
  "A bar can never see its own future: bar N cannot use data from bar N+1.",
  "Stops and targets are frozen at the signal bar and checked from the bar after entry.",
  "If a bar gaps beyond a stop or target, it fills at that bar's open, not the level.",
  "If a single bar's range contains both the stop and the target, the STOP is taken. Without intrabar data the order is unknowable, so the engine always picks the worse outcome.",
  "An opposite-side signal while in a position closes it and reverses at the same next-bar open.",
  "Any position still open on the last bar is closed at that bar's close, reason 'End of Test'.",
  "Commission is charged per unit on entry and on exit. Slippage is applied adversely on every fill.",
  "P&L uses the instrument's real tick size, tick value and multiplier — never a generic contract.",
].join("\n");

export type PositionSizing =
  | { mode: "fixed_qty"; qty: number }
  | { mode: "fixed_cash"; cash: number }
  | { mode: "percent_equity"; percent: number }
  | { mode: "risk_percent"; percent: number };

export type BacktestSettings = {
  startingCapital: number;
  sizing: PositionSizing;
  /** Currency per unit, per side. */
  commissionPerUnit: number;
  /** Ticks of adverse slippage on every fill. */
  slippageTicks: number;
  /** Unix seconds; inclusive bounds. Null = no bound. */
  from: number | null;
  to: number | null;
};

export const DEFAULT_SETTINGS: BacktestSettings = {
  startingCapital: 50_000,
  sizing: { mode: "percent_equity", percent: 10 },
  commissionPerUnit: 0,
  slippageTicks: 1,
  from: null,
  to: null,
};

export type ExitReason = "Stop Loss" | "Take Profit" | "Strategy Exit" | "Reverse" | "End of Test";

export type BacktestTrade = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  qty: number;
  stop: number | null;
  target: number | null;
  pnl: number;
  commission: number;
  rMultiple: number | null;
  exitReason: ExitReason;
  session: SessionName;
  comment: string;
  /**
   * Maximum adverse / favourable excursion while the trade was open, in
   * account currency and (when an initial stop exists) as a multiple of the
   * risk that stop defined at entry. Measured from the bar after entry
   * through the exit bar, using each bar's intrabar high/low — the same
   * OHLC-only assumption every other fill in this engine already makes.
   */
  mae: number;
  mfe: number;
  maeR: number | null;
  mfeR: number | null;
};

export type SessionName = "Asia" | "London" | "New York" | "Other";
export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type BacktestReport = {
  ok: true;
  symbol: string;
  interval: string;
  strategyName: string;
  barsTested: number;
  firstBarTime: number;
  lastBarTime: number;
  settings: BacktestSettings;
  instrument: Instrument;
  trades: BacktestTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
  /** Peak-to-current drawdown at every bar the engine marks equity to market. */
  drawdownCurve: Array<{ time: number; drawdown: number; drawdownPct: number }>;
  metrics: Metrics;
  longMetrics: Metrics;
  shortMetrics: Metrics;
  sessionMetrics: Array<{ session: SessionName } & Metrics>;
  dayOfWeekMetrics: Array<{ day: DayOfWeek } & Metrics>;
  hourOfDayMetrics: Array<{ hourUtc: number } & Metrics>;
  /** Honest limitations that apply to this specific run. */
  limitations: string[];
};

export type Metrics = {
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  /** avgWin / |avgLoss|. Null when there are no losing trades to divide by. */
  winLossRatio: number | null;
  largestWin: number;
  largestLoss: number;
  maxWinStreak: number;
  maxLossStreak: number;
  /** Mean time in the trade, seconds, from fill to exit. */
  avgHoldingSeconds: number;
  avgMae: number;
  avgMfe: number;
  avgMaeR: number | null;
  avgMfeR: number | null;
  avgR: number | null;
  expectancy: number;
  returnPct: number;
};

/** Why a project cannot be backtested — never guessed around, always reported. */
export type BacktestBlocked = {
  ok: false;
  reason: "no-rules" | "no-data" | "no-entries";
  message: string;
  missing: string[];
};

export type BacktestOutcome = BacktestReport | BacktestBlocked;

function sessionOf(timeSec: number): SessionName {
  const h = new Date(timeSec * 1000).getUTCHours();
  if (h >= 0 && h < 7) return "Asia";
  if (h >= 7 && h < 12) return "London";
  if (h >= 12 && h < 21) return "New York";
  return "Other";
}

const DAY_NAMES: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayOfWeekOf(timeSec: number): DayOfWeek {
  return DAY_NAMES[new Date(timeSec * 1000).getUTCDay()];
}
function hourOfDayOf(timeSec: number): number {
  return new Date(timeSec * 1000).getUTCHours();
}

/** Longest run of consecutive winning / losing trades, in declared (chronological) order. */
function streaks(trades: BacktestTrade[]): { maxWinStreak: number; maxLossStreak: number } {
  let win = 0, loss = 0, maxWin = 0, maxLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) { win++; loss = 0; } else { loss++; win = 0; }
    if (win > maxWin) maxWin = win;
    if (loss > maxLoss) maxLoss = loss;
  }
  return { maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

function emptyMetrics(startingCapital: number): Metrics {
  return {
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    profitFactor: null,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    avgTrade: 0,
    avgWin: 0,
    avgLoss: 0,
    winLossRatio: null,
    largestWin: 0,
    largestLoss: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    avgHoldingSeconds: 0,
    avgMae: 0,
    avgMfe: 0,
    avgMaeR: null,
    avgMfeR: null,
    avgR: null,
    expectancy: 0,
    returnPct: 0,
  };
}

function computeMetrics(trades: BacktestTrade[], startingCapital: number): Metrics {
  if (trades.length === 0) return emptyMetrics(startingCapital);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0);

  let equity = startingCapital;
  let peak = startingCapital;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null);
  const maeRs = trades.map((t) => t.maeR).filter((r): r is number => r !== null);
  const mfeRs = trades.map((t) => t.mfeR).filter((r): r is number => r !== null);
  const winRate = (wins.length / trades.length) * 100;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const { maxWinStreak, maxLossStreak } = streaks(trades);

  return {
    netPnl,
    grossProfit,
    grossLoss,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    avgTrade: netPnl / trades.length,
    avgWin,
    avgLoss,
    winLossRatio: avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    maxWinStreak,
    maxLossStreak,
    avgHoldingSeconds: trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / trades.length,
    avgMae: trades.reduce((s, t) => s + t.mae, 0) / trades.length,
    avgMfe: trades.reduce((s, t) => s + t.mfe, 0) / trades.length,
    avgMaeR: maeRs.length ? maeRs.reduce((s, r) => s + r, 0) / maeRs.length : null,
    avgMfeR: mfeRs.length ? mfeRs.reduce((s, r) => s + r, 0) / mfeRs.length : null,
    avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
    expectancy:
      (winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss,
    returnPct: startingCapital > 0 ? (netPnl / startingCapital) * 100 : 0,
  };
}

/**
 * Sizes a position from a percent of equity risked and the actual distance
 * to the stop, rather than notional value — e.g. riskPercent 1 with a stop
 * $50 away always risks 1% of equity, regardless of the instrument's price
 * or the entry's distance-to-stop on any other trade.
 */
function riskBasedQty(
  riskPercent: number,
  equity: number,
  entryPrice: number,
  stopPrice: number,
  inst: Instrument,
): number {
  const step = inst.qtyStep || 0.0001;
  const riskCash = (equity * riskPercent) / 100;
  const riskPerUnit = Math.abs(pnlPerUnit(inst, entryPrice - stopPrice));
  if (!(riskPerUnit > 0)) return 0;
  const raw = riskCash / riskPerUnit;
  const q = Math.floor(raw / step) * step;
  return Number.isFinite(q) && q > 0 ? Number(q.toFixed(8)) : 0;
}

function sizeFor(
  sizing: PositionSizing,
  equity: number,
  price: number,
  inst: Instrument,
  stopPrice: number | null,
): number {
  if (sizing.mode === "risk_percent") {
    return stopPrice === null ? 0 : riskBasedQty(sizing.percent, equity, price, stopPrice, inst);
  }
  const step = inst.qtyStep || 0.0001;
  let raw: number;
  if (sizing.mode === "fixed_qty") raw = sizing.qty;
  else {
    const cash =
      sizing.mode === "fixed_cash" ? sizing.cash : (equity * sizing.percent) / 100;
    const notionalPerUnit = Math.abs(pnlPerUnit(inst, price)) || price;
    raw = notionalPerUnit > 0 ? cash / notionalPerUnit : 0;
  }
  const q = Math.floor(raw / step) * step;
  return Number.isFinite(q) && q > 0 ? Number(q.toFixed(8)) : 0;
}

type OpenTrade = {
  side: "long" | "short";
  entryBar: number;
  entryTime: number;
  entryPrice: number;
  qty: number;
  stop: number | null;
  target: number | null;
  /** Stop as declared at entry, frozen — never moved by trail/breakeven. The
   * risk unit ("1R") is always measured against this, not the live `stop`. */
  initialStop: number | null;
  /** Bar-indexed trailing-stop series, if the script declared one. */
  trail: number[] | null;
  breakEvenAfterR: number | null;
  breakEvenArmed: boolean;
  /** Best/worst price reached while open (bars strictly after entry). */
  mfeExtremePrice: number;
  maeExtremePrice: number;
  comment: string;
};

/**
 * Runs the declared strategy over the bars. Pure: same inputs -> same report.
 */
export function runBacktestEngine(args: {
  bars: Bar[];
  strategy: StrategyOut;
  symbol: string;
  interval: string;
  strategyName: string;
  settings: BacktestSettings;
}): BacktestOutcome {
  const { bars, strategy, symbol, interval, strategyName } = args;
  const settings = args.settings;
  const inst = getInstrument(symbol);

  if (!strategy.declared) {
    return {
      ok: false,
      reason: "no-rules",
      message:
        "This project plots an indicator but does not declare any trading rules, so there is nothing to simulate.",
      missing: ["entry rule", "exit rule (or a stop and target)"],
    };
  }
  if (bars.length < 3) {
    return {
      ok: false,
      reason: "no-data",
      message: "Not enough historical bars are loaded to run a simulation.",
      missing: ["historical data"],
    };
  }

  const from = settings.from;
  const to = settings.to;
  const inRange = (t: number) => (from === null || t >= from) && (to === null || t <= to);

  const entriesByBar = new Map<number, (typeof strategy.entries)[number]>();
  for (const e of strategy.entries) {
    // Last declaration on a bar wins; a bar produces at most one entry intent.
    if (bars[e.bar] && inRange(bars[e.bar].time)) entriesByBar.set(e.bar, e);
  }
  const exitsByBar = new Map<number, (typeof strategy.exits)[number]>();
  for (const x of strategy.exits) {
    if (bars[x.bar]) exitsByBar.set(x.bar, x);
  }

  if (entriesByBar.size === 0) {
    return {
      ok: false,
      reason: "no-entries",
      message:
        "The strategy rules never triggered on the loaded history and date range, so there are no trades to report.",
      missing: [],
    };
  }

  const tick = inst.tickSize || 0.01;
  const slip = settings.slippageTicks * tick;
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ time: number; equity: number }> = [];
  const drawdownCurve: Array<{ time: number; drawdown: number; drawdownPct: number }> = [];
  let equity = settings.startingCapital;
  let equityPeak = settings.startingCapital;
  const pos: { current: OpenTrade | null } = { current: null };
  let tradeId = 0;
  let gapFills = 0;
  let collisions = 0;
  let riskSizingFallbacks = 0;

  const closeTrade = (
    bar: Bar,
    price: number,
    reason: ExitReason,
  ) => {
    const open = pos.current;
    if (!open) return;
    const dir = open.side === "long" ? 1 : -1;
    const gross = pnlPerUnit(inst, (price - open.entryPrice) * dir) * open.qty;
    const commission = settings.commissionPerUnit * open.qty * 2;
    const pnl = gross - commission;
    equity += pnl;
    const risk =
      open.stop !== null
        ? Math.abs(pnlPerUnit(inst, open.entryPrice - open.stop)) * open.qty
        : 0;
    // "1R" for MAE/MFE is measured against the risk declared at entry, not
    // whatever the stop has since moved to (trail/breakeven) — otherwise a
    // breakeven-armed trade would nonsensically show 0R of adverse room left.
    const initialRiskPerUnit =
      open.initialStop !== null ? Math.abs(pnlPerUnit(inst, open.entryPrice - open.initialStop)) : 0;
    const mae = Math.abs(pnlPerUnit(inst, open.maeExtremePrice - open.entryPrice)) * open.qty;
    const mfe = Math.abs(pnlPerUnit(inst, open.mfeExtremePrice - open.entryPrice)) * open.qty;
    trades.push({
      id: ++tradeId,
      symbol,
      direction: open.side,
      entryTime: open.entryTime,
      entryPrice: open.entryPrice,
      exitTime: bar.time,
      exitPrice: price,
      qty: open.qty,
      stop: open.stop,
      target: open.target,
      pnl,
      commission,
      rMultiple: risk > 0 ? pnl / risk : null,
      exitReason: reason,
      session: sessionOf(open.entryTime),
      comment: open.comment,
      mae,
      mfe,
      maeR: initialRiskPerUnit > 0 ? mae / (initialRiskPerUnit * open.qty) : null,
      mfeR: initialRiskPerUnit > 0 ? mfe / (initialRiskPerUnit * open.qty) : null,
    });
    pos.current = null;
  };

  const openTrade = (
    signal: (typeof strategy.entries)[number],
    bar: Bar,
    fillPrice: number,
  ) => {
    // A signal that explicitly asked for risk-based sizing but declared no
    // stop can't have that request honoured (there's no risk distance to
    // size from) — falling back to the settings' sizing mode without saying
    // so would silently trade a different size than the strategy asked for.
    // Surface it every time this substitution happens, not just when the
    // fallback also happens to fail.
    const wantsRiskSizing = signal.riskPercent !== null || settings.sizing.mode === "risk_percent";
    if (wantsRiskSizing && signal.stop === null) riskSizingFallbacks++;

    const qty =
      signal.qty && signal.qty > 0
        ? signal.qty
        : signal.riskPercent !== null && signal.stop !== null
          ? riskBasedQty(signal.riskPercent, equity, fillPrice, signal.stop, inst)
          : sizeFor(settings.sizing, equity, fillPrice, inst, signal.stop);
    if (qty <= 0) return;
    let target = signal.target;
    if (target === null && signal.targetR !== null && signal.stop !== null) {
      const r = Math.abs(fillPrice - signal.stop);
      target = signal.side === "long" ? fillPrice + r * signal.targetR : fillPrice - r * signal.targetR;
    }
    const stop = signal.stop === null ? null : roundToTick(inst, signal.stop);
    pos.current = {
      side: signal.side,
      entryBar: bars.indexOf(bar),
      entryTime: bar.time,
      entryPrice: fillPrice,
      qty,
      stop,
      target: target === null ? null : roundToTick(inst, target),
      initialStop: stop,
      trail: signal.trail,
      breakEvenAfterR: signal.breakEvenAfterR,
      breakEvenArmed: false,
      mfeExtremePrice: fillPrice,
      maeExtremePrice: fillPrice,
      comment: signal.comment,
    };
  };

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const prev = i - 1;

    // 1) Protective exits first — they belong to bars strictly after entry.
    const held = pos.current;
    if (held && held.entryBar < i) {
      // Ratchet the stop to this bar's trail value before testing it against
      // the bar's range — a real trailing-stop order adjusts, then the
      // market either does or doesn't trade through the new level. Only
      // moves in the position's favour, matching every real broker's
      // trailing-stop semantics: it can never loosen.
      if (held.trail && i < held.trail.length) {
        const candidate = held.trail[i];
        if (Number.isFinite(candidate)) {
          const rounded = roundToTick(inst, candidate);
          held.stop =
            held.stop === null
              ? rounded
              : held.side === "long"
                ? Math.max(held.stop, rounded)
                : Math.min(held.stop, rounded);
        }
      }

      // Track best/worst excursion using this bar's full range — same
      // OHLC-only, no-tick-data assumption every other check here makes.
      if (held.side === "long") {
        if (bar.high > held.mfeExtremePrice) held.mfeExtremePrice = bar.high;
        if (bar.low < held.maeExtremePrice) held.maeExtremePrice = bar.low;
      } else {
        if (bar.low < held.mfeExtremePrice) held.mfeExtremePrice = bar.low;
        if (bar.high > held.maeExtremePrice) held.maeExtremePrice = bar.high;
      }

      // Move the stop to breakeven once favourable excursion reaches the
      // declared R multiple — same ratchet-only-favourable rule as trail,
      // measured against the risk frozen at entry, not a since-moved stop.
      if (!held.breakEvenArmed && held.breakEvenAfterR !== null && held.initialStop !== null) {
        const riskPerUnit = Math.abs(pnlPerUnit(inst, held.entryPrice - held.initialStop));
        if (riskPerUnit > 0) {
          const favorablePrice = held.side === "long" ? bar.high : bar.low;
          const favorableMove = Math.abs(pnlPerUnit(inst, favorablePrice - held.entryPrice));
          if (favorableMove / riskPerUnit >= held.breakEvenAfterR) {
            held.stop =
              held.stop === null
                ? held.entryPrice
                : held.side === "long"
                  ? Math.max(held.stop, held.entryPrice)
                  : Math.min(held.stop, held.entryPrice);
            held.breakEvenArmed = true;
          }
        }
      }

      const { stop, target, side } = held;
      const hitStop =
        stop !== null && (side === "long" ? bar.low <= stop : bar.high >= stop);
      const hitTarget =
        target !== null && (side === "long" ? bar.high >= target : bar.low <= target);

      if (hitStop && hitTarget) collisions++;

      if (hitStop) {
        // Gap through the stop fills at the open, which is worse than the level.
        const gapped =
          side === "long" ? bar.open <= (stop as number) : bar.open >= (stop as number);
        if (gapped) gapFills++;
        const px = gapped ? bar.open : (stop as number);
        closeTrade(bar, side === "long" ? px - slip : px + slip, "Stop Loss");
      } else if (hitTarget) {
        const gapped =
          side === "long"
            ? bar.open >= (target as number)
            : bar.open <= (target as number);
        if (gapped) gapFills++;
        const px = gapped ? bar.open : (target as number);
        closeTrade(bar, side === "long" ? px - slip : px + slip, "Take Profit");
      }
    }

    // 2) Signals from the previous (confirmed) bar execute at this bar's open.
    const exitSig = exitsByBar.get(prev);
    const holding = pos.current;
    if (holding && exitSig && (exitSig.side === null || exitSig.side === holding.side)) {
      closeTrade(
        bar,
        holding.side === "long" ? bar.open - slip : bar.open + slip,
        "Strategy Exit",
      );
    }

    const entrySig = entriesByBar.get(prev);
    if (entrySig) {
      const cur = pos.current;
      if (cur && cur.side !== entrySig.side) {
        closeTrade(
          bar,
          cur.side === "long" ? bar.open - slip : bar.open + slip,
          "Reverse",
        );
      }
      if (!pos.current) {
        openTrade(
          entrySig,
          bar,
          entrySig.side === "long" ? bar.open + slip : bar.open - slip,
        );
      }
    }

    if (inRange(bar.time)) {
      const mark = pos.current;
      const mtm = mark
        ? equity +
          pnlPerUnit(inst, (bar.close - mark.entryPrice) * (mark.side === "long" ? 1 : -1)) *
            mark.qty
        : equity;
      equityCurve.push({ time: bar.time, equity: mtm });
      if (mtm > equityPeak) equityPeak = mtm;
      const dd = equityPeak - mtm;
      drawdownCurve.push({
        time: bar.time,
        drawdown: dd,
        drawdownPct: equityPeak > 0 ? (dd / equityPeak) * 100 : 0,
      });
    }
  }

  // Anything still open is closed on the final bar, flagged as such.
  if (pos.current)
    closeTrade(bars[bars.length - 1], bars[bars.length - 1].close, "End of Test");

  const longs = trades.filter((t) => t.direction === "long");
  const shorts = trades.filter((t) => t.direction === "short");
  const sessions: SessionName[] = ["Asia", "London", "New York", "Other"];
  const days: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const limitations = [
    "Fills are simulated on bar OHLC only — no tick or order-book data is available, so intrabar sequence is assumed conservatively.",
    ...(collisions > 0
      ? [
          `${collisions} bar(s) contained both the stop and the target. Each was booked as a stop loss.`,
        ]
      : []),
    ...(gapFills > 0 ? [`${gapFills} exit(s) filled on a gap through the level.`] : []),
    ...(riskSizingFallbacks > 0
      ? [
          `${riskSizingFallbacks} entry signal(s) requested risk-based sizing but declared no stop — sized using the settings' position-sizing mode instead.`,
        ]
      : []),
    ...(inst.dataAvailable
      ? []
      : [`No market data provider is connected for ${inst.root}; contract maths only.`]),
    ...strategy.notes,
  ];

  return {
    ok: true,
    symbol,
    interval,
    strategyName,
    barsTested: bars.length,
    firstBarTime: bars[0].time,
    lastBarTime: bars[bars.length - 1].time,
    settings,
    instrument: inst,
    trades,
    equityCurve,
    drawdownCurve,
    metrics: computeMetrics(trades, settings.startingCapital),
    longMetrics: computeMetrics(longs, settings.startingCapital),
    shortMetrics: computeMetrics(shorts, settings.startingCapital),
    sessionMetrics: sessions
      .map((s) => ({
        session: s,
        ...computeMetrics(
          trades.filter((t) => t.session === s),
          settings.startingCapital,
        ),
      }))
      .filter((m) => m.totalTrades > 0),
    dayOfWeekMetrics: days
      .map((d) => ({
        day: d,
        ...computeMetrics(
          trades.filter((t) => dayOfWeekOf(t.entryTime) === d),
          settings.startingCapital,
        ),
      }))
      .filter((m) => m.totalTrades > 0),
    hourOfDayMetrics: Array.from({ length: 24 }, (_, hourUtc) => ({
      hourUtc,
      ...computeMetrics(
        trades.filter((t) => hourOfDayOf(t.entryTime) === hourUtc),
        settings.startingCapital,
      ),
    })).filter((m) => m.totalTrades > 0),
    limitations,
  };
}
