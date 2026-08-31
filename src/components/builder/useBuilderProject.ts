import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { buildProject, validateProject, type BuildResult } from "@/lib/project.functions";
import { createIndicator, getIndicator, listIndicators, listVersions, restoreVersion, updateIndicator } from "@/lib/indicators.functions";
import { listIndicatorMessages, appendIndicatorMessage } from "@/lib/indicatorMessages.functions";
import { runIndicator } from "@/lib/sgscript/client";
import type { Bar } from "@/lib/sgscript/types";
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
  fixErrorRequestPayload,
  hydrateFromIndicator,
  mergeSettingsWithDefaults,
  renameIndicator,
  setManualSgscript,
  updateSetting,
  type BuilderMessageKind,
  type BuilderMessageRole,
  type BuilderProjectState,
  type SettingValue,
} from "@/lib/builder/generationState";
import { classifyBuildResult, type BuildOutcomeStatus } from "@/lib/spec/buildOutcome";

/**
 * Phase 5A-2/5A-3/5A-4b/5A-5 — the ONE place Indicator Builder touches the
 * canonical generation/persistence/execution chain. Every server call here
 * is one of the reused functions from `project.functions.ts`/
 * `indicators.functions.ts`/`indicatorMessages.functions.ts` — nothing here
 * defines a new server function, calls the AI SDK directly, or
 * re-implements any validation/runtime logic. All pure decision-making
 * (what state transition a result implies, what request shape to send)
 * lives in `src/lib/builder/generationState.ts`; this hook is only the thin
 * React/I-O shell around it. Manual code/settings/rename edits are actions
 * in this hook that touch ZERO server functions — see their own doc
 * comments below.
 *
 * Phase 5A-4b adds `runIndicator` from `@/lib/sgscript/client` — NOT a
 * server function, a pure client-side Web Worker call — as a seventh,
 * architecturally distinct reused entry point: the canonical SGScript
 * execution engine. `submitRunPreview` is the only place it's called from
 * anywhere in Builder (mirroring the "exactly one call site" rule already
 * enforced for `buildProject`/`validateProject`).
 *
 * Phase 5A-5 adds `getIndicator` (reopening an existing project),
 * `listVersions`/`restoreVersion` (version history) — all three already
 * existed, already RLS-scoped, already used by Chart Studio's own "Saved"
 * widget. No new server function is introduced by this phase.
 */
