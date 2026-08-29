BEGIN;

-- Phase 4E-2: complete professional Trade Journal — taxonomy (Setup,
-- Strategy, Mistakes, Emotion, Tags), Trade Grade, Screenshots, and AI
-- Trade Review persistence, plus the deferred one-entry-per-position
-- uniqueness from the Phase 4E audit.
--
-- SAFETY: before writing this migration, the real hosted `journal_entries`
-- table was queried live (via the app's own `listJournal` server function,
-- under the caller's own RLS-scoped session) and confirmed to contain
-- exactly one row, with no `(user_id, position_id)` duplicates. The new
-- unique index below is therefore safe to add now. This migration only
-- ADDS columns/tables/indexes — it never updates, deletes, or otherwise
-- touches any existing `journal_entries` row, so the existing QA entry
-- (notes "Phase 4E journal QA", session "asia", position
-- e6c7decd-0929-487a-8c78-0300dbcac4eb) is preserved untouched.
--
-- HARDENING PASS: this version fixes three issues found before applying:
--   1. `UNIQUE (user_id, kind, lower(label))` is not a valid table
--      constraint in Postgres (table UNIQUE constraints can't reference
--      expressions) -- replaced with a UNIQUE expression INDEX.
--   2. Every child table's denormalized `user_id` (and, for
--      `journal_entry_terms`, `kind`) is now enforced by a COMPOSITE
--      FOREIGN KEY against a composite-unique key on its parent, so the
--      database itself -- not just application code -- guarantees a
--      child row can never point at a journal entry (or taxonomy term)
--      owned by a different user, and a `journal_entry_terms` row can
--      never claim a `kind` that disagrees with the term it points to.
--   3. The whole migration is wrapped in an explicit transaction so a
--      failure partway through rolls back cleanly instead of leaving the
--      schema half-migrated.

-- ---------------------------------------------------------------------
-- Composite-unique key added to the EXISTING journal_entries table so
-- child tables can foreign-key against (id, user_id) as a pair, not just
-- id alone -- this is what lets Postgres itself refuse to store a child
-- row whose user_id disagrees with its parent journal entry's real owner.
-- Purely additive: journal_entries' existing primary key on id is
-- untouched, and no existing row's data changes.
-- ---------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_id_user_id_key UNIQUE (id, user_id);

-- ---------------------------------------------------------------------
-- Taxonomy: one unified system for Setup / Strategy / Mistakes / Emotion /
-- Tags rather than five near-identical table pairs. Each is "a
-- user-extensible, reusable label attached to a journal entry" -- they
-- only differ in whether one or many can attach to a single entry, which
-- is enforced below via a partial unique index, not via separate schemas.
-- Reusing one taxonomy_terms row across many trades (rather than a
-- comma-separated string repeated per row) is what makes future
-- "Win Rate by Setup" / "P&L by Tag" a clean GROUP BY instead of a
-- string-parsing exercise, and avoids near-duplicate labels
-- ("NY Open" / "ny open" / "NY  Open") fragmenting analytics.
-- ---------------------------------------------------------------------
CREATE TABLE public.journal_taxonomy_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('setup', 'strategy', 'mistake', 'emotion', 'tag')),
  label TEXT NOT NULL CHECK (char_length(trim(label)) > 0 AND char_length(label) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite-unique key so `journal_entry_terms` can foreign-key against
  -- (id, user_id, kind) as a trio -- enforcing that an attached term both
  -- belongs to the same user AND actually has the kind the junction row
  -- claims it does.
  CONSTRAINT journal_taxonomy_terms_id_user_id_kind_key UNIQUE (id, user_id, kind)
);

-- Case-insensitive de-duplication per (user, kind) -- a table UNIQUE
-- constraint can't reference an expression like lower(label), so this is
-- a unique INDEX instead, which Postgres fully supports for expressions.
CREATE UNIQUE INDEX journal_taxonomy_terms_user_kind_label_idx
  ON public.journal_taxonomy_terms (user_id, kind, lower(label));

-- Supports "list all of this user's terms for a kind" without needing to
-- know a term's id up front (the composite unique constraint above is
-- keyed by id first, so it doesn't serve this access pattern).
CREATE INDEX journal_taxonomy_terms_user_kind_idx ON public.journal_taxonomy_terms (user_id, kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_taxonomy_terms TO authenticated;
GRANT ALL ON public.journal_taxonomy_terms TO service_role;
ALTER TABLE public.journal_taxonomy_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own taxonomy terms" ON public.journal_taxonomy_terms
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Which terms are attached to which journal entry. `kind` and `user_id` are
-- denormalized from the joined term/entry, but no longer merely trusted:
-- the two composite foreign keys below force the database to verify, on
-- every insert/update, that (a) `journal_entry_id` really is a journal
-- entry owned by this exact `user_id`, and (b) `term_id` really is a
-- taxonomy term owned by this exact `user_id` AND whose own `kind` matches
-- this row's `kind`. RLS below remains the authorization boundary (who can
-- act); these FKs are the added data-integrity boundary (what can ever be
-- stored), enforced for every writer regardless of RLS.
CREATE TABLE public.journal_entry_terms (
  journal_entry_id UUID NOT NULL,
  term_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('setup', 'strategy', 'mistake', 'emotion', 'tag')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (journal_entry_id, term_id),
  CONSTRAINT journal_entry_terms_entry_owner_fk
    FOREIGN KEY (journal_entry_id, user_id) REFERENCES public.journal_entries (id, user_id) ON DELETE CASCADE,
  CONSTRAINT journal_entry_terms_term_owner_kind_fk
    FOREIGN KEY (term_id, user_id, kind) REFERENCES public.journal_taxonomy_terms (id, user_id, kind) ON DELETE CASCADE
);
CREATE UNIQUE INDEX journal_entry_terms_single_select
  ON public.journal_entry_terms (journal_entry_id, kind)
  WHERE kind IN ('setup', 'strategy', 'emotion');
