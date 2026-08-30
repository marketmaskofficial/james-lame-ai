import type { BuildResult } from "@/lib/project.functions";
import type { IndicatorSpec } from "@/lib/spec/types";
import { classifyBuildResult, formatBuildIssuesForRepair, type BuildOutcomeStatus } from "@/lib/spec/buildOutcome";

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
 */

export type LifecycleStatus = "idle" | "generating" | "success" | "generationFailed" | "validationFailed";

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
