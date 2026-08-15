/**
 * Tradovate execution adapter.
 *
 * Implements the Signal Goat BrokerAdapter against the official Tradovate REST
 * API (https://api.tradovate.com). Demo and live share one implementation and
 * differ only by base URL; live routing is feature-flagged off elsewhere.
 *
 * Nothing in this file is simulated: every account, order, position and fill is
 * read back from Tradovate. If Tradovate cannot be reached, the adapter throws
 * a BrokerError instead of inventing state.
 */

import { BrokerError } from "./types";
import type {
  BrokerAccount,
  BrokerAdapter,
  BrokerContract,
  BrokerEnvironment,
  BrokerExecution,
  BrokerOrder,
  BrokerPosition,
  PlaceOrderRequest,
  PlaceOrderResult,
} from "./types";
import type { OrderSide, OrderStatus, OrderType } from "../types";

export type TradovateCredentials = {
  name: string;
  password: string;
  appId: string;
  appVersion: string;
  cid: string;
  sec: string;
  deviceId: string;
};

export type TradovateSession = {
  accessToken: string;
  expiresAt: string;
  userId: number;
  hasLive: boolean;
};

export type TradovateVault = {
  credentials: TradovateCredentials;
  session?: TradovateSession;
};

const BASE: Record<Exclude<BrokerEnvironment, "paper">, string> = {
  demo: "https://demo.tradovateapi.com/v1",
  live: "https://live.tradovateapi.com/v1",
};

/** Tradovate ordStatus -> Signal Goat OrderStatus. */
function mapStatus(ordStatus: string | undefined): OrderStatus {
  switch ((ordStatus ?? "").toLowerCase()) {
    case "filled":
    case "completed":
      return "filled";
    case "working":
      return "working";
    case "pendingnew":
    case "suspended":
      return "accepted";
    case "pendingcancel":
    case "pendingreplace":
      return "working";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    default:
      return "accepted";
  }
}

function mapOrderType(t: OrderType): string {
  switch (t) {
    case "market":
      return "Market";
    case "limit":
      return "Limit";
    case "stop":
      return "Stop";
    case "stop_limit":
      return "StopLimit";
  }
}

function backOrderType(t: string | undefined): OrderType {
  switch ((t ?? "").toLowerCase()) {
    case "limit":
      return "limit";
    case "stop":
      return "stop";
    case "stoplimit":
      return "stop_limit";
    default:
      return "market";
  }
}

const action = (s: OrderSide) => (s === "buy" ? "Buy" : "Sell");
const sideOf = (a: string | undefined): OrderSide =>
  (a ?? "").toLowerCase() === "sell" ? "sell" : "buy";

