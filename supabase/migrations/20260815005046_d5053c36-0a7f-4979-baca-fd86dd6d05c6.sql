ALTER TABLE public.trade_orders
  ADD COLUMN bracket_stop numeric,
  ADD COLUMN bracket_target numeric;