ALTER TABLE public.indicators
  ADD COLUMN IF NOT EXISTS spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pine text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'indicator',
  ADD COLUMN IF NOT EXISTS symbol text,
  ADD COLUMN IF NOT EXISTS timeframe text,
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.indicator_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  indicator_id uuid NOT NULL REFERENCES public.indicators(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL DEFAULT 'Untitled indicator',
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  pine text NOT NULL DEFAULT '',
  code text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_overlay boolean NOT NULL DEFAULT true,
  changelog text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (indicator_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indicator_versions TO authenticated;
GRANT ALL ON public.indicator_versions TO service_role;

ALTER TABLE public.indicator_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own indicator versions"
  ON public.indicator_versions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS indicator_versions_indicator_idx
  ON public.indicator_versions (indicator_id, version DESC);

INSERT INTO public.indicator_versions (indicator_id, user_id, version, name, code, settings, is_overlay, changelog)
SELECT i.id, i.user_id, 1, i.name, i.code, i.settings, i.is_overlay, 'Initial version'
FROM public.indicators i
WHERE NOT EXISTS (
  SELECT 1 FROM public.indicator_versions v WHERE v.indicator_id = i.id
);