type Json = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export class TradovateClient {
  private vault: TradovateVault;
  private env: Exclude<BrokerEnvironment, "paper">;
  private onSession?: (s: TradovateSession) => Promise<void>;
  private contractCache = new Map<string, { id: number; name: string }>();

  constructor(
    vault: TradovateVault,
    env: Exclude<BrokerEnvironment, "paper">,
    onSession?: (s: TradovateSession) => Promise<void>,
  ) {
    this.vault = vault;
    this.env = env;
    if (onSession) this.onSession = onSession;
  }

  private base() {
    return BASE[this.env];
  }

  /** Authenticates (or reuses a still-valid token) and returns the bearer. */
  async token(): Promise<string> {
    const s = this.vault.session;
    if (s && new Date(s.expiresAt).getTime() - Date.now() > 60_000)
      return s.accessToken;
    return this.authenticate();
  }

  async authenticate(): Promise<string> {
    const c = this.vault.credentials;
    const body: Json = {
      name: c.name,
      password: c.password,
      appId: c.appId,
      appVersion: c.appVersion,
      deviceId: c.deviceId,
      cid: c.cid,
      sec: c.sec,
    };
    const res = await this.raw("POST", "/auth/accessTokenRequest", body, false);
    const token = typeof res["accessToken"] === "string" ? res["accessToken"] : "";
    if (!token) {
      const reason =
        typeof res["errorText"] === "string" ? res["errorText"] : "Unknown reason";
      throw new BrokerError(`Tradovate authentication failed: ${reason}`, "auth_failed");
    }
    const session: TradovateSession = {
      accessToken: token,
      expiresAt:
        typeof res["expirationTime"] === "string"
          ? res["expirationTime"]
          : new Date(Date.now() + 55 * 60_000).toISOString(),
      userId: Number(res["userId"] ?? 0),
      hasLive: res["hasLive"] === true,
    };
    this.vault.session = session;
    if (this.onSession) await this.onSession(session);
    return token;
  }

  get session(): TradovateSession | undefined {
    return this.vault.session;
  }

  /**
   * One HTTP call. Handles Tradovate's p-ticket penalty flow (wait p-time then
   * replay the identical request once) and never logs credentials.
   */
  private async raw(
    method: "GET" | "POST",
    path: string,
    body?: Json,
    auth = true,
    retryTicket = true,
  ): Promise<Json> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers["Authorization"] = `Bearer ${await this.token()}`;
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new BrokerError("Could not reach Tradovate.", "disconnected");
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      json = { errorText: text.slice(0, 200) };
    }

    const ticket = json["p-ticket"];
    if (typeof ticket === "string" && retryTicket) {
      if (json["p-captcha"]) {
        throw new BrokerError(
          "Tradovate has rate-limited this login and requires a captcha. Sign in at tradovate.com, then try again in about an hour.",
          "rate_limited",
        );
      }
      const wait = Math.min(Number(json["p-time"] ?? 1), 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.raw(method, path, { ...(body ?? {}), "p-ticket": ticket }, auth, false);
    }

    if (res.status === 401) {
      throw new BrokerError(
        "Tradovate rejected the session (401). Reconnect the broker.",
        "auth_failed",
      );
    }
    if (res.status === 429) {
      throw new BrokerError("Tradovate rate limit hit — slow down.", "rate_limited");
    }
    if (!res.ok) {
      const reason =
        typeof json["errorText"] === "string"
          ? json["errorText"]
          : `HTTP ${res.status}`;
      throw new BrokerError(reason, "unknown", `${method} ${path}`);
    }
    if (typeof json["errorText"] === "string" && json["errorText"]) {
      throw new BrokerError(json["errorText"], "rejected", `${method} ${path}`);
    }
    return json;
  }

  private async list(path: string): Promise<Json[]> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
    };
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, { headers });
    } catch {
      throw new BrokerError("Could not reach Tradovate.", "disconnected");
    }
    if (res.status === 401)
      throw new BrokerError("Tradovate session expired.", "auth_failed");
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed as Json[];
      const err = (parsed as Json)["errorText"];
      throw new BrokerError(
        typeof err === "string" ? err : "Unexpected Tradovate response.",
      );
    } catch (e) {
      if (e instanceof BrokerError) throw e;
      throw new BrokerError("Unexpected Tradovate response.");
    }
  }

  // ------------------------------------------------------------- entities

  async accounts(): Promise<Json[]> {
    return this.list("/account/list");
  }

  async cashBalance(accountId: number): Promise<Json | null> {
    try {
      return await this.raw("POST", "/cashBalance/getcashbalancesnapshot", {
        accountId,
      });
    } catch {
      return null;
    }
  }

  async orders(): Promise<Json[]> {
    return this.list("/order/list");
  }

  async positions(): Promise<Json[]> {
    return this.list("/position/list");
  }

  async fills(): Promise<Json[]> {
    return this.list("/fill/list");
  }

  async contractById(id: number): Promise<{ id: number; name: string } | null> {
    for (const [, v] of this.contractCache) if (v.id === id) return v;
    try {
      const c = await this.raw("GET", `/contract/item?id=${id}`);
      const name = typeof c["name"] === "string" ? c["name"] : null;
      if (!name) return null;
      const entry = { id, name };
      this.contractCache.set(name.toUpperCase(), entry);
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * Resolves a Signal Goat symbol to a real tradable Tradovate contract.
   * "NQZ5" is used as-is; a bare root like "NQ" resolves to the front month via
   * contract/suggest so an order can never land on the wrong contract silently.
   */
  async contract(symbol: string): Promise<{ id: number; name: string }> {
    const key = symbol.toUpperCase();
    const cached = this.contractCache.get(key);
    if (cached) return cached;

    const exact = await this.raw("GET", `/contract/find?name=${encodeURIComponent(key)}`)
      .then((c) => c)
      .catch(() => null);
    if (exact && typeof exact["id"] === "number" && typeof exact["name"] === "string") {
      const entry = { id: exact["id"], name: exact["name"] };
      this.contractCache.set(key, entry);
      return entry;
    }

    const suggestions = await this.list(
      `/contract/suggest?t=${encodeURIComponent(key)}&l=10`,
    ).catch(() => [] as Json[]);
    const candidates = suggestions
      .filter(
        (c) =>
          typeof c["name"] === "string" &&
          (c["name"] as string).toUpperCase().startsWith(key),
      )
      .sort((a, b) =>
        String(a["name"]).localeCompare(String(b["name"])),
      );
    const front =
      candidates.find((c) => c["status"] === "Active") ?? candidates[0] ?? null;
    if (!front || typeof front["id"] !== "number")
      throw new BrokerError(
        `${symbol} is not a tradable Tradovate contract on this account.`,
        "instrument_unavailable",
      );
    const entry = { id: front["id"], name: String(front["name"]) };
    this.contractCache.set(key, entry);
    return entry;
  }

  async placeOrder(payload: Json): Promise<Json> {
    return this.raw("POST", "/order/placeOrder", payload);
  }

  async placeOSO(payload: Json): Promise<Json> {
    return this.raw("POST", "/order/placeOSO", payload);
  }

  async modifyOrder(payload: Json): Promise<Json> {
    return this.raw("POST", "/order/modifyOrder", payload);
  }

  async cancelOrder(payload: Json): Promise<Json> {
    return this.raw("POST", "/order/cancelOrder", payload);
  }

  async liquidatePosition(payload: Json): Promise<Json> {
    return this.raw("POST", "/order/liquidatePosition", payload);
  }
}

/** Builds the normalized adapter the OMS talks to. */
export function tradovateAdapter(
  client: TradovateClient,
  env: Exclude<BrokerEnvironment, "paper">,
): BrokerAdapter {
  const contractNameCache = new Map<number, string>();

  const nameFor = async (contractId: unknown): Promise<string> => {
    const id = Number(contractId);
    if (!Number.isFinite(id)) return "UNKNOWN";
    const hit = contractNameCache.get(id);
    if (hit) return hit;
    const c = await client.contractById(id);
    const name = c?.name ?? `#${id}`;
    contractNameCache.set(id, name);
    return name;
  };

  const accountFromJson = async (a: Json): Promise<BrokerAccount> => {
    const id = Number(a["id"]);
    const cash = await client.cashBalance(id);
    return {
      brokerAccountId: String(id),
      accountNumber: String(a["name"] ?? id),
      label: `Tradovate ${String(a["name"] ?? id)}`,
      environment: env,
      currency: "USD",
      balance: cash ? num(cash["totalCashValue"]) : null,
      equity: cash
        ? num(cash["totalCashValue"]) !== null
          ? Number(cash["totalCashValue"]) + Number(cash["openPnL"] ?? 0)
          : null
        : null,
      buyingPower: cash ? num(cash["totalMarginBalance"]) : null,
      realizedPnl: cash ? num(cash["realizedPnL"]) : null,
      openPnl: cash ? num(cash["openPnL"]) : null,
      accountSpec: String(a["name"] ?? ""),
    };
  };

  const orderFromJson = async (o: Json): Promise<BrokerOrder> => ({
    brokerOrderId: String(o["id"]),
    clientTag:
      typeof o["customTag50"] === "string" ? (o["customTag50"] as string) : null,
    symbol: await nameFor(o["contractId"]),
    side: sideOf(o["action"] as string),
    type: backOrderType(o["orderType"] as string),
    qty: Number(o["orderQty"] ?? o["qty"] ?? 0),
    filledQty: Number(o["filledQty"] ?? 0),
    limitPrice: num(o["price"]),
    stopPrice: num(o["stopPrice"]),
    avgFillPrice: num(o["avgPx"]),
    status: mapStatus(o["ordStatus"] as string),
    brokerStatus: String(o["ordStatus"] ?? "Unknown"),
    rejectReason: typeof o["text"] === "string" ? (o["text"] as string) : null,
    createdAt: String(o["timestamp"] ?? new Date().toISOString()),
  });

  return {
    id: "tradovate",
    environment: env,
    supports: {
      market: true,
      limit: true,
      stop: true,
      stopLimit: true,
      brackets: true, // placeOSO
      modify: true,
      reverse: false, // no native reverse; must be two OMS legs
      liquidate: true,
      streaming: false, // user-sync websocket is not used from serverless yet
    },

    async listAccounts() {
      const rows = await client.accounts();
      return Promise.all(rows.map(accountFromJson));
    },

    async getAccount(brokerAccountId) {
      const rows = await client.accounts();
      const hit = rows.find((a) => String(a["id"]) === brokerAccountId);
      if (!hit)
        throw new BrokerError(
          "That Tradovate account is no longer available.",
          "account_unavailable",
        );
      return accountFromJson(hit);
    },

    async listOrders(brokerAccountId) {
      const rows = await client.orders();
      const mine = rows.filter((o) => String(o["accountId"]) === brokerAccountId);
      return Promise.all(mine.map(orderFromJson));
    },

    async listPositions(brokerAccountId) {
      const rows = await client.positions();
      const mine = rows.filter(
        (p) => String(p["accountId"]) === brokerAccountId && Number(p["netPos"] ?? 0) !== 0,
      );
      const out: BrokerPosition[] = [];
      for (const p of mine) {
        const net = Number(p["netPos"] ?? 0);
        const qty = Math.abs(net);
        const price = num(p["netPrice"]) ?? num(p["avgPrice"]) ?? 0;
        out.push({
          brokerPositionId: String(p["id"]),
          symbol: await nameFor(p["contractId"]),
          side: net >= 0 ? "buy" : "sell",
          qty,
          avgEntry: price,
          realizedPnl: num(p["realizedPnl"]),
        });
      }
      return out;
    },

    async listExecutions(brokerAccountId) {
      const rows = await client.fills();
      const mine = rows.filter((f) => String(f["accountId"]) === brokerAccountId);
      const out: BrokerExecution[] = [];
      for (const f of mine.slice(0, 200)) {
        out.push({
          brokerExecutionId: String(f["id"]),
          brokerOrderId: f["orderId"] ? String(f["orderId"]) : null,
          symbol: await nameFor(f["contractId"]),
          side: Number(f["qty"] ?? 0) >= 0 ? "buy" : "sell",
          qty: Math.abs(Number(f["qty"] ?? 0)),
          price: Number(f["price"] ?? 0),
          commission: 0,
          executedAt: String(f["timestamp"] ?? new Date().toISOString()),
        });
      }
      return out;
    },

    async resolveContract(symbol): Promise<BrokerContract | null> {
      try {
        const c = await client.contract(symbol);
        return {
          brokerSymbol: c.name,
          name: c.name,
          exchange: null,
          tickSize: null,
          tickValue: null,
          expiration: null,
        };
      } catch {
        return null;
      }
    },

    async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
      const contract = await client.contract(req.symbol);
      const base: Json = {
        accountId: Number(req.brokerAccountId),
        accountSpec: req.accountSpec ?? undefined,
        symbol: contract.name,
        action: action(req.side),
        orderQty: req.qty,
        orderType: mapOrderType(req.type),
        timeInForce: (req.timeInForce ?? "gtc").toUpperCase() === "DAY" ? "Day" : "GTC",
        isAutomated: true,
        customTag50: req.clientTag,
        clOrdId: req.clientTag,
      };
      if (req.limitPrice !== undefined) base["price"] = req.limitPrice;
      if (req.stopPrice !== undefined) base["stopPrice"] = req.stopPrice;

      const brackets: Json[] = [];
      const exit = req.side === "buy" ? "Sell" : "Buy";
      if (req.stopLoss !== undefined)
        brackets.push({ action: exit, orderType: "Stop", stopPrice: req.stopLoss });
      if (req.takeProfit !== undefined)
        brackets.push({ action: exit, orderType: "Limit", price: req.takeProfit });

      let res: Json;
      if (brackets.length) {
        const oso: Json = { ...base };
        if (brackets[0]) oso["bracket1"] = brackets[0];
        if (brackets[1]) oso["bracket2"] = brackets[1];
        res = await client.placeOSO(oso);
      } else {
        res = await client.placeOrder(base);
      }

      const failure = res["failureReason"] ?? res["failureText"];
      if (failure) {
        throw new BrokerError(
          String(res["failureText"] ?? failure),
          "rejected",
          String(res["failureReason"] ?? ""),
        );
      }
      const orderId = res["orderId"] ?? (res["order"] as Json | undefined)?.["id"];
      if (!orderId)
        throw new BrokerError("Tradovate did not return an order id.", "rejected");
      return {
        brokerOrderId: String(orderId),
        status: "accepted",
        brokerStatus: "Submitted",
        rejectReason: null,
      };
    },

    async findOrderByClientTag(brokerAccountId, clientTag) {
      const rows = await client.orders();
      const hit = rows.find(
        (o) =>
          String(o["accountId"]) === brokerAccountId &&
          (o["customTag50"] === clientTag || o["clOrdId"] === clientTag),
      );
      return hit ? orderFromJson(hit) : null;
    },

    async modifyOrder(req) {
      const payload: Json = { orderId: Number(req.brokerOrderId), isAutomated: true };
      if (req.qty !== undefined) payload["orderQty"] = req.qty;
      if (req.limitPrice !== undefined) payload["price"] = req.limitPrice;
      if (req.stopPrice !== undefined) payload["stopPrice"] = req.stopPrice;
      const res = await client.modifyOrder(payload);
      if (res["failureReason"])
        throw new BrokerError(
          String(res["failureText"] ?? res["failureReason"]),
          "rejected",
        );
    },

    async cancelOrder(brokerOrderId) {
      const res = await client.cancelOrder({
        orderId: Number(brokerOrderId),
        isAutomated: true,
      });
      if (res["failureReason"])
        throw new BrokerError(
          String(res["failureText"] ?? res["failureReason"]),
          "rejected",
        );
    },

    async liquidatePosition(req) {
      const contract = await client.contract(req.symbol);
      const res = await client.liquidatePosition({
        accountId: Number(req.brokerAccountId),
        contractId: contract.id,
        admin: false,
      });
      if (res["failureReason"])
        throw new BrokerError(
          String(res["failureText"] ?? res["failureReason"]),
          "rejected",
        );
    },
  };
}
