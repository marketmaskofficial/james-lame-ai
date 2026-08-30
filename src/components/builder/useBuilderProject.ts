import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { buildProject, validateProject, type BuildResult } from "@/lib/project.functions";
import { createIndicator, updateIndicator } from "@/lib/indicators.functions";
import { listIndicatorMessages, appendIndicatorMessage } from "@/lib/indicatorMessages.functions";
import { defaultSettingsFromSpec } from "@/lib/spec/inputDefaults";
import { runIndicator } from "@/lib/sgscript/client";
import type { Bar } from "@/lib/sgscript/types";
import {
  INITIAL_BUILDER_PROJECT_STATE,
  appendUserMessage,
  applyBuildFailure,
  applyBuildSuccess,
  applyPreviewFailure,
  applyPreviewResult,
  applyValidationFailure,
  applyValidationResult,
  beginPreviewRun,
  beginValidation,
  buildRequestPayload,
  canRunPreview,
  canSubmitFixError,
  canSubmitPrompt,
  canSubmitValidate,
  fixErrorRequestPayload,
  setManualSgscript,
  withIndicatorId,
  type BuilderMessageKind,
  type BuilderMessageRole,
  type BuilderProjectState,
} from "@/lib/builder/generationState";
import { classifyBuildResult, type BuildOutcomeStatus } from "@/lib/spec/buildOutcome";

/**
 * Phase 5A-2/5A-3/5A-4b — the ONE place Indicator Builder touches the
 * canonical generation/persistence/execution chain. Every server call here
 * is one of the six explicitly reused functions (`buildProject`,
 * `validateProject`, `createIndicator`, `updateIndicator`,
 * `listIndicatorMessages`, `appendIndicatorMessage`) — nothing here defines
 * a new server function, calls the AI SDK directly, or re-implements any
 * validation/runtime logic. All pure decision-making (what state transition
 * a result implies, what request shape to send) lives in
 * `src/lib/builder/generationState.ts`; this hook is only the thin
 * React/I-O shell around it. Manual code edits (`updateSgscript`) are one
 * action in this hook that touches ZERO server functions — see its own doc
 * comment below.
 *
 * Phase 5A-4b adds `runIndicator` from `@/lib/sgscript/client` — NOT a
 * server function, a pure client-side Web Worker call — as a seventh,
 * architecturally distinct reused entry point: the canonical SGScript
 * execution engine. `submitRunPreview` is the only place it's called from
 * anywhere in Builder (mirroring the "exactly one call site" rule already
 * enforced for `buildProject`/`validateProject`).
 */
