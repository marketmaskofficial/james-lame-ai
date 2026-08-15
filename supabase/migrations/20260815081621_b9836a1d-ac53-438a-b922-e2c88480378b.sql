-- One open position per account+symbol, enforced by the database so
-- concurrent fills can never create duplicate position rows.
DELETE FROM public.trade_positions a
USING public.trade_positions b
WHERE a.status = 'open' AND b.status = 'open'
  AND a.account_id = b.account_id AND a.symbol = b.symbol
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS trade_positions_one_open_per_symbol
  ON public.trade_positions (account_id, symbol)
  WHERE status = 'open';

-- Idempotency key for manual tickets: identical rapid clicks collide here
-- instead of both being booked.
CREATE UNIQUE INDEX IF NOT EXISTS trade_orders_client_tag_unique
  ON public.trade_orders (user_id, client_tag)
  WHERE client_tag IS NOT NULL;