export function useBuilderProject(signedIn: boolean, initialIndicatorId?: string) {
  const buildProjectFn = useServerFn(buildProject);
  const validateProjectFn = useServerFn(validateProject);
  const createIndicatorFn = useServerFn(createIndicator);
  const updateIndicatorFn = useServerFn(updateIndicator);
  const getIndicatorFn = useServerFn(getIndicator);
  const listVersionsFn = useServerFn(listVersions);
  const restoreVersionFn = useServerFn(restoreVersion);
  const listIndicatorsFn = useServerFn(listIndicators);
  const listIndicatorMessagesFn = useServerFn(listIndicatorMessages);
  const appendIndicatorMessageFn = useServerFn(appendIndicatorMessage);
  const qc = useQueryClient();

  const [state, setState] = useState<BuilderProjectState>(INITIAL_BUILDER_PROJECT_STATE);
  const [prompt, setPrompt] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);

  /** Kept in sync with `state.indicatorId` via the effect below so the
   * async `persistIndicator` call (inside a mutation's `onSuccess`, which
   * closes over whatever `state` looked like when the mutation started)
   * always reads the truly-current id rather than a stale closure. */
  const indicatorIdRef = useRef<string | null>(null);
  useEffect(() => {
    indicatorIdRef.current = state.indicatorId;
  }, [state.indicatorId]);

  /** Tracks which id this hook itself created OR hydrated FROM (Phase
   * 5A-5) — mirrors `AiSidePanel`'s own `selfAssignedIdRef` convention.
   * Deliberately reset to `null` the moment a FOREIGN id is loaded via
   * `/builder/$id` (see the hydration effect below), so the existing
   * `messagesQuery` guard (`state.indicatorId !== selfAssignedIdRef.current`)
   * — unchanged since Phase 5A-2, exactly as forward-compatible as its own
   * doc comment always claimed — fires and restores that project's real
   * chat history. */
  const selfAssignedIdRef = useRef<string | null>(null);
  const persistedCountRef = useRef(0);

  /** Phase 5A-4b — the smallest stale-result guard the audit recommended:
   * incremented on every `submitRunPreview` call; a run's result is only
   * ever applied to state if this ref still equals the value captured when
   * THAT run started. `runIndicator` exposes no request id/cancellation of
   * its own (see the Phase 5A-4b audit), so this is the one piece Builder
   * needs to add — no `AbortController`, no job queue, no polling. */
  const runSeqRef = useRef(0);

  /** Phase 5A-4e — the narrow "a manual edit just happened" signal the
   * preview-refresh orchestration (`useBuilderPreviewRefresh.ts`) debounces
   * off of. Deliberately NOT inferred by diffing `state.sgscript` values
   * (that can't distinguish a manual keystroke from `sgscript` changing
   * because a build/refinement just succeeded, which must NOT debounce).
   * Bumped synchronously inside `updateSgscript` below, then read as a
   * plain number at render time — the ref itself holds no data other than
   * this counter, so it's not a second copy of the code in any sense; the
   * one `setState` call `updateSgscript` already makes is what actually
   * triggers the re-render that lets a consumer observe the new value. */
  const manualEditSeqRef = useRef(0);

  /** Phase 5A-5 — the identical counter shape as `manualEditSeqRef`, for a
   * Settings-panel edit instead of a code edit. Kept as its OWN ref (not
   * reusing `manualEditSeqRef`) so a future consumer can always tell which
   * kind of edit most recently happened, even though today both feed the
   * same debounced preview-refresh trigger. */
  const settingsEditSeqRef = useRef(0);

