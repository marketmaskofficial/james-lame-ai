-- Saved backtest runs: enough metadata bundled with each result to identify
-- and compare it later (e.g. "1R vs 2R vs 3R") without re-running anything.
-- Stores the exact SGScript source alongside the settings and full report,
-- since a strategy's risk/target parameters are usually baked into the
-- script itself, not just the sizing/commission settings.
CREATE TABLE public.backtest_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  strategy_name TEXT NOT NULL,
  code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  settings JSONB NOT NULL,
  report JSONB NOT NULL,
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.backtest_runs TO authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can save their own backtest runs" ON public.backtest_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read their own backtest runs" ON public.backtest_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own backtest runs" ON public.backtest_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX backtest_runs_user_created_idx ON public.backtest_runs (user_id, created_at DESC);
