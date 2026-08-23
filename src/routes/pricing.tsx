import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, LineChart, Sparkles, TestTube2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { createPortalSession, getBetaPlan, type BetaPlanResult } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Signal Goat AI Beta" },
      {
        name: "description",
        content: "Join the Signal Goat AI paid beta for full access to Chart Studio, the AI Builder, Strategy Tester, and Paper Trading.",
      },
    ],
  }),
  component: Pricing,
});

// Real, current beta capabilities — do not add anything here that isn't
// actually shipped in Chart Studio today.
const BETA_FEATURES = [
  { icon: LineChart, label: "Chart Studio", desc: "Live multi-chart workspace with indicators, drawing tools, and layouts." },
  { icon: Sparkles, label: "AI Builder", desc: "Build, modify, explain, and fix SGScript indicators from plain English." },
  { icon: TestTube2, label: "Strategy Tester", desc: "Backtest strategies against historical data before risking anything." },
  { icon: Wallet, label: "Paper Trading", desc: "Run your strategies live against real markets with simulated funds." },
];

function formatPrice(plan: Extract<BetaPlanResult, { priceLookupKey: string }>): string {
  if (plan.unitAmount == null) return "Contact us";
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    minimumFractionDigits: plan.unitAmount % 100 === 0 ? 0 : 2,
  }).format(plan.unitAmount / 100);
  if (!plan.interval) return amount;
  const cadence = plan.intervalCount && plan.intervalCount > 1 ? `${plan.intervalCount} ${plan.interval}s` : plan.interval;
  return `${amount}/${cadence}`;
}

function Pricing() {
  const { user, loading } = useAuth();
  const { isActive, subscription } = useSubscription();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState(false);
  const portal = useServerFn(createPortalSession);
  const getBetaPlanFn = useServerFn(getBetaPlan);
  const [portalLoading, setPortalLoading] = useState(false);
  const [plan, setPlan] = useState<BetaPlanResult | { status: "loading" }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let environment: ReturnType<typeof getStripeEnvironment>;
    try {
      environment = getStripeEnvironment();
    } catch (e) {
      setPlan({ error: e instanceof Error ? e.message : "Payments are not configured" });
      return;
    }
    getBetaPlanFn({ data: { environment } }).then((result) => {
      if (!cancelled) setPlan(result);
    });
    return () => {
      cancelled = true;
    };
  }, [getBetaPlanFn]);

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

  const planLoaded = "priceLookupKey" in plan;
  const planErrored = "error" in plan;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PaymentTestModeBanner />
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Link to="/" className="text-sm font-semibold">Signal Goat AI</Link>
          {!loading && !user ? (
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          ) : (
            <span className="w-[52px]" aria-hidden />
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">Signal Goat AI Beta</h1>
          <p className="mt-3 text-muted-foreground">
            One plan. Full access to everything in the paid beta.
          </p>
        </div>

        {checkingOut ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-border bg-card p-4">
            <button
              onClick={() => setCheckingOut(false)}
              className="mb-3 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Cancel
            </button>
            <StripeEmbeddedCheckout priceId={planLoaded ? plan.priceLookupKey : "pro_monthly"} />
          </div>
        ) : (
          <div className="mx-auto mt-12 max-w-md">
            <div className="rounded-xl border border-brand bg-card p-6 shadow-lg shadow-brand/10">
              <div className="text-sm font-semibold text-brand">
                {planLoaded ? plan.productName : "Signal Goat AI Beta"}
              </div>
              <div className="mt-2 text-4xl font-black">
                {planLoaded ? (
                  formatPrice(plan)
                ) : planErrored ? (
                  <span className="text-lg font-semibold text-muted-foreground">Pricing unavailable</span>
                ) : (
                  <span className="text-lg font-semibold text-muted-foreground">Loading price…</span>
                )}
              </div>
              {planErrored && (
                <p className="mt-1 text-xs text-destructive">{plan.error}</p>
              )}
              <ul className="mt-5 space-y-3 text-sm">
                {BETA_FEATURES.map((f) => (
                  <li key={f.label} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <span>
                      <span className="font-medium">{f.label}</span>{" "}
                      <span className="text-muted-foreground">— {f.desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {loading ? null : !user ? (
                <button
                  onClick={() => navigate({ to: "/auth", search: { mode: "signup" } })}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
                >
                  Create an account to join
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
                  disabled={!planLoaded}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Join the beta
                </button>
              )}
              {!user && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <Link to="/auth" className="text-brand hover:underline">
                    Sign in
                  </Link>
                </p>
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
