/**
 * Signal Goat Order Management System.
 *
 * One central engine handles every order, from every source (manual ticket,
 * chart trading, AI strategy signal). Broker adapters plug in underneath; the
 * paper adapter is the only one wired today and every fill it produces is
 * explicitly labelled as simulated.
 *
 * Simulation model (documented, not hidden):
 *  - Market orders fill in full at the server-fetched last traded price.
 *  - Limit/stop orders fill when the server-fetched last price crosses the
 *    trigger, at the trigger price (no queue position modelling).
 *  - Commission is `commission_per_unit * qty`; slippage is zero.
 * It is a simplification of real execution and is presented as such in the UI.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getInstrument, pnlPerUnit, roundToTick } from "./instruments";
import { getLastPrice, getLastPrices } from "./quotes.server";
import { isBrokerAccount } from "./brokers/registry.server";
import type {
  AccountSnapshot,
  ExecutionRow,
  OrderRow,
  OrderSide,
  OrderType,
  PositionRow,
  TradingAccount,
} from "./types";

export const SIMULATION_NOTE =
  "Paper engine: market orders fill at the live last price, limit/stop orders fill at their trigger once price crosses it. Zero slippage, no queue modelling. Simulated fills only.";

type Db = typeof supabaseAdmin;

const ACCOUNT_COLS =
  "id, broker, label, account_number, environment, currency, starting_balance, balance, realized_pnl, commission_per_unit, status, connection_id, broker_account_id, broker_account_spec, buying_power, equity";
const ORDER_COLS =
  "id, account_id, position_id, parent_order_id, symbol, side, order_type, purpose, qty, filled_qty, limit_price, stop_price, avg_fill_price, status, reduce_only, reject_reason, bracket_stop, bracket_target, indicator_name, timeframe, created_at, updated_at";
const POSITION_COLS =
  "id, account_id, symbol, side, qty, avg_entry, realized_pnl, status, stop_price, target_price, indicator_name, indicator_id, indicator_version, signal_id, timeframe, opened_at, closed_at";
const EXEC_COLS =
  "id, order_id, position_id, symbol, side, qty, price, commission, realized_pnl, executed_at";

/**
 * Phase 5B-Final — trusted-execution-boundary injection point. Every
 * function in this file keeps calling the SAME `db()` accessor it always
 * has; the only change is that `db()` now prefers an explicitly-injected
 * client over the module's own `supabaseAdmin` when one has been set.
 *
 * Why this exists: the Node/TanStack server process this file normally
 * runs in may not itself be provisioned with `SUPABASE_SERVICE_ROLE_KEY`
 * (Lovable Cloud's app-hosting tier does not universally grant it — see
 * the Phase 5B-Final audit). Supabase Edge Functions, by contrast, always
 * receive it automatically from the platform. Rather than duplicating
 * this file's order/fill/position/P&L/risk logic inside a second,
 * Deno-only implementation, `supabase/functions/paper-submit-order/`
 * imports THIS file directly (via a Deno import map resolving the `@/`
 * alias and the `@supabase/supabase-js` npm package) and calls
 * `__setTrustedDbClient` once, at the top of the request, with an admin
 * client built from ITS OWN environment — then calls the exact same
 * exported `submitOrder`/`getSnapshot` functions unchanged. One
 * implementation, two hosts, never two engines.
 *
 * The Node path is completely unaffected: nothing there ever calls
 * `__setTrustedDbClient`, so `db()` falls back to `supabaseAdmin` exactly
 * as it always has.
 */
let trustedDbOverride: Db | null = null;
export function __setTrustedDbClient(client: Db | null): void {
  trustedDbOverride = client;
}
const db = (): Db => trustedDbOverride ?? supabaseAdmin;

export class OmsError extends Error {}

const opposite = (s: OrderSide): OrderSide => (s === "buy" ? "sell" : "buy");

// ---------------------------------------------------------------- accounts

