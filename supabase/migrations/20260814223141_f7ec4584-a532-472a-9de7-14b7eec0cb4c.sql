CREATE TABLE public.indicators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled indicator',
  code TEXT NOT NULL DEFAULT '',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_overlay BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX indicators_user_updated_idx ON public.indicators (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicators TO authenticated;
GRANT ALL ON public.indicators TO service_role;

ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own indicators"
ON public.indicators FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_indicators_updated_at
BEFORE UPDATE ON public.indicators
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();