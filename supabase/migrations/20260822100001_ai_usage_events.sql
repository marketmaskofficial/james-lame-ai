-- UI-8: durable AI usage accounting foundation (accounting only -- no
-- limits/credits are enforced from this table yet). Records one row per
-- AI-generation call across every AI-backed path in the app: Chart
-- Studio's AI Builder (build/modify/fix-error via buildProject in
-- src/lib/project.functions.ts), the paste-a-script translate/repair flows
-- (src/lib/sgscript.functions.ts), the standalone indicator analyzer
-- (src/lib/analyze.functions.ts), and the legacy /api/generate route.
CREATE TABLE public.ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('build', 'modify', 'fix_error', 'translate', 'repair', 'analyze', 'generate')),
  success BOOLEAN NOT NULL,
  model TEXT,
  error_message TEXT,
  -- Token counts are only ever populated when the model provider's own
  -- response actually reports them (see the `ai` SDK's `usage` field) --
  -- left NULL rather than estimated/fabricated when a provider omits them.
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_events_user_id_created_at_idx ON public.ai_usage_events (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Users can see their own usage (for the Account -> Usage panel) and can
-- insert their own events (the app writes usage rows using the caller's own
-- authenticated/RLS-scoped Supabase client, never the service role, for
-- every path that has one available). No UPDATE/DELETE policy: usage
-- accounting rows are append-only from the client's perspective.
CREATE POLICY "Users can view own AI usage" ON public.ai_usage_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own AI usage" ON public.ai_usage_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
