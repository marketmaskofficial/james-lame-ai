import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

export const Route = createFileRoute("/checkout/return")({
  head: () => ({ meta: [{ title: "Payment complete — Signal Goat AI" }] }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

// Stripe's webhook (src/routes/api/public/payments/webhook.ts) writes the
// `subscriptions` row asynchronously, a moment after this page mounts —
// there is no synchronous "is it done yet" call. `useSubscription` already
// holds a realtime Postgres subscription on that exact table (the same
// source of truth Studio's access gate reads), so instead of inventing a
// polling loop this page just waits on the SAME hook to flip `isActive`
// true and reacts the instant it does. If it hasn't landed after a
// reasonably generous window, this says so honestly instead of silently
// spinning forever or lying about success.
const ACTIVATION_TIMEOUT_MS = 20_000;

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  const navigate = useNavigate();
  const { isActive, loading } = useSubscription();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!session_id) return;
    if (isActive) {
      const t = setTimeout(() => navigate({ to: "/studio", replace: true }), 900);
      return () => clearTimeout(t);
    }
  }, [session_id, isActive, navigate]);

  useEffect(() => {
    if (!session_id || isActive) return;
    const t = setTimeout(() => setTimedOut(true), ACTIVATION_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [session_id, isActive]);

  const activating = !!session_id && !isActive && !timedOut;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          {activating ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <CheckCircle2 className="h-6 w-6" />
          )}
        </div>
        <h1 className="text-2xl font-bold">
          {!session_id
            ? "No session found"
            : isActive
              ? "You're on Pro!"
              : timedOut
                ? "Almost there"
                : "Confirming your payment…"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {!session_id
            ? "We couldn't find a checkout session."
            : isActive
              ? "Thanks for upgrading. Opening Chart Studio…"
              : timedOut
                ? "Your payment succeeded, but activation is taking longer than usual. This page updates automatically — you can also try continuing now."
                : loading
                  ? "Loading your account…"
                  : "Stripe is finalizing your subscription. This usually takes just a few seconds."}
        </p>
        {!activating && (
          <Link
            to="/studio"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
          >
            Open Chart Studio
          </Link>
        )}
      </div>
    </div>
  );
}
