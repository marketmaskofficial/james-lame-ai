-- Trading accounts (paper first, broker adapters later)
CREATE TABLE public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null default 'signalgoat',
  label text not null default 'Paper account',
  account_number text not null default 'PAPER-1',
  environment text not null default 'paper',
  currency text not null default 'USD',
  starting_balance numeric not null default 100000,
  balance numeric not null default 100000,
  realized_pnl numeric not null default 0,
  commission_per_unit numeric not null default 0,
  is_default boolean not null default true,
  status text not null default 'connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.trading_accounts TO authenticated;
GRANT ALL ON public.trading_accounts TO service_role;
ALTER TABLE public.trading_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own trading accounts" ON public.trading_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trading_accounts_set_updated_at BEFORE UPDATE ON public.trading_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.trade_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  symbol text not null,
  side text not null,
  qty numeric not null default 0,
  avg_entry numeric not null default 0,
  realized_pnl numeric not null default 0,
  status text not null default 'open',
  stop_price numeric,
  target_price numeric,
  indicator_id uuid,
  indicator_version integer,
  indicator_name text,
  signal_id text,
  timeframe text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.trade_positions TO authenticated;
GRANT ALL ON public.trade_positions TO service_role;
ALTER TABLE public.trade_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own positions" ON public.trade_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trade_positions_set_updated_at BEFORE UPDATE ON public.trade_positions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.trade_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  position_id uuid references public.trade_positions(id) on delete set null,
  parent_order_id uuid references public.trade_orders(id) on delete set null,
  symbol text not null,
  side text not null,
  order_type text not null,
  purpose text not null default 'entry',
  qty numeric not null,
  filled_qty numeric not null default 0,
  limit_price numeric,
  stop_price numeric,
  avg_fill_price numeric,
  status text not null default 'created',
  reduce_only boolean not null default false,
  time_in_force text not null default 'gtc',
  reject_reason text,
  indicator_id uuid,
  indicator_version integer,
  indicator_name text,
  signal_id text,
  timeframe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.trade_orders TO authenticated;
GRANT ALL ON public.trade_orders TO service_role;
ALTER TABLE public.trade_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own orders" ON public.trade_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trade_orders_set_updated_at BEFORE UPDATE ON public.trade_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.trade_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  order_id uuid references public.trade_orders(id) on delete set null,
  position_id uuid references public.trade_positions(id) on delete set null,
  symbol text not null,
  side text not null,
  qty numeric not null,
  price numeric not null,
  commission numeric not null default 0,
  realized_pnl numeric not null default 0,
  liquidity text not null default 'simulated',
  executed_at timestamptz not null default now()
);
GRANT SELECT ON public.trade_executions TO authenticated;
GRANT ALL ON public.trade_executions TO service_role;
ALTER TABLE public.trade_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own executions" ON public.trade_executions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.risk_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_risk_per_trade numeric,
  max_daily_loss numeric,
  max_position_size numeric,
  max_trades_per_day integer,
  max_open_positions integer,
  require_stop_loss boolean not null default false,
  confirm_live_orders boolean not null default true,
  disable_after_daily_loss boolean not null default true,
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.risk_settings TO authenticated;
GRANT ALL ON public.risk_settings TO service_role;
ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own risk settings" ON public.risk_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER risk_settings_set_updated_at BEFORE UPDATE ON public.risk_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_trade_orders_account_status ON public.trade_orders(account_id, status);
CREATE INDEX idx_trade_positions_account_status ON public.trade_positions(account_id, status);
CREATE INDEX idx_trade_executions_account ON public.trade_executions(account_id, executed_at DESC);