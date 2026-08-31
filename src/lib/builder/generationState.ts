import type { BuildResult } from "@/lib/project.functions";
import type { IndicatorSpec } from "@/lib/spec/types";
import { classifyBuildResult, formatBuildIssuesForRepair, type BuildOutcomeStatus } from "@/lib/spec/buildOutcome";
import type { RunResult } from "@/lib/sgscript/types";

/**
 * Phase 5A-2 — Indicator Builder's pure generation-lifecycle state. No
 * React, no Supabase, no I/O — every function here is a synchronous
 * `(state, ...) => state` transform, fully testable without mocking
 * anything. The one React-owning module (`useBuilderProject.ts`) is a thin
 * shell around these functions plus the canonical `buildProject`/
 * `createIndicator`/`updateIndicator`/`listIndicatorMessages`/
 * `appendIndicatorMessage` server-function calls — no generation, spec, or
 * validation logic is reimplemented here, only reused via `BuildResult`.
 *
 * `"repairing"` is deliberately NOT a state in this machine: `buildProject`
 * runs its whole repair loop inside one server request, so the client can
 * never observe an in-progress repair pass — only `"generating"` while the
 * request is in flight, then the final `repairPasses` count disclosed
 * honestly after the fact (see `repairPassesLabel` below).
 *
 * Phase 5A-4b adds a third, independent lifecycle — Preview *execution*
 * (`previewStatus`/`previewResult`/`previewError`) — for running
 * `state.sgscript` through the canonical `runIndicator` (`@/lib/sgscript/
 * client`) against caller-supplied bars. This module stays type-only with
 * respect to that runtime (`import type { RunResult }`); the real call
 * lives in `useBuilderProject.ts`, exactly like `buildProject`/
 * `validateProject` before it. `state.sgscript` remains the one canonical
 * source Preview executes — no second code/draft field exists for it.
 */

export type LifecycleStatus = "idle" | "generating" | "success" | "generationFailed" | "validationFailed";

/** Phase 5A-4b — the Preview *execution* lifecycle, deliberately separate
 * from `LifecycleStatus` (AI build/refine) and from `validationPending`
 * (static `validateProject` checks). Preview runs the canonical SGScript
 * runtime (`runIndicator`) against real bars — a third, independent
 * concern that must never be conflated with the other two, exactly as the
 * Phase 5A-4b audit requires. */
export type PreviewStatus = "idle" | "running" | "success" | "error";

export type BuilderMessageRole = "user" | "ai";
/** Mirrors `indicator_messages.kind` exactly — Builder only ever produces
 * "build" turns in Phase 5A-2 (no Explain feature yet). */
export type BuilderMessageKind = "build" | "explain";

export type BuilderMessage = {
  id: string;
  role: BuilderMessageRole;
  kind: BuilderMessageKind;
  text: string;
  status?: BuildOutcomeStatus;
  issues?: number;
  repairPasses?: number;
  createdAt: string;
  /** True once this exact message has been durably written via
   * `appendIndicatorMessage` — never blocks or reverts the visible chat
   * either way (see the Phase 5A-2 audit's non-destructive-persistence-
   * failure rule). */
  persisted: boolean;
};

export type FailedDraft = {
  spec: IndicatorSpec;
  pine: string;
  sgscript: string;
  issuesText: string;
};

/** The narrow slice of `BuildResult["validation"]` the Diagnostics panel
 * needs — re-exported here so panel components import it from this Builder
 * module instead of reaching into `project.functions` directly. */
export type BuildValidation = BuildResult["validation"];

