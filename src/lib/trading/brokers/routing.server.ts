/**
 * Broker routing for the Signal Goat OMS.
 *
 * The OMS calls into here whenever the selected account is broker-backed. Every
 * function does the same three things: send the request through the adapter,
 * wait for the broker's answer, then re-read broker state so the local mirror
 * matches reality. Nothing is marked filled, cancelled or modified locally
 * before the broker confirms it.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { adapterFor, audit, reconcileBrokerAccount } from "./registry.server";
import { BrokerError } from "./types";
import type { OrderSide, OrderType, TradingAccount } from "../types";

const db = () => supabaseAdmin;

type Acct = TradingAccount;

const localAccount = (a: Acct) => ({
  id: a.id,
  connection_id: a.connection_id ?? null,
  broker_account_id: a.broker_account_id ?? null,
  broker_account_spec: a.broker_account_spec ?? null,
  environment: a.environment as string,
});

export type BrokerSubmit = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number | undefined;
  stopPrice?: number | undefined;
  stopLoss?: number | undefined;
  takeProfit?: number | undefined;
  indicatorId?: string | undefined;
  indicatorVersion?: number | undefined;
  indicatorName?: string | undefined;
  signalId?: string | undefined;
  timeframe?: string | undefined;
};

/**
 * Submit through the broker.
 *
 * A client tag is written locally *before* the request leaves, so a dropped
 * connection can never cause a blind retry: we look the tag up at the broker
 * and adopt the existing order instead of sending a second one.
 */
