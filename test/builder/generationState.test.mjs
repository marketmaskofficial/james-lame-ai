// Coverage for the Phase 5A-2 Indicator Builder generation lifecycle:
// src/lib/builder/generationState.ts. Pure, synchronous, no I/O — every
// state transition and request-payload shape is exercised directly against
// hand-built `BuildResult` fixtures, matching the style of
// test/dashboard/journalAnalytics.test.mjs.
//
// Usage: npx tsx test/builder/generationState.test.mjs

import {
  INITIAL_BUILDER_PROJECT_STATE,
  appendUserMessage,
  applyBuildFailure,
  applyBuildSuccess,
  buildRequestPayload,
  canSubmitFixError,
  canSubmitPrompt,
  fixErrorRequestPayload,
  repairPassesLabel,
  withIndicatorId,
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

/** A minimal, valid IndicatorSpec fixture. */
function spec(overrides = {}) {
  return {
    version: 1,
    name: "Test Indicator",
    purpose: "",
    kind: "indicator",
    overlay: true,
    symbols: [],
    higherTimeframes: [],
    lowerTimeframes: [],
    sessions: [],
    dataRequirements: [],
    dataLimitations: [],
    inputs: [],
    calculations: [],
    bullishConditions: [],
    bearishConditions: [],
    confirmations: [],
    stateRules: [],
    entries: [],
    exits: [],
    plots: [],
    drawings: [],
    alerts: [],
    colors: {},
    repaint: "unknown",
    assumptions: [],
    ...overrides,
  };
}

/** A minimal, valid BuildResult fixture — mirrors the exact shape
 * `buildProject` (src/lib/project.functions.ts) returns. */
function buildResult(overrides = {}) {
  return {
    spec: spec(),
    pine: "//@version=6\nindicator('x')",
    sgscript: "plot(close)",
    summary: "Built a test indicator.",
    changelog: "Initial build",
    validation: {
      pine: { ok: true, issues: [], repaint: { classification: "unknown" } },
      sgscript: { ok: true, issues: [] },
      repairPasses: 0,
      method: "static-validation",
    },
    ...overrides,
  };
}

function issue(overrides = {}) {
  return { severity: "error", code: "test-issue", message: "Something is wrong", ...overrides };
}

// ==== appendUserMessage =======================================================
{
  const s1 = appendUserMessage(INITIAL_BUILDER_PROJECT_STATE, "Build me a 20 EMA overlay");
  eq("appendUserMessage: adds exactly one message", s1.messages.length, 1);
  eq("appendUserMessage: role is user", s1.messages[0].role, "user");
  eq("appendUserMessage: kind is build", s1.messages[0].kind, "build");
  eq("appendUserMessage: text matches input", s1.messages[0].text, "Build me a 20 EMA overlay");
  eq("appendUserMessage: not yet persisted", s1.messages[0].persisted, false);
  eq("appendUserMessage: transitions status to generating", s1.status, "generating");
  eq("appendUserMessage: clears any prior error", appendUserMessage({ ...INITIAL_BUILDER_PROJECT_STATE, error: "old error" }, "x").error, null);
  ok("appendUserMessage: original state object is not mutated", INITIAL_BUILDER_PROJECT_STATE.messages.length === 0);
}

// ==== applyBuildSuccess — success outcome =====================================
{
  const afterUser = appendUserMessage(INITIAL_BUILDER_PROJECT_STATE, "Build a 20 EMA overlay");
  const result = buildResult();
  const s = applyBuildSuccess(afterUser, result);

  eq("applyBuildSuccess(success): status becomes success", s.status, "success");
  eq("applyBuildSuccess(success): spec is stored", s.spec.name, "Test Indicator");
  eq("applyBuildSuccess(success): pine is stored", s.pine, result.pine);
  eq("applyBuildSuccess(success): sgscript is stored", s.sgscript, result.sgscript);
  eq("applyBuildSuccess(success): summary is stored", s.summary, result.summary);
  eq("applyBuildSuccess(success): validation is stored", s.validation, result.validation);
  eq("applyBuildSuccess(success): repairPasses is stored", s.repairPasses, 0);
  eq("applyBuildSuccess(success): failedDraft is null", s.failedDraft, null);
  eq("applyBuildSuccess(success): dirty becomes true", s.dirty, true);
  eq("applyBuildSuccess(success): appends exactly one AI message (plus the earlier user message = 2 total)", s.messages.length, 2);
  eq("applyBuildSuccess(success): AI message role", s.messages[1].role, "ai");
  eq("applyBuildSuccess(success): AI message status is success", s.messages[1].status, "success");
  eq("applyBuildSuccess(success): AI message text uses the summary", s.messages[1].text, result.summary);
  eq("applyBuildSuccess(success): AI message carries repairPasses", s.messages[1].repairPasses, 0);
}

// ==== applyBuildSuccess — warning outcome (issues present, still ok) =========
{
  const withWarning = buildResult({
    validation: {
      pine: { ok: true, issues: [issue({ severity: "warning", code: "note" })], repaint: { classification: "unknown" } },
      sgscript: { ok: true, issues: [] },
      repairPasses: 1,
      method: "static-validation",
    },
  });
  const s = applyBuildSuccess(INITIAL_BUILDER_PROJECT_STATE, withWarning);
  eq("applyBuildSuccess(warning): status success (never a distinct lifecycle state)", s.status, "success");
  eq("applyBuildSuccess(warning): AI message status is warning", s.messages[0].status, "warning");
  eq("applyBuildSuccess(warning): AI message issues count is 1", s.messages[0].issues, 1);
  eq("applyBuildSuccess(warning): repairPasses reported as 1", s.messages[0].repairPasses, 1);
  eq("applyBuildSuccess(warning): still commits spec/pine/sgscript (warning is not error)", s.sgscript, withWarning.sgscript);
  eq("applyBuildSuccess(warning): still marks dirty", s.dirty, true);
}

// ==== applyBuildSuccess — error outcome (unresolved validation failure) ======
{
  const withError = buildResult({
    pine: "BAD PINE",
    sgscript: "BAD SGSCRIPT",
    validation: {
      pine: { ok: false, issues: [issue({ code: "no-version" })], repaint: { classification: "unknown" } },
      sgscript: { ok: true, issues: [] },
      repairPasses: 3,
      method: "static-validation",
    },
  });
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec({ name: "Previous good spec" }), pine: "OLD PINE", sgscript: "OLD SGSCRIPT", dirty: false };
  const s = applyBuildSuccess(before, withError);

  eq("applyBuildSuccess(error): lifecycle becomes validationFailed", s.status, "validationFailed");
  ok("applyBuildSuccess(error): failedDraft is populated", s.failedDraft !== null);
  eq("applyBuildSuccess(error): failedDraft carries the FAILING pine", s.failedDraft.pine, "BAD PINE");
  eq("applyBuildSuccess(error): failedDraft carries the FAILING sgscript", s.failedDraft.sgscript, "BAD SGSCRIPT");
  ok("applyBuildSuccess(error): failedDraft.issuesText mentions the issue code", s.failedDraft.issuesText.includes("no-version"));
  eq("applyBuildSuccess(error): NEVER commits the failing pine over the previous good one", s.pine, "OLD PINE");
  eq("applyBuildSuccess(error): NEVER commits the failing sgscript over the previous good one", s.sgscript, "OLD SGSCRIPT");
  eq("applyBuildSuccess(error): NEVER commits the failing spec over the previous good one", s.spec.name, "Previous good spec");
  eq("applyBuildSuccess(error): dirty is NOT set (nothing new was actually committed)", s.dirty, false);
  eq("applyBuildSuccess(error): AI message status is error", s.messages[s.messages.length - 1].status, "error");
}

