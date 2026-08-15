CREATE TABLE public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('ai_wrong_result','indicator_issue','chart_issue','backtest_issue','trading_issue','bug','feature_request')),
  message text not null check (char_length(message) between 1 and 4000),
  page text,
  symbol text,
  timeframe text,
  project_id text,
  app_version text,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users create own feedback" ON public.feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users view own feedback" ON public.feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX feedback_created_at_idx ON public.feedback (created_at DESC);