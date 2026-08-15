ALTER TABLE public.scripts ADD COLUMN is_public boolean NOT NULL DEFAULT false;

CREATE INDEX scripts_is_public_idx ON public.scripts (is_public) WHERE is_public = true;

-- Allow anonymous read of public scripts (limited columns projected in the fetcher).
GRANT SELECT ON public.scripts TO anon;
GRANT SELECT ON public.messages TO anon;

CREATE POLICY "Public scripts are viewable by anyone"
  ON public.scripts FOR SELECT
  TO anon
  USING (is_public = true);

CREATE POLICY "Public script messages are viewable by anyone"
  ON public.messages FOR SELECT
  TO anon
  USING (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.is_public = true));

-- Owners must still be able to SELECT their own (even private) scripts explicitly.
CREATE POLICY "Owners can view own scripts"
  ON public.scripts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);