// ==== applyBuildFailure — AI/network failure, no BuildResult at all ==========
{
  const afterUser = appendUserMessage(INITIAL_BUILDER_PROJECT_STATE, "Build something");
  const s = applyBuildFailure(afterUser, "Network timeout");
  eq("applyBuildFailure: lifecycle becomes generationFailed", s.status, "generationFailed");
  eq("applyBuildFailure: error message stored", s.error, "Network timeout");
  eq("applyBuildFailure: the user's own message is preserved untouched", s.messages.length, 1);
  eq("applyBuildFailure: no AI message is fabricated", s.messages[0].role, "user");
  eq("applyBuildFailure: spec remains whatever it was before (null here)", s.spec, null);
}

// ==== withIndicatorId ==========================================================
{
  const s = withIndicatorId(INITIAL_BUILDER_PROJECT_STATE, "11111111-1111-1111-1111-111111111111");
  eq("withIndicatorId: sets indicatorId", s.indicatorId, "11111111-1111-1111-1111-111111111111");
  eq("withIndicatorId: does not touch messages", s.messages, INITIAL_BUILDER_PROJECT_STATE.messages);
}

// ==== buildRequestPayload — first build vs. follow-up refinement ============
{
  const firstBuild = buildRequestPayload(INITIAL_BUILDER_PROJECT_STATE, "Build a 20 EMA overlay");
  eq("buildRequestPayload(no spec yet): operation is build", firstBuild.operation, "build");
  eq("buildRequestPayload(no spec yet): request text passed through", firstBuild.request, "Build a 20 EMA overlay");
  ok("buildRequestPayload(no spec yet): currentSpec omitted", firstBuild.currentSpec === undefined);
  ok("buildRequestPayload(no spec yet): currentSgscript omitted", firstBuild.currentSgscript === undefined);

  const afterSuccess = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec({ name: "Existing" }), sgscript: "plot(close)" };
  const followUp = buildRequestPayload(afterSuccess, "Make the EMA 50 instead of 20");
  eq("buildRequestPayload(has spec): operation is modify", followUp.operation, "modify");
  eq("buildRequestPayload(has spec): currentSpec is the CURRENT spec", followUp.currentSpec.name, "Existing");
  eq("buildRequestPayload(has spec): currentSgscript is the CURRENT sgscript", followUp.currentSgscript, "plot(close)");

  const withEmptySgscript = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec(), sgscript: "   " };
  const followUpEmpty = buildRequestPayload(withEmptySgscript, "x");
  ok("buildRequestPayload(has spec, whitespace-only sgscript): currentSgscript omitted, never sent as blank", followUpEmpty.currentSgscript === undefined);
}