export async function ensureAccount(userId: string): Promise<TradingAccount> {
  const { data } = await db()
    .from("trading_accounts")
    .select(ACCOUNT_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (data && data.length) return data[0] as unknown as TradingAccount;

  const { data: created, error } = await db()
    .from("trading_accounts")
    .insert({ user_id: userId })
    .select(ACCOUNT_COLS)
    .single();
  if (error) throw new OmsError(error.message);
  return created as unknown as TradingAccount;
}

async function getAccount(userId: string, accountId?: string) {
  if (!accountId) return ensureAccount(userId);
  const { data, error } = await db()
    .from("trading_accounts")
    .select(ACCOUNT_COLS)
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new OmsError("Trading account not found");
  return data as unknown as TradingAccount;
}

export async function resetAccount(userId: string, accountId?: string) {
  const acct = await getAccount(userId, accountId);
  await db().from("trade_executions").delete().eq("account_id", acct.id);
  await db().from("trade_orders").delete().eq("account_id", acct.id);
  await db().from("trade_positions").delete().eq("account_id", acct.id);
  await db()
    .from("trading_accounts")
    .update({ balance: acct.starting_balance, realized_pnl: 0 })
    .eq("id", acct.id);
  return getSnapshot(userId, acct.id);
}

// ------------------------------------------------------------------ risk

type RiskSettings = {
  max_risk_per_trade: number | null;
  max_daily_loss: number | null;
  max_position_size: number | null;
  max_trades_per_day: number | null;
  max_open_positions: number | null;
  require_stop_loss: boolean;
};

async function getRisk(userId: string): Promise<RiskSettings> {
  const { data } = await db()
    .from("risk_settings")
    .select(
      "max_risk_per_trade, max_daily_loss, max_position_size, max_trades_per_day, max_open_positions, require_stop_loss",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (
    (data as RiskSettings | null) ?? {
      max_risk_per_trade: null,
      max_daily_loss: null,
      max_position_size: null,
      max_trades_per_day: null,
      max_open_positions: null,
      require_stop_loss: false,
    }
  );
}

export async function saveRisk(
  userId: string,
  patch: Partial<RiskSettings> & { confirm_live_orders?: boolean },
) {
  const { error } = await db()
    .from("risk_settings")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) throw new OmsError(error.message);
  return getRisk(userId);
}

export async function loadRisk(userId: string) {
  return getRisk(userId);
}

/** Pre-trade checks. Rejections are recorded on the order, never swallowed. */
async function preTradeCheck(
  userId: string,
  acct: TradingAccount,
  input: SubmitInput,
  refPrice: number,
): Promise<string | null> {
  const risk = await getRisk(userId);
  const inst = getInstrument(input.symbol);

  if (input.qty <= 0) return "Quantity must be greater than zero";
  if (risk.max_position_size && input.qty > risk.max_position_size)
    return `Quantity exceeds max position size (${risk.max_position_size})`;

  if (input.purpose === "entry" && risk.require_stop_loss && !input.stopLoss)
    return "Risk settings require a stop loss on every entry";

  if (input.stopLoss && risk.max_risk_per_trade) {
    const perUnit = pnlPerUnit(inst, Math.abs(refPrice - input.stopLoss));
    const risked = perUnit * input.qty;
    if (risked > risk.max_risk_per_trade)
      return `Trade risks ${risked.toFixed(2)} ${acct.currency}, above your ${risk.max_risk_per_trade} limit`;
  }

  if (risk.max_open_positions) {
    const { count } = await db()
      .from("trade_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id)
      .eq("status", "open");
    if ((count ?? 0) >= risk.max_open_positions && input.purpose === "entry")
      return `Max open positions reached (${risk.max_open_positions})`;
  }

  if (risk.max_trades_per_day) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await db()
      .from("trade_executions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id)
      .gte("executed_at", since.toISOString());
    if ((count ?? 0) >= risk.max_trades_per_day)
      return `Daily trade limit reached (${risk.max_trades_per_day})`;
  }

  if (risk.max_daily_loss) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: rows } = await db()
      .from("trade_executions")
      .select("realized_pnl, commission")
      .eq("account_id", acct.id)
      .gte("executed_at", since.toISOString());
    const day = (rows ?? []).reduce(
      (s, r) => s + Number(r.realized_pnl) - Number(r.commission),
      0,
    );
    if (day <= -Math.abs(risk.max_daily_loss))
      return `Daily loss limit hit (${risk.max_daily_loss}) — trading is halted for today`;
  }

  return null;
}

/**
 * Risk checks for broker accounts. Same rules, minus the ones that need a
 * market-data price Signal Goat does not have for that instrument — those are
 * skipped rather than evaluated against a made-up price.
 */
async function brokerPreTradeCheck(
  userId: string,
  acct: TradingAccount,
  input: SubmitInput,
): Promise<string | null> {
  const risk = await getRisk(userId);
  if (input.qty <= 0) return "Quantity must be greater than zero";
  if (risk.max_position_size && input.qty > risk.max_position_size)
    return `Quantity exceeds max position size (${risk.max_position_size})`;
  if ((input.purpose ?? "entry") === "entry" && risk.require_stop_loss && !input.stopLoss)
    return "Risk settings require a stop loss on every entry";
  if (risk.max_open_positions && (input.purpose ?? "entry") === "entry") {
    const { count } = await db()
      .from("trade_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", acct.id)
      .eq("status", "open");
    if ((count ?? 0) >= risk.max_open_positions)
      return `Max open positions reached (${risk.max_open_positions})`;
  }
  return null;
}

