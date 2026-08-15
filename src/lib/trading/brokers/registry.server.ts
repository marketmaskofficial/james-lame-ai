/**
 * Broker connection registry + broker-authoritative reconciliation.
 *
 * Signal Goat keeps its own normalized OMS tables as the single thing the UI
 * reads. For broker-backed accounts those rows are a *mirror*: every sync pulls
 * orders, positions, fills and balances from the broker and overwrites the
 * local mirror, so the broker always wins. Nothing is invented locally.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptJson, encryptJson } from "./crypto.server";
import { BrokerError } from "./types";
import type { BrokerAdapter, BrokerEnvironment, BrokerHealth } from "./types";
import {
  TradovateClient,
  tradovateAdapter,
  type TradovateCredentials,
  type TradovateSession,
  type TradovateVault,
} from "./tradovate.server";

const db = () => supabaseAdmin;

/** Live money stays off until the demo suite is signed off. */
export const LIVE_TRADING_ENABLED = false;

export type ConnectionRow = {
  id: string;
  user_id: string;
  broker: string;
  environment: BrokerEnvironment;
  label: string;
  status: BrokerHealth;
  broker_user_id: string | null;
  last_connected_at: string | null;
  last_error: string | null;
};

const CONN_COLS =
  "id, user_id, broker, environment, label, status, broker_user_id, last_connected_at, last_error";

