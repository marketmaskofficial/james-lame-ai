import { useEffect, useRef, useState } from "react";
import { canRunPreview, type LifecycleStatus, type PreviewStatus } from "@/lib/builder/generationState";
import type { Timeframe } from "@/lib/marketdata";
import type { Bar, RunResult } from "@/lib/sgscript/types";

/**
 * Phase 5A-4e — automatic Preview refresh orchestration.
 *
 * Owns exactly three things: the 500ms manual-edit debounce timer, the
 * `PreviewContext` freshness record (which symbol/timeframe/sgscript the
 * currently-displayed `previewResult` was actually computed against), and
 * the trigger effects that decide WHEN to call the caller-supplied
 * `submitRunPreview`. It never calls `runIndicator` itself, never fetches
 * bars, never calls `buildProject`/`validateProject`/any persistence
 * function, and never owns a second copy of `sgscript` — `submitRunPreview`
 * (Phase 5A-4b, `useBuilderProject.ts`) remains the ONE `runIndicator` call
 * site in all of Builder; this hook is purely "when should I call it."
 *
 * Three trigger effects, each answering a different question about WHY a
 * run might be needed, all funneling through the same `attemptAutoRun`:
 *   1. `buildStatus` transitions to `"success"` — a build/refinement just
 *      committed real `sgscript` (Phase 5A-4e §1/§2). Immediate, no debounce.
 *   2. `bars`/`barsLoading` settle into "ready" — a symbol/timeframe change
 *      (or the initial load) just produced a fresh, correct `Bar[]` (§5).
 *      Immediate, no debounce. `useBuilderMarketData`'s own fetch effect
 *      already clears `bars` to `[]` the instant selection changes, so this
 *      trigger can never fire against a stale symbol's bars — there simply
 *      are none to run against until the new fetch actually lands.
 *   3. `manualEditVersion` increments — a real keystroke/paste/undo/redo
 *      touched `state.sgscript` (§3/§4). Debounced 500ms, and the timer is
 *      reset on every further increment.
 * Plus one retry effect (§7): `previewStatus` changing (including the
 * moment a run finishes) re-evaluates `attemptAutoRun` so a trigger that
 * arrived while a run was in flight is retried exactly once, with no queue
 * and no `AbortController` — `canRunPreview`'s own `previewStatus !==
 * "running"` gate is what prevented it from firing concurrently in the
 * first place.
 *
 * `attemptAutoRun` itself is idempotent and self-terminating: it compares
 * the CURRENT `{symbol, timeframe, sgscript}` against `lastAttemptedRef`
 * (the signature of whatever was last ATTEMPTED, success or failure — see
 * that ref's own doc comment for why this must be separate from
 * `previewContext`) and no-ops if they already match, so it can be called
 * redundantly (e.g. by two trigger effects settling in close succession, or
 * by the retry-once-free effect after every single run) without ever
 * double-running or looping. A synchronous `isRunningRef` closes the one
 * gap `previewStatus` can't (two triggers firing in the same React commit,
 * before a `setState` from the first has actually re-rendered) — this is
 * NOT a second guard duplicating `runSeqRef`'s job (which decides which
 * ASYNC RESULT wins); it only prevents a second call to `submitRunPreview`
 * from being ISSUED in the same tick a first one already started.
 */

export type PreviewContext = { symbol: string; timeframe: Timeframe; sgscript: string };

const MANUAL_EDIT_DEBOUNCE_MS = 500;