// -------------------------------------------------------------- positions

async function openPositionFor(
  userId: string,
  acct: TradingAccount,
  symbol: string,
): Promise<PositionRow | null> {
  const { data } = await db()
    .from("trade_positions")
    .select(POSITION_COLS)
    .eq("account_id", acct.id)
    .eq("symbol", symbol)
    .eq("status", "open")
    .limit(1);
  const row = data?.[0] as unknown as PositionRow | undefined;
  return row ?? null;
}

type FillContext = {
  userId: string;
  acct: TradingAccount;
  order: OrderRow;
  price: number;
};

/** Applies a fill to the position book and writes the execution record. */
async function applyFill({ userId, acct, order, price }: FillContext) {
  const inst = getInstrument(order.symbol);
  const qty = order.qty - order.filled_qty;
  if (qty <= 0) return;
  // Claim the order before booking anything: concurrent callers (submit + the
  // account sweep) must not book the same order twice.
  const { data: claimed } = await db()
    .from("trade_orders")
    .update({ status: "partially_filled" })
    .eq("id", order.id)
    .in("status", ["created", "accepted", "working"])
    .select("id");
  if (!claimed || claimed.length === 0) return;
  const commission = Number(acct.commission_per_unit) * qty;


  let position = await openPositionFor(userId, acct, order.symbol);
  let realized = 0;
  let positionId: string | null = position?.id ?? null;

  /** Books this fill against a position that already exists. */
  const bookAgainstExisting = async (pos: PositionRow) => {
    positionId = pos.id;
    if (pos.side === order.side) {
      const newQty = Number(pos.qty) + qty;
      const newAvg =
        (Number(pos.avg_entry) * Number(pos.qty) + price * qty) / newQty;
      await db()
        .from("trade_positions")
        .update({ qty: newQty, avg_entry: newAvg })
        .eq("id", pos.id);
      return;
    }
    const closing = Math.min(qty, Number(pos.qty));
    const dir = pos.side === "buy" ? 1 : -1;
    realized = pnlPerUnit(inst, (price - Number(pos.avg_entry)) * dir) * closing;
    const remaining = Number(pos.qty) - closing;
    if (remaining > 0) {
      await db()
        .from("trade_positions")
        .update({
          qty: remaining,
          realized_pnl: Number(pos.realized_pnl) + realized,
        })
        .eq("id", pos.id);
      return;
    }
    await db()
      .from("trade_positions")
      .update({
        qty: 0,
        status: "closed",
        closed_at: new Date().toISOString(),
        realized_pnl: Number(pos.realized_pnl) + realized,
      })
      .eq("id", pos.id);
    await cancelChildren(pos.id, order.id);
    const leftover = qty - closing;
    if (leftover > 0) {
      const { data: flipped } = await db()
        .from("trade_positions")
        .insert({
          user_id: userId,
          account_id: acct.id,
          symbol: order.symbol,
          side: order.side,
          qty: leftover,
          avg_entry: price,
          indicator_name: order.indicator_name,
          timeframe: order.timeframe,
        })
        .select("id")
        .single();
      positionId = (flipped?.id as string | undefined) ?? null;
    }
  };

  if (!position || Number(position.qty) === 0) {
    const { data: created, error } = await db()
      .from("trade_positions")
      .insert({
        user_id: userId,
        account_id: acct.id,
        symbol: order.symbol,
        side: order.side,
        qty,
        avg_entry: price,
        stop_price: null,
        target_price: null,
        indicator_name: order.indicator_name,
        timeframe: order.timeframe,
      })
      .select(POSITION_COLS)
      .single();
    if (!error) {
      position = created as unknown as PositionRow;
      positionId = position.id;
    } else if (/duplicate key|23505/i.test(error.message)) {
      // A concurrent fill opened the position first (the database guarantees
      // one open position per account+symbol) — merge into the winner.
      const winner = await openPositionFor(userId, acct, order.symbol);
      if (!winner) throw new OmsError(error.message);
      await bookAgainstExisting(winner);
    } else {
      throw new OmsError(error.message);
    }
  } else {
    await bookAgainstExisting(position);
  }


  await db().from("trade_executions").insert({
    user_id: userId,
    account_id: acct.id,
    order_id: order.id,
    position_id: positionId,
    symbol: order.symbol,
    side: order.side,
    qty,
    price,
    commission,
    realized_pnl: realized,
  });

  await db()
    .from("trade_orders")
    .update({
      filled_qty: order.qty,
      avg_fill_price: price,
      status: "filled",
      position_id: positionId,
    })
    .eq("id", order.id);

  await db()
    .from("trading_accounts")
    .update({
      realized_pnl: Number(acct.realized_pnl) + realized - commission,
      balance: Number(acct.balance) + realized - commission,
    })
    .eq("id", acct.id);
  acct.realized_pnl = Number(acct.realized_pnl) + realized - commission;
  acct.balance = Number(acct.balance) + realized - commission;

  return positionId;
}

