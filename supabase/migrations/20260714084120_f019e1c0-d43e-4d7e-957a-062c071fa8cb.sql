CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  condition text NOT NULL CHECK (condition IN ('above','below')),
  threshold numeric NOT NULL CHECK (threshold > 0),
  active boolean NOT NULL DEFAULT true,
  cooldown_seconds integer NOT NULL DEFAULT 3600,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own alerts"
  ON public.alerts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER alerts_set_updated_at
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX alerts_active_symbol_idx ON public.alerts (active, symbol) WHERE active = true;
CREATE INDEX alerts_user_idx ON public.alerts (user_id, created_at DESC);


CREATE TABLE public.alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  condition text NOT NULL,
  threshold numeric NOT NULL,
  triggered_price numeric NOT NULL,
  read boolean NOT NULL DEFAULT false,
  triggered_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.alert_notifications TO authenticated;
GRANT ALL ON public.alert_notifications TO service_role;

ALTER TABLE public.alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications"
  ON public.alert_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
  ON public.alert_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own notifications"
  ON public.alert_notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX alert_notifications_user_idx
  ON public.alert_notifications (user_id, triggered_at DESC);