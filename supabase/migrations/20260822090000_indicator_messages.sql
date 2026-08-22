-- UI-5c: persistent AI Builder conversation history, scoped to an indicator
-- project (public.indicators.id) rather than the legacy chat page's
-- public.scripts.id, so each AI-built indicator has its own independent
-- conversation that survives refresh and sign-out/sign-in for signed-in
-- users. Purely additive: a new table, no existing table touched.
--
-- NOT applied against the live/shared Supabase project as part of this
-- change — pending explicit approval, same rule as any other live schema
-- change (see 20260820120000_alerts_crossing_conditions.sql for precedent:
-- written here, held for approval, applied later by the user directly).
-- The app degrades gracefully if this table doesn't exist yet: conversation
-- history simply doesn't persist across reloads/sign-outs until this is
-- applied, but Build/Modify/Explain/Fix Error/Add to Chart/versioning all
-- keep working exactly as before regardless.

CREATE TABLE public.indicator_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  indicator_id uuid NOT NULL REFERENCES public.indicators(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'ai')),
  kind text NOT NULL DEFAULT 'build' CHECK (kind IN ('build', 'explain')),
  content text NOT NULL,
  status text CHECK (status IN ('success', 'warning', 'error')),
  issues integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.indicator_messages TO authenticated;
GRANT ALL ON public.indicator_messages TO service_role;

ALTER TABLE public.indicator_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own indicator messages"
  ON public.indicator_messages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX indicator_messages_indicator_created_idx
  ON public.indicator_messages (indicator_id, created_at);
