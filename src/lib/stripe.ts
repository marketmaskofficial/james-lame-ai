import { loadStripe, type Stripe } from "@stripe/stripe-js";

export type StripeEnv = "sandbox" | "live";

/**
 * Temporary beta-wide kill switch for the Lovable/Stripe payments flow —
 * distinct from `isStudioGateLocalPaidBypassed`/`isStudioGateTestBypassed`
 * in subscription-status.ts, which are dev-only, single-machine escape
 * hatches that are dead-code-eliminated from production builds. This flag
 * is the opposite: a real, environment-portable business toggle meant to
 * work identically wherever it's set (including a real deployment), so
 * flipping it back to enabled later requires no code changes anywhere that
 * reads it. Defaults to enabled (current/existing behavior) unless
 * explicitly set to the string "false" — an unset or misconfigured value
 * never accidentally disables real payments.
 */
export function paymentsEnabled(): boolean {
  return import.meta.env.VITE_PAYMENTS_ENABLED !== "false";
}

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Payments are not configured for this build. Complete go-live in your Lovable project to enable production checkout.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}
