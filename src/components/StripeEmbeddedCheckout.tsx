import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession } from "@/lib/payments.functions";

interface Props {
  priceId: string;
  returnUrl?: string;
}

type CheckoutLoadState =
  | { status: "loading" }
  | { status: "ready"; clientSecret: string }
  | { status: "error"; message: string };

/**
 * Wraps Stripe's EmbeddedCheckoutProvider/EmbeddedCheckout. This exists
 * because that provider does NOT show any visible UI when `fetchClientSecret`
 * rejects — it just leaves its mount point empty and throws an unhandled
 * `IntegrationError` that only ever shows up in the browser console. That
 * silent failure is exactly what looked like a "blank checkout": session
 * creation failing (bad price lookup key, Stripe misconfiguration, network
 * error) rendered as nothing at all, forever, with no way for the user to
 * know what happened or retry. This component fetches the client secret
 * itself first, surfaces any failure as a real on-screen error with a retry
 * button, and only mounts the Stripe-hosted provider once a client secret is
 * actually in hand.
 */
export function StripeEmbeddedCheckout({ priceId, returnUrl }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CheckoutLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    createCheckoutSession({
      data: {
        priceId,
        returnUrl: returnUrl || `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        environment: getStripeEnvironment(),
      },
    })
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) throw new Error(result.error);
        if (!result.clientSecret) throw new Error("No client secret returned");
        setState({ status: "ready", clientSecret: result.clientSecret });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Couldn't start checkout",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [priceId, returnUrl, attempt]);

  if (state.status === "loading") {
    return (
      <div id="checkout" className="flex min-h-[300px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading checkout…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div id="checkout" className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm font-medium">Checkout couldn't load</p>
        <p className="max-w-sm text-xs text-muted-foreground">{state.message}</p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider
        key={state.clientSecret}
        stripe={getStripe()}
        options={{ clientSecret: state.clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