/** OCO behaviour: closing a position kills its resting protective orders. */
async function cancelChildren(positionId: string, exceptOrderId?: string) {
  let q = db()
    .from("trade_orders")
    .update({ status: "cancelled", reject_reason: "Position closed" })
    .eq("position_id", positionId)
    .in("status", ["working", "accepted", "created"]);
  if (exceptOrderId) q = q.neq("id", exceptOrderId);
  await q;
}

// ----------------------------------------------------------------- orders

export type SubmitInput = {
  accountId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  purpose?: "entry" | "exit";
  reduceOnly?: boolean;
  indicatorId?: string;
  indicatorVersion?: number;
  indicatorName?: string;
  signalId?: string;
  timeframe?: string;
};

export async function submitOrder(userId: string, input: SubmitInput) {
  const acct = await getAccount(userId, input.accountId);

  // Duplicate-click / retried-request guard: an identical manual ticket that
  // arrives within 2s of the previous one is almost never intentional. The
  // read below catches the common case; `clientTag` makes it atomic, because
  // a unique index rejects the loser of a genuinely concurrent double click.
  //
  // Phase 5B-Final — a caller-supplied `signalId` (a strategy's own
  // deterministic indicator+symbol+timeframe+bar+kind+side identity, never
  // random) gets the EXACT SAME unique-index-backed atomicity, via the
  // `signal:` prefix below, rather than being exempted from it. This is the
  // server-side backstop the client-side dedup set (useStrategyExecution's
  // processedSignalsRef) cannot fully provide on its own — an HTTP retry of
  // the identical request (network hiccup, a second browser tab, a replayed
  // request) now collides on the SAME unique `(account_id, client_tag)`
  // index and returns the ALREADY-ACCEPTED order (see the duplicate-key
  // catch below) instead of creating a second one. A manual ticket (no
  // signalId) keeps its own pre-existing 2-second-window content-based
  // guard, unchanged.
  const clientTag = input.signalId
    ? `signal:${input.signalId}`
    : [
        acct.id,
        input.symbol.toUpperCase(),
        input.side,
        input.type,
        input.qty,
        input.purpose ?? "entry",
        Math.floor(Date.now() / 2000),
      ].join("|");
  if (!input.signalId) {
    const since = new Date(Date.now() - 2000).toISOString();
    const { data: recent } = await db()
      .from("trade_orders")
      .select("id")
      .eq("user_id", userId)
      .eq("account_id", acct.id)
      .eq("symbol", input.symbol.toUpperCase())
      .eq("side", input.side)
      .eq("order_type", input.type)
      .eq("qty", input.qty)
      .eq("purpose", input.purpose ?? "entry")
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      return { orderId: recent[0]!.id as string, duplicate: true as const };
    }
  }



  // Broker-backed account: the same ticket, risk checks and OMS row, but the
  // execution leaves through the broker adapter instead of the paper engine.
  if (isBrokerAccount(acct)) {
    const routing = await import("./brokers/routing.server");
    const brokerReject = await brokerPreTradeCheck(userId, acct, input);
    if (brokerReject) {
      const { data } = await db()
        .from("trade_orders")
        .insert({
          user_id: userId,
          account_id: acct.id,
          symbol: input.symbol.toUpperCase(),
          side: input.side,
          order_type: input.type,
          purpose: input.purpose ?? "entry",
          qty: input.qty,
          status: "rejected",
          reject_reason: brokerReject,
        })
        .select("id")
        .single();
      return { orderId: (data?.id as string) ?? "", rejected: brokerReject };
    }
    return routing.brokerSubmitOrder(userId, acct, {
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      type: input.type,
      qty: input.qty,
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      indicatorId: input.indicatorId,
      indicatorVersion: input.indicatorVersion,
      indicatorName: input.indicatorName,
      signalId: input.signalId,
      timeframe: input.timeframe,
    });
  }

  if (acct.environment !== "paper")
    throw new OmsError(
      "Live routing is not connected yet — this account cannot send real orders.",
    );

  const inst = getInstrument(input.symbol);
  const last = await getLastPrice(input.symbol);
  if (last === null)
    throw new OmsError(
      `No live market data for ${input.symbol} — order refused rather than filled at a made-up price.`,
    );

  const purpose = input.purpose ?? "entry";
  const reject = await preTradeCheck(userId, acct, input, last);

  const { data: inserted, error } = await db()
    .from("trade_orders")
    .insert({
      user_id: userId,
      account_id: acct.id,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      order_type: input.type,
      purpose,
      qty: input.qty,
      limit_price: input.limitPrice ? roundToTick(inst, input.limitPrice) : null,
      stop_price: input.stopPrice ? roundToTick(inst, input.stopPrice) : null,
      status: reject ? "rejected" : "accepted",
      reject_reason: reject,
      reduce_only: input.reduceOnly ?? false,
      indicator_id: input.indicatorId ?? null,
      indicator_version: input.indicatorVersion ?? null,
      indicator_name: input.indicatorName ?? null,
      signal_id: input.signalId ?? null,
      timeframe: input.timeframe ?? null,
      client_tag: clientTag,
    })
    .select(ORDER_COLS)
    .single();
  if (error) {
    if (clientTag && /duplicate key|23505/i.test(error.message)) {
      const { data: dup } = await db()
        .from("trade_orders")
        .select("id")
        .eq("user_id", userId)
        .eq("client_tag", clientTag)
        .limit(1);
      if (dup && dup.length > 0) {
        return { orderId: dup[0]!.id as string, duplicate: true as const };
      }
    }
    throw new OmsError(error.message);
  }
  const order = inserted as unknown as OrderRow;

  if (reject) return { rejected: reject, orderId: order.id };

  if (input.type === "market") {
    const positionId = await applyFill({ userId, acct, order, price: last });
    if (positionId && (input.stopLoss || input.takeProfit)) {
      await attachBrackets(userId, acct, {
        positionId,
        symbol: order.symbol,
        side: opposite(order.side),
        qty: input.qty,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        indicatorName: input.indicatorName,
        timeframe: input.timeframe,
      });
    }
  } else {
    // Pending brackets are stored on the order so they survive a restart and
    // are attached when the entry actually fills during sync.
    await db()
      .from("trade_orders")
      .update({
        status: "working",
        bracket_stop: input.stopLoss ? roundToTick(inst, input.stopLoss) : null,
        bracket_target: input.takeProfit ? roundToTick(inst, input.takeProfit) : null,
      })
      .eq("id", order.id);
  }

  return { orderId: order.id, rejected: null as string | null };
}

