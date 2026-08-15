import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { createPortalSession } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Signal Goat AI Pro" },
      {
        name: "description",
        content: "Upgrade to Signal Goat AI Pro for unlimited history, custom symbols, and priority AI models.",
      },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  const { user, loading } = useAuth();
  const { isActive, subscription } = useSubscription();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState(false);
  const portal = useServerFn(createPortalSession);
  const [portalLoading, setPortalLoading] = useState(false);

  const openPortal = async () => {
    try {
      setPortalLoading(true);
      const res = await portal({
        data: {
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/pricing`,
        },
      });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PaymentTestModeBanner />
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Link to="/" className="text-sm font-semibold">Signal Goat AI</Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">Upgrade to Pro</h1>
          <p className="mt-3 text-muted-foreground">Unlock everything Signal Goat AI can do.</p>
        </div>

        {checkingOut ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-border bg-card p-4">
            <button
              onClick={() => setCheckingOut(false)}
              className="mb-3 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Cancel
            </button>
            <StripeEmbeddedCheckout priceId="pro_monthly" />
          </div>
        ) : (
          <div className="mx-auto mt-12 grid max-w-3xl gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="text-sm font-semibold text-muted-foreground">Free</div>
              <div className="mt-2 text-4xl font-black">$0</div>
              <div className="text-xs text-muted-foreground">forever</div>
              <ul className="mt-5 space-y-2 text-sm">
                {["Unlimited prompts", "Live chart preview", "History (last 50 scripts)"].map((i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" /> {i}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-brand bg-card p-6 shadow-lg shadow-brand/10">
              <div className="text-sm font-semibold text-brand">Pro</div>
              <div className="mt-2 text-4xl font-black">
                $19<span className="text-base font-normal text-muted-foreground">/mo</span>
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "Everything in Free",
                  "Unlimited script history",
                  "Custom symbols & timeframes",
                  "Priority AI models",
                ].map((i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" /> {i}
                  </li>
                ))}
              </ul>
              {loading ? null : !user ? (
                <button
                  onClick={() => navigate({ to: "/auth" })}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  Sign in to upgrade
                </button>
              ) : isActive ? (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-60"
                >
                  {portalLoading ? "Opening…" : "Manage subscription"}
                </button>
              ) : (
                <button
                  onClick={() => setCheckingOut(true)}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  Upgrade to Pro
                </button>
              )}
              {isActive && subscription?.cancel_at_period_end && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Cancels on {new Date(subscription.current_period_end!).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
