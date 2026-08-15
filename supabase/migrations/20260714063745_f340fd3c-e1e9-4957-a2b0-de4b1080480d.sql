CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.user_id = auth.uid()));

CREATE POLICY "Owners can insert messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.user_id = auth.uid()));

CREATE POLICY "Owners can delete messages"
  ON public.messages FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scripts s WHERE s.id = script_id AND s.user_id = auth.uid()));

CREATE INDEX messages_script_id_created_at_idx ON public.messages (script_id, created_at);

-- Allow scripts.code to be empty for freshly-created chat threads before first assistant reply.
ALTER TABLE public.scripts ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.scripts ALTER COLUMN code SET DEFAULT '';
ALTER TABLE public.scripts ALTER COLUMN prompt DROP NOT NULL;
ALTER TABLE public.scripts ALTER COLUMN prompt SET DEFAULT '';