async function attachBrackets(
  userId: string,
  acct: TradingAccount,
  o: {
    positionId: string;
    symbol: string;
    side: OrderSide;
    qty: number;
    stopLoss?: number | undefined;
    takeProfit?: number | undefined;
    indicatorName?: string | undefined;
    timeframe?: string | undefined;
  },
) {
  const inst = getInstrument(o.symbol);
  const rows: Record<string, unknown>[] = [];
  if (o.stopLoss)
    rows.push({
      user_id: userId,
      account_id: acct.id,
      position_id: o.positionId,
      symbol: o.symbol,
      side: o.side,
      order_type: "stop",
      purpose: "stop",
      qty: o.qty,
      stop_price: roundToTick(inst, o.stopLoss),
      status: "working",
      reduce_only: true,
      indicator_name: o.indicatorName ?? null,
      timeframe: o.timeframe ?? null,
    });
  if (o.takeProfit)
    rows.push({
      user_id: userId,
      account_id: acct.id,
      position_id: o.positionId,
      symbol: o.symbol,
      side: o.side,
      order_type: "limit",
      purpose: "target",
      qty: o.qty,
      limit_price: roundToTick(inst, o.takeProfit),
      status: "working",
      reduce_only: true,
      indicator_name: o.indicatorName ?? null,
      timeframe: o.timeframe ?? null,
    });
  if (rows.length) await db().from("trade_orders").insert(rows as never);
  await db()
    .from("trade_positions")
    .update({
      stop_price: o.stopLoss ? roundToTick(inst, o.stopLoss) : null,
      target_price: o.takeProfit ? roundToTick(inst, o.takeProfit) : null,
    })
    .eq("id", o.positionId);
}

export async function cancelOrder(userId: string, orderId: string) {
  const { data: owner } = await db()
    .from("trade_orders")
    .select("account_id")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (owner) {
    const acct = await getAccount(userId, owner.account_id as string);
    if (isBrokerAccount(acct)) {
      const routing = await import("./brokers/routing.server");
      await routing.brokerCancelOrder(userId, acct, orderId);
      return { ok: true };
    }
  }
  const { data, error } = await db()
    .from("trade_orders")
    .update({ status: "cancelled", reject_reason: "Cancelled by user" })
    .eq("id", orderId)
    .eq("user_id", userId)
    .in("status", ["created", "accepted", "working", "partially_filled"])
    .select("id");
  if (error) throw new OmsError(error.message);
  if (!data?.length) throw new OmsError("Order is no longer cancellable");
  return { ok: true };
}

