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
  applyValidationFailure,
  applyValidationResult,
  beginValidation,
  buildRequestPayload,
  canSubmitFixError,
  canSubmitPrompt,
  canSubmitValidate,
  fixErrorRequestPayload,
  repairPassesLabel,
  setManualSgscript,
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

// ==== setManualSgscript — Phase 5A-3's ONE manual-edit state transition ====
{
  const before = {
    ...INITIAL_BUILDER_PROJECT_STATE,
    indicatorId: "11111111-1111-1111-1111-111111111111",
    spec: spec({ name: "EMA 20" }),
    pine: "//@version=6\nindicator('x')",
    sgscript: "const length = 20\nplot(ema(close, length))",
    summary: "A 20 EMA overlay.",
    changelog: "Initial build",
    validation: { pine: { ok: true, issues: [], repaint: { classification: "unknown" } }, sgscript: { ok: true, issues: [] }, repairPasses: 0, method: "static-validation" },
    repairPasses: 0,
    messages: [{ id: "m1", role: "user", kind: "build", text: "Build a 20 EMA overlay", createdAt: "2026-01-01T00:00:00.000Z", persisted: true }],
    status: "success",
    failedDraft: null,
    dirty: false,
    error: null,
    validationPending: false,
    validationError: "stale error from an earlier failed Validate click",
  };
  const edited = setManualSgscript(before, "const length = 30\nplot(ema(close, length))");

  eq("setManualSgscript: sgscript becomes the manually edited value", edited.sgscript, "const length = 30\nplot(ema(close, length))");
  eq("setManualSgscript: dirty becomes true", edited.dirty, true);
  eq("setManualSgscript: spec is preserved untouched", edited.spec, before.spec);
  eq("setManualSgscript: pine is preserved untouched", edited.pine, before.pine);
  eq("setManualSgscript: indicatorId is preserved untouched", edited.indicatorId, before.indicatorId);
  eq("setManualSgscript: messages are preserved untouched", edited.messages, before.messages);
  eq("setManualSgscript: validation is preserved untouched (stays whatever it was, even if now stale)", edited.validation, before.validation);
  eq("setManualSgscript: failedDraft is preserved untouched", edited.failedDraft, before.failedDraft);
  eq("setManualSgscript: lifecycle status is preserved untouched", edited.status, before.status);
  eq("setManualSgscript: validationPending is preserved untouched", edited.validationPending, before.validationPending);
  eq("setManualSgscript: validationError is preserved untouched (not silently cleared by a keystroke)", edited.validationError, before.validationError);
  ok("setManualSgscript: original state object is not mutated", before.sgscript === "const length = 20\nplot(ema(close, length))");
}

// ==== manual edit -> buildRequestPayload uses the EDITED code, not stale ===
{
  const afterBuild = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec({ name: "EMA" }), sgscript: "const length = 20\nplot(ema(close, length))" };
  const afterManualEdit = setManualSgscript(afterBuild, "const length = 30\nplot(ema(close, length))");
  const payload = buildRequestPayload(afterManualEdit, "make the line blue");
  eq("buildRequestPayload after a manual edit: currentSgscript is the MANUALLY EDITED code (30), never the stale AI output (20)", payload.currentSgscript, "const length = 30\nplot(ema(close, length))");
  eq("buildRequestPayload after a manual edit: still operation modify (spec still exists)", payload.operation, "modify");
}

// ==== manual edit survives a subsequent generation failure =================
{
  const afterBuild = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec(), sgscript: "ORIGINAL" };
  const afterManualEdit = setManualSgscript(afterBuild, "MANUALLY EDITED");
  const afterUserMsg = appendUserMessage(afterManualEdit, "make the line blue");
  const afterFailure = applyBuildFailure(afterUserMsg, "Network timeout");
  eq("a manual edit is NOT erased by a subsequent generationFailed outcome", afterFailure.sgscript, "MANUALLY EDITED");
  eq("applyBuildFailure still reports generationFailed", afterFailure.status, "generationFailed");
}

// ==== canSubmitValidate guard ==================================================
{
  ok("canSubmitValidate: real code, idle, not pending, signed in -> true", canSubmitValidate("plot(close)", "idle", false, true) === true);
  ok("canSubmitValidate: real code, success status, not pending, signed in -> true", canSubmitValidate("plot(close)", "success", false, true) === true);
  ok("canSubmitValidate: empty code -> false", canSubmitValidate("", "idle", false, true) === false);
  ok("canSubmitValidate: whitespace-only code -> false", canSubmitValidate("   \n\t  ", "idle", false, true) === false);
  ok("canSubmitValidate: while an AI build is generating -> false", canSubmitValidate("plot(close)", "generating", false, true) === false);
  ok("canSubmitValidate: while a validate request is already pending -> false (no duplicate clicks)", canSubmitValidate("plot(close)", "idle", true, true) === false);
  ok("canSubmitValidate: not signed in -> false", canSubmitValidate("plot(close)", "idle", false, false) === false);
}

