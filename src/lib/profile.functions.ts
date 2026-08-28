import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Profile ----------

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, display_name, avatar_url, created_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ displayName: z.string().trim().min(1).max(80) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.displayName })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Onboarding (UI-8 task 3) ----------
//
// `has_onboarded` is a pending-migration column (see
// supabase/migrations/20260822100000_profiles_onboarding.sql, not applied as
// of this phase). Every read/write here is wrapped so a missing column (or
// any other failure) degrades safely instead of ever blocking access:
//   - the read fails OPEN as "already onboarded" (never re-shows the flow
//     to an existing paid user just because the column can't be read), and
//   - the write is fire-and-forget from the caller's perspective (failing to
//     PERSIST "onboarded" just means the flow may show again next session,
//     which is a minor annoyance, never a lockout).

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ hasOnboarded: boolean }> => {
    try {
      const { data, error } = await context.supabase
        .from("profiles")
        .select("has_onboarded")
        .eq("id", context.userId)
        .maybeSingle();
      if (error) throw error;
      // No row / null column (pre-migration, or a profile row that predates
      // the column's default) -> treat as "not yet onboarded" so a genuinely
      // new user still sees the flow once the column exists.
      return { hasOnboarded: Boolean(data?.has_onboarded) };
    } catch (e) {
      console.warn("[onboarding] status check failed — failing open (treated as onboarded)", e);
      // Fail OPEN: never let an infra hiccup or a not-yet-applied migration
      // re-trap an existing user in the onboarding flow.
      return { hasOnboarded: true };
    }
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    try {
      const { error } = await context.supabase
        .from("profiles")
        .update({ has_onboarded: true })
        .eq("id", context.userId);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      console.warn("[onboarding] failed to persist completion (non-fatal)", e);
      return { ok: false };
    }
  });
