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
  applyAutoPersistFailure,
  applyAutoPersistSuccess,
  applyBuildFailure,
  applyBuildSuccess,
  applyPreviewFailure,
  applyPreviewResult,
  applySaveSuccess,
  applyValidationFailure,
  applyValidationResult,
  beginPreviewRun,
  beginValidation,
  buildRequestPayload,
  canRunPreview,
  canSave,
  canSaveVersion,
  canSubmitFixError,
  canSubmitPrompt,
  canSubmitValidate,
  displayName,
  fixErrorRequestPayload,
  hydrateFromIndicator,
  mergeSettingsWithDefaults,
  renameIndicator,
  repairPassesLabel,
  setManualSgscript,
  updateSetting,
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

/** A minimal, valid RunResult fixture — mirrors the exact shape
 * `runIndicator` (src/lib/sgscript/client.ts / runtime.ts) resolves with. */
function runResult(overrides = {}) {
  return {
    ok: true,
    meta: { name: "Test Indicator", overlay: true },
    strategy: { declared: false, entries: [], exits: [], notes: [] },
    inputs: [],
    plots: [],
    hlines: [],
    boxes: [],
    lines: [],
    labels: [],
    markers: [],
    fills: [],
    logs: [],
    ms: 5,
    ...overrides,
  };
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

// ==== Phase 5A-5B: applyAutoPersistSuccess / applyAutoPersistFailure =========
{
  const dirtyAfterBuild = { ...INITIAL_BUILDER_PROJECT_STATE, dirty: true, autoPersistError: null };
  const s1 = applyAutoPersistSuccess(dirtyAfterBuild, "11111111-1111-1111-1111-111111111111", 1);
  eq("applyAutoPersistSuccess: sets indicatorId", s1.indicatorId, "11111111-1111-1111-1111-111111111111");
  eq("applyAutoPersistSuccess: sets currentVersion", s1.currentVersion, 1);
  eq("applyAutoPersistSuccess: clears dirty (the ONLY thing that clears dirty after an AI turn)", s1.dirty, false);
  eq("applyAutoPersistSuccess: clears any prior autoPersistError", s1.autoPersistError, null);

  const s2 = applyAutoPersistFailure(dirtyAfterBuild, "Network error");
  eq("applyAutoPersistFailure: stores the error", s2.autoPersistError, "Network error");
  eq("applyAutoPersistFailure: NEVER clears dirty — a generated-but-unsaved project must not look safe", s2.dirty, true);
  eq("applyAutoPersistFailure: never touches indicatorId", s2.indicatorId, dirtyAfterBuild.indicatorId);
}

// ==== Phase 5A-5B: applySaveSuccess (Save vs Save Version) ===================
{
  const dirty = { ...INITIAL_BUILDER_PROJECT_STATE, dirty: true, currentVersion: 2, autoPersistError: "stale" };
  const saved = applySaveSuccess(dirty);
  eq("applySaveSuccess (plain Save): clears dirty", saved.dirty, false);
  eq("applySaveSuccess (plain Save): clears stale autoPersistError", saved.autoPersistError, null);
  eq("applySaveSuccess (plain Save): currentVersion untouched when omitted", saved.currentVersion, 2);

  const savedVersion = applySaveSuccess(dirty, 3);
  eq("applySaveSuccess (Save Version): clears dirty", savedVersion.dirty, false);
  eq("applySaveSuccess (Save Version): currentVersion advances to the given value", savedVersion.currentVersion, 3);
}

// ==== Phase 5A-5B: canSave / canSaveVersion guards ============================
{
  ok("canSave: has id, dirty, not pending, signed in -> true", canSave("id-1", true, false, true) === true);
  ok("canSave: NO id (brand-new /builder session) -> false — never create an empty indicator via Save", canSave(null, true, false, true) === false);
  ok("canSave: not dirty -> false (nothing to save)", canSave("id-1", false, false, true) === false);
  ok("canSave: save already pending -> false", canSave("id-1", true, true, true) === false);
  ok("canSave: not signed in -> false", canSave("id-1", true, false, false) === false);
  ok("canSaveVersion: shares the identical gate as canSave", canSaveVersion("id-1", true, false, true) === true);
  ok("canSaveVersion: NO id -> false", canSaveVersion(null, true, false, true) === false);
}

// ==== Phase 5A-5C: mergeSettingsWithDefaults ==================================
{
  const specWithInputs = spec({ inputs: [{ name: "length", type: "number", default: 20 }, { name: "showLabels", type: "bool", default: true }] });
  const merged1 = mergeSettingsWithDefaults({}, specWithInputs);
  eq("mergeSettingsWithDefaults (no existing values): uses declared defaults", merged1, { length: 20, showLabels: true });

  const merged2 = mergeSettingsWithDefaults({ length: 50 }, specWithInputs);
  eq("mergeSettingsWithDefaults: preserves a user-set value for a still-declared input", merged2.length, 50);
  eq("mergeSettingsWithDefaults: fills in the default for an input the user never touched", merged2.showLabels, true);

  const specWithFewerInputs = spec({ inputs: [{ name: "length", type: "number", default: 20 }] });
  const merged3 = mergeSettingsWithDefaults({ length: 50, oldRemovedInput: "x" }, specWithFewerInputs);
  eq("mergeSettingsWithDefaults: drops a setting for an input the spec no longer declares", merged3, { length: 50 });
}

// ==== Phase 5A-5C: updateSetting — the ONE settings-edit transition, zero I/O =
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, settings: { length: 20 }, dirty: false };
  const s = updateSetting(before, "length", 30);
  eq("updateSetting: updates only the named setting", s.settings, { length: 30 });
  eq("updateSetting: marks dirty (same as a manual code edit)", s.dirty, true);
  eq("updateSetting: never touches sgscript", s.sgscript, before.sgscript);
  eq("updateSetting: never touches spec", s.spec, before.spec);

  const withOthers = { ...INITIAL_BUILDER_PROJECT_STATE, settings: { length: 20, color: "#fff" } };
  const s2 = updateSetting(withOthers, "color", "#000");
  eq("updateSetting: preserves OTHER settings untouched", s2.settings, { length: 20, color: "#000" });
}

