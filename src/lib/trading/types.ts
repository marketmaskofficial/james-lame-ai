/** Shared trading types for the Signal Goat OMS (paper engine + future brokers). */

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderPurpose = "entry" | "stop" | "target" | "exit";

/** Real lifecycle states — never set "filled" just because a button was clicked. */
export type OrderStatus =
  | "created"
  | "submitting"
  | "accepted"
  | "working"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

export type Environment = "paper" | "live";

export type TradingAccount = {
  id: string;
  broker: string;
  label: string;
  account_number: string;
  environment: Environment;
  currency: string;
  starting_balance: number;
  balance: number;
  realized_pnl: number;
  commission_per_unit: number;
  status: string;
  /** Set when the account is mirrored from a connected broker. */
  connection_id?: string | null;
  broker_account_id?: string | null;
  broker_account_spec?: string | null;
  buying_power?: number | null;
  equity?: number | null;
};

export type OrderRow = {
  id: string;
  account_id: string;
  position_id: string | null;
  parent_order_id: string | null;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  purpose: OrderPurpose;
  qty: number;
  filled_qty: number;
  limit_price: number | null;
  stop_price: number | null;
  avg_fill_price: number | null;
  status: OrderStatus;
  reduce_only: boolean;
  reject_reason: string | null;
  bracket_stop: number | null;
  bracket_target: number | null;
  indicator_name: string | null;
  timeframe: string | null;
  created_at: string;
  updated_at: string;
};

export type PositionRow = {
  id: string;
  account_id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  avg_entry: number;
  realized_pnl: number;
  status: "open" | "closed";
  stop_price: number | null;
  target_price: number | null;
  indicator_name: string | null;
  indicator_id: string | null;
  indicator_version: number | null;
  signal_id: string | null;
  timeframe: string | null;
  opened_at: string;
  closed_at: string | null;
};

export type ExecutionRow = {
  id: string;
  order_id: string | null;
  position_id: string | null;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  commission: number;
  realized_pnl: number;
  executed_at: string;
};

export type AccountSnapshot = {
  account: TradingAccount;
  positions: Array<PositionRow & { last: number | null; unrealized: number }>;
  orders: OrderRow[];
  history: ExecutionRow[];
  openPnl: number;
  /** Realized P&L booked since UTC midnight, net of commission. */
  dailyPnl: number;

  /** Documented simulation model shown in the UI so fills are never sold as real. */
  simulation: string;
};