export type BuilderProjectState = {
  indicatorId: string | null;
  spec: IndicatorSpec | null;
  pine: string;
  sgscript: string;
  summary: string;
  changelog: string;
  validation: BuildValidation | null;
  repairPasses: number | null;
  messages: BuilderMessage[];
  status: LifecycleStatus;
  failedDraft: FailedDraft | null;
  /** True once a successful generated result exists that has not been
   * explicitly saved through the (Phase 5A-6) manual Save Version UX. Never
   * set for an unsent prompt or a failed generation with no committed
   * result — see the Phase 5A-2 scope decision. No discard-confirmation UX
   * reads this yet; it exists so later phases have a truthful foundation. */
  dirty: boolean;
  /** The last generation/network failure message, if any — cleared on the
   * next successful or validation-failed outcome. */
  error: string | null;
  /** True while an explicit Validate click's `validateProject` request is
   * in flight — Phase 5A-3. Distinct from `status === "generating"` (which
   * is only for `buildProject`/AI generation): Validate is a separate,
   * static-only action, so it gets its own pending flag rather than
   * overloading the build lifecycle (that would incorrectly make the code
   * editor read-only and block Build while a plain static check runs). */
  validationPending: boolean;
  /** The last Validate *request* failure (network/server error), if any —
   * never a validation *result* (failing static checks are a normal
   * `validation` value, not an error). Cleared on the next successful
   * Validate or AI build. Kept separate from `error` so a Validate failure
   * is never mistaken for a generation failure in Chat. */
  validationError: string | null;
  /** Phase 5A-4b — whether an explicit Preview run (`runIndicator` against
   * real bars) is currently in flight. Independent of `status`/
   * `validationPending`: execution is a third concern, never layered onto
   * the build or static-validation lifecycles. */
  previewStatus: PreviewStatus;
  /** The last SUCCESSFUL execution result. Doubles as "last-known-good" for
   * free: a failed run (see `applyPreviewFailure`) never clears this, so a
   * previously-working preview stays visible/usable across a later error —
   * the same non-destructive-failure convention `spec`/`pine`/`sgscript`
   * and `validation` already follow. */
  previewResult: RunResult | null;
  /** The last Preview *execution* failure (a thrown/rejected `runIndicator`
   * call — parse error, runtime error, timeout, or "no market data"), if
   * any. Cleared on the next successful run. Kept separate from `error`/
   * `validationError` so a Preview failure is never mistaken for a
   * generation or Validate-request failure anywhere in the UI. */
  previewError: string | null;
};

export const INITIAL_BUILDER_PROJECT_STATE: BuilderProjectState = {
  indicatorId: null,
  spec: null,
  pine: "",
  sgscript: "",
  summary: "",
  changelog: "",
  validation: null,
  repairPasses: null,
  messages: [],
  status: "idle",
  failedDraft: null,
  dirty: false,
  error: null,
  validationPending: false,
  validationError: null,
  previewStatus: "idle",
  previewResult: null,
  previewError: null,
};

