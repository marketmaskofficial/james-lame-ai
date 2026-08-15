import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, Wand2 } from "lucide-react";
import { analyzeIndicator, type AnalyzeResult } from "@/lib/analyze.functions";
import { buildProject, type BuildResult } from "@/lib/project.functions";
import type { IndicatorSpec } from "@/lib/spec/types";
import { track } from "@/lib/telemetry";

type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const SUPPORTED: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

type Turn = {
  role: "user" | "ai";
  text: string;
  issues?: number;
};

/**
 * Signal Goat AI beside the chart. Two modes:
 *  - Build: describe an indicator, or ask for a change to the one you have.
 *    Runs the structured spec -> Pine -> SGScript pipeline and drops the
 *    result straight onto the chart. Follow-up messages patch the same spec.
 *  - Analyze: reviews the script currently in the editor. Never places orders.
 */
export function AiSidePanel({
  code,
  symbol,
  interval,
  signedIn,
  onConvert,
  converting,
  spec,
  onBuilt,
  seedPrompt = null,
  onSeedConsumed,
}: {
  code: string;
  symbol: string;
  interval: string;
  signedIn: boolean;
  onConvert: () => void;
  converting: boolean;
  spec: IndicatorSpec | null;
  onBuilt: (result: BuildResult) => void;
  /** Pre-fills the box, e.g. when the tester asks for missing strategy rules. */
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
}) {
  const [mode, setMode] = useState<"build" | "analyze">("build");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!seedPrompt) return;
    setMode("build");
    setPrompt(seedPrompt);
    onSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  const safeInterval = (
    SUPPORTED.includes(interval as Interval) ? interval : "1h"
  ) as Interval;

  const analyze = useMutation({
    mutationFn: () =>
      analyzeIndicator({ data: { code, symbol, interval: safeInterval } }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Analysis failed"),
  });

  const build = useMutation({
    mutationFn: (request: string) =>
      buildProject({
        data: {
          request,
          symbol,
          timeframe: safeInterval,
          ...(spec ? { currentSpec: spec as unknown as Record<string, unknown> } : {}),
          ...(spec && code.trim() ? { currentSgscript: code } : {}),
        },
      }),
    onSuccess: (r) => {
      track(spec ? "patch_succeeded" : "ai_build_succeeded", {
        repairPasses: r.validation.repairPasses,
      });
      const issues =
        r.validation.pine.issues.length + r.validation.sgscript.issues.length;
      setTurns((t) => [
        ...t,
        { role: "ai", text: r.summary || r.changelog, issues },
      ]);
      setError(null);
      onBuilt(r);
      requestAnimationFrame(() =>
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight }),
      );
    },
    onError: (e: unknown) => {
      track(spec ? "patch_failed" : "ai_build_failed", {
        message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
      setError(e instanceof Error ? e.message : "Build failed");
    },
  });

  const submit = () => {
    const text = prompt.trim();
    if (!text || build.isPending || !signedIn) return;
    setTurns((t) => [...t, { role: "user", text }]);
    setPrompt("");
    setError(null);
    track("ai_build_started", { patch: !!spec });
    build.mutate(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        <div className="mr-auto flex items-center gap-1.5 text-[11px] font-medium">
          <Sparkles className="h-3.5 w-3.5 text-brand" /> Signal Goat AI
        </div>
        {(["build", "analyze"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
              mode === m
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "build" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            className="min-h-0 flex-1 space-y-2 overflow-auto p-2 text-[11px]"
          >
            {turns.length === 0 && (
              <div className="space-y-2 text-muted-foreground">
                <p className="leading-relaxed">
                  Describe the indicator you want. It gets built, validated and
                  plotted on {symbol} automatically. Then just say what to
                  change — the same indicator is patched, not rebuilt.
                </p>
                <div className="space-y-1">
                  {[
                    "RSI divergence with buy/sell labels",
                    "Fair value gaps with mitigation boxes",
                    "EMA 21/55 cross with ATR trailing stop",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setPrompt(s)}
                      className="block w-full rounded border border-border px-1.5 py-1 text-left text-[10.5px] hover:bg-accent hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={
                  t.role === "user"
                    ? "rounded-md bg-accent px-2 py-1.5 leading-relaxed"
                    : "leading-relaxed"
                }
              >
                {t.role === "ai" && (
                  <p className="mb-0.5 text-[9px] uppercase tracking-wide text-brand">
                    Signal Goat
                  </p>
                )}
                <p>{t.text}</p>
                {t.role === "ai" && (
                  <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                    {t.issues
                      ? `${t.issues} static-validation note${t.issues === 1 ? "" : "s"}`
                      : "Passed static validation"}{" "}
                    · plotted on the chart
                  </p>
                )}
              </div>
            ))}
            {build.isPending && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {spec ? "Applying your change…" : "Building your indicator…"}
              </p>
            )}
            {error && <p className="text-[10px] text-destructive">{error}</p>}
          </div>

          <div className="space-y-1.5 border-t border-border p-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={3}
              placeholder={
                spec
                  ? "Change something — e.g. add a 200 EMA filter"
                  : "Describe an indicator or strategy…"
              }
              className="w-full resize-none rounded-md border border-border bg-background p-1.5 text-[11px] outline-none focus:border-brand"
            />
            <button
              disabled={!signedIn || build.isPending || !prompt.trim()}
              onClick={submit}
              className="flex w-full items-center justify-center gap-1 rounded-md bg-brand py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
            >
              {build.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {spec ? "Apply change" : "Build & add to chart"}
            </button>
            {spec && (
              <p className="truncate text-[9.5px] text-muted-foreground">
                Editing: {spec.name}
              </p>
            )}
            {!signedIn && (
              <p className="text-[10px] text-muted-foreground">
                Sign in to build with AI.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-1.5 border-b border-border p-2">
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Reviews the script currently in the editor against the last 200
              bars of {symbol}. Analysis only — it never places orders.
            </p>
            <button
              disabled={!signedIn || !code.trim() || analyze.isPending}
              onClick={() => analyze.mutate()}
              className="flex w-full items-center justify-center gap-1 rounded-md bg-brand py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
            >
              {analyze.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Analyze this indicator
            </button>
            <button
              disabled={!signedIn || converting || !code.trim()}
              onClick={onConvert}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-border py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
            >
              {converting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
              Convert editor code to SGScript
            </button>
            {!signedIn && (
              <p className="text-[10px] text-muted-foreground">
                Sign in to use AI analysis.
              </p>
            )}
            {error && <p className="text-[10px] text-destructive">{error}</p>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2 text-[11px]">
            {!result && !analyze.isPending && (
              <p className="text-muted-foreground">No analysis yet.</p>
            )}
            {result && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      result.signal === "buy"
                        ? "border-emerald-500/50 text-emerald-400"
                        : result.signal === "sell"
                          ? "border-red-500/50 text-red-400"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {result.signal}
                  </span>
                  <span className="text-muted-foreground">
                    {result.confidence} confidence · {result.strategyType}
                  </span>
                </div>
                <p className="leading-relaxed">{result.summary}</p>
                <Section title="Reasoning">
                  <p className="leading-relaxed text-muted-foreground">
                    {result.reasoning}
                  </p>
                </Section>
                {result.keyLevels.length > 0 && (
                  <Section title="Key levels">
                    <ul className="space-y-0.5 font-mono text-muted-foreground">
                      {result.keyLevels.map((l) => (
                        <li key={`${l.label}${l.price}`}>
                          {l.label}: {l.price}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}
                <Bullets title="Strengths" items={result.strengths} />
                <Bullets title="Risks" items={result.risks} />
                <Bullets title="Suggestions" items={result.suggestions} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Section>
  );
}