// ==== Phase 5A-5A: renameIndicator — local-only, persisted through Save =====
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, name: "Old Name", dirty: false };
  const s = renameIndicator(before, "New Name");
  eq("renameIndicator: sets the new name", s.name, "New Name");
  eq("renameIndicator: marks dirty", s.dirty, true);
}

// ==== displayName — the naming-bug fix: real fallback chain, never hardcoded
{
  eq("displayName: an explicit name wins", displayName({ ...INITIAL_BUILDER_PROJECT_STATE, name: "My Indicator", spec: spec({ name: "AI Name" }) }), "My Indicator");
  eq("displayName: falls back to the spec's name when nothing was explicitly set", displayName({ ...INITIAL_BUILDER_PROJECT_STATE, name: null, spec: spec({ name: "AI Name" }) }), "AI Name");
  eq("displayName: falls back to the literal placeholder before any project/name exists", displayName(INITIAL_BUILDER_PROJECT_STATE), "Untitled Indicator");
}

// ==== applyBuildSuccess — Phase 5A-5 name-preservation + settings merge =====
{
  const firstBuild = applyBuildSuccess(INITIAL_BUILDER_PROJECT_STATE, buildResult({ spec: spec({ name: "AI Chosen Name" }) }));
  eq("applyBuildSuccess: a brand-new project takes the AI's own spec name", firstBuild.name, "AI Chosen Name");

  const renamed = renameIndicator(firstBuild, "User Renamed It");
  const afterRefinement = applyBuildSuccess(renamed, buildResult({ spec: spec({ name: "AI Would Rename It Again" }) }));
  eq("applyBuildSuccess: NEVER overwrites a name the user (or a persisted row) already gave the project", afterRefinement.name, "User Renamed It");

  const specWithOneInput = spec({ inputs: [{ name: "length", type: "number", default: 20 }] });
  const builtWithInput = applyBuildSuccess(INITIAL_BUILDER_PROJECT_STATE, buildResult({ spec: specWithOneInput }));
  eq("applyBuildSuccess: settings default from the spec's declared inputs", builtWithInput.settings, { length: 20 });

  const userAdjusted = updateSetting(builtWithInput, "length", 99);
  const refinedKeepingSetting = applyBuildSuccess(userAdjusted, buildResult({ spec: specWithOneInput }));
  eq("applyBuildSuccess: a refinement that doesn't change inputs preserves the user's settings edit", refinedKeepingSetting.settings, { length: 99 });
}