export async function modifyOrder(
  userId: string,
  input: { orderId: string; limitPrice?: number; stopPrice?: number; qty?: number },
) {
  const { data: existing } = await db()
    .from("trade_orders")
    .select("id, symbol, status, account_id")
    .eq("id", input.orderId)
    .eq("user_id", userId)
    .single();
  if (!existing) throw new OmsError("Order not found");
  {
    const acct = await getAccount(userId, existing.account_id as string);
    if (isBrokerAccount(acct)) {
      const routing = await import("./brokers/routing.server");
      await routing.brokerModifyOrder(userId, acct, input);
      return { ok: true };
    }
  }
  if (!["working", "accepted", "created"].includes(existing.status as string))
    throw new OmsError("Only working orders can be modified");
  const inst = getInstrument(existing.symbol as string);
  const patch: Record<string, unknown> = {};
  if (input.limitPrice !== undefined)
    patch["limit_price"] = roundToTick(inst, input.limitPrice);
  if (input.stopPrice !== undefined)
    patch["stop_price"] = roundToTick(inst, input.stopPrice);
  if (input.qty !== undefined) patch["qty"] = input.qty;
  const { error } = await db()
    .from("trade_orders")
    .update(patch as never)
    .eq("id", input.orderId);
  if (error) throw new OmsError(error.message);
  return { ok: true };
}

/** Moves/creates the protective orders attached to an open position. */
export async function setPositionProtection(
  userId: string,
  input: { positionId: string; stopLoss?: number | null; takeProfit?: number | null },
) {
  const { data: pos } = await db()
    .from("trade_positions")
    .select(POSITION_COLS)
    .eq("id", input.positionId)
    .eq("user_id", userId)
    .eq("status", "open")
    .single();
  if (!pos) throw new OmsError("Open position not found");
  const position = pos as unknown as PositionRow;
  const acct = await getAccount(userId, position.account_id);
  await db()
    .from("trade_orders")
    .update({ status: "cancelled", reject_reason: "Replaced" })
    .eq("position_id", position.id)
    .in("purpose", ["stop", "target"])
    .in("status", ["working", "accepted", "created"]);
  await attachBrackets(userId, acct, {
    positionId: position.id,
    symbol: position.symbol,
    side: opposite(position.side),
    qty: Number(position.qty),
    ...(input.stopLoss ? { stopLoss: input.stopLoss } : {}),
    ...(input.takeProfit ? { takeProfit: input.takeProfit } : {}),
    ...(position.indicator_name ? { indicatorName: position.indicator_name } : {}),
    ...(position.timeframe ? { timeframe: position.timeframe } : {}),
  });
  return { ok: true };
}

export async function closePosition(
  userId: string,
  input: { positionId: string; qty?: number },
) {
  // Compare-and-swap lock: two rapid close requests for the same position
  // would otherwise both read it as open and submit two exit orders.
  const lockCutoff = new Date(Date.now() - 10_000).toISOString();
  const { data: locked } = await db()
    .from("trade_positions")
    .update({ close_lock_at: new Date().toISOString() })
    .eq("id", input.positionId)
    .eq("user_id", userId)
    .eq("status", "open")
    // The timestamp is quoted: unquoted it contains characters PostgREST
    // treats as filter syntax, which silently matched nothing.
    .or(`close_lock_at.is.null,close_lock_at.lt."${lockCutoff}"`)

    .select(POSITION_COLS);
  if (!locked || locked.length === 0) {
    throw new OmsError("Close already in progress for this position");
  }
  const position = locked[0] as unknown as PositionRow;
  const qty = Math.min(input.qty ?? Number(position.qty), Number(position.qty));

  {
    const acct = await getAccount(userId, position.account_id);
    if (isBrokerAccount(acct)) {
      const routing = await import("./brokers/routing.server");
      return routing.brokerClosePosition(
        userId,
        acct,
        {
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          qty: Number(position.qty),
        },
        qty,
      );
    }
  }
  const res = await submitOrder(userId, {
    accountId: position.account_id,
    symbol: position.symbol,
    side: opposite(position.side),
    type: "market",
    qty,
    purpose: "exit",
    reduceOnly: true,
    ...(position.timeframe ? { timeframe: position.timeframe } : {}),
  });
  if (Number(position.qty) - qty <= 0) await cancelChildren(position.id);
  return res;
}

export async function flattenAll(userId: string, accountId?: string) {
  const acct = await getAccount(userId, accountId);
  if (isBrokerAccount(acct)) {
    const routing = await import("./brokers/routing.server");
    await routing.brokerFlatten(userId, acct);
    return getSnapshot(userId, acct.id);
  }
  const { data } = await db()
    .from("trade_positions")
    .select("id")
    .eq("account_id", acct.id)
    .eq("status", "open");
  for (const p of data ?? []) {
    await closePosition(userId, { positionId: p.id as string });
  }
  await db()
    .from("trade_orders")
    .update({ status: "cancelled", reject_reason: "Flatten all" })
    .eq("account_id", acct.id)
    .in("status", ["working", "accepted", "created"]);
  return getSnapshot(userId, acct.id);
}

