import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BarChart3,
  Check,
  MessageSquarePlus,
  PlayCircle,
  Save,
  Sparkles,
  Wand2,
  ShieldCheck,
} from "lucide-react";
import { SYMBOL_REGISTRY } from "@/lib/symbols";
import { PRESETS, PRESET_ORDER, isPresetLocked, type PresetId } from "@/lib/workspace/presets";
import { applyOnboardingWorkspaceChoice } from "@/lib/workspace/onboarding";
import { addToWatchlist } from "@/lib/watchlists.functions";
import { completeOnboarding } from "@/lib/profile.functions";

/** Short, curated starting-market list for onboarding — the same crypto
 * universe Chart Studio already supports (src/lib/symbols.ts), narrowed to
 * the handful a brand-new user is most likely to recognize. */
const STARTER_MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"]
  .map((ticker) => SYMBOL_REGISTRY.find((s) => s.ticker === ticker))
  .filter((s): s is NonNullable<typeof s> => Boolean(s));

const WORKFLOW_STEPS: Array<{ icon: typeof MessageSquarePlus; label: string; blurb: string }> = [
  { icon: MessageSquarePlus, label: "Describe", blurb: "Tell Signal Goat AI what to build, in plain English." },
  { icon: Wand2, label: "Build", blurb: "It writes a real Pine + SGScript indicator and validates it." },
  { icon: BarChart3, label: "Add to Chart", blurb: "A successful build is plotted on your chart automatically." },
  { icon: Sparkles, label: "Edit", blurb: "Ask for changes, or edit the code directly in the editor." },
  { icon: ShieldCheck, label: "Validate", blurb: "Every change is re-checked before it reaches your chart." },
  { icon: Save, label: "Save", blurb: "Versions are kept automatically so you can always go back." },
  { icon: PlayCircle, label: "Backtest / Paper Trade", blurb: "Test it against history, then run it live on paper." },
];

type Step = 0 | 1 | 2 | 3;

/**
 * UI-8 first-run onboarding: four short steps shown once for a newly-paid
 * user, then never again (persisted via `profiles.has_onboarded` — see
 * src/lib/profile.functions.ts). Mounted by the `Studio` route gate in
 * src/routes/studio.tsx BEFORE the real workspace component ever renders,
 * so the preset/market choice below is written to local storage while
 * nothing else has mounted yet — the workspace component's own existing
 * load path then just picks it up like any other prior customization (see
 * src/lib/workspace/onboarding.ts for why that needs no changes there).
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [markets, setMarkets] = useState<string[]>(["BTCUSDT"]);
  const [presetId, setPresetId] = useState<PresetId>("beginner");
  const [finishing, setFinishing] = useState(false);
  const addToWatchlistFn = useServerFn(addToWatchlist);
  const completeOnboardingFn = useServerFn(completeOnboarding);

  const toggleMarket = (ticker: string) => {
    setMarkets((prev) =>
      prev.includes(ticker)
        ? prev.length > 1
          ? prev.filter((m) => m !== ticker)
          : prev // keep at least one selected
        : [...prev, ticker],
    );
  };

  const finish = async () => {
    setFinishing(true);
    const primary = markets[0] ?? "BTCUSDT";
    // Local, synchronous, and best-effort-free — this is the same write the
    // Layouts menu itself produces, so there's nothing to fail here short of
    // storage being unavailable, which the underlying helper already
    // tolerates silently.
    applyOnboardingWorkspaceChoice(presetId, primary);

    // Best-effort extras: a fresh watchlist and the completion flag. Neither
    // blocks entry to Studio if it fails (no session yet in some edge case,
    // network hiccup, or the `has_onboarded` column not existing yet — see
    // completeOnboarding's own fail-open handling).
    await Promise.allSettled([
      ...markets.map((m) => addToWatchlistFn({ data: { symbol: m } })),
      completeOnboardingFn(),
    ]);
    onDone();
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <StepDots step={step} />

        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}

        {step === 1 && (
          <MarketStep
            markets={markets}
            onToggle={toggleMarket}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <PresetStep
            presetId={presetId}
            onSelect={setPresetId}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <WorkflowStep onBack={() => setStep(2)} onFinish={finish} finishing={finishing} />
        )}
      </div>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? "w-6 bg-brand" : i < step ? "w-1.5 bg-brand/60" : "w-1.5 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function NextButton({ onClick, children = "Continue" }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90"
    >
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground">
      Back
    </button>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand font-black text-brand-foreground">
        G
      </div>
      <h1 className="text-xl font-bold tracking-tight">Welcome to Chart Studio</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        You're all set up on Signal Goat AI Pro. Let's get your workspace ready — this takes less than a minute.
      </p>
      <div className="mt-6">
        <NextButton onClick={onNext}>Get started</NextButton>
      </div>
    </div>
  );
}

function MarketStep({
  markets,
  onToggle,
  onBack,
  onNext,
}: {
  markets: string[];
  onToggle: (ticker: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">Choose your markets</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick what you want to watch first. Your chart opens on the first one — the rest go straight to your watchlist.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STARTER_MARKETS.map((m) => {
          const selected = markets.includes(m.ticker);
          return (
            <button
              key={m.ticker}
              onClick={() => onToggle(m.ticker)}
              className={`flex items-center justify-between gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                selected
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="font-medium">{m.ticker.replace("USDT", "")}</span>
              {selected && <Check className="h-3.5 w-3.5 text-brand" />}
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        <NextButton onClick={onNext} />
      </div>
      <BackLink onClick={onBack} />
    </div>
  );
}

function PresetStep({
  presetId,
  onSelect,
  onBack,
  onNext,
}: {
  presetId: PresetId;
  onSelect: (id: PresetId) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">Choose a starting workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You can switch or customize layouts anytime from the Layouts menu in Chart Studio.
      </p>
      <div className="mt-4 max-h-64 space-y-1.5 overflow-auto pr-1">
        {PRESET_ORDER.map((id) => {
          const locked = isPresetLocked(PRESETS[id]);
          const selected = presetId === id;
          return (
            <button
              key={id}
              disabled={locked}
              onClick={() => onSelect(id)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                locked
                  ? "cursor-not-allowed border-border/50 text-muted-foreground/50"
                  : selected
                    ? "border-brand bg-brand/10 text-foreground"
                    : "border-border hover:bg-accent hover:text-foreground"
              }`}
            >
              <span>
                {PRESETS[id].name}
                {locked && <span className="ml-1.5 text-[10px] uppercase tracking-wide">Coming soon</span>}
              </span>
              {selected && !locked && <Check className="h-3.5 w-3.5 text-brand" />}
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        <NextButton onClick={onNext} />
      </div>
      <BackLink onClick={onBack} />
    </div>
  );
}

function WorkflowStep({
  onBack,
  onFinish,
  finishing,
}: {
  onBack: () => void;
  onFinish: () => void;
  finishing: boolean;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">How Chart Studio works</h2>
      <p className="mt-1 text-sm text-muted-foreground">The core loop, start to finish:</p>
      <div className="mt-4 space-y-2.5">
        {WORKFLOW_STEPS.map((s, i) => (
          <div key={s.label} className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <s.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {i + 1}. {s.label}
              </p>
              <p className="text-xs text-muted-foreground">{s.blurb}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <button
          onClick={onFinish}
          disabled={finishing}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
        >
          {finishing ? "Setting up your workspace…" : "Enter Chart Studio"}
        </button>
      </div>
      {!finishing && <BackLink onClick={onBack} />}
    </div>
  );
}
