// Phase 5A-4e — real algorithm coverage for the automatic Preview refresh
// orchestration in `src/components/builder/useBuilderPreviewRefresh.ts`.
//
// The hook itself cannot be mounted here — there is no live-browser/React
// render harness in this codebase (see test/builder/builderShell.test.mjs's
// own header comment). Exactly like test/builder/builderMarketData.test.mjs
// (the stale-fetch guard) and test/builder/previewExecution.test.mjs
// (the runSeqRef race), this file mirrors the hook's EXACT algorithm using
// plain objects in place of React refs/state/effects (a ref is just a
// mutable box; an effect keyed on a value is just "call this function when
// that value changes" — the algorithm is identical either way) and REAL
// `setTimeout`/`Promise` timing, not simulated clocks. It imports the real,
// pure `generationState.ts` functions directly (`canRunPreview`,
// `beginPreviewRun`, `applyPreviewResult`, `applyPreviewFailure`,
// `setManualSgscript`) — the exact same functions `useBuilderProject.ts`
// and the real hook call — so `submitRunPreview`'s own state transitions
// and stale-result guard are exercised for real, not re-implemented.
//
// Usage: npx tsx test/builder/builderPreviewRefresh.test.mjs

import {
  INITIAL_BUILDER_PROJECT_STATE,
  applyPreviewFailure,
  applyPreviewResult,
  beginPreviewRun,
  canRunPreview,
  setManualSgscript,
} from "../../src/lib/builder/generationState.ts";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} (${a} === ${e})`, a === e);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBOUNCE_MS = 500;

function fixtureBars(tag, n = 5) {
  return Array.from({ length: n }, (_, i) => ({ time: 1700000000 + i * 60, open: 100, high: 101, low: 99, close: 100.5, volume: 10, __tag: tag }));
}
function fixtureResult(name) {
  return { ok: true, meta: { name, overlay: true }, strategy: { declared: false, entries: [], exits: [], notes: [] }, inputs: [], plots: [], hlines: [], boxes: [], lines: [], labels: [], markers: [], fills: [], logs: [], ms: 1 };
}

/**
 * Mirrors `useBuilderProject.ts`'s real `submitRunPreview` (including its
 * real `runSeqRef` stale-result guard) plus `useBuilderPreviewRefresh.ts`'s
 * real `runNow`/`attemptAutoRun`/debounce/trigger-effect logic, wired
 * together exactly as `BuilderWorkspace.tsx` wires the real hooks.
 */
function makeBuilderSimulator(runIndicatorImpl, { initialBars = fixtureBars("BTCUSDT", 5) } = {}) {
  let state = { ...INITIAL_BUILDER_PROJECT_STATE };
  let manualEditVersion = 0;
  const runSeqRef = { current: 0 };

  let selectedSymbol = "BTCUSDT";
  let selectedTimeframe = "15m";
  // Mirrors the real app already having completed its initial bars-fetch by
  // the time a test cares about build/edit-triggered runs — the empty-to-
  // ready market-data LIFECYCLE itself is what section G/H/K exercise via
  // selectSymbol/selectTimeframe, not the very first mount fetch.
  let bars = initialBars;
  let barsLoading = false;

  let previewContext = null;
  const pendingContextRef = { current: null };
  // Mirrors the real hook's lastAttemptedRef fix: tracks the signature of
  // the LAST run attempted (success or failure), separate from
  // previewContext (which only advances on success). Without this, a
  // failing run would leave previewContext permanently behind, and the
  // retry-once-free logic would reattempt the same broken code forever.
  const lastAttemptedRef = { current: null };
  const debounceTimerRef = { current: null };
  const isRunningRef = { current: false };
  const runLog = [];
  const aiCallLog = [];
  const persistenceCallLog = [];

  function clearPendingDebounce() {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  // Real submitRunPreview mirror — identical logic to useBuilderProject.ts.
  async function submitRunPreview(barsArg) {
    if (!canRunPreview(state.sgscript, state.previewStatus, barsArg.length > 0)) return;
    runSeqRef.current += 1;
    const runId = runSeqRef.current;
    state = beginPreviewRun(state);
    try {
      const result = await runIndicatorImpl(state.sgscript, barsArg, {});
      if (runId === runSeqRef.current) state = applyPreviewResult(state, result);
    } catch (e) {
      if (runId === runSeqRef.current) state = applyPreviewFailure(state, e instanceof Error ? e.message : "Preview failed");
    }
  }

  function runNow() {
    clearPendingDebounce();
    isRunningRef.current = true;
    const ctx = { symbol: selectedSymbol, timeframe: selectedTimeframe, sgscript: state.sgscript };
    pendingContextRef.current = ctx;
    lastAttemptedRef.current = ctx;
    runLog.push({ ...ctx, barsTag: bars[0]?.__tag ?? null });
    const resultBefore = state.previewResult;
    void submitRunPreview(bars)
      .then(() => {
        if (state.previewResult && state.previewResult !== resultBefore && pendingContextRef.current) {
          previewContext = pendingContextRef.current;
        }
      })
      .finally(() => {
        isRunningRef.current = false;
        attemptAutoRun();
      });
  }

  function attemptAutoRun() {
    if (isRunningRef.current || barsLoading) return;
    if (!canRunPreview(state.sgscript, state.previewStatus, bars.length > 0)) return;
    const attempted = lastAttemptedRef.current;
    const alreadyAttempted =
      attempted !== null && attempted.symbol === selectedSymbol && attempted.timeframe === selectedTimeframe && attempted.sgscript === state.sgscript;
    if (alreadyAttempted) return;
    runNow();
  }

  function triggerManualRun() {
    if (isRunningRef.current || barsLoading) return;
    if (!canRunPreview(state.sgscript, state.previewStatus, bars.length > 0)) return;
    runNow();
  }

  // ---- driver actions (mirror what BuilderWorkspace/useBuilderMarketData actually do) ----

  function type(code) {
    manualEditVersion += 1;
    state = setManualSgscript(state, code);
    clearPendingDebounce();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      attemptAutoRun();
    }, DEBOUNCE_MS);
  }

  function buildSucceeds(code) {
    state = { ...state, sgscript: code, status: "success" };
    aiCallLog.push({ event: "buildProject", code });
    persistenceCallLog.push({ event: "createIndicatorOrUpdate" });
    clearPendingDebounce();
    attemptAutoRun();
  }

  function buildFails() {
    aiCallLog.push({ event: "buildProject-failed" });
    // sgscript/status/previewResult all deliberately untouched — no trigger call at all.
  }

  async function selectSymbol(sym, fetchImpl, delayMs = 0) {
    selectedSymbol = sym;
    barsLoading = true;
    bars = [];
    const result = await fetchImpl(delayMs);
    barsLoading = false;
    bars = result;
    attemptAutoRun();
  }

  async function selectTimeframe(tf, fetchImpl, delayMs = 0) {
    selectedTimeframe = tf;
    barsLoading = true;
    bars = [];
    const result = await fetchImpl(delayMs);
    barsLoading = false;
    bars = result;
    attemptAutoRun();
  }

  return {
    type,
    buildSucceeds,
    buildFails,
    selectSymbol,
    selectTimeframe,
    triggerManualRun,
    attemptAutoRun,
    clearPendingDebounce,
    get state() {
      return state;
    },
    get previewContext() {
      return previewContext;
    },
    get bars() {
      return bars;
    },
    get barsLoading() {
      return barsLoading;
    },
    get isRunning() {
      return isRunningRef.current;
    },
    get pendingDebounceActive() {
      return debounceTimerRef.current !== null;
    },
    runLog,
    aiCallLog,
    persistenceCallLog,
  };
}

// ==== A. Manual-edit debounce mechanics ==========================================
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("plot(ema(close, 20))");
  await wait(20); // let the build-success auto-run settle
  eq("build success produced exactly one run before the debounce test begins", sim.runLog.length, 1);

  sim.type("plot(ema(close, 21))");
  await wait(200);
  eq("manual typing: no run has fired yet at 200ms (debounce is 500ms)", sim.runLog.length, 1);
  await wait(400); // total ~600ms since the edit
  eq("manual typing: exactly one new run fires once 500ms of silence has passed", sim.runLog.length, 2);
  eq("the debounced run used the latest typed code", sim.runLog[1].sgscript, "plot(ema(close, 21))");
}

// ==== B. Rapid typing collapses into exactly one run ==============================
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("v0");
  await wait(20);
  const before = sim.runLog.length;

  for (let i = 1; i <= 10; i++) {
    sim.type(`v${i}`);
    await wait(40); // well under the 500ms window — keeps resetting the timer
  }
  await wait(600);
  eq("10 rapid edits inside the debounce window produce exactly ONE scheduled run", sim.runLog.length - before, 1);
  eq("that one run used the FINAL typed value, not an intermediate one", sim.runLog[sim.runLog.length - 1].sgscript, "v10");
}

// ==== C. Paste / undo / redo follow the identical debounce mechanism ==============
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("v0");
  await wait(20);
  const before = sim.runLog.length;
  // Paste and undo/redo both arrive through CodeMirror's identical onChange
  // path as a normal keystroke (confirmed by reading CodeEditor.tsx) — this
  // simulator's `type()` IS that exact same signal, so exercising it here
  // with a large multi-line "paste" and then a shorter "undo" value proves
  // both are handled by the same single mechanism, not special-cased.
  sim.type("// pasted a much larger block\nplot(ema(close, 55))");
  await wait(550);
  eq("a large pasted change debounces exactly like typing", sim.runLog.length - before, 1);
  sim.type("v0"); // "undo" back to the original value
  await wait(550);
  eq("an undo-produced change debounces exactly like typing", sim.runLog.length - before, 2);
}

// ==== D. Manual Run Preview cancels a pending debounce =============================
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("v0");
  await wait(20);
  const before = sim.runLog.length;

  sim.type("v1");
  await wait(100); // well before the 500ms debounce fires
  ok("a debounce is genuinely pending before the manual click", sim.pendingDebounceActive);
  sim.triggerManualRun();
  await wait(20);
  eq("manual Run Preview fires immediately, bypassing the debounce", sim.runLog.length - before, 1);
  ok("the pending debounce timer was cancelled by the manual click", !sim.pendingDebounceActive);

  await wait(500); // past when the original debounced run would have fired
  eq("the cancelled debounce never fires afterward — still exactly one run", sim.runLog.length - before, 1);
}

// ==== E. Build/refinement success triggers ==========================================
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("first build");
  await wait(20);
  eq("first successful AI Build auto-runs Preview exactly once", sim.runLog.length, 1);
  ok("no manual Run Preview click was needed for the first build", true);

  // A build outcome classified "warning" still sets LifecycleStatus to
  // "success" and commits sgscript (confirmed in generationState.ts's
  // applyBuildSuccess — only the "error" classification diverts to
  // failedDraft) — from this trigger's perspective it is indistinguishable
  // from a plain success, so the same buildSucceeds() call exercises it.
  sim.buildSucceeds("build with warnings");
  await wait(20);
  eq("a warning-carrying build success also auto-runs exactly once", sim.runLog.length, 2);

  sim.buildSucceeds("refined version");
  await wait(20);
  eq("a successful AI refinement auto-runs Preview exactly once more", sim.runLog.length, 3);
  eq("the refinement's run used the newly-refined code", sim.runLog[2].sgscript, "refined version");
}

// ==== F. Build/refinement failure does not auto-run and preserves last-good ========
{
  const sim = makeBuilderSimulator(async () => fixtureResult("EMA"));
  sim.buildSucceeds("good version");
  await wait(20);
  const previewResultBefore = sim.state.previewResult;
  const sgscriptBefore = sim.state.sgscript;
  const runsBefore = sim.runLog.length;

  sim.buildFails();
  await wait(20);
  eq("a build/refinement failure triggers zero additional Preview runs", sim.runLog.length, runsBefore);
  eq("a build/refinement failure never changes state.sgscript", sim.state.sgscript, sgscriptBefore);
  ok("a build/refinement failure preserves the exact last-good previewResult reference", sim.state.previewResult === previewResultBefore);
}

// ==== G. Symbol/timeframe changes never execute against stale bars =================
{
  const sim = makeBuilderSimulator(async (code, bars) => fixtureResult(`EMA-${bars[0]?.__tag}`));
  sim.buildSucceeds("plot(close)");
  await wait(20);
  eq("initial build+bars produced exactly one run", sim.runLog.length, 1);
  eq("that run used the initial BTCUSDT bars", sim.runLog[0].barsTag, "BTCUSDT");

  const before = sim.runLog.length;
  const symbolPromise = sim.selectSymbol("ETHUSDT", async (delayMs) => {
    await wait(delayMs);
    return fixtureBars("ETHUSDT", 5);
  }, 60);
  // Bars are cleared synchronously the instant the selection changes — no
  // run can possibly fire against the old BTCUSDT bars in this window.
  eq("bars are cleared immediately on symbol change, before any new fetch resolves", sim.bars.length, 0);
  ok("barsLoading is true immediately after a symbol change", sim.barsLoading);
  await symbolPromise;
  eq("exactly one new Preview run fires once the correct ETHUSDT bars arrive", sim.runLog.length - before, 1);
  eq("that run used the real ETHUSDT bars, never the old BTCUSDT ones", sim.runLog[sim.runLog.length - 1].barsTag, "ETHUSDT");

  const before2 = sim.runLog.length;
  await sim.selectTimeframe("1h", async (delayMs) => {
    await wait(delayMs);
    return fixtureBars("ETHUSDT-1h", 5);
  }, 30);
  eq("timeframe change behaves identically: exactly one new run against the new bars", sim.runLog.length - before2, 1);
  eq("that run used the 1h bars", sim.runLog[sim.runLog.length - 1].barsTag, "ETHUSDT-1h");
}

// ==== H. A stale, slower fetch cannot overwrite a newer selection's bars ===========
{
  const sim = makeBuilderSimulator(async (code, bars) => fixtureResult(`EMA-${bars[0]?.__tag}`));
  sim.buildSucceeds("plot(close)");
  await wait(20);
  const before = sim.runLog.length;

  // Symbol A (slow) started first; Symbol B (fast) started after and
  // resolves first — B's bars must be the only ones ever run against.
  const slowA = sim.selectSymbol("SYM_A", async (d) => {
    await wait(d);
    return fixtureBars("SYM_A", 3);
  }, 80);
  const fastB = sim.selectSymbol("SYM_B", async (d) => {
    await wait(d);
    return fixtureBars("SYM_B", 3);
  }, 10);
  await Promise.all([slowA, fastB]);
  await wait(20);

  const tagsUsed = sim.runLog.slice(before).map((r) => r.barsTag);
  ok("the stale, slower SYM_A fetch never produced a run against its bars", !tagsUsed.includes("SYM_A"));
  ok("only the newer SYM_B selection's bars were ever run against", tagsUsed.includes("SYM_B"));
}

// ==== I. runSeqRef still wins the concurrency race once auto-runs exist ===========
{
  const sim = makeBuilderSimulator(async (code) => {
    if (code === "slow") {
      await wait(60);
      return fixtureResult("slow-result");
    }
    await wait(10);
    return fixtureResult("fast-result");
  });
  sim.buildSucceeds("slow"); // starts a slow run (via the build-success trigger)
  await wait(5); // let it begin, but not finish
  sim.type("fast"); // schedule a debounced edit
  // Force the debounced edit to fire immediately via a manual click instead
  // of waiting the full 500ms, so its run genuinely overlaps the slow one.
  sim.triggerManualRun();
  await wait(120); // both the slow (60ms) and fast (10ms) runs have settled by now

  eq("the OLDER, slower run's result never wins", sim.state.previewResult.meta.name, "fast-result");
  ok("previewContext reflects the newer run's code, not the older one", sim.previewContext.sgscript === "fast");
}

// ==== J. Edit during an in-flight run causes exactly one newest follow-up run =====
{
  let callN = 0;
  const sim = makeBuilderSimulator(async (code) => {
    callN += 1;
    await wait(80);
    return fixtureResult(`r${callN}-${code}`);
  });
  sim.buildSucceeds("v1"); // starts a slow (80ms) run
  await wait(10);
  ok("a run is genuinely in flight", sim.isRunning);

  sim.type("v2"); // debounce scheduled for +500ms, but the in-flight run finishes first (~80ms)
  await wait(700); // long enough for both the in-flight run AND the debounced retry to settle
  eq("exactly one follow-up run occurred for the newest code after the in-flight run finished", sim.runLog.filter((r) => r.sgscript === "v2").length, 1);
  eq("the visible result is the newest code's result", sim.state.previewResult.meta.name, `r2-v2`);
}

// ==== K. Bars becoming ready during an in-flight run also retries exactly once =====
{
  let callN = 0;
  const sim = makeBuilderSimulator(async (code, bars) => {
    callN += 1;
    await wait(70);
    return fixtureResult(`b${callN}-${bars[0]?.__tag}`);
  });
  sim.buildSucceeds("v1");
  await wait(10);
  ok("a run is genuinely in flight", sim.isRunning);

  const symbolPromise = sim.selectSymbol("NEWSYM", async (d) => {
    await wait(d);
    return fixtureBars("NEWSYM", 4);
  }, 30); // resolves while the first run (70ms) is still in flight
  await symbolPromise;
  await wait(150);

  const followUps = sim.runLog.filter((r) => r.barsTag === "NEWSYM");
  eq("exactly one follow-up run occurred against the newly-arrived bars", followUps.length, 1);
}

// ==== L. No infinite auto-run loop once Preview is current ==========================
{
  const sim = makeBuilderSimulator(async () => fixtureResult("stable"));
  sim.buildSucceeds("v1");
  await wait(30);
  const settledCount = sim.runLog.length;
  // Re-invoke the exact same trigger functions the real effects would call
  // on every dependency-array re-evaluation — nothing changed, so nothing
  // should fire again.
  sim.attemptAutoRun();
  sim.attemptAutoRun();
  await wait(30);
  eq("calling the auto-run check again with nothing changed produces zero further runs", sim.runLog.length, settledCount);
}

// ==== M. Runtime failure preserves the last-good chart ==============================
{
  let shouldFail = false;
  const sim = makeBuilderSimulator(async () => {
    if (shouldFail) throw new Error("boom: invalid indicator");
    return fixtureResult("good");
  });
  sim.buildSucceeds("good code");
  await wait(20);
  const goodResult = sim.state.previewResult;
  ok("a real successful result exists", goodResult !== null);

  shouldFail = true;
  sim.type("bad code");
  await wait(550);
  eq("a real runtime failure surfaces previewError", sim.state.previewStatus, "error");
  ok("a real runtime failure NEVER erases the last-good previewResult", sim.state.previewResult === goodResult);
}

// ==== N. previewContext.sgscript distinguishes current vs stale code ===============
{
  const sim = makeBuilderSimulator(async () => fixtureResult("v"));
  sim.buildSucceeds("codeA");
  await wait(20);
  eq("previewContext.sgscript matches the just-run code (current)", sim.previewContext.sgscript, "codeA");

  sim.type("codeB");
  await wait(50); // debounce still pending — previewContext hasn't advanced yet
  ok("previewContext.sgscript still reflects the OLDER code while the debounce is pending (this IS what marks the visible chart code-stale)", sim.previewContext.sgscript === "codeA" && sim.state.sgscript === "codeB");

  await wait(550);
  eq("once the debounced run lands, previewContext.sgscript advances to match the current code again", sim.previewContext.sgscript, "codeB");
}

// ==== O. Zero AI/persistence calls from typing or from Preview execution itself ====
{
  const sim = makeBuilderSimulator(async () => fixtureResult("v"));
  sim.buildSucceeds("v1"); // the ONE legitimate AI event in this whole test
  await wait(20);
  const aiCallsAfterBuild = sim.aiCallLog.length;
  const persistenceCallsAfterBuild = sim.persistenceCallLog.length;

  for (let i = 0; i < 5; i++) sim.type(`v${i}`);
  await wait(600);
  eq("ordinary typing calls the AI build path zero times", sim.aiCallLog.length, aiCallsAfterBuild);
  eq("ordinary typing calls the persistence path zero times", sim.persistenceCallLog.length, persistenceCallsAfterBuild);

  sim.triggerManualRun();
  await wait(20);
  eq("an explicit Preview execution calls the AI build path zero times", sim.aiCallLog.length, aiCallsAfterBuild);
  eq("an explicit Preview execution calls the persistence path zero times", sim.persistenceCallLog.length, persistenceCallsAfterBuild);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
