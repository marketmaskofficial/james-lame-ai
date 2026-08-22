import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { HelpCircle, Loader2, Send, Sparkles, Wand2, Wrench } from "lucide-react";
import { analyzeIndicator, type AnalyzeResult } from "@/lib/analyze.functions";
import { buildProject, type BuildResult } from "@/lib/project.functions";
import type { IndicatorSpec } from "@/lib/spec/types";
import { explainSpec } from "@/lib/spec/explain";
import { track } from "@/lib/telemetry";

type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const SUPPORTED: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Real outcome of a build/fix attempt, derived only from the pipeline's own validation result — never optimistic. */
type BuildStatus = "success" | "warning" | "error";

type Turn = {
  role: "user" | "ai";
  text: string;
  issues?: number;
  status?: BuildStatus;
  /** "explain" turns are a plain description of the current spec — no validation ran, nothing was built. */
  kind?: "build" | "explain";
};

/** A build/fix attempt whose validation reported an unresolved error: kept locally so Fix Error can
 * repair the actual failing draft, without ever committing it to the chart/editor as if it succeeded. */
type FailedDraft = {
  spec: IndicatorSpec;
  pine: string;
  sgscript: string;
  issuesText: string;
};

function classify(r: BuildResult): { status: BuildStatus; totalIssues: number } {
  const hasError = !r.validation.pine.ok || !r.validation.sgscript.ok;
  const totalIssues = r.validation.pine.issues.length + r.validation.sgscript.issues.length;
  return { status: hasError ? "error" : totalIssues > 0 ? "warning" : "success", totalIssues };
}

