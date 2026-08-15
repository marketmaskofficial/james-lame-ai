CREATE TABLE public.chart_drawings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  layout TEXT NOT NULL DEFAULT 'default',
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  drawings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, layout, symbol, timeframe)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_drawings TO authenticated;
GRANT ALL ON public.chart_drawings TO service_role;
ALTER TABLE public.chart_drawings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own chart drawings" ON public.chart_drawings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER chart_drawings_set_updated_at BEFORE UPDATE ON public.chart_drawings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.trading_accounts(id) ON DELETE SET NULL,
  position_id UUID REFERENCES public.trade_positions(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT,
  session TEXT,
  side TEXT,
  qty NUMERIC,
  entry_price NUMERIC,
  exit_price NUMERIC,
  realized_pnl NUMERIC,
  indicator_name TEXT,
  signal_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  chart_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT ALL ON public.journal_entries TO service_role;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own journal entries" ON public.journal_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER journal_entries_set_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX journal_entries_user_created_idx ON public.journal_entries (user_id, created_at DESC);