// ==== fixErrorRequestPayload ===================================================
{
  const draft = { spec: spec({ name: "Broken one" }), pine: "BAD", sgscript: "BAD_SG", issuesText: "[error] no-version: missing version" };
  const payload = fixErrorRequestPayload(draft);
  eq("fixErrorRequestPayload: operation is fix_error", payload.operation, "fix_error");
  ok("fixErrorRequestPayload: request text includes the actual issues", payload.request.includes("no-version"));
  eq("fixErrorRequestPayload: currentSpec is the failing draft's spec", payload.currentSpec.name, "Broken one");
  eq("fixErrorRequestPayload: currentSgscript is the failing draft's sgscript", payload.currentSgscript, "BAD_SG");
}

// ==== canSubmitPrompt guard — empty prompt / duplicate-submit protection ====
{
  ok("canSubmitPrompt: real text, idle, signed in -> true", canSubmitPrompt("Build an EMA", "idle", true) === true);
  ok("canSubmitPrompt: empty string -> false", canSubmitPrompt("", "idle", true) === false);
  ok("canSubmitPrompt: whitespace-only -> false (empty prompts must never call AI)", canSubmitPrompt("   \n\t  ", "idle", true) === false);
  ok("canSubmitPrompt: while generating -> false (duplicate submission blocked)", canSubmitPrompt("Build an EMA", "generating", true) === false);
  ok("canSubmitPrompt: not signed in -> false", canSubmitPrompt("Build an EMA", "idle", false) === false);
  ok("canSubmitPrompt: success status with real text -> true (follow-ups allowed)", canSubmitPrompt("Refine it", "success", true) === true);
}

// ==== canSubmitFixError guard ==================================================
{
  const draft = { spec: spec(), pine: "", sgscript: "", issuesText: "" };
  ok("canSubmitFixError: real draft, idle-ish status, signed in -> true", canSubmitFixError(draft, "validationFailed", true) === true);
  ok("canSubmitFixError: no draft -> false", canSubmitFixError(null, "validationFailed", true) === false);
  ok("canSubmitFixError: while generating -> false", canSubmitFixError(draft, "generating", true) === false);
  ok("canSubmitFixError: not signed in -> false", canSubmitFixError(draft, "validationFailed", false) === false);
}

// ==== repairPassesLabel — honest, retroactive disclosure only =================
{
  eq("repairPassesLabel(0): null (nothing to disclose)", repairPassesLabel(0), null);
  eq("repairPassesLabel(null): null", repairPassesLabel(null), null);
  eq("repairPassesLabel(undefined): null", repairPassesLabel(undefined), null);
  eq("repairPassesLabel(1): singular phrasing", repairPassesLabel(1), "1 automatic repair pass");
  eq("repairPassesLabel(3): plural phrasing", repairPassesLabel(3), "3 automatic repair passes");
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