export function useBuilderPreviewRefresh({
  sgscript,
  buildStatus,
  previewStatus,
  previewResult,
  manualEditVersion,
  selectedSymbol,
  selectedTimeframe,
  bars,
  barsLoading,
  submitRunPreview,
}: {
  sgscript: string;
  buildStatus: LifecycleStatus;
  previewStatus: PreviewStatus;
  previewResult: RunResult | null;
  manualEditVersion: number;
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  bars: Bar[];
  barsLoading: boolean;
  submitRunPreview: (bars: Bar[]) => Promise<void>;
}): { previewContext: PreviewContext | null; triggerManualRun: () => void } {
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null);
  const pendingContextRef = useRef<PreviewContext | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef = useRef(false);
  /** Tracks the signature of the LAST run actually attempted, success or
   * failure — deliberately separate from `previewContext` (which only ever
   * advances on success, so `PreviewPanel` never mislabels a failed run's
   * input as current). Without this, a failing run would leave
   * `previewContext` permanently behind the current signature, and the
   * retry-once-free effect (trigger 4 below) would reattempt the exact same
   * broken code forever the instant each attempt finished — a genuine
   * infinite loop, caught by this file's own real-execution test suite.
   * Manual retries (`triggerManualRun`) deliberately bypass this check
   * entirely — an explicit click is always allowed to reattempt an
   * unchanged, still-failing signature on purpose. */
  const lastAttemptedRef = useRef<PreviewContext | null>(null);

  // Kept in a ref (not the effect closures below) so every trigger path —
  // automatic or manual — always reads the truly-current values, exactly
  // the same reasoning `useBuilderProject.ts` already applies to
  // `indicatorIdRef`.
  const latestRef = useRef({ sgscript, selectedSymbol, selectedTimeframe, bars, barsLoading, previewStatus });
  latestRef.current = { sgscript, selectedSymbol, selectedTimeframe, bars, barsLoading, previewStatus };

  function clearPendingDebounce() {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  function runNow() {
    const l = latestRef.current;
    clearPendingDebounce();
    isRunningRef.current = true;
    const ctx: PreviewContext = { symbol: l.selectedSymbol, timeframe: l.selectedTimeframe, sgscript: l.sgscript };
    pendingContextRef.current = ctx;
    lastAttemptedRef.current = ctx;
    void submitRunPreview(l.bars).finally(() => {
      isRunningRef.current = false;
    });
  }

  /** The one gate every automatic trigger passes through. Never fabricates
   * a run: no-ops whenever `canRunPreview` (the same pure guard the manual
   * button uses) says no, whenever bars are mid-fetch, whenever a run is
   * already in flight, or whenever the current signature was already the
   * LAST one attempted (success or failure) — that last check is what
   * makes this self-terminating rather than an infinite-retry risk, both
   * once Preview is genuinely current AND after a run that simply failed
   * (a failed run never advances `previewContext`, so comparing against
   * `previewContext` alone would retry the same broken code forever). */
  function attemptAutoRun() {
    const l = latestRef.current;
    if (isRunningRef.current || l.barsLoading) return;
    if (!canRunPreview(l.sgscript, l.previewStatus, l.bars.length > 0)) return;
    const attempted = lastAttemptedRef.current;
    const alreadyAttempted =
      attempted !== null && attempted.symbol === l.selectedSymbol && attempted.timeframe === l.selectedTimeframe && attempted.sgscript === l.sgscript;
    if (alreadyAttempted) return;
    runNow();
  }

  /** Promotes `pendingContextRef` to the displayed `previewContext` only
   * once `previewResult` actually changes to a new successful value — never
   * on failure (`applyPreviewFailure` never touches `previewResult`, so
   * this must not update either, or a failed run against a NEW signature
   * would incorrectly relabel the OLD, still-displayed chart as current). */
  useEffect(() => {
    if (previewResult && pendingContextRef.current) {
      setPreviewContext(pendingContextRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewResult]);

  // Trigger 1 — build/refinement success: immediate, no debounce (§1/§2).
  useEffect(() => {
    if (buildStatus === "success") {
      clearPendingDebounce();
      attemptAutoRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus]);

  // Trigger 2 — bars became ready (initial load or symbol/timeframe
  // change): immediate, no debounce (§5). Cannot fire against stale bars —
  // `useBuilderMarketData` already cleared `bars` to `[]` the instant the
  // selection changed, before this trigger's dependencies could even see a
  // "ready" state again.
  useEffect(() => {
    if (!barsLoading && bars.length > 0) {
      attemptAutoRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barsLoading, bars]);

  // Trigger 3 — manual edit: debounced 500ms, reset on every further edit
  // (§3/§4). Guarded on `manualEditVersion > 0` so mounting never schedules
  // a run before any real keystroke has happened.
  useEffect(() => {
    if (manualEditVersion === 0) return;
    clearPendingDebounce();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      attemptAutoRun();
    }, MANUAL_EDIT_DEBOUNCE_MS);
    return clearPendingDebounce;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualEditVersion]);

  // Trigger 4 — retry-once-free (§7): re-evaluates whenever previewStatus
  // changes, including the moment a run finishes. No queue, no flag — a
  // trigger that arrived while busy simply left the signature mismatched,
  // and this is what notices that once free.
  useEffect(() => {
    attemptAutoRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewStatus]);

  /** The Run Preview button's handler (§6): explicit, immediate, cancels
   * any pending debounce, bypasses the "already current" signature check
   * (a manual click is an intentional re-run/retry even if nothing
   * changed) — but still respects `canRunPreview`/`barsLoading`/
   * `isRunningRef` so it can never spawn a second concurrent Worker. */
  function triggerManualRun() {
    const l = latestRef.current;
    if (isRunningRef.current || l.barsLoading) return;
    if (!canRunPreview(l.sgscript, l.previewStatus, l.bars.length > 0)) return;
    runNow();
  }

  return { previewContext, triggerManualRun };
}
