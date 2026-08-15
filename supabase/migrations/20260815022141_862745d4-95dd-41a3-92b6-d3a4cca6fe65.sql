CREATE TABLE public.broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker text NOT NULL DEFAULT 'tradovate',
  environment text NOT NULL DEFAULT 'demo',
  label text NOT NULL DEFAULT 'Tradovate Demo',
  status text NOT NULL DEFAULT 'disconnected',
  credentials_encrypted text,
  broker_user_id text,
  last_connected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker, environment)
);

GRANT SELECT (id, user_id, broker, environment, label, status, broker_user_id, last_connected_at, last_error, created_at, updated_at)
  ON public.broker_connections TO authenticated;
GRANT ALL ON public.broker_connections TO service_role;
ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own broker connections" ON public.broker_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER broker_connections_set_updated_at
  BEFORE UPDATE ON public.broker_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.broker_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker text NOT NULL,
  environment text NOT NULL DEFAULT 'demo',
  account_id uuid,
  broker_account_id text,
  action text NOT NULL,
  order_id uuid,
  broker_order_id text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL DEFAULT 'ok',
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.broker_audit_log TO authenticated;
GRANT ALL ON public.broker_audit_log TO service_role;
ALTER TABLE public.broker_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own broker audit log" ON public.broker_audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX broker_audit_log_user_created_idx ON public.broker_audit_log (user_id, created_at DESC);

ALTER TABLE public.trading_accounts
  ADD COLUMN connection_id uuid REFERENCES public.broker_connections(id) ON DELETE SET NULL,
  ADD COLUMN broker_account_id text,
  ADD COLUMN broker_account_spec text,
  ADD COLUMN buying_power numeric,
  ADD COLUMN equity numeric;

CREATE UNIQUE INDEX trading_accounts_broker_account_idx
  ON public.trading_accounts (user_id, connection_id, broker_account_id)
  WHERE connection_id IS NOT NULL;

ALTER TABLE public.trade_orders
  ADD COLUMN broker_order_id text,
  ADD COLUMN client_tag text,
  ADD COLUMN broker_status text;

CREATE UNIQUE INDEX trade_orders_client_tag_idx
  ON public.trade_orders (account_id, client_tag)
  WHERE client_tag IS NOT NULL;

ALTER TABLE public.trade_positions
  ADD COLUMN broker_position_id text;