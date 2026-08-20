-- UI-4h-4: adds two new condition values ("crosses_above", "crosses_below")
-- to public.alerts so a real, edge-triggered crossing alert (fires only on
-- the transition through the threshold, not immediately if already past it
-- at creation time) can be distinguished from the existing level conditions
-- ("above"/"below", which fire whenever the price is currently past the
-- threshold). Purely additive: existing rows are all "above"/"below" and
-- remain valid; no column added, no data touched.
--
-- NOT applied against the live/shared Supabase project as part of this
-- change — pending explicit approval, same as any other live schema change.
-- The app code does not yet expose "crosses_above"/"crosses_below" as
-- selectable options (see AlertsSidePanel.tsx), specifically to avoid
-- shipping a selector that would fail against the still-unmigrated live
-- CHECK constraint. Once this migration is applied, wiring the two new
-- condition values into the UI and into check-alerts.ts's evaluation loop
-- (comparing the previous completed candle's close, fetched from the
-- existing /api/klines endpoint, against the threshold to determine which
-- side of it price was already on, rather than firing immediately) is a
-- small follow-up, not a re-architecture.

ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_condition_check;

ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_condition_check
  CHECK (condition IN ('above', 'below', 'crosses_above', 'crosses_below'));