// ==== Phase 5A-5A: hydrateFromIndicator — reopening a persisted project =====
{
  const row = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Saved Indicator",
    code: "plot(ema(close, 20))",
    pine: "//@version=6\nindicator('x')",
    spec: spec({ name: "Saved Indicator", inputs: [{ name: "length", type: "number", default: 20 }] }),
    settings: { length: 55 },
    current_version: 4,
  };
  const s = hydrateFromIndicator(row);
  eq("hydrateFromIndicator: indicatorId comes from the row", s.indicatorId, row.id);
  eq("hydrateFromIndicator: name comes from the row", s.name, "Saved Indicator");
  eq("hydrateFromIndicator: sgscript comes from row.code (the ONE canonical code field)", s.sgscript, row.code);
  eq("hydrateFromIndicator: pine comes from the row", s.pine, row.pine);
  eq("hydrateFromIndicator: currentVersion comes from the row", s.currentVersion, 4);
  eq("hydrateFromIndicator: settings preserve the persisted value (not recomputed defaults)", s.settings, { length: 55 });
  eq("hydrateFromIndicator: status becomes success (so the preview-refresh Trigger 1 fires automatically)", s.status, "success");
  eq("hydrateFromIndicator: dirty is false — a freshly reopened project has nothing unsaved", s.dirty, false);
  eq("hydrateFromIndicator: messages reset to empty (chat is restored separately via listIndicatorMessages)", s.messages, []);
  eq("hydrateFromIndicator: failedDraft resets (no stale error carries over)", s.failedDraft, null);
  eq("hydrateFromIndicator: previewResult resets — a new project's preview must not show the OLD project's chart", s.previewResult, null);

  const rowMissingSettingsColumn = { ...row, settings: {} };
  const s2 = hydrateFromIndicator(rowMissingSettingsColumn);
  eq("hydrateFromIndicator: falls back to spec-declared defaults when the persisted settings are empty", s2.settings, { length: 20 });
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

// ==== Phase 5A-4b: initial Preview state =======================================
{
  eq("INITIAL_BUILDER_PROJECT_STATE: previewStatus starts idle", INITIAL_BUILDER_PROJECT_STATE.previewStatus, "idle");
  eq("INITIAL_BUILDER_PROJECT_STATE: previewResult starts null", INITIAL_BUILDER_PROJECT_STATE.previewResult, null);
  eq("INITIAL_BUILDER_PROJECT_STATE: previewError starts null", INITIAL_BUILDER_PROJECT_STATE.previewError, null);
}

// ==== Phase 5A-4b/4d: canRunPreview guard ======================================
{
  ok("canRunPreview: real code, idle, has bars -> true", canRunPreview("plot(close)", "idle", true) === true);
  ok("canRunPreview: real code, success, has bars -> true", canRunPreview("plot(close)", "success", true) === true);
  ok(
    "canRunPreview: real code, error, has bars -> true (a previous failure must not permanently block re-running)",
    canRunPreview("plot(close)", "error", true) === true,
  );
  ok("canRunPreview: empty code, has bars -> false", canRunPreview("", "idle", true) === false);
  ok("canRunPreview: whitespace-only code, has bars -> false", canRunPreview("   \n\t  ", "idle", true) === false);
  ok(
    "canRunPreview: while a run is already in flight, has bars -> false (no duplicate concurrent runs)",
    canRunPreview("plot(close)", "running", true) === false,
  );
  ok(
    "Phase 5A-4d: canRunPreview: real code, idle, NO bars -> false (the runtime hard-requires non-empty bars — never let a click reach that failure)",
    canRunPreview("plot(close)", "idle", false) === false,
  );
  ok(
    "Phase 5A-4d: canRunPreview: real code, success, NO bars -> false (bars can become unavailable again after a symbol change even once a previous run succeeded)",
    canRunPreview("plot(close)", "success", false) === false,
  );
}