function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`;
}

/** Appends the user's own prompt immediately (optimistic — no round trip
 * needed for this part) and transitions Idle/Success/*Failed -> Generating. */
export function appendUserMessage(state: BuilderProjectState, text: string): BuilderProjectState {
  const message: BuilderMessage = {
    id: newMessageId(),
    role: "user",
    kind: "build",
    text,
    createdAt: new Date().toISOString(),
    persisted: false,
  };
  return { ...state, messages: [...state.messages, message], status: "generating", error: null };
}

/**
 * Applies a real `BuildResult` from `buildProject`. Reuses
 * `classifyBuildResult` (the exact same function `AiSidePanel` uses) —
 * never a second definition of success/warning/error. An `"error"`
 * classification NEVER commits `spec`/`pine`/`sgscript`/`dirty` — the
 * failing draft is stashed in `failedDraft` instead, exactly like the
 * Chart Studio reference implementation.
 */
export function applyBuildSuccess(state: BuilderProjectState, result: BuildResult): BuilderProjectState {
  const { status, totalIssues } = classifyBuildResult(result);
  const aiMessage: BuilderMessage = {
    id: newMessageId(),
    role: "ai",
    kind: "build",
    text: result.summary || result.changelog,
    status,
    issues: totalIssues,
    repairPasses: result.validation.repairPasses,
    createdAt: new Date().toISOString(),
    persisted: false,
  };

  if (status === "error") {
    return {
      ...state,
      messages: [...state.messages, aiMessage],
      status: "validationFailed",
      failedDraft: { spec: result.spec, pine: result.pine, sgscript: result.sgscript, issuesText: formatBuildIssuesForRepair(result) },
      error: null,
      // A fresh AI attempt supersedes any earlier failed Validate-request
      // error — Diagnostics must show this real result, not stale text.
      validationError: null,
    };
  }

  return {
    ...state,
    messages: [...state.messages, aiMessage],
    status: "success",
    spec: result.spec,
    pine: result.pine,
    sgscript: result.sgscript,
    summary: result.summary,
    changelog: result.changelog,
    validation: result.validation,
    repairPasses: result.validation.repairPasses,
    failedDraft: null,
    dirty: true,
    error: null,
    validationError: null,
  };
}

/** An AI/network/model-output failure — no `BuildResult` exists at all.
 * The user's own message (already appended by `appendUserMessage`) is
 * preserved untouched; nothing about the previously-committed
 * spec/pine/sgscript changes. */
export function applyBuildFailure(state: BuilderProjectState, message: string): BuilderProjectState {
  return { ...state, status: "generationFailed", error: message };
}

export function withIndicatorId(state: BuilderProjectState, indicatorId: string): BuilderProjectState {
  return { ...state, indicatorId };
}

export function markMessagePersisted(state: BuilderProjectState, messageId: string): BuilderProjectState {
  return { ...state, messages: state.messages.map((m) => (m.id === messageId ? { ...m, persisted: true } : m)) };
}

/**
 * Phase 5A-3 — the ONE place a manual code-editor keystroke touches state.
 * Replaces only `sgscript` and sets `dirty`; every other field (`spec`,
 * `pine`, `indicatorId`, `messages`, `validation`, `failedDraft`, `status`,
 * `error`, `validationPending`/`validationError`) is preserved untouched by
 * the object spread. This is deliberately the *only* thing a keystroke may
 * do — no debounce, no second draft field, no network/validation side
 * effect — so `state.sgscript` stays the single canonical working copy
 * `buildRequestPayload` and (later) Preview both read from.
 */
export function setManualSgscript(state: BuilderProjectState, sgscript: string): BuilderProjectState {
  return { ...state, sgscript, dirty: true };
}

/** Marks an explicit Validate click as in flight. Never touches
 * `spec`/`pine`/`sgscript`/`status` — Validate is static-only and must not
 * look like an AI generation to the rest of the UI. */
export function beginValidation(state: BuilderProjectState): BuilderProjectState {
  return { ...state, validationPending: true, validationError: null };
}

/**
 * Applies a real `validateProject` result to `state.validation` — the SAME
 * field an AI build already populates, so `DiagnosticsPanel`/`ChatPanel`
 * need no second rendering path for a manual-validate result. `pine`/
 * `sgscript` in the request are only ever `null` in the response when the
 * corresponding field was empty in the request, which `canSubmitValidate`
 * already prevents for `sgscript` — treated defensively as "nothing to
 * validate" rather than fabricating a fake pass. `repairPasses: 0` is
 * honest: manual validation never runs the AI repair loop.
 */
export function applyValidationResult(
  state: BuilderProjectState,
  result: { pine: BuildValidation["pine"] | null; sgscript: BuildValidation["sgscript"] | null },
): BuilderProjectState {
  if (!result.pine || !result.sgscript) {
    return { ...state, validationPending: false, validationError: "Nothing to validate yet." };
  }
  return {
    ...state,
    validation: { pine: result.pine, sgscript: result.sgscript, repairPasses: 0, method: "static-validation" },
    validationPending: false,
    validationError: null,
  };
}

/** A `validateProject` request itself failing (network/server error) — NOT
 * a failing validation result. Never touches `spec`/`pine`/`sgscript`/
 * `validation` — the current code and last-known diagnostics stay exactly
 * as they were. */
export function applyValidationFailure(state: BuilderProjectState, message: string): BuilderProjectState {
  return { ...state, validationPending: false, validationError: message };
}

/** Guards the Validate action: real non-whitespace code to check, no AI
 * build in flight (`generating` also makes the editor read-only — see
 * `CodeEditorPanel`), no other Validate request already pending, signed in. */
export function canSubmitValidate(sgscript: string, status: LifecycleStatus, validationPending: boolean, signedIn: boolean): boolean {
  return sgscript.trim().length > 0 && status !== "generating" && !validationPending && signedIn;
}

/**
 * Phase 5A-4b — Preview execution lifecycle. `runIndicator` is a pure
 * client-side Worker call (no server, no auth), so unlike `canSubmitPrompt`/
 * `canSubmitValidate` this guard takes no `signedIn` — there is nothing to
 * authenticate against. Blocks a second run only while one is already in
 * flight (the stale-result guard in `useBuilderProject.ts` additionally
 * protects against an old run's result ever winning over a newer one).
 *
 * Phase 5A-4d adds `hasBars` — the runtime itself hard-throws "No market
 * data loaded" against an empty `Bar[]` (see the Phase 5A-4b runtime audit),
 * so a run with zero bars is guaranteed to fail; gating on it here means the
 * button-enablement check and `submitRunPreview`'s own internal guard share
 * the identical rule, exactly like every other canX function in this file.
 * Deliberately NOT `barsLoading` — that is Builder's market-data-hook's own
 * transient UI concept, not a generic execution precondition, so it stays
 * out of this module and is combined at the call site instead (see
 * `useBuilderMarketData.ts`).
 */
export function canRunPreview(sgscript: string, previewStatus: PreviewStatus, hasBars: boolean): boolean {
  return sgscript.trim().length > 0 && previewStatus !== "running" && hasBars;
}

/** Marks an explicit Preview run as in flight. Never touches `spec`/`pine`/
 * `sgscript`/`status`/`validationPending` — execution is a third, wholly
 * separate concern from AI generation and static validation. Preserves the
 * existing `previewResult` (the chart, if any, stays visible while a new
 * run is in progress). */
export function beginPreviewRun(state: BuilderProjectState): BuilderProjectState {
  return { ...state, previewStatus: "running", previewError: null };
}

/** Applies a real `RunResult` from `runIndicator`. Never touches `spec`/
 * `pine`/`sgscript`/`status`/`validation`/`dirty` — a Preview run observes
 * the current code, it never mutates the Builder's generation/validation
 * state. */
export function applyPreviewResult(state: BuilderProjectState, result: RunResult): BuilderProjectState {
  return { ...state, previewStatus: "success", previewResult: result, previewError: null };
}

/** A Preview execution failure — a thrown/rejected `runIndicator` call
 * (parse error, runtime error, timeout, or "no market data"). NEVER clears
 * `previewResult`: the last successfully-rendered preview stays intact so
 * a broken follow-up edit doesn't blank out a working chart — the same
 * non-destructive-failure convention already used for build/validate. */
export function applyPreviewFailure(state: BuilderProjectState, message: string): BuilderProjectState {
  return { ...state, previewStatus: "error", previewError: message };
}

/** The exact canonical `buildProject` request shape for a first build or a
 * follow-up refinement — mirrors `AiSidePanel.tsx`'s own request
 * construction precisely: `operation` is `"modify"` once a spec already
 * exists, `"build"` otherwise; `currentSgscript` is only included when
 * there is real non-whitespace code to hand back (never an empty string). */
export function buildRequestPayload(
  state: BuilderProjectState,
  requestText: string,
): { request: string; operation: "build" | "modify"; currentSpec?: Record<string, unknown>; currentSgscript?: string } {
  if (state.spec) {
    return {
      request: requestText,
      operation: "modify",
      currentSpec: state.spec as unknown as Record<string, unknown>,
      ...(state.sgscript.trim() ? { currentSgscript: state.sgscript } : {}),
    };
  }
  return { request: requestText, operation: "build" };
}

/** The exact canonical `buildProject` request shape for the explicit Fix
 * Error action — reuses the SAME `buildProject` function with
 * `operation: "fix_error"`, seeded with the failing draft and its own
 * issues, exactly like `AiSidePanel.tsx`'s `fixError` mutation. Never a
 * second generation/repair engine. */
export function fixErrorRequestPayload(
  draft: FailedDraft,
): { request: string; operation: "fix_error"; currentSpec: Record<string, unknown>; currentSgscript: string } {
  return {
    request: `Fix these validation errors without changing the indicator's intent:\n${draft.issuesText}`,
    operation: "fix_error",
    currentSpec: draft.spec as unknown as Record<string, unknown>,
    currentSgscript: draft.sgscript,
  };
}

/** Guards the Build action: a real, non-generating, signed-in submission
 * with actual non-whitespace text. Never true while a build is already in
 * flight — the only thing that makes duplicate submissions impossible. */
export function canSubmitPrompt(prompt: string, status: LifecycleStatus, signedIn: boolean): boolean {
  return prompt.trim().length > 0 && status !== "generating" && signedIn;
}

/** Guards the Fix Error action the same way, additionally requiring a real
 * failed draft to operate on. */
export function canSubmitFixError(failedDraft: FailedDraft | null, status: LifecycleStatus, signedIn: boolean): boolean {
  return failedDraft !== null && status !== "generating" && signedIn;
}

/** Honest, retroactive repair-pass disclosure — never a live "Repairing
 * N/3…" progress indicator, since that state is not observable client-side
 * (see this file's own doc comment). `null` when no repair pass ran. */
export function repairPassesLabel(repairPasses: number | null | undefined): string | null {
  if (!repairPasses || repairPasses <= 0) return null;
  return `${repairPasses} automatic repair pass${repairPasses === 1 ? "" : "es"}`;
}