export async function listConnections(userId: string): Promise<ConnectionRow[]> {
  const { data } = await db()
    .from("broker_connections")
    .select(CONN_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as ConnectionRow[];
}

export async function getConnection(
  userId: string,
  connectionId: string,
): Promise<ConnectionRow> {
  const { data } = await db()
    .from("broker_connections")
    .select(CONN_COLS)
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new BrokerError("Broker connection not found.", "disconnected");
  return data as unknown as ConnectionRow;
}

async function setStatus(
  connectionId: string,
  status: BrokerHealth,
  lastError?: string | null,
) {
  await db()
    .from("broker_connections")
    .update({
      status,
      last_error: lastError ?? null,
      ...(status === "connected" ? { last_connected_at: new Date().toISOString() } : {}),
    })
    .eq("id", connectionId);
}

export async function audit(entry: {
  userId: string;
  broker: string;
  environment: string;
  accountId?: string | null;
  brokerAccountId?: string | null;
  action: string;
  orderId?: string | null;
  brokerOrderId?: string | null;
  request?: unknown;
  response?: unknown;
  result?: "ok" | "error";
  message?: string | null;
}) {
  await db()
    .from("broker_audit_log")
    .insert({
      user_id: entry.userId,
      broker: entry.broker,
      environment: entry.environment,
      account_id: entry.accountId ?? null,
      broker_account_id: entry.brokerAccountId ?? null,
      action: entry.action,
      order_id: entry.orderId ?? null,
      broker_order_id: entry.brokerOrderId ?? null,
      request: (entry.request ?? {}) as never,
      response: (entry.response ?? {}) as never,
      result: entry.result ?? "ok",
      message: entry.message ?? null,
    });
}

// ------------------------------------------------------------- credentials

export async function saveTradovateConnection(
  userId: string,
  input: {
    environment: Exclude<BrokerEnvironment, "paper">;
    credentials: TradovateCredentials;
  },
): Promise<ConnectionRow> {
  if (input.environment === "live" && !LIVE_TRADING_ENABLED)
    throw new BrokerError(
      "Tradovate Live routing is feature-flagged off until the demo test suite is signed off.",
      "unsupported",
    );

  const blob = await encryptJson({
    credentials: input.credentials,
  } as TradovateVault);

  const { data, error } = await db()
    .from("broker_connections")
    .upsert(
      {
        user_id: userId,
        broker: "tradovate",
        environment: input.environment,
        label: `Tradovate ${input.environment === "demo" ? "Demo" : "Live"}`,
        status: "connecting",
        credentials_encrypted: blob,
        last_error: null,
      },
      { onConflict: "user_id,broker,environment" },
    )
    .select(CONN_COLS)
    .single();
  if (error) throw new BrokerError(error.message);
  return data as unknown as ConnectionRow;
}

export async function deleteConnection(userId: string, connectionId: string) {
  const conn = await getConnection(userId, connectionId);
  await db()
    .from("trading_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("connection_id", conn.id);
  await db().from("broker_connections").delete().eq("id", conn.id).eq("user_id", userId);
}

/** Builds a live adapter for a stored connection, authenticating if needed. */
export async function adapterFor(
  userId: string,
  connectionId: string,
): Promise<{ conn: ConnectionRow; adapter: BrokerAdapter }> {
  const conn = await getConnection(userId, connectionId);
  const { data } = await db()
    .from("broker_connections")
    .select("credentials_encrypted")
    .eq("id", conn.id)
    .single();
  const blob = (data as { credentials_encrypted: string | null } | null)
    ?.credentials_encrypted;
  if (!blob)
    throw new BrokerError(
      "This broker connection has no stored credentials. Reconnect it.",
      "auth_failed",
    );

  const vault = await decryptJson<TradovateVault>(blob);
  const env = conn.environment === "live" ? "live" : "demo";
  if (env === "live" && !LIVE_TRADING_ENABLED)
    throw new BrokerError("Live routing is disabled.", "unsupported");

  const persist = async (session: TradovateSession) => {
    const next = await encryptJson({ ...vault, session });
    await db()
      .from("broker_connections")
      .update({ credentials_encrypted: next, broker_user_id: String(session.userId) })
      .eq("id", conn.id);
  };

  const client = new TradovateClient(vault, env, persist);
  return { conn, adapter: tradovateAdapter(client, env) };
}

/** Authenticate and prove the connection really works. */
export async function verifyConnection(userId: string, connectionId: string) {
  await setStatus(connectionId, "connecting");
  try {
    const { conn, adapter } = await adapterFor(userId, connectionId);
    const accounts = await adapter.listAccounts();
    await setStatus(conn.id, "connected", null);
    await audit({
      userId,
      broker: conn.broker,
      environment: conn.environment,
      action: "connect",
      response: { accounts: accounts.length },
    });
    return { connection: await getConnection(userId, connectionId), accounts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connection failed";
    await setStatus(
      connectionId,
      e instanceof BrokerError && e.code === "auth_failed" ? "error" : "disconnected",
      msg,
    );
    await audit({
      userId,
      broker: "tradovate",
      environment: "demo",
      action: "connect",
      result: "error",
      message: msg,
    });
    throw e;
  }
}

// ------------------------------------------------------- account importing

/** Links a broker account into the existing Signal Goat account selector. */
export async function importBrokerAccount(
  userId: string,
  connectionId: string,
  brokerAccountId: string,
) {
  const { conn, adapter } = await adapterFor(userId, connectionId);
  const acct = await adapter.getAccount(brokerAccountId);

  const { data: existing } = await db()
    .from("trading_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("connection_id", conn.id)
    .eq("broker_account_id", acct.brokerAccountId)
    .maybeSingle();

  const row = {
    user_id: userId,
    connection_id: conn.id,
    broker: conn.broker,
    label: acct.label,
    account_number: acct.accountNumber,
    environment: conn.environment,
    currency: acct.currency,
    broker_account_id: acct.brokerAccountId,
    broker_account_spec: acct.accountSpec ?? null,
    balance: acct.balance ?? 0,
    equity: acct.equity,
    buying_power: acct.buyingPower,
    realized_pnl: acct.realizedPnl ?? 0,
    starting_balance: acct.balance ?? 0,
    is_default: false,
    status: "connected",
  };

  if (existing) {
    await db().from("trading_accounts").update(row).eq("id", existing.id);
    return existing.id as string;
  }
  const { data, error } = await db()
    .from("trading_accounts")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new BrokerError(error.message);
  return data.id as string;
}

// --------------------------------------------------------- reconciliation

type LocalAccount = {
  id: string;
  connection_id: string | null;
  broker_account_id: string | null;
  broker_account_spec: string | null;
  environment: string;
};

export function isBrokerAccount(a: {
  connection_id?: string | null;
  broker_account_id?: string | null;
}) {
  return Boolean(a.connection_id && a.broker_account_id);
}

/**
 * Pulls broker state and overwrites the local mirror for one account.
 * Broker is the source of truth: local rows that the broker no longer reports
 * are closed/cancelled rather than kept alive.
 */
export async function reconcileBrokerAccount(userId: string, account: LocalAccount) {
  if (!account.connection_id || !account.broker_account_id) return;
  const { conn, adapter } = await adapterFor(userId, account.connection_id);
  const brokerAccountId = account.broker_account_id;

  const [state, orders, positions, fills] = await Promise.all([
    adapter.getAccount(brokerAccountId),
    adapter.listOrders(brokerAccountId),
    adapter.listPositions(brokerAccountId),
    adapter.listExecutions(brokerAccountId),
  ]);
  await setStatus(conn.id, "connected", null);

  await db()
    .from("trading_accounts")
    .update({
      balance: state.balance ?? 0,
      equity: state.equity,
      buying_power: state.buyingPower,
      realized_pnl: state.realizedPnl ?? 0,
      status: "connected",
    })
    .eq("id", account.id);

  // ---- orders (broker authoritative)
  const { data: localOrders } = await db()
    .from("trade_orders")
    .select("id, broker_order_id, status")
    .eq("account_id", account.id);
  const byBrokerId = new Map(
    (localOrders ?? [])
      .filter((o) => o.broker_order_id)
      .map((o) => [String(o.broker_order_id), o.id as string]),
  );

  for (const o of orders) {
    const patch = {
      symbol: o.symbol,
      side: o.side,
      order_type: o.type,
      qty: o.qty,
      filled_qty: o.filledQty,
      limit_price: o.limitPrice,
      stop_price: o.stopPrice,
      avg_fill_price: o.avgFillPrice,
      status: o.status,
      broker_status: o.brokerStatus,
      reject_reason: o.rejectReason,
    };
    const localId = byBrokerId.get(o.brokerOrderId);
    if (localId) {
      await db().from("trade_orders").update(patch).eq("id", localId);
    } else {
      await db()
        .from("trade_orders")
        .insert({
          user_id: userId,
          account_id: account.id,
          broker_order_id: o.brokerOrderId,
          client_tag: o.clientTag,
          purpose: "entry",
          ...patch,
        });
    }
  }
  // Anything still working locally that the broker no longer lists is stale.
  const brokerIds = new Set(orders.map((o) => o.brokerOrderId));
  for (const l of localOrders ?? []) {
    if (
      l.broker_order_id &&
      !brokerIds.has(String(l.broker_order_id)) &&
      ["created", "accepted", "working", "partially_filled"].includes(
        String(l.status),
      )
    ) {
      await db()
        .from("trade_orders")
        .update({ status: "cancelled", reject_reason: "Not reported by broker" })
        .eq("id", l.id);
    }
  }

  // ---- positions (broker authoritative)
  const { data: localPositions } = await db()
    .from("trade_positions")
    .select("id, broker_position_id, status, stop_price, target_price")
    .eq("account_id", account.id)
    .eq("status", "open");
  const posByBroker = new Map(
    (localPositions ?? [])
      .filter((p) => p.broker_position_id)
      .map((p) => [String(p.broker_position_id), p]),
  );

  for (const p of positions) {
    const hit = posByBroker.get(p.brokerPositionId);
    const patch = {
      symbol: p.symbol,
      side: p.side,
      qty: p.qty,
      avg_entry: p.avgEntry,
      realized_pnl: p.realizedPnl ?? 0,
      status: "open",
    };
    if (hit) {
      await db().from("trade_positions").update(patch).eq("id", hit.id);
    } else {
      await db()
        .from("trade_positions")
        .insert({
          user_id: userId,
          account_id: account.id,
          broker_position_id: p.brokerPositionId,
          ...patch,
        });
    }
  }
  const openBrokerPositions = new Set(positions.map((p) => p.brokerPositionId));
  for (const l of localPositions ?? []) {
    if (l.broker_position_id && !openBrokerPositions.has(String(l.broker_position_id))) {
      await db()
        .from("trade_positions")
        .update({ status: "closed", qty: 0, closed_at: new Date().toISOString() })
        .eq("id", l.id);
    }
  }

  // ---- executions (append-only, deduped on broker execution id)
  if (fills.length) {
    const { data: known } = await db()
      .from("trade_executions")
      .select("broker_execution_id")
      .eq("account_id", account.id)
      .not("broker_execution_id", "is", null);
    const seen = new Set((known ?? []).map((k) => String(k.broker_execution_id)));
    const fresh = fills.filter((f) => !seen.has(f.brokerExecutionId));
    if (fresh.length) {
      const orderLookup = new Map(
        (localOrders ?? [])
          .filter((o) => o.broker_order_id)
          .map((o) => [String(o.broker_order_id), o.id as string]),
      );
      await db()
        .from("trade_executions")
        .insert(
          fresh.map((f) => ({
            user_id: userId,
            account_id: account.id,
            broker_execution_id: f.brokerExecutionId,
            order_id: f.brokerOrderId ? (orderLookup.get(f.brokerOrderId) ?? null) : null,
            symbol: f.symbol,
            side: f.side,
            qty: f.qty,
            price: f.price,
            commission: f.commission,
            realized_pnl: 0,
            liquidity: "broker",
            executed_at: f.executedAt,
          })) as never,
        );
    }
  }
}