export async function brokerSubmitOrder(
  userId: string,
  acct: Acct,
  input: BrokerSubmit,
) {
  const { conn, adapter } = await adapterFor(userId, acct.connection_id!);
  const clientTag = `SG-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const contract = await adapter.resolveContract(input.symbol);
  if (!contract)
    throw new BrokerError(
      `${input.symbol} cannot be traded on this ${conn.label} account.`,
      "instrument_unavailable",
    );

  const { data: inserted, error } = await db()
    .from("trade_orders")
    .insert({
      user_id: userId,
      account_id: acct.id,
      symbol: contract.brokerSymbol,
      side: input.side,
      order_type: input.type,
      purpose: "entry",
      qty: input.qty,
      limit_price: input.limitPrice ?? null,
      stop_price: input.stopPrice ?? null,
      bracket_stop: input.stopLoss ?? null,
      bracket_target: input.takeProfit ?? null,
      status: "submitting",
      client_tag: clientTag,
      indicator_id: input.indicatorId ?? null,
      indicator_version: input.indicatorVersion ?? null,
      indicator_name: input.indicatorName ?? null,
      signal_id: input.signalId ?? null,
      timeframe: input.timeframe ?? null,
    })
    .select("id")
    .single();
  if (error) throw new BrokerError(error.message);
  const orderId = inserted.id as string;

  try {
    const res = await adapter.placeOrder({
      brokerAccountId: acct.broker_account_id!,
      accountSpec: acct.broker_account_spec ?? undefined,
      symbol: contract.brokerSymbol,
      side: input.side,
      type: input.type,
      qty: input.qty,
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      clientTag,
    });
    await db()
      .from("trade_orders")
      .update({
        broker_order_id: res.brokerOrderId,
        status: res.status,
        broker_status: res.brokerStatus,
      })
      .eq("id", orderId);
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      brokerAccountId: acct.broker_account_id,
      action: "place_order",
      orderId,
      brokerOrderId: res.brokerOrderId,
      request: {
        symbol: contract.brokerSymbol,
        side: input.side,
        type: input.type,
        qty: input.qty,
        clientTag,
      },
      response: { status: res.status, brokerStatus: res.brokerStatus },
    });
    await reconcileBrokerAccount(userId, localAccount(acct));
    return { orderId, rejected: null as string | null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Order failed";

    // Never blindly retry: ask the broker whether our tag already exists.
    let adopted: string | null = null;
    try {
      const found = await adapter.findOrderByClientTag(
        acct.broker_account_id!,
        clientTag,
      );
      if (found) adopted = found.brokerOrderId;
    } catch {
      /* broker unreachable — leave the order flagged for reconciliation */
    }

    if (adopted) {
      await db()
        .from("trade_orders")
        .update({ broker_order_id: adopted, status: "accepted" })
        .eq("id", orderId);
      await reconcileBrokerAccount(userId, localAccount(acct));
      return { orderId, rejected: null as string | null };
    }

    await db()
      .from("trade_orders")
      .update({ status: "rejected", reject_reason: message })
      .eq("id", orderId);
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      brokerAccountId: acct.broker_account_id,
      action: "place_order",
      orderId,
      result: "error",
      message,
      request: { symbol: input.symbol, side: input.side, qty: input.qty, clientTag },
    });
    return { orderId, rejected: message };
  }
}

async function orderRow(userId: string, orderId: string) {
  const { data } = await db()
    .from("trade_orders")
    .select("id, account_id, broker_order_id, symbol, qty, status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new BrokerError("Order not found.");
  return data;
}

export async function brokerCancelOrder(userId: string, acct: Acct, orderId: string) {
  const row = await orderRow(userId, orderId);
  if (!row.broker_order_id)
    throw new BrokerError("This order was never accepted by the broker.");
  const { conn, adapter } = await adapterFor(userId, acct.connection_id!);
  try {
    await adapter.cancelOrder(String(row.broker_order_id));
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      action: "cancel_order",
      orderId,
      brokerOrderId: String(row.broker_order_id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cancel rejected";
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      action: "cancel_order",
      orderId,
      brokerOrderId: String(row.broker_order_id),
      result: "error",
      message,
    });
    throw new BrokerError(message, "rejected");
  }
  await reconcileBrokerAccount(userId, localAccount(acct));
}

export async function brokerModifyOrder(
  userId: string,
  acct: Acct,
  input: { orderId: string; qty?: number | undefined; limitPrice?: number | undefined; stopPrice?: number | undefined },
) {
  const row = await orderRow(userId, input.orderId);
  if (!row.broker_order_id)
    throw new BrokerError("This order is not live at the broker yet.");
  const { conn, adapter } = await adapterFor(userId, acct.connection_id!);
  try {
    await adapter.modifyOrder({
      brokerOrderId: String(row.broker_order_id),
      qty: input.qty ?? Number(row.qty),
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
    });
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      action: "modify_order",
      orderId: input.orderId,
      brokerOrderId: String(row.broker_order_id),
      request: input as never,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Modification rejected";
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      action: "modify_order",
      orderId: input.orderId,
      brokerOrderId: String(row.broker_order_id),
      result: "error",
      message,
    });
    throw new BrokerError(message, "rejected");
  }
  // The chart only moves after the broker confirms, so re-read broker state.
  await reconcileBrokerAccount(userId, localAccount(acct));
}

export async function brokerClosePosition(
  userId: string,
  acct: Acct,
  position: { id: string; symbol: string; side: OrderSide; qty: number },
  qty?: number,
) {
  const size = Math.min(qty ?? position.qty, position.qty);
  const full = size >= position.qty;
  const { conn, adapter } = await adapterFor(userId, acct.connection_id!);

  if (full && adapter.supports.liquidate) {
    await adapter.liquidatePosition({
      brokerAccountId: acct.broker_account_id!,
      accountSpec: acct.broker_account_spec ?? undefined,
      symbol: position.symbol,
    });
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      accountId: acct.id,
      action: "liquidate_position",
      request: { symbol: position.symbol },
    });
    await reconcileBrokerAccount(userId, localAccount(acct));
    return { orderId: null as string | null, rejected: null as string | null };
  }

  return brokerSubmitOrder(userId, acct, {
    symbol: position.symbol,
    side: position.side === "buy" ? "sell" : "buy",
    type: "market",
    qty: size,
  });
}

export async function brokerFlatten(userId: string, acct: Acct) {
  const { adapter } = await adapterFor(userId, acct.connection_id!);
  const brokerAccountId = acct.broker_account_id!;

  const orders = await adapter.listOrders(brokerAccountId);
  for (const o of orders) {
    if (["working", "accepted", "partially_filled"].includes(o.status)) {
      try {
        await adapter.cancelOrder(o.brokerOrderId);
      } catch {
        /* keep flattening; reconciliation reports what survived */
      }
    }
  }
  const positions = await adapter.listPositions(brokerAccountId);
  for (const p of positions) {
    try {
      await adapter.liquidatePosition({
        brokerAccountId,
        accountSpec: acct.broker_account_spec ?? undefined,
        symbol: p.symbol,
      });
    } catch {
      /* same */
    }
  }
  await audit({
    userId,
    broker: "tradovate",
    environment: acct.environment,
    accountId: acct.id,
    action: "flatten",
    request: { orders: orders.length, positions: positions.length },
  });
  await reconcileBrokerAccount(userId, localAccount(acct));
}

export async function brokerSync(userId: string, acct: Acct) {
  await reconcileBrokerAccount(userId, localAccount(acct));
}