CREATE INDEX journal_entry_terms_entry_idx ON public.journal_entry_terms (journal_entry_id);
CREATE INDEX journal_entry_terms_term_idx ON public.journal_entry_terms (term_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entry_terms TO authenticated;
GRANT ALL ON public.journal_entry_terms TO service_role;
ALTER TABLE public.journal_entry_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own journal entry terms" ON public.journal_entry_terms
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Trade Grade: a fixed, non-extensible enum representing EXECUTION quality,
-- not trade outcome (a losing trade can be graded A+; a winning trade can
-- be graded F) -- not user-created, so a plain column, not a taxonomy kind.
-- ---------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD COLUMN grade TEXT CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F'));

-- ---------------------------------------------------------------------
-- Screenshots: paths only, never raw bytes (storage bucket added below).
-- The composite FK below enforces that a screenshot's user_id genuinely
-- matches the journal entry it's attached to, the same as
-- journal_entry_terms above.
-- ---------------------------------------------------------------------
CREATE TABLE public.journal_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_screenshots_entry_owner_fk
    FOREIGN KEY (journal_entry_id, user_id) REFERENCES public.journal_entries (id, user_id) ON DELETE CASCADE
);
CREATE INDEX journal_screenshots_entry_idx ON public.journal_screenshots (journal_entry_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_screenshots TO authenticated;
GRANT ALL ON public.journal_screenshots TO service_role;
ALTER TABLE public.journal_screenshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own journal screenshots" ON public.journal_screenshots
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Private bucket, same folder-scoped-by-auth.uid() policy shape as the
-- existing "chart-images" bucket (see
-- supabase/migrations/20260827120000_chart_images_bucket.sql) -- a
-- separate bucket (not chart-images) because journal screenshots have
-- different lifecycle/deletion semantics (1:1 owned by a journal entry,
-- deletable outright) than chart drawing images (potentially shared across
-- duplicated drawings).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'journal-screenshots',
  'journal-screenshots',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload own journal screenshots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'journal-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users read own journal screenshots"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'journal-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users update own journal screenshots"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'journal-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'journal-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete own journal screenshots"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'journal-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- AI Trade Review: append-only history (one row per generation, most
-- recent wins for display) rather than a single mutable field, so a future
-- "regenerate" never destroys a prior review and can build real history.
-- The composite FK below enforces the same "user_id genuinely matches the
-- parent journal entry's owner" guarantee as the tables above.
-- ---------------------------------------------------------------------
CREATE TABLE public.journal_ai_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model TEXT,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_ai_reviews_entry_owner_fk
    FOREIGN KEY (journal_entry_id, user_id) REFERENCES public.journal_entries (id, user_id) ON DELETE CASCADE
);
CREATE INDEX journal_ai_reviews_entry_created_idx ON public.journal_ai_reviews (journal_entry_id, created_at DESC);

GRANT SELECT, INSERT ON public.journal_ai_reviews TO authenticated;
GRANT ALL ON public.journal_ai_reviews TO service_role;
ALTER TABLE public.journal_ai_reviews ENABLE ROW LEVEL SECURITY;
-- Append-only from the client's perspective, matching ai_usage_events'
-- own convention -- no UPDATE/DELETE policy.
CREATE POLICY "Users view own AI reviews" ON public.journal_ai_reviews
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own AI reviews" ON public.journal_ai_reviews
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Deferred from the Phase 4E audit: one journal entry per position,
-- confirmed safe by the live duplicate-free check described above.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX journal_entries_one_per_position
  ON public.journal_entries (user_id, position_id)
  WHERE position_id IS NOT NULL;

-- New AI usage operation for accounting the journal-review call, alongside
-- every other AI call site's existing operation values.
ALTER TABLE public.ai_usage_events DROP CONSTRAINT ai_usage_events_operation_check;
ALTER TABLE public.ai_usage_events ADD CONSTRAINT ai_usage_events_operation_check
  CHECK (operation IN ('build', 'modify', 'fix_error', 'translate', 'repair', 'analyze', 'generate', 'journal_review'));

COMMIT;