// ------------------------------------------------------------------ sync

/** Evaluates every working order against live prices and books any fills. */
export async function syncAccount(
  userId: string,
  accountId?: string,
): Promise<AccountSnapshot> {
  const acct = await getAccount(userId, accountId);
  if (isBrokerAccount(acct)) {
    // Broker is authoritative: pull its state and mirror it locally.
    const routing = await import("./brokers/routing.server");
    await routing.brokerSync(userId, acct);
    return getSnapshot(userId, acct.id);
  }
  const { data: working } = await db()
    .from("trade_orders")
    .select(ORDER_COLS)
    .eq("account_id", acct.id)
    // Market tickets are filled synchronously by submitOrder. If the sweep also
    // saw them (they are briefly "accepted") the same order booked twice.
    .in("order_type", ["limit", "stop", "stop_limit"])
    .in("status", ["working", "accepted"]);

  const orders = (working ?? []) as unknown as OrderRow[];

  if (orders.length) {
    const prices = await getLastPrices(orders.map((o) => o.symbol));
    for (const order of orders) {
      const last = prices[order.symbol.toUpperCase()];
      if (last === undefined) continue;
      const trigger = triggerPrice(order, last);
      if (trigger === null) continue;

      // A protective order whose position vanished must not fill.
      if (order.position_id) {
        const { data: p } = await db()
          .from("trade_positions")
          .select("status, qty")
          .eq("id", order.position_id)
          .single();
        if (!p || p.status !== "open" || Number(p.qty) <= 0) {
          await db()
            .from("trade_orders")
            .update({ status: "cancelled", reject_reason: "Position already closed" })
            .eq("id", order.id);
          continue;
        }
      }

      if (order.order_type === "stop_limit" && order.limit_price) {
        await db()
          .from("trade_orders")
          .update({ order_type: "limit", status: "working" })
          .eq("id", order.id);
        continue;
      }

      const positionId = await applyFill({ userId, acct, order, price: trigger });
      const bStop = order.bracket_stop === null ? null : Number(order.bracket_stop);
      const bTarget =
        order.bracket_target === null ? null : Number(order.bracket_target);
      if (positionId && (bStop || bTarget)) {
        await attachBrackets(userId, acct, {
          positionId,
          symbol: order.symbol,
          side: opposite(order.side),
          qty: Number(order.qty),
          ...(bStop ? { stopLoss: bStop } : {}),
          ...(bTarget ? { takeProfit: bTarget } : {}),
        });
      }
    }
  }

  return getSnapshot(userId, acct.id);
}

function triggerPrice(order: OrderRow, last: number): number | null {
  const lim = order.limit_price === null ? null : Number(order.limit_price);
  const stp = order.stop_price === null ? null : Number(order.stop_price);
  switch (order.order_type) {
    case "market":
      return last;
    case "limit":
      if (lim === null) return null;
      return order.side === "buy"
        ? last <= lim
          ? lim
          : null
        : last >= lim
          ? lim
          : null;
    case "stop":
    case "stop_limit":
      if (stp === null) return null;
      return order.side === "buy"
        ? last >= stp
          ? stp
          : null
        : last <= stp
          ? stp
          : null;
    default:
      return null;
  }
}

// -------------------------------------------------------------- snapshot

export async function getSnapshot(
  userId: string,
  accountId?: string,
): Promise<AccountSnapshot> {
  const acct = await getAccount(userId, accountId);
  const [{ data: pos }, { data: ord }, { data: ex }] = await Promise.all([
    db()
      .from("trade_positions")
      .select(POSITION_COLS)
      .eq("account_id", acct.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false }),
    db()
      .from("trade_orders")
      .select(ORDER_COLS)
      .eq("account_id", acct.id)
      .order("created_at", { ascending: false })
      .limit(100),
    db()
      .from("trade_executions")
      .select(EXEC_COLS)
      .eq("account_id", acct.id)
      .order("executed_at", { ascending: false })
      .limit(100),
  ]);

  const positions = (pos ?? []) as unknown as PositionRow[];
  const prices = positions.length
    ? await getLastPrices(positions.map((p) => p.symbol))
    : {};

  let openPnl = 0;
  const enriched = positions.map((p) => {
    const last = prices[p.symbol.toUpperCase()] ?? null;
    const inst = getInstrument(p.symbol);
    const dir = p.side === "buy" ? 1 : -1;
    const unrealized =
      last === null
        ? 0
        : pnlPerUnit(inst, (last - Number(p.avg_entry)) * dir) * Number(p.qty);
    openPnl += unrealized;
    return { ...p, last, unrealized };
  });

  return {
    account: acct,
    positions: enriched,
    orders: (ord ?? []) as unknown as OrderRow[],
    history: (ex ?? []) as unknown as ExecutionRow[],
    openPnl,
    dailyPnl: await dailyRealized(acct.id),
    simulation: SIMULATION_NOTE,
  };
}


