-- UI-8: first-run onboarding completion flag.
-- Lets Chart Studio show the 4-step onboarding flow exactly once per user
-- instead of every session. Defaults to false so every EXISTING user (who
-- has obviously already "onboarded" themselves informally) would see it
-- once after this migration lands -- the application code additionally
-- fails open on any read error, so a missing/unreadable column never blocks
-- an existing paid user from reaching Studio.
ALTER TABLE public.profiles
  ADD COLUMN has_onboarded BOOLEAN NOT NULL DEFAULT false;