// ==== Phase 5A-4b: beginPreviewRun ==============================================
{
  const before = { ...INITIAL_BUILDER_PROJECT_STATE, sgscript: "plot(close)", previewError: "stale error from a prior failed run" };
  const s = beginPreviewRun(before);
  eq("beginPreviewRun: previewStatus becomes running", s.previewStatus, "running");
  eq("beginPreviewRun: clears any prior previewError", s.previewError, null);
  eq("beginPreviewRun: never touches sgscript", s.sgscript, "plot(close)");
  eq("beginPreviewRun: never touches build lifecycle status", s.status, "idle");
  eq("beginPreviewRun: never touches validationPending", s.validationPending, before.validationPending);
}

// ==== Phase 5A-4b: applyPreviewResult — a real RunResult =======================
{
  const before = {
    ...INITIAL_BUILDER_PROJECT_STATE,
    spec: spec({ name: "EMA 20" }),
    pine: "PINE",
    sgscript: "plot(ema(close, 20))",
    messages: [{ id: "m1", role: "user", kind: "build", text: "Build a 20 EMA", createdAt: "2026-01-01T00:00:00.000Z", persisted: true }],
    validation: { pine: { ok: true, issues: [], repaint: { classification: "unknown" } }, sgscript: { ok: true, issues: [] }, repairPasses: 0, method: "static-validation" },
    status: "success",
    indicatorId: "11111111-1111-1111-1111-111111111111",
    dirty: true,
    previewStatus: "running",
  };
  const result = runResult({ meta: { name: "20 EMA Overlay", overlay: true } });
  const s = applyPreviewResult(before, result);

  eq("applyPreviewResult: previewStatus becomes success", s.previewStatus, "success");
  eq("applyPreviewResult: previewResult stores the real RunResult", s.previewResult, result);
  eq("applyPreviewResult: previewError is cleared", s.previewError, null);
  eq("applyPreviewResult: NEVER touches spec", s.spec, before.spec);
  eq("applyPreviewResult: NEVER touches pine", s.pine, before.pine);
  eq("applyPreviewResult: NEVER touches sgscript", s.sgscript, before.sgscript);
  eq("applyPreviewResult: NEVER touches messages", s.messages, before.messages);
  eq("applyPreviewResult: NEVER touches validation", s.validation, before.validation);
  eq("applyPreviewResult: NEVER touches build lifecycle status", s.status, before.status);
  eq("applyPreviewResult: NEVER touches indicatorId", s.indicatorId, before.indicatorId);
  eq("applyPreviewResult: NEVER touches dirty", s.dirty, before.dirty);
}

// ==== Phase 5A-4b: applyPreviewFailure — failure never erases last-good ========
{
  const goodResult = runResult({ meta: { name: "Working Preview", overlay: true } });
  const before = {
    ...INITIAL_BUILDER_PROJECT_STATE,
    spec: spec(),
    pine: "PINE",
    sgscript: "plot(close) /* now broken */",
    validation: { pine: { ok: true, issues: [], repaint: { classification: "unknown" } }, sgscript: { ok: true, issues: [] }, repairPasses: 0, method: "static-validation" },
    status: "success",
    previewStatus: "running",
    previewResult: goodResult,
  };
  const s = applyPreviewFailure(before, "Line 3: close is not defined");

  eq("applyPreviewFailure: previewStatus becomes error", s.previewStatus, "error");
  eq("applyPreviewFailure: previewError is stored", s.previewError, "Line 3: close is not defined");
  eq("applyPreviewFailure: the LAST GOOD previewResult is preserved, never erased", s.previewResult, goodResult);
  eq("applyPreviewFailure: NEVER touches spec", s.spec, before.spec);
  eq("applyPreviewFailure: NEVER touches pine", s.pine, before.pine);
  eq("applyPreviewFailure: NEVER touches sgscript", s.sgscript, before.sgscript);
  eq("applyPreviewFailure: NEVER touches validation", s.validation, before.validation);
  eq("applyPreviewFailure: NEVER touches build lifecycle status", s.status, before.status);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