export function useBuilderProject(signedIn: boolean) {
  const buildProjectFn = useServerFn(buildProject);
  const validateProjectFn = useServerFn(validateProject);
  const createIndicatorFn = useServerFn(createIndicator);
  const updateIndicatorFn = useServerFn(updateIndicator);
  const listIndicatorMessagesFn = useServerFn(listIndicatorMessages);
  const appendIndicatorMessageFn = useServerFn(appendIndicatorMessage);
  const qc = useQueryClient();

  const [state, setState] = useState<BuilderProjectState>(INITIAL_BUILDER_PROJECT_STATE);
  const [prompt, setPrompt] = useState("");

  /** Kept in sync with `state.indicatorId` via the effect below so the
   * async `persistIndicator` call (inside a mutation's `onSuccess`, which
   * closes over whatever `state` looked like when the mutation started)
   * always reads the truly-current id rather than a stale closure. */
  const indicatorIdRef = useRef<string | null>(null);
  useEffect(() => {
    indicatorIdRef.current = state.indicatorId;
  }, [state.indicatorId]);

  /** Tracks which id this hook itself created — mirrors `AiSidePanel`'s own
   * `selfAssignedIdRef` convention exactly. In Phase 5A-2, Builder never
   * receives an `indicatorId` from outside (no "resume a project" entry
   * point exists yet), so this is always the same id as `indicatorIdRef`
   * once one exists — kept as its own ref anyway so `listIndicatorMessages`
   * is wired the identical, forward-compatible way Studio already proved
   * out, rather than a Builder-specific shortcut. */
  const selfAssignedIdRef = useRef<string | null>(null);
  const persistedCountRef = useRef(0);

  /** Phase 5A-4b — the smallest stale-result guard the audit recommended:
   * incremented on every `submitRunPreview` call; a run's result is only
   * ever applied to state if this ref still equals the value captured when
   * THAT run started. `runIndicator` exposes no request id/cancellation of
   * its own (see the Phase 5A-4b audit), so this is the one piece Builder
   * needs to add — no `AbortController`, no job queue, no polling. */
  const runSeqRef = useRef(0);

  // Only ever enabled for an indicatorId this hook did NOT itself just
  // create — i.e. never fires during the normal Phase 5A-2 flow (first
  // build always self-assigns), and is ready for a future "resume this
  // project" entry point without any further wiring.
  const messagesQuery = useQuery({
    queryKey: ["builder-indicator-messages", state.indicatorId],
    enabled: Boolean(state.indicatorId) && state.indicatorId !== selfAssignedIdRef.current,
    queryFn: () => listIndicatorMessagesFn({ data: { indicatorId: state.indicatorId as string } }),
    retry: false,
  });

  useEffect(() => {
    if (!messagesQuery.data || state.indicatorId === selfAssignedIdRef.current) return;
    setState((s) => ({
      ...s,
      messages: messagesQuery.data.map((m) => ({
        id: m.id,
        role: m.role as BuilderMessageRole,
        kind: m.kind as BuilderMessageKind,
        text: m.content,
        status: (m.status ?? undefined) as BuildOutcomeStatus | undefined,
        issues: m.issues ?? undefined,
        createdAt: m.created_at,
        persisted: true,
      })),
    }));
    persistedCountRef.current = messagesQuery.data.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesQuery.data]);

  // Best-effort persistence of every NEW message, exactly mirroring
  // AiSidePanel's own effect: never re-sends already-persisted history,
  // never blocks or reverts the visible chat if the write fails (the
  // hosted table may not exist yet, or the request may simply fail — the
  // local conversation stays fully visible either way).
  useEffect(() => {
    if (!state.indicatorId) return;
    const toPersist = state.messages.slice(persistedCountRef.current);
    if (toPersist.length === 0) return;
    persistedCountRef.current = state.messages.length;
    for (const m of toPersist) {
      void appendIndicatorMessageFn({
        data: { indicatorId: state.indicatorId, role: m.role, kind: m.kind, content: m.text, status: m.status, issues: m.issues },
      }).catch(() => {
        /* Best-effort — the local message stays visible regardless. */
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.messages, state.indicatorId]);

  /** Reuses the exact same `createIndicator`/`updateIndicator` pattern
   * Studio's `AiSidePanel.persistVersion` already uses: the FIRST
   * successful build creates the row (giving `indicator_messages`
   * something real to attach to, per the Phase 5A-2 audit), every
   * successful build after that snapshots a new version on the SAME row —
   * never one indicator per chat turn. Never called for an `"error"`
   * outcome. A persistence failure here never invalidates the already-
   * successful generated result — it just means this particular turn
   * doesn't gain durable identity/versioning yet. */
  async function persistIndicator(result: BuildResult, requestText: string): Promise<string | null> {
    const settings = defaultSettingsFromSpec(result.spec);
    const currentId = indicatorIdRef.current;
    try {
      if (!currentId) {
        const row = await createIndicatorFn({
          data: {
            name: result.spec.name || "Untitled indicator",
            code: result.sgscript,
            pine: result.pine,
            spec: result.spec as unknown as Record<string, unknown>,
            settings,
            isOverlay: result.spec.overlay,
            changelog: requestText,
          },
        });
        return row.id;
      }
      await updateIndicatorFn({
        data: {
          id: currentId,
          name: result.spec.name || undefined,
          code: result.sgscript,
          pine: result.pine,
          spec: result.spec as unknown as Record<string, unknown>,
          settings,
          isOverlay: result.spec.overlay,
          snapshot: true,
          changelog: requestText,
        },
      });
      return currentId;
    } catch {
      return currentId;
    }
  }

  const buildMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildRequestPayload> | ReturnType<typeof fixErrorRequestPayload>) => buildProjectFn({ data: payload }),
    onSuccess: async (result, payload) => {
      setState((s) => applyBuildSuccess(s, result));
      if (classifyBuildResult(result).status !== "error") {
        const id = await persistIndicator(result, payload.request);
        if (id) {
          selfAssignedIdRef.current = id;
          qc.invalidateQueries({ queryKey: ["indicators"] });
          setState((s) => withIndicatorId(s, id));
        }
      }
    },
    onError: (e: unknown) => {
      setState((s) => applyBuildFailure(s, e instanceof Error ? e.message : "Build failed"));
    },
  });

  function submitPrompt() {
    const text = prompt.trim();
    if (!canSubmitPrompt(prompt, state.status, signedIn)) return;
    const payload = buildRequestPayload(state, text);
    setState((s) => appendUserMessage(s, text));
    setPrompt("");
    buildMutation.mutate(payload);
  }

  function submitFixError() {
    if (!canSubmitFixError(state.failedDraft, state.status, signedIn)) return;
    const draft = state.failedDraft!;
    const payload = fixErrorRequestPayload(draft);
    setState((s) => appendUserMessage(s, "Fix the validation error."));
    buildMutation.mutate(payload);
  }

  /** Phase 5A-3 — the ONE place a manual editor keystroke touches state.
   * Purely local: `setManualSgscript` is a synchronous state transform with
   * no I/O, so an ordinary keystroke never reaches this hook's network
   * layer at all (no `buildProjectFn`/`validateProjectFn`/
   * `createIndicatorFn`/`updateIndicatorFn`/`appendIndicatorMessageFn`
   * call is anywhere in this function). */
  function updateSgscript(sgscript: string) {
    setState((s) => setManualSgscript(s, sgscript));
  }

  /** Re-validates the CURRENT canonical `state.pine`/`state.sgscript` — the
   * exact same fields a follow-up `buildProject` call would read, so a
   * manual edit is validated exactly as typed, never a stale AI draft.
   * `validateProject` is static-only (no `generateText`, no AI usage
   * recording, no indicator/message persistence) — reused as-is, never
   * duplicated. */
  const validateMutation = useMutation({
    mutationFn: (payload: { pine?: string; sgscript?: string }) => validateProjectFn({ data: payload }),
    onSuccess: (result) => {
      setState((s) => applyValidationResult(s, result));
    },
    onError: (e: unknown) => {
      setState((s) => applyValidationFailure(s, e instanceof Error ? e.message : "Validation failed"));
    },
  });

  function submitValidate() {
    if (!canSubmitValidate(state.sgscript, state.status, state.validationPending, signedIn)) return;
    setState((s) => beginValidation(s));
    validateMutation.mutate({ pine: state.pine, sgscript: state.sgscript });
  }

  /**
   * Phase 5A-4b — the ONE call site of `runIndicator` in the entire Builder
   * feature. Reads `state.sgscript` at invocation time (the same pattern
   * `buildRequestPayload`/`submitValidate` already use), so a manual edit
   * made a moment ago is exactly what gets executed — never a stale
   * generated copy. `bars` is supplied by the caller rather than sourced
   * internally: Builder has no symbol/timeframe/market-data of its own yet
   * (Phase 5A-4d), so this adapter is real and fully testable today via
   * fixture bars, without fabricating any market data itself.
   *
   * Deliberately does NOT call `buildProject`, `validateProject`,
   * `generateText`, or any persistence function — execution is a pure,
   * local, client-side Worker call, wholly separate from AI
   * generation/refinement and from static validation.
   */
  async function submitRunPreview(bars: Bar[], settings: Record<string, number | boolean | string> = {}) {
    if (!canRunPreview(state.sgscript, state.previewStatus, bars.length > 0)) return;
    runSeqRef.current += 1;
    const runId = runSeqRef.current;
    setState((s) => beginPreviewRun(s));
    try {
      const result = await runIndicator(state.sgscript, bars, settings);
      if (runId === runSeqRef.current) setState((s) => applyPreviewResult(s, result));
    } catch (e) {
      if (runId === runSeqRef.current) setState((s) => applyPreviewFailure(s, e instanceof Error ? e.message : "Preview failed"));
    }
  }

  return { state, prompt, setPrompt, submitPrompt, submitFixError, updateSgscript, submitValidate, submitRunPreview };
}
