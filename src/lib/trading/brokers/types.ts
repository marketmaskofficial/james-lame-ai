/**
 * Broker interface.
 *
 * The Signal Goat OMS speaks only this vocabulary. Adapters (paper today,
 * Tradovate now, others later) translate it into broker-specific requests and
 * translate broker responses back into these normalized shapes. No
 * broker-specific field name is allowed to leak past an adapter.
 */

import type { OrderSide, OrderStatus, OrderType } from "../types";

export type BrokerEnvironment = "paper" | "demo" | "live";

export type BrokerHealth =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "error";

export type BrokerAccount = {
  /** Broker's own account identifier, as a string. */
  brokerAccountId: string;
  /** Human account number shown to the trader, e.g. "DEMO1234567". */
  accountNumber: string;
  label: string;
  environment: BrokerEnvironment;
  currency: string;
  /** Values the broker actually supplies. `null` means "not supplied". */
  balance: number | null;
  equity: number | null;
  buyingPower: number | null;
  realizedPnl: number | null;
  openPnl: number | null;
  /** Broker-specific routing hint (Tradovate: accountSpec). */
  accountSpec?: string;
};

export type BrokerOrder = {
  brokerOrderId: string;
  clientTag: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  filledQty: number;
  limitPrice: number | null;
  stopPrice: number | null;
  avgFillPrice: number | null;
  status: OrderStatus;
  /** Raw broker status text, kept for the audit log and UI tooltips. */
  brokerStatus: string;
  rejectReason: string | null;
  createdAt: string;
};

export type BrokerPosition = {
  brokerPositionId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  avgEntry: number;
  realizedPnl: number | null;
};

export type BrokerExecution = {
  brokerExecutionId: string;
  brokerOrderId: string | null;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  commission: number;
  executedAt: string;
};

export type PlaceOrderRequest = {
  brokerAccountId: string;
  accountSpec?: string | undefined;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number | undefined;
  stopPrice?: number | undefined;
  /** Idempotency key — replayed on retry so a broker never double-fills. */
  clientTag: string;
  stopLoss?: number | undefined;
  takeProfit?: number | undefined;
  timeInForce?: "day" | "gtc" | "ioc" | "fok" | undefined;
};

export type PlaceOrderResult = {
  brokerOrderId: string;
  status: OrderStatus;
  brokerStatus: string;
  rejectReason: string | null;
};

/** Every adapter method throws BrokerError with a trader-readable message. */
export class BrokerError extends Error {
  code:
    | "auth_failed"
    | "disconnected"
    | "rejected"
    | "invalid_qty"
    | "invalid_price"
    | "account_unavailable"
    | "instrument_unavailable"
    | "rate_limited"
    | "unsupported"
    | "unknown";
  detail: string | undefined;
  constructor(
    message: string,
    code: BrokerError["code"] = "unknown",
    detail?: string,
  ) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export type BrokerContract = {
  brokerSymbol: string;
  name: string;
  exchange: string | null;
  tickSize: number | null;
  tickValue: number | null;
  expiration: string | null;
};

export type BrokerAdapter = {
  id: string;
  environment: BrokerEnvironment;
  /** Feature flags — the UI disables anything an adapter cannot honour. */
  supports: {
    market: boolean;
    limit: boolean;
    stop: boolean;
    stopLimit: boolean;
    brackets: boolean;
    modify: boolean;
    reverse: boolean;
    liquidate: boolean;
    streaming: boolean;
  };
  listAccounts(): Promise<BrokerAccount[]>;
  getAccount(brokerAccountId: string): Promise<BrokerAccount>;
  listOrders(brokerAccountId: string): Promise<BrokerOrder[]>;
  listPositions(brokerAccountId: string): Promise<BrokerPosition[]>;
  listExecutions(brokerAccountId: string): Promise<BrokerExecution[]>;
  resolveContract(symbol: string): Promise<BrokerContract | null>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  /** Used after a dropped connection to find an order by its client tag. */
  findOrderByClientTag(
    brokerAccountId: string,
    clientTag: string,
  ): Promise<BrokerOrder | null>;
  modifyOrder(req: {
    brokerOrderId: string;
    qty?: number | undefined;
    limitPrice?: number | undefined;
    stopPrice?: number | undefined;
  }): Promise<void>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  liquidatePosition(req: {
    brokerAccountId: string;
    accountSpec?: string | undefined;
    symbol: string;
  }): Promise<void>;
};