/** Kept in sync with `state.name`/`state.settings` the exact same way
   * `indicatorIdRef` already is, for the exact same reason: the async
   * `persistIndicator` continuation inside `buildMutation.onSuccess` needs
   * the truly-current name/settings, not whatever `state` looked like in
   * the closure captured when the mutation's options were last set. A
   * one-render lag here is the same tolerance this codebase already
   * accepts for `indicatorIdRef` — not worth a more elaborate mechanism. */
  const nameRef = useRef<string | null>(null);
  const settingsRef = useRef<Record<string, SettingValue>>({});
  useEffect(() => {
    nameRef.current = state.name;
    settingsRef.current = state.settings;
  }, [state.name, state.settings]);

  /** Phase 5A-5 — guards `hydrateFromIndicator` against running more than
   * once for the same `initialIndicatorId` (e.g. a background refetch of
   * the `["indicator", id]` query this hook itself never invalidates, but
   * defensively guarded anyway) — a second hydration mid-session would
   * silently discard any local edits made since the first one. */
  const hydratedIdRef = useRef<string | null>(null);

  /** Phase 5A-5 — reopening `/builder/$id`. The route's own loader already
   * primed the `["indicator", id]` query via `ensureQueryData` before this
   * component ever mounted (mirroring `src/routes/s.$id.tsx`'s established
   * pattern), so this `useQuery` reads straight from that warm cache — one
   * indicator read total, not two. */
  const initialIndicatorQuery = useQuery({
    queryKey: ["indicator", initialIndicatorId],
    queryFn: () => getIndicatorFn({ data: { id: initialIndicatorId as string } }),
    enabled: Boolean(initialIndicatorId),
    retry: false,
  });

  useEffect(() => {
    if (!initialIndicatorId || !initialIndicatorQuery.data) return;
    if (hydratedIdRef.current === initialIndicatorId) return;
    hydratedIdRef.current = initialIndicatorId;
    selfAssignedIdRef.current = null;
    setState(() => hydrateFromIndicator(initialIndicatorQuery.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndicatorId, initialIndicatorQuery.data]);

  // Only ever enabled for an indicatorId this hook did NOT itself just
  // create or hydrate from — i.e. never fires for a brand-new project's
  // first build (self-assigned) and never fires again for the SAME
  // reopened project once its history has loaded once.
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

  /**
   * Phase 5A-2/5A-5 — reuses the exact same `createIndicator`/
   * `updateIndicator` pattern Studio's `AiSidePanel.persistVersion` already
   * uses: the FIRST successful build creates the row (`createIndicator`
   * itself lays down its own v1 version row — untouched, see the 5A-5B
   * audit's "don't fight the existing backend model" decision). EVERY
   * successful build/modify AFTER that now persists with `snapshot: false`
   * — Phase 5A-5's deliberate version-pollution fix: routine AI refinements
   * update the live row so nothing is ever silently lost, but no longer
   * create a permanent `indicator_versions` row on every single chat
   * message. A permanent checkpoint is now something the user asks for
   * explicitly via Save Version (`saveVersionIndicator` below). Never
   * called for an `"error"` outcome. Returns the resulting id AND an error
   * message (rather than swallowing a failure) so the caller can correctly
   * report "generated but not saved" instead of falsely claiming the
   * project is safe.
   */
  async function persistIndicator(result: BuildResult, name: string | null, settings: Record<string, SettingValue>): Promise<{ id: string | null; error: string | null }> {
    const currentId = indicatorIdRef.current;
    try {
      if (!currentId) {
        const row = await createIndicatorFn({
          data: {
            name: name || result.spec.name || "Untitled indicator",
            code: result.sgscript,
            pine: result.pine,
            spec: result.spec as unknown as Record<string, unknown>,
            settings,
            isOverlay: result.spec.overlay,
            changelog: "Initial version",
          },
        });
        return { id: row.id, error: null };
      }
      await updateIndicatorFn({
        data: {
          id: currentId,
          name: name || result.spec.name || undefined,
          code: result.sgscript,
          pine: result.pine,
          spec: result.spec as unknown as Record<string, unknown>,
          settings,
          isOverlay: result.spec.overlay,
          snapshot: false,
        },
      });
      return { id: currentId, error: null };
    } catch (e) {
      return { id: currentId, error: e instanceof Error ? e.message : "Could not save the generated indicator." };
    }
  }

  const buildMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildRequestPayload> | ReturnType<typeof fixErrorRequestPayload>) => buildProjectFn({ data: payload }),
    onSuccess: async (result) => {
      setState((s) => applyBuildSuccess(s, result));
      if (classifyBuildResult(result).status !== "error") {
        // Reads `nameRef`/`settingsRef` (kept in sync via the effect above)
        // rather than the merged values `applyBuildSuccess` just computed
        // inside the `setState` updater above — updater functions are not a
        // channel for reading back a result, only for computing the next
        // state; the merge these refs reflect (name-preservation,
        // `mergeSettingsWithDefaults`) is deterministic from the same
        // inputs, so persisting from the refs is equivalent.
        const mergedSettings = mergeSettingsWithDefaults(settingsRef.current, result.spec);
        const resolvedName = nameRef.current ?? result.spec.name;
        const { id, error } = await persistIndicator(result, resolvedName, mergedSettings);
        if (id) {
          selfAssignedIdRef.current = id;
          qc.invalidateQueries({ queryKey: ["indicators"] });
          setState((s) => (error ? applyAutoPersistFailure(s, error) : applyAutoPersistSuccess(s, id, s.currentVersion ?? 1)));
        } else if (error) {
          setState((s) => applyAutoPersistFailure(s, error));
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
    manualEditSeqRef.current += 1;
    setState((s) => setManualSgscript(s, sgscript));
  }

  /** Phase 5A-5 — the ONE place a Settings-panel edit touches state. Same
   * zero-I/O shape as `updateSgscript`: no AI call, no DB write. */
  function updateSettingValue(name: string, value: SettingValue) {
    settingsEditSeqRef.current += 1;
    setState((s) => updateSetting(s, name, value));
  }

  /** Phase 5A-5 — the ONE place a manual rename touches state. Local only;
   * persisted through Save, never a dedicated rename endpoint. */
  function renameProject(name: string) {
    setState((s) => renameIndicator(s, name));
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
   * fixture bars, without fabricating any market data itself. `settings`
   * defaults to the CURRENT canonical `state.settings` (Phase 5A-5) rather
   * than an empty object, so a caller can omit it and still execute against
   * the real configured inputs.
   *
   * Deliberately does NOT call `buildProject`, `validateProject`,
   * `generateText`, or any persistence function — execution is a pure,
   * local, client-side Worker call, wholly separate from AI
   * generation/refinement and from static validation.
   */
  async function submitRunPreview(bars: Bar[], settings: Record<string, SettingValue> = state.settings) {
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

  /** Phase 5A-5B — explicit Save: `updateIndicator(..., snapshot: false)`,
   * the SAME function/flag Save Version uses, differing only in that flag —
   * never a second persistence mechanism. Requires an existing
   * `indicatorId` (`canSave` already enforces this) so opening a blank
   * `/builder` and clicking Save can never create an empty row. */
  const saveMutation = useMutation({
    mutationFn: () =>
      updateIndicatorFn({
        data: {
          id: state.indicatorId as string,
          name: state.name ?? undefined,
          code: state.sgscript,
          pine: state.pine,
          spec: (state.spec ?? undefined) as unknown as Record<string, unknown> | undefined,
          settings: state.settings,
          isOverlay: state.spec?.overlay,
          snapshot: false,
        },
      }),
    onSuccess: () => {
      setState((s) => applySaveSuccess(s));
      qc.invalidateQueries({ queryKey: ["indicators"] });
    },
  });

  function saveIndicator() {
    if (!canSave(state.indicatorId, state.dirty, saveMutation.isPending, signedIn)) return;
    saveMutation.mutate();
  }

  /** Phase 5A-5B — explicit Save Version: identical payload to Save, plus
   * `snapshot: true` and a changelog — the ONE place `indicator_versions`
   * gains a new row from a user action (routine AI refinements no longer
   * do, see `persistIndicator` above). */
  const saveVersionMutation = useMutation({
    mutationFn: (changelog: string) =>
      updateIndicatorFn({
        data: {
          id: state.indicatorId as string,
          name: state.name ?? undefined,
          code: state.sgscript,
          pine: state.pine,
          spec: (state.spec ?? undefined) as unknown as Record<string, unknown> | undefined,
          settings: state.settings,
          isOverlay: state.spec?.overlay,
          snapshot: true,
          changelog: changelog.trim() || "Manual checkpoint",
        },
      }),
    onSuccess: (result) => {
      setState((s) => applySaveSuccess(s, result.version));
      qc.invalidateQueries({ queryKey: ["indicators"] });
      qc.invalidateQueries({ queryKey: ["indicator-versions", state.indicatorId] });
    },
  });

  function saveVersionIndicator(changelog: string) {
    if (!canSaveVersion(state.indicatorId, state.dirty, saveVersionMutation.isPending, signedIn)) return;
    saveVersionMutation.mutate(changelog);
  }

  /** Phase 5A-5B — version history, read only once the toolbar's History
   * control has actually been opened (`historyOpen`) so a project that's
   * never had its history opened never issues the extra `listVersions`
   * request — matches the audit's "version read only if/when History needs
   * it" network requirement. Cached under a stable key, so reopening the
   * popover after the first time is free unless something invalidated it. */
  const versionsQuery = useQuery({
    queryKey: ["indicator-versions", state.indicatorId],
    queryFn: () => listVersionsFn({ data: { indicatorId: state.indicatorId as string } }),
    enabled: Boolean(state.indicatorId) && historyOpen,
    retry: false,
  });

  /** Phase 5A-5B — Restore: reuses `restoreVersion` as-is (the server
   * already persists the checkpoint/version bookkeeping); this hook only
   * rehydrates local state from the `restored` row the call returns —
   * exactly the same `hydrateFromIndicator` transform reopening a project
   * uses, never a second "restored draft" copy.
   *
   * `hydrateFromIndicator` resets to a blank `messages: []` (correct for
   * `/builder/$id` reopening a DIFFERENT id, which lets `messagesQuery`'s
   * existing `indicatorId !== selfAssignedIdRef.current` guard notice and
   * reload real history) — but Restore keeps the SAME `indicatorId`, so
   * that guard would never re-fire and the real conversation would
   * silently vanish from the UI even though `indicator_messages` was never
   * touched. The functional `setState` updater below explicitly carries the
   * CURRENT `s.messages` forward across the hydration for exactly that
   * reason — restoring a version changes code/spec/settings, never chat. */
  const restoreMutation = useMutation({
    mutationFn: (version: number) => restoreVersionFn({ data: { indicatorId: state.indicatorId as string, version } }),
    onSuccess: (result) => {
      const id = state.indicatorId as string;
      setState((s) => ({
        ...hydrateFromIndicator({
          id,
          name: result.restored.name,
          code: result.restored.code,
          pine: result.restored.pine,
          spec: result.restored.spec,
          settings: result.restored.settings,
          current_version: result.version,
        }),
        messages: s.messages,
      }));
      qc.invalidateQueries({ queryKey: ["indicators"] });
      qc.invalidateQueries({ queryKey: ["indicator-versions", id] });
    },
  });

  function restoreVersionAction(version: number) {
    restoreMutation.mutate(version);
  }

  /** Phase 5A-5F — saved-project discovery. Reuses the exact `listIndicators`
   * query Chart Studio's own "Saved" widget already populates under the
   * SAME `["indicators"]` cache key — if Studio was visited earlier this
   * session, opening Builder's Open menu for the first time is free. Only
   * fetched once the menu is actually opened (`openMenuOpen`), matching the
   * same lazy-read shape as `versionsQuery` above. */
  const savedIndicatorsQuery = useQuery({
    queryKey: ["indicators"],
    queryFn: () => listIndicatorsFn(),
    enabled: signedIn && openMenuOpen,
  });

  return {
    state,
    prompt,
    setPrompt,
    submitPrompt,
    submitFixError,
    updateSgscript,
    submitValidate,
    submitRunPreview,
    manualEditVersion: manualEditSeqRef.current,
    // Phase 5A-5 additions:
    updateSetting: updateSettingValue,
    settingsVersion: settingsEditSeqRef.current,
    renameProject,
    saveIndicator,
    savePending: saveMutation.isPending,
    saveError: saveMutation.error instanceof Error ? saveMutation.error.message : null,
    saveVersionIndicator,
    saveVersionPending: saveVersionMutation.isPending,
    saveVersionError: saveVersionMutation.error instanceof Error ? saveVersionMutation.error.message : null,
    versions: versionsQuery.data ?? [],
    versionsLoading: versionsQuery.isLoading,
    versionsError: versionsQuery.error instanceof Error ? versionsQuery.error.message : null,
    historyOpen,
    setHistoryOpen,
    restoreVersionAction,
    restorePending: restoreMutation.isPending,
    restoreError: restoreMutation.error instanceof Error ? restoreMutation.error.message : null,
    messagesLoadError: messagesQuery.isError ? (messagesQuery.error instanceof Error ? messagesQuery.error.message : "Could not load chat history.") : null,
    projectLoading: Boolean(initialIndicatorId) && initialIndicatorQuery.isLoading,
    savedIndicators: savedIndicatorsQuery.data ?? [],
    savedIndicatorsLoading: savedIndicatorsQuery.isLoading,
    openMenuOpen,
    setOpenMenuOpen,
  };
}
