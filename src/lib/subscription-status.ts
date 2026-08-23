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
 *
 * Double-gated on `import.meta.env.DEV` in addition to the env var: Vite
 * statically replaces `import.meta.env.DEV` with the literal `false` in a
 * production build (`vite build`) and dead-code-eliminates the branch, so
 * this function — and everything it guards — provably cannot exist in a
 * production bundle even if the env var were somehow set at production
 * build time. `vite dev` (what this suite's spawned server and any local
 * `npm run dev` use) always has `DEV === true`, so this adds no behavior
 * change for the render-regression suite itself.
 *
 * NOTE: this bypasses AUTHENTICATION too (see `checkStudioAccess` below),
 * not just the subscription check — that is intentional and scoped to this
 * one disposable test process, which has no seeded login at all. Local
 * manual testing that needs a REAL signed-in Supabase session treated as
 * paid should use `isStudioGateLocalPaidBypassed` instead, which requires a
 * real authenticated user and only ever short-circuits the subscription
 * lookup.
 */
export function isStudioGateTestBypassed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_SG_TEST_BYPASS_STUDIO_GATE === "1";
}

/**
 * Local-development-only escape hatch for manually exercising the PAID
 * Chart Studio experience against a REAL Supabase auth session, without a
 * real Stripe subscription existing. Unlike `isStudioGateTestBypassed`
 * above, this does NOT skip authentication — `checkStudioAccess` only ever
 * consults this AFTER resolving a real signed-in user, so a signed-out
 * visitor still gets `"unauthenticated"` -> redirected to `/auth` exactly
 * as in production. It only ever short-circuits the `subscriptions` table
 * lookup for that already-authenticated user; it never reads, writes, or
 * fabricates a `subscriptions` row, and never calls any Stripe/payments
 * code path (both are skipped entirely by returning before that code runs).
 *
 * Double-gated exactly like `isStudioGateTestBypassed`: `import.meta.env
 * .DEV` (statically `false` and dead-code-eliminated in `vite build`
 * production output) AND an explicit env var, which must only ever be set
 * in a gitignored local file (`.env.local`, not `.env`/`.env.development`,
 * which ARE committed) — never in anything the hosted deployment reads.
 */
export function isStudioGateLocalPaidBypassed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_SG_LOCAL_PAID_BYPASS === "1";
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

  // Real user, real session — only the subscription-table lookup below (and
  // whatever Stripe config it depends on) is ever skipped by this flag. See
  // `isStudioGateLocalPaidBypassed`'s docstring for the full guard contract.
  if (isStudioGateLocalPaidBypassed()) return "ok";

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
