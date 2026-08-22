import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

export interface SubscriptionRow {
  status: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

/**
 * Single formula for "does this subscription row currently grant access" —
 * shared by `useSubscription` (reactive UI state) and `checkStudioAccess`
 * (the one-shot route-level gate below), so the two can never disagree about
 * what counts as paid. This is the ONLY place that interprets a
 * `subscriptions` row's status/period into an access boolean.
 */
export function isSubscriptionRowActive(subscription: SubscriptionRow | null): boolean {
  if (!subscription) return false;
  if (
    ["active", "trialing", "past_due"].includes(subscription.status) &&
    (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date())
  ) {
    return true;
  }
  if (
    subscription.status === "canceled" &&
    !!subscription.current_period_end &&
    new Date(subscription.current_period_end) > new Date()
  ) {
    return true;
  }
  return false;
}

export type StudioAccessResult = "unauthenticated" | "unpaid" | "ok";

/**
 * Escape hatch for `test/render-regression`'s headless Playwright suite
 * ONLY. That suite exists purely to check the SGScript render PIPELINE
 * (does a runtime-computed box/plot/line/marker actually reach real chart
 * pixels) — a concern completely orthogonal to auth/subscription state,
 * predates this phase, and has no seeded login. It spawns its own
 * throwaway dev server (see `startDevServer` in
 * test/render-regression/run.mjs) with this Vite env var set, so the bypass
 * only ever exists on that disposable process — a normal `npm run dev` or
 * any real deployment never sets it, and a browser request can't set it
 * either (`import.meta.env.VITE_*` is baked into the served bundle when the
 * server starts, not read per-request).
 */
export function isStudioGateTestBypassed(): boolean {
  return import.meta.env.VITE_SG_TEST_BYPASS_STUDIO_GATE === "1";
}

/**
 * One-shot access check for route-level gating (Chart Studio's `beforeLoad`).
 * Reads straight from Supabase auth + the `subscriptions` table — the exact
 * same source of truth `useSubscription` reads reactively — instead of a
 * second entitlement system. Never throws: any failure to resolve payment
 * configuration is treated as "unpaid" (fail closed), matching how
 * `useSubscription` itself behaves when `getStripeEnvironment()` throws.
 */
export async function checkStudioAccess(): Promise<StudioAccessResult> {
  if (isStudioGateTestBypassed()) return "ok";
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return "unauthenticated";

  let env: "sandbox" | "live";
  try {
    env = getStripeEnvironment();
  } catch {
    return "unpaid";
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("status, price_id, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return isSubscriptionRowActive((data as SubscriptionRow | null) ?? null) ? "ok" : "unpaid";
}
