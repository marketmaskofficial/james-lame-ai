-- Saved workspace layouts (UI-4d): named, user-customized Chart Studio
-- workspace trees, so a widget layout customized on one device (which
-- widgets are open in the sidebar/dock and in what order) can be named,
-- saved, and later synced across devices for a signed-in user. Local
-- storage remains the source of truth while signed out; this table is
-- where a signed-in user's named layouts live once the sign-in migration
-- path (a later phase) wires up to it.
CREATE TABLE public.workspace_layouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  layout JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_layouts TO authenticated;
GRANT ALL ON public.workspace_layouts TO service_role;
ALTER TABLE public.workspace_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can save their own workspace layouts" ON public.workspace_layouts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read their own workspace layouts" ON public.workspace_layouts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own workspace layouts" ON public.workspace_layouts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own workspace layouts" ON public.workspace_layouts FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX workspace_layouts_user_created_idx ON public.workspace_layouts (user_id, created_at DESC);