// ------------------------------------------------- multiple paper accounts

/**
 * Every account the user owns. Paper accounts are created here; broker
 * (demo/live) accounts will be inserted by their adapter once connected, so the
 * UI never has to know which kind it is rendering.
 */
export async function listAccounts(userId: string): Promise<TradingAccount[]> {
  const { data } = await db()
    .from("trading_accounts")
    .select(ACCOUNT_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as TradingAccount[];
  if (rows.length) return rows;
  return [await ensureAccount(userId)];
}

export async function createPaperAccount(
  userId: string,
  input: { label: string; startingBalance: number; currency?: string },
): Promise<TradingAccount> {
  const existing = await listAccounts(userId);
  if (existing.length >= 10)
    throw new OmsError("Paper account limit reached (10).");
  const { data, error } = await db()
    .from("trading_accounts")
    .insert({
      user_id: userId,
      broker: "signalgoat",
      label: input.label.slice(0, 60),
      account_number: `PAPER-${existing.length + 1}`,
      environment: "paper",
      currency: input.currency ?? "USD",
      starting_balance: input.startingBalance,
      balance: input.startingBalance,
      is_default: false,
    })
    .select(ACCOUNT_COLS)
    .single();
  if (error) throw new OmsError(error.message);
  return data as unknown as TradingAccount;
}

export async function deletePaperAccount(userId: string, accountId: string) {
  const acct = await getAccount(userId, accountId);
  if (acct.environment !== "paper")
    throw new OmsError("Only paper accounts can be deleted here.");
  const all = await listAccounts(userId);
  if (all.length <= 1) throw new OmsError("You need at least one account.");
  await db().from("trade_executions").delete().eq("account_id", acct.id);
  await db().from("trade_orders").delete().eq("account_id", acct.id);
  await db().from("trade_positions").delete().eq("account_id", acct.id);
  await db().from("trading_accounts").delete().eq("id", acct.id);
  return listAccounts(userId);
}

/** Realized P&L booked since UTC midnight on this account. */
export async function dailyRealized(accountId: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await db()
    .from("trade_executions")
    .select("realized_pnl, commission")
    .eq("account_id", accountId)
    .gte("executed_at", since.toISOString());
  return (data ?? []).reduce(
    (sum, r) =>
      sum + Number(r.realized_pnl ?? 0) - Number(r.commission ?? 0),
    0,
  );
}

/** Rename a paper account. Broker-managed accounts keep their broker label. */
export async function renamePaperAccount(
  userId: string,
  accountId: string,
  label: string,
) {
  const acct = await getAccount(userId, accountId);
  if (acct.environment !== "paper")
    throw new OmsError("Only paper accounts can be renamed here.");
  await db()
    .from("trading_accounts")
    .update({ label: label.slice(0, 60) })
    .eq("id", acct.id);
  return listAccounts(userId);
}

/**
 * Reverse: flatten the open position and immediately open the same size on the
 * other side. Both legs route through the normal OMS so risk checks still run.
 */
export async function reversePosition(userId: string, positionId: string) {
  const { data: pos } = await db()
    .from("trade_positions")
    .select(POSITION_COLS)
    .eq("id", positionId)
    .eq("user_id", userId)
    .eq("status", "open")
    .single();
  if (!pos) throw new OmsError("Open position not found");
  const position = pos as unknown as PositionRow;
  const qty = Number(position.qty);
  await closePosition(userId, { positionId });
  return submitOrder(userId, {
    accountId: position.account_id,
    symbol: position.symbol,
    side: opposite(position.side),
    type: "market",
    qty,
    purpose: "entry",
    ...(position.timeframe ? { timeframe: position.timeframe } : {}),
  });
}

/** Move the protective stop to the average entry price. */
export async function movePositionToBreakeven(userId: string, positionId: string) {
  const { data: pos } = await db()
    .from("trade_positions")
    .select(POSITION_COLS)
    .eq("id", positionId)
    .eq("user_id", userId)
    .eq("status", "open")
    .single();
  if (!pos) throw new OmsError("Open position not found");
  const position = pos as unknown as PositionRow;
  return setPositionProtection(userId, {
    positionId,
    stopLoss: Number(position.avg_entry),
  });
}