function formatIssuesForRepair(r: BuildResult): string {
  return [...r.validation.pine.issues, ...r.validation.sgscript.issues]
    .map((i) => `[${i.severity}] ${i.code}: ${i.message}${i.line ? ` (line ${i.line})` : ""}`)
    .join("\n");
}

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
  const [failedDraft, setFailedDraft] = useState<FailedDraft | null>(null);
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

  /**
   * Shared outcome handler for both Build/Modify and the explicit Fix Error
   * action — both call `buildProject` and both must be judged the same way:
   * a real, unresolved validation error (still `!ok` after the pipeline's
   * own bounded repair passes) is NEVER treated as success. Only success and
   * warning-only outcomes are committed to the chart/editor via `onBuilt`;
   * an error outcome keeps the last-good chart/editor state untouched and
   * instead stashes the failing draft so Fix Error can operate on it without
   * losing the user's project context.
   */
  const handleResult = (r: BuildResult, opts: { isFix: boolean }) => {
    const { status, totalIssues } = classify(r);
    track(
      opts.isFix
        ? status === "error"
          ? "fix_error_still_failing"
          : "fix_error_succeeded"
        : status === "error"
          ? spec
            ? "patch_failed_validation"
            : "ai_build_failed_validation"
          : spec
            ? "patch_succeeded"
            : "ai_build_succeeded",
      { repairPasses: r.validation.repairPasses, status },
    );
    setTurns((t) => [
      ...t,
      { role: "ai", text: r.summary || r.changelog, issues: totalIssues, status, kind: "build" },
    ]);
    setError(null);
    if (status === "error") {
      setFailedDraft({ spec: r.spec, pine: r.pine, sgscript: r.sgscript, issuesText: formatIssuesForRepair(r) });
    } else {
      setFailedDraft(null);
      onBuilt(r);
    }
    requestAnimationFrame(() =>
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight }),
    );
  };

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
    onSuccess: (r) => handleResult(r, { isFix: false }),
    onError: (e: unknown) => {
      track(spec ? "patch_failed" : "ai_build_failed", {
        message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
      setError(e instanceof Error ? e.message : "Build failed");
    },
  });

  /** Explicit, user-triggered repair of the CURRENT failed draft — reuses
   * buildProject's own validate+repair pipeline (same as Build/Modify), just
   * seeded with the failing spec/sgscript and its exact issues instead of a
   * fresh instruction, so the user's project context is never discarded. */
  const fixError = useMutation({
    mutationFn: () => {
      if (!failedDraft) throw new Error("Nothing to fix");
      return buildProject({
        data: {
          request: `Fix these validation errors without changing the indicator's intent:\n${failedDraft.issuesText}`,
          symbol,
          timeframe: safeInterval,
          currentSpec: failedDraft.spec as unknown as Record<string, unknown>,
          currentSgscript: failedDraft.sgscript,
        },
      });
    },
    onSuccess: (r) => handleResult(r, { isFix: true }),
    onError: (e: unknown) => {
      track("fix_error_request_failed", {
        message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
      setError(e instanceof Error ? e.message : "Fix failed");
    },
  });

  const busy = build.isPending || fixError.isPending;

  const submit = () => {
    const text = prompt.trim();
    if (!text || busy || !signedIn) return;
    setTurns((t) => [...t, { role: "user", text }]);
    setPrompt("");
    setError(null);
    track("ai_build_started", { patch: !!spec });
    build.mutate(text);
  };

  const handleFixError = () => {
    if (!failedDraft || busy || !signedIn) return;
    setTurns((t) => [...t, { role: "user", text: "Fix the validation error." }]);
    setError(null);
    track("fix_error_started", {});
    fixError.mutate();
  };

  /** Describes the CURRENT spec in plain language — a pure, synchronous read
   * of state already held here. No model call, no market data, and it never
   * touches `spec`/`code`, so it can never modify or regenerate anything. */
  const handleExplain = () => {
    if (!spec) return;
    setTurns((t) => [
      ...t,
      { role: "user", text: "Explain this indicator." },
      { role: "ai", text: explainSpec(spec), kind: "explain" },
    ]);
    requestAnimationFrame(() =>
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight }),
    );
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
                    Signal Goat{t.kind === "explain" ? " · Explain" : ""}
                  </p>
                )}
                <p className={t.kind === "explain" ? "whitespace-pre-line" : ""}>{t.text}</p>
                {t.role === "ai" && t.kind !== "explain" && (
                  <p
                    className={`mt-0.5 text-[9.5px] ${
                      t.status === "error"
                        ? "font-medium text-destructive"
                        : t.status === "warning"
                          ? "text-amber-500"
                          : "text-muted-foreground"
                    }`}
                  >
                    {t.status === "error"
                      ? `${t.issues ?? 0} static-validation issue${(t.issues ?? 0) === 1 ? "" : "s"} — unresolved, not added to chart`
                      : t.status === "warning"
                        ? `${t.issues} static-validation note${t.issues === 1 ? "" : "s"} · plotted on the chart`
                        : "Passed static validation · plotted on the chart"}
                  </p>
                )}
              </div>
            ))}
            {busy && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {fixError.isPending
                  ? "Fixing the error & validating…"
                  : spec
                    ? "Applying your change & validating…"
                    : "Building your indicator & validating…"}
              </p>
            )}
            {error && <p className="text-[10px] text-destructive">{error}</p>}
          </div>

          {failedDraft && !busy && (
            <div className="mx-2 mb-1.5 space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-1.5">
              <p className="text-[10px] font-medium text-destructive">
                Build has an unresolved validation error — not added to the chart.
              </p>
              <button
                type="button"
                disabled={!signedIn}
                onClick={handleFixError}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-destructive/50 py-1 text-[10.5px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Wrench className="h-3 w-3" /> Fix Error
              </button>
            </div>
          )}

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
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!spec || busy}
                onClick={handleExplain}
                title={spec ? "Describe the current indicator — doesn't change anything" : "Build an indicator first"}
                className="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
              >
                <HelpCircle className="h-3 w-3" />
                Explain
              </button>
              <button
                disabled={!signedIn || busy || !prompt.trim()}
                onClick={submit}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-brand py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
              >
                {build.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {spec ? "Apply change" : "Build & add to chart"}
              </button>
            </div>
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