// ==== beginValidation ==========================================================
{
  const s = beginValidation({ ...INITIAL_BUILDER_PROJECT_STATE, validationError: "old error", sgscript: "plot(close)" });
  eq("beginValidation: validationPending becomes true", s.validationPending, true);
  eq("beginValidation: clears any prior validationError", s.validationError, null);
  eq("beginValidation: never touches sgscript", s.sgscript, "plot(close)");
  eq("beginValidation: never touches status (Validate is not a build)", s.status, "idle");
}

// ==== applyValidationResult — real validateProject result ====================
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec(), pine: "PINE", sgscript: "SGSCRIPT", validationPending: true, dirty: false, status: "success" };
  const result = {
    pine: { ok: true, issues: [], repaint: { classification: "unknown" } },
    sgscript: { ok: false, issues: [issue({ code: "bad-thing" })] },
  };
  const s = applyValidationResult(before, result);

  eq("applyValidationResult: validation is populated from the result", s.validation.pine, result.pine);
  eq("applyValidationResult: validation.sgscript is populated from the result", s.validation.sgscript, result.sgscript);
  eq("applyValidationResult: repairPasses is honestly 0 (manual validation never repairs)", s.validation.repairPasses, 0);
  eq("applyValidationResult: method is static-validation", s.validation.method, "static-validation");
  eq("applyValidationResult: validationPending becomes false", s.validationPending, false);
  eq("applyValidationResult: validationError is cleared", s.validationError, null);
  eq("applyValidationResult: NEVER touches spec", s.spec, before.spec);
  eq("applyValidationResult: NEVER touches pine", s.pine, before.pine);
  eq("applyValidationResult: NEVER touches sgscript", s.sgscript, before.sgscript);
  eq("applyValidationResult: NEVER touches dirty", s.dirty, before.dirty);
  eq("applyValidationResult: NEVER touches lifecycle status", s.status, before.status);
}

// ==== applyValidationResult — defensive null case (never fabricates a pass) ==
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, validation: null, validationPending: true };
  const s = applyValidationResult(before, { pine: null, sgscript: null });
  eq("applyValidationResult(nulls): does not fabricate a fake validation pass", s.validation, null);
  eq("applyValidationResult(nulls): validationPending becomes false", s.validationPending, false);
  ok("applyValidationResult(nulls): surfaces an honest validationError", typeof s.validationError === "string" && s.validationError.length > 0);
}

// ==== applyValidationFailure — the REQUEST failed, not the validation =========
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, spec: spec(), pine: "PINE", sgscript: "SGSCRIPT", validation: { pine: { ok: true, issues: [], repaint: { classification: "unknown" } }, sgscript: { ok: true, issues: [] }, repairPasses: 0, method: "static-validation" }, validationPending: true };
  const s = applyValidationFailure(before, "Server error");
  eq("applyValidationFailure: validationPending becomes false", s.validationPending, false);
  eq("applyValidationFailure: validationError is stored", s.validationError, "Server error");
  eq("applyValidationFailure: the LAST KNOWN validation result is untouched", s.validation, before.validation);
  eq("applyValidationFailure: NEVER touches sgscript", s.sgscript, "SGSCRIPT");
  eq("applyValidationFailure: NEVER touches pine", s.pine, "PINE");
  eq("applyValidationFailure: NEVER touches spec", s.spec, before.spec);
}

// ==== a fresh AI build clears a stale Validate-request error ==================
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, validationError: "stale validate-request failure" };
  const successResult = buildResult();
  const afterSuccess = applyBuildSuccess(before, successResult);
  eq("applyBuildSuccess(success): clears a stale validationError so Diagnostics shows the real new result", afterSuccess.validationError, null);

  const errorResult = buildResult({ validation: { pine: { ok: false, issues: [issue()], repaint: { classification: "unknown" } }, sgscript: { ok: true, issues: [] }, repairPasses: 3, method: "static-validation" } });
  const afterErrorBranch = applyBuildSuccess(before, errorResult);
  eq("applyBuildSuccess(error branch): also clears a stale validationError", afterErrorBranch.validationError, null);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
