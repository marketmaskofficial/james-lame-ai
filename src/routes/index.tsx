import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight,
  Sparkles,
  LineChart,
  Code2,
  Zap,
  Shield,
  Brain,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Signal Goat AI — Turn ideas into Pine Script indicators" },
      {
        name: "description",
        content:
          "Describe a strategy in plain English. Signal Goat AI writes the Pine Script, previews it on live charts, and saves every version to your history.",
      },
      { property: "og:title", content: "Signal Goat AI — Turn ideas into Pine Script indicators" },
      {
        property: "og:description",
        content:
          "Describe a strategy in plain English. Signal Goat AI writes the Pine Script, previews it on live charts, and saves every version to your history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const ctaHref = user ? "/app" : "/auth";
  const ctaLabel = user ? "Open the app" : "Try it free";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-black text-brand-foreground">
              G
            </div>
            <span className="text-sm font-semibold tracking-tight">Signal Goat AI</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            {!loading && !user && (
              <Link
                to="/auth"
                className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
              >
                Sign in
              </Link>
            )}
            <Link
              to={ctaHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground hover:opacity-90"
            >
              {user ? "Open app" : "Get started"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px circle at 20% 10%, hsl(var(--brand) / 0.25), transparent 60%), radial-gradient(500px circle at 80% 20%, hsl(var(--brand) / 0.15), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-24 md:pt-28 md:pb-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 text-brand" />
              Powered by Lovable AI
            </div>
            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              Turn any idea into a <span className="text-brand">Pine Script</span> indicator
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
              Describe a strategy in plain English. Signal Goat AI writes the code,
              previews it on live charts, and saves every version to your history.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                to={ctaHref}
                className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90"
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-accent"
              >
                See how it works
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No credit card. Generate your first script in under a minute.
            </p>
          </div>

          {/* Mock preview */}
          <div className="mx-auto mt-16 max-w-5xl rounded-xl border border-border bg-card p-2 shadow-2xl shadow-brand/10">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
              <div className="ml-3 text-xs text-muted-foreground">signalgoat.ai / app</div>
            </div>
            <div className="grid gap-2 p-2 md:grid-cols-[1fr_1fr]">
              <div className="rounded-lg bg-background p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Prompt</div>
                <p className="mt-2 text-sm">
                  Build a mean-reversion indicator using RSI(14) with a 200 EMA trend filter.
                  Green triangle on oversold, red on overbought.
                </p>
                <div className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">Generated</div>
                <pre className="mt-2 overflow-hidden rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
{`//@version=5
indicator("SG Mean Reversion", overlay=true)
rsi = ta.rsi(close, 14)
ema200 = ta.ema(close, 200)
long = rsi < 30 and close > ema200
short = rsi > 70 and close < ema200
plotshape(long, style=shape.triangleup, ...)`}
                </pre>
              </div>
              <div className="rounded-lg bg-background p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Live chart</div>
                <div className="mt-2 flex h-56 items-end gap-1 rounded-md bg-muted/30 p-3">
                  {Array.from({ length: 40 }).map((_, i) => {
                    const h = 20 + Math.abs(Math.sin(i * 0.6) * 60) + (i % 5) * 4;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${h}%`,
                          background:
                            i % 3 === 0
                              ? "hsl(var(--brand))"
                              : "hsl(var(--muted-foreground) / 0.4)",
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>BTC / USDT · 15m</span>
                  <span className="text-brand">+2.4%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Everything you need to prototype ideas
            </h2>
            <p className="mt-3 text-muted-foreground">
              From napkin sketch to backtestable script — without touching a docs page.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Brain,
                title: "AI that speaks Pine",
                desc: "Trained prompts produce clean, valid Pine v5 out of the box.",
              },
              {
                icon: LineChart,
                title: "Live chart preview",
                desc: "See BTC price action side-by-side while you iterate.",
              },
              {
                icon: Code2,
                title: "Copy-ready code",
                desc: "One click to paste directly into TradingView.",
              },
              {
                icon: Zap,
                title: "Instant iteration",
                desc: "Refine with a follow-up prompt. Every version saved.",
              },
              {
                icon: Shield,
                title: "Your history, secured",
                desc: "Sign in and every generation is private to your account.",
              },
              {
                icon: Sparkles,
                title: "Ideas, not syntax",
                desc: "Focus on strategy — we handle the boilerplate.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-background p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <f.icon className="h-4.5 w-4.5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              From idea to indicator in three steps
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { n: "01", t: "Describe", d: "Type your strategy in plain English. Any language, any complexity." },
              { n: "02", t: "Generate", d: "AI writes Pine Script v5 and previews live BTC action beside it." },
              { n: "03", t: "Ship", d: "Copy to TradingView, refine, or save the version to revisit later." },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-border bg-card p-6">
                <div className="text-3xl font-black text-brand">{s.n}</div>
                <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Simple pricing</h2>
            <p className="mt-3 text-muted-foreground">Start free. Upgrade when you're shipping serious strategies.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-6">
              <div className="text-sm font-semibold text-muted-foreground">Free</div>
              <div className="mt-2 text-4xl font-black">$0</div>
              <div className="text-xs text-muted-foreground">forever</div>
              <ul className="mt-5 space-y-2 text-sm">
                {["Unlimited prompts", "Live BTC chart preview", "History (last 50 scripts)"].map((i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" /> {i}
                  </li>
                ))}
              </ul>
              <Link
                to={ctaHref}
                className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Get started
              </Link>
            </div>
            <div className="rounded-xl border border-brand bg-background p-6 shadow-lg shadow-brand/10">
              <div className="text-sm font-semibold text-brand">Pro</div>
              <div className="mt-2 text-4xl font-black">$19</div>
              <div className="text-xs text-muted-foreground">per month</div>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "Everything in Free",
                  "Unlimited history",
                  "Custom symbols & timeframes",
                  "Priority AI models",
                ].map((i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" /> {i}
                  </li>
                ))}
              </ul>
              <Link
                to="/pricing"
                className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
              >
                Upgrade to Pro
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-4 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Your next trading idea is one prompt away
          </h2>
          <p className="mt-3 text-muted-foreground">
            Join traders shipping indicators faster with Signal Goat AI.
          </p>
          <div className="mt-8">
            <Link
              to={ctaHref}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground hover:opacity-90"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground md:flex-row">
          <div>© {new Date().getFullYear()} Signal Goat AI</div>
          <div className="flex gap-4">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
