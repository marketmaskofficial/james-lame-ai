import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, Check, ImagePlus, Trash2, Sparkles, X, ArrowUpRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listExecutionsForPosition,
  getJournalEntryForPosition,
  saveTradeJournalForPosition,
  listJournalEntryTerms,
  listJournalTaxonomySuggestions,
  saveJournalTerms,
  listJournalScreenshots,
  recordJournalScreenshot,
  deleteJournalScreenshot,
  generateJournalAiReview,
  getLatestJournalAiReview,
  type TradeJournalEntry,
  type JournalScreenshot,
} from "@/lib/trades.functions";
import { classifyTrade, netPnlForTrade, SESSION_LABELS, type ClosedTrade } from "@/lib/dashboard/metrics";
import { formatDuration, tradeDurationMs, tradeSession } from "@/lib/dashboard/tradeExplorer";
import { isJournalDraftDirty, sameLabelSet, selectValueToSession, sessionToSelectValue, type JournalDraft, type JournalSessionValue } from "@/lib/dashboard/journalDraft";
import { SUGGESTIONS_BY_KIND, GRADE_VALUES, type TaxonomyKind, type TradeGrade } from "@/lib/dashboard/journalTaxonomy";
import type { JournalFocusKind } from "@/lib/dashboard/journalAnalytics";
import { uploadJournalScreenshotFile, validateJournalScreenshotFile } from "@/lib/storage/journalScreenshots";
import { JournalChipField } from "@/components/trades/JournalChipField";

/**
 * Phase 4D — Trade Explorer detail drawer. Opens on top of the table/cards
 * rather than navigating away, per the phase brief. Executions and the
 * journal entry are fetched only when a trade is open (`enabled: !!trade`),
 * never preloaded for every row in the table — both reads are RLS-scoped
 * (`requireSupabaseAuth`/`context.supabase`), same as every other Dashboard
 * read this session has built.
 *
 * Phase 4E-1 added an editable Notes/Session journal editor in place of
 * the old read-only block; Phase 4E-2 extends the SAME architecture (same
 * dirty-state model, same save/saving/saved/error states, same discard
 * protection) with Grade, Setup, Strategy, Emotion, Mistakes, Tags,
 * Screenshots, and an AI Trade Review — nothing from Phase 4E-1 is
 * replaced, only extended. Unsaved-edit protection (closing the drawer or
 * switching to another trade while dirty) is exposed to the parent
 * (`src/routes/trades.tsx`) via `TradeDetailDrawerHandle` — the parent's
 * `selectedTrade` state is the single source of truth and is only ever
 * changed after this component confirms it's safe to do so.
 *
 * Screenshots and the AI review are NOT part of the notes/session/grade/
 * taxonomy "dirty draft" — an upload/delete persists immediately (standard
 * file-upload UX), and "Generate AI Review" is its own explicit action —
 * so neither can ever be silently lost by the discard-changes flow, and
 * neither blocks or is blocked by the Save Journal button.
 */

export type TradeDetailDrawerHandle = {
  hasUnsavedChanges: () => boolean;
  /** Runs `action` immediately if there are no unsaved journal edits;
   * otherwise shows the discard-confirmation dialog and only runs `action`
   * if the user confirms discarding. */
  confirmDiscardThen: (action: () => void) => void;
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Full UTC date/time — explicitly labeled, matching this app's established
 * convention of never silently rendering OMS timestamps in browser-local
 * time. */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  const month = MONTH_ABBR[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  let hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month} ${day}, ${year}, ${hours}:${minutes} ${ampm} UTC`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Phase 4G — an additive, outbound-only "Analyze this X" link. Navigates to
 * `/journal` with the existing `focusKind`/`focusValue` search params
 * (Phase 4F's own drill-down contract — nothing new on that side) plus the
 * shared Account/Symbol/Date context. Purely a link: it never reads or
 * writes any journal-editing state, so it cannot affect the drawer's
 * save/discard behavior in any way.
 */
function AnalyzeLink({ context, kind, value, label }: { context: JournalLinkContext; kind: JournalFocusKind; value: string; label: string }) {
  return (
    <Link
      to="/journal"
      search={{
        accountId: context.accountId,
        symbol: context.symbol || undefined,
        from: context.from || undefined,
        to: context.to || undefined,
        focusKind: kind,
        focusValue: value,
      }}
      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand hover:underline"
    >
      {label}
      <ArrowUpRight className="h-2.5 w-2.5" />
    </Link>
  );
}

const EMPTY_DRAFT: JournalDraft = { notes: "", session: null, grade: null, setup: null, strategy: null, emotion: null, mistakes: [], tags: [] };

const TAXONOMY_KINDS: TaxonomyKind[] = ["setup", "strategy", "mistake", "emotion", "tag"];

/** The shared Account/Symbol/Date filter context Trade Explorer is
 * currently viewing — carried into every "Analyze this..." link's `/journal`
 * navigation so the analysis opens scoped to the same filters, per the
 * Phase 4G scope decision (never Trade Explorer's direction/outcome/
 * session/sort/page state, which `/journal` doesn't support). */
export type JournalLinkContext = { accountId: string; symbol?: string; from?: string; to?: string };

export const TradeDetailDrawer = forwardRef<TradeDetailDrawerHandle, {
  trade: ClosedTrade | null;
  accountLabel: string | null;
  onOpenChange: (open: boolean) => void;
  journalContext: JournalLinkContext;
}>(function TradeDetailDrawer({ trade, accountLabel, onOpenChange, journalContext }, ref) {
  const listExecutionsFn = useServerFn(listExecutionsForPosition);
  const getJournalFn = useServerFn(getJournalEntryForPosition);
  const saveJournalFn = useServerFn(saveTradeJournalForPosition);
  const listTermsFn = useServerFn(listJournalEntryTerms);
  const listSuggestionsFn = useServerFn(listJournalTaxonomySuggestions);
  const saveTermsFn = useServerFn(saveJournalTerms);
  const listScreenshotsFn = useServerFn(listJournalScreenshots);
  const recordScreenshotFn = useServerFn(recordJournalScreenshot);
  const deleteScreenshotFn = useServerFn(deleteJournalScreenshot);
  const generateReviewFn = useServerFn(generateJournalAiReview);
  const getLatestReviewFn = useServerFn(getLatestJournalAiReview);
  const qc = useQueryClient();

  const executionsQuery = useQuery({
    queryKey: ["trade-executions", trade?.positionId],
    queryFn: () => listExecutionsFn({ data: { positionId: trade!.positionId } }),
    enabled: !!trade,
  });
  const journalQuery = useQuery({
    queryKey: ["trade-journal", trade?.positionId],
    queryFn: () => getJournalFn({ data: { positionId: trade!.positionId } }),
    enabled: !!trade,
  });
  const termsQuery = useQuery({
    queryKey: ["trade-journal-terms", trade?.positionId],
    queryFn: () => listTermsFn({ data: { positionId: trade!.positionId } }),
    enabled: !!trade,
  });
  const suggestionsQuery = useQuery({
    queryKey: ["trade-journal-taxonomy-suggestions"],
    queryFn: () => listSuggestionsFn(),
    enabled: !!trade,
    staleTime: 60_000,
  });
  const screenshotsQuery = useQuery({
    queryKey: ["trade-journal-screenshots", trade?.positionId],
    queryFn: () => listScreenshotsFn({ data: { positionId: trade!.positionId } }),
    enabled: !!trade,
  });
  const latestReviewQuery = useQuery({
    queryKey: ["trade-journal-ai-review", trade?.positionId],
    queryFn: () => getLatestReviewFn({ data: { positionId: trade!.positionId } }),
    enabled: !!trade,
  });

  const [savedDraft, setSavedDraft] = useState<JournalDraft>(EMPTY_DRAFT);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftSession, setDraftSession] = useState<JournalSessionValue>(null);
  const [draftGrade, setDraftGrade] = useState<TradeGrade | null>(null);
  const [draftSetup, setDraftSetup] = useState<string | null>(null);
  const [draftStrategy, setDraftStrategy] = useState<string | null>(null);
  const [draftEmotion, setDraftEmotion] = useState<string | null>(null);
  const [draftMistakes, setDraftMistakes] = useState<string[]>([]);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const syncedPositionIdRef = useRef<string | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // `trade.qty` (trade_positions.qty) is the position's REMAINING open
  // quantity, which the OMS explicitly zeroes out once a position fully
  // closes — always 0 for every real closed trade, confirmed against
  // oms.server.ts, not something this UI can treat as "the trade's size".
  // The real originally-traded quantity only survives in that position's
  // own fills, so it's derived here from the opening-side executions once
  // they've loaded, rather than shown as a static (always-wrong) 0.
  // Mirrored into a ref so the AI-review mutation's closure (defined
  // below, but only ever invoked well after this value is current) always
  // reads the latest value without needing to be in its dependency list.
  const openingQty = trade ? executionsQuery.data?.filter((e) => e.side === trade.side).reduce((s, e) => s + e.qty, 0) : undefined;
  const openingQtyRef = useRef(openingQty);
  openingQtyRef.current = openingQty;

  const currentDraft: JournalDraft = {
    notes: draftNotes,
    session: draftSession,
    grade: draftGrade,
    setup: draftSetup,
    strategy: draftStrategy,
    emotion: draftEmotion,
    mistakes: draftMistakes,
    tags: draftTags,
  };

  // Populate the editor from the loaded journal entry + its terms exactly
  // once per position — not on every background refetch of the SAME
  // position, which would otherwise stomp on values the user is actively
  // editing.
  useEffect(() => {
    if (!trade) {
      syncedPositionIdRef.current = null;
      return;
    }
    if (syncedPositionIdRef.current === trade.positionId) return;
    if (journalQuery.isLoading || termsQuery.isLoading) return;
    syncedPositionIdRef.current = trade.positionId;

    const terms = termsQuery.data ?? [];
    const singleTerm = (kind: TaxonomyKind) => terms.find((t) => t.kind === kind)?.label ?? null;
    const multiTerms = (kind: TaxonomyKind) => terms.filter((t) => t.kind === kind).map((t) => t.label);

    const loaded: JournalDraft = {
      notes: journalQuery.data?.notes ?? "",
      session: (journalQuery.data?.session as JournalSessionValue) ?? null,
      grade: (journalQuery.data?.grade as TradeGrade | null) ?? null,
      setup: singleTerm("setup"),
      strategy: singleTerm("strategy"),
      emotion: singleTerm("emotion"),
      mistakes: multiTerms("mistake"),
      tags: multiTerms("tag"),
    };
    setSavedDraft(loaded);
    setDraftNotes(loaded.notes);
    setDraftSession(loaded.session);
    setDraftGrade(loaded.grade);
    setDraftSetup(loaded.setup);
    setDraftStrategy(loaded.strategy);
    setDraftEmotion(loaded.emotion);
    setDraftMistakes(loaded.mistakes);
    setDraftTags(loaded.tags);
    setSavedAt(journalQuery.data?.updated_at ?? null);
    setSaveStatus("idle");
    setSaveError(null);
  }, [trade, journalQuery.isLoading, journalQuery.data, termsQuery.isLoading, termsQuery.data]);

  const isDirty = isJournalDraftDirty(savedDraft, currentDraft);

  useImperativeHandle(
    ref,
    () => ({
      hasUnsavedChanges: () => isDirty,
      confirmDiscardThen: (action: () => void) => {
        if (!isDirty) {
          action();
          return;
        }
        pendingActionRef.current = action;
        setDiscardDialogOpen(true);
      },
    }),
    [isDirty],
  );

  const saveMutation = useMutation({
    mutationFn: async (draft: JournalDraft) => {
      const positionId = trade!.positionId;
      const accountId = trade!.accountId;
      const symbol = trade!.symbol;

      const entryPromise = saveJournalFn({
        data: { positionId, accountId, symbol, notes: draft.notes, session: draft.session, grade: draft.grade },
      });

      const termTasks: Promise<unknown>[] = [];
      if (draft.setup !== savedDraft.setup) {
        termTasks.push(saveTermsFn({ data: { positionId, accountId, symbol, kind: "setup", labels: draft.setup ? [draft.setup] : [] } }));
      }
      if (draft.strategy !== savedDraft.strategy) {
        termTasks.push(saveTermsFn({ data: { positionId, accountId, symbol, kind: "strategy", labels: draft.strategy ? [draft.strategy] : [] } }));
      }
      if (draft.emotion !== savedDraft.emotion) {
        termTasks.push(saveTermsFn({ data: { positionId, accountId, symbol, kind: "emotion", labels: draft.emotion ? [draft.emotion] : [] } }));
      }
      if (!sameLabelSet(draft.mistakes, savedDraft.mistakes)) {
        termTasks.push(saveTermsFn({ data: { positionId, accountId, symbol, kind: "mistake", labels: draft.mistakes } }));
      }
      if (!sameLabelSet(draft.tags, savedDraft.tags)) {
        termTasks.push(saveTermsFn({ data: { positionId, accountId, symbol, kind: "tag", labels: draft.tags } }));
      }

      const [entry] = await Promise.all([entryPromise, ...termTasks]);
      return entry as TradeJournalEntry;
    },
    onMutate: () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      setSaveStatus("saving");
      setSaveError(null);
    },
    onSuccess: (saved, draft) => {
      setSavedDraft(draft);
      setSavedAt(saved.updated_at);
      setSaveStatus("saved");
      qc.setQueryData(["trade-journal", trade?.positionId], saved);
      qc.invalidateQueries({ queryKey: ["trade-journal-terms", trade?.positionId] });
      qc.invalidateQueries({ queryKey: ["trade-journal-taxonomy-suggestions"] });
      // Refreshes the Trade Explorer table's journal indicator/filter —
      // matches on the query key PREFIX (any current filter/sort/page
      // combination), never a per-row request.
      qc.invalidateQueries({ queryKey: ["trades-page"] });
      savedTimeoutRef.current = setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    },
    onError: (e: unknown) => {
      setSaveStatus("error");
      setSaveError(e instanceof Error ? e.message : "Could not save journal entry.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const invalid = validateJournalScreenshotFile(file);
      if (invalid) throw new Error(invalid === "too-large" ? "Image exceeds the 5 MB limit." : "Unsupported image type — use PNG, JPEG, WEBP, or GIF.");
      const storagePath = await uploadJournalScreenshotFile(file, trade!.userId);
      return recordScreenshotFn({ data: { positionId: trade!.positionId, accountId: trade!.accountId, symbol: trade!.symbol, storagePath } });
    },
    onMutate: () => setScreenshotError(null),
    onSuccess: (created) => {
      qc.setQueryData(["trade-journal-screenshots", trade?.positionId], (prev: JournalScreenshot[] | undefined) => [...(prev ?? []), created]);
    },
    onError: (e: unknown) => setScreenshotError(e instanceof Error ? e.message : "Could not upload screenshot."),
  });

  const deleteScreenshotMutation = useMutation({
    mutationFn: (screenshotId: string) => deleteScreenshotFn({ data: { screenshotId } }),
    onMutate: (screenshotId) => {
      setScreenshotError(null);
      qc.setQueryData(["trade-journal-screenshots", trade?.positionId], (prev: JournalScreenshot[] | undefined) => (prev ?? []).filter((s) => s.id !== screenshotId));
    },
    onError: (e: unknown) => {
      setScreenshotError(e instanceof Error ? e.message : "Could not delete screenshot.");
      qc.invalidateQueries({ queryKey: ["trade-journal-screenshots", trade?.positionId] });
    },
  });

  const generateReviewMutation = useMutation({
    mutationFn: () => {
      const t = trade!;
      return generateReviewFn({
        data: {
          positionId: t.positionId,
          accountId: t.accountId,
          symbol: t.symbol,
          side: t.side,
          qty: openingQtyRef.current ?? 0,
          avgEntry: t.avgEntry,
          exitPrice: t.exitPrice,
          realizedPnl: t.realizedPnl,
          commission: t.commission,
          openedAt: t.openedAt,
          closedAt: t.closedAt,
          durationLabel: formatDuration(tradeDurationMs(t)),
          computedSession: SESSION_LABELS[tradeSession(t)],
          notes: draftNotes,
          manualSession: draftSession,
          grade: draftGrade,
          setup: draftSetup,
          strategy: draftStrategy,
          emotion: draftEmotion,
          mistakes: draftMistakes,
          tags: draftTags,
          executions: (executionsQuery.data ?? []).map((e) => ({ side: e.side, qty: e.qty, price: e.price, executedAt: e.executed_at })),
        },
      });
    },
    onMutate: () => setReviewError(null),
    onSuccess: (review) => {
      qc.setQueryData(["trade-journal-ai-review", trade?.positionId], review);
    },
    onError: (e: unknown) => setReviewError(e instanceof Error ? e.message : "Could not generate an AI review."),
  });

  useEffect(() => () => {
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
  }, []);

  function handleOpenChange(open: boolean) {
    if (open) return;
    if (isDirty) {
      pendingActionRef.current = () => onOpenChange(false);
      setDiscardDialogOpen(true);
      return;
    }
    onOpenChange(false);
  }

  function handleDiscardConfirmed() {
    setDiscardDialogOpen(false);
    setDraftNotes(savedDraft.notes);
    setDraftSession(savedDraft.session);
    setDraftGrade(savedDraft.grade);
    setDraftSetup(savedDraft.setup);
    setDraftStrategy(savedDraft.strategy);
    setDraftEmotion(savedDraft.emotion);
    setDraftMistakes(savedDraft.mistakes);
    setDraftTags(savedDraft.tags);
    setSaveStatus("idle");
    setSaveError(null);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }

  function handleKeepEditing() {
    setDiscardDialogOpen(false);
    pendingActionRef.current = null;
  }

  const quantityValue = executionsQuery.isLoading ? "…" : openingQty && openingQty > 0 ? String(openingQty) : "—";

  const net = trade ? netPnlForTrade(trade) : 0;
  const cls = trade ? classifyTrade(trade) : "breakeven";
  const netToneClass = cls === "win" ? "text-emerald-400" : cls === "loss" ? "text-red-400" : "text-foreground";
  const resultBadgeClass =
    cls === "win" ? "bg-emerald-950/40 text-emerald-300" : cls === "loss" ? "bg-red-950/30 text-red-300" : "bg-muted text-muted-foreground";

  const computedSessionLabel = trade ? SESSION_LABELS[tradeSession(trade)] : null;

  const suggestionsFor = (kind: TaxonomyKind): string[] => {
    const own = (suggestionsQuery.data ?? []).filter((t) => t.kind === kind).map((t) => t.label);
    const merged = [...SUGGESTIONS_BY_KIND[kind]];
    for (const label of own) {
      if (!merged.some((m) => m.toLowerCase() === label.toLowerCase())) merged.push(label);
    }
    return merged;
  };

  const journalIsLoading = journalQuery.isLoading || termsQuery.isLoading;
  const journalHasError = journalQuery.isError || termsQuery.isError;
  const screenshots = screenshotsQuery.data ?? [];
  const latestReview = latestReviewQuery.data ?? null;

  return (
    <>
      <Sheet open={!!trade} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-border bg-card sm:max-w-md"
          onInteractOutside={(e) => {
            // The Sheet is modal: its overlay covers the whole viewport
            // (including the table behind it), so a real click there hits
            // the overlay, not a row — Radix treats that as "outside" and
            // would otherwise close the Sheet unconditionally, bypassing
            // the same dirty check `handleOpenChange` already applies to
            // the X button/Escape. When clean, let Radix's default
            // click-outside-to-close behavior proceed unchanged (same as
            // Phase 4D). When dirty, block it and route through
            // `handleOpenChange` instead, so an outside click gets the
            // identical discard-confirmation the X button gets, rather
            // than silently discarding.
            if (isDirty) {
              e.preventDefault();
              handleOpenChange(false);
            }
          }}
        >
          {trade && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      trade.side === "buy" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
                    }`}
                  >
                    {trade.side === "buy" ? "Long" : "Short"}
                  </span>
                  <SheetTitle className="truncate">{trade.symbol}</SheetTitle>
                  <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${resultBadgeClass}`}>
                    {cls === "win" ? "Win" : cls === "loss" ? "Loss" : "Breakeven"}
                  </span>
                </div>
                <SheetDescription asChild>
                  <span className={`block text-2xl font-bold tabular-nums ${netToneClass}`}>
                    {net >= 0 ? "+" : "-"}
                    {money(Math.abs(net))}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 divide-y divide-border/40 border-t border-border/40">
                <DetailRow label="Entry Price" value={money(trade.avgEntry)} />
                <DetailRow label="Exit Price" value={trade.exitPrice == null ? "—" : money(trade.exitPrice)} />
                <DetailRow label="Quantity" value={quantityValue} />
                <DetailRow label="Opened" value={formatUtc(trade.openedAt)} />
                <DetailRow label="Closed" value={formatUtc(trade.closedAt)} />
                <DetailRow label="Duration" value={formatDuration(tradeDurationMs(trade))} />
                <DetailRow label="Gross Realized P&L" value={money(trade.realizedPnl)} />
                <DetailRow label="Commission" value={money(trade.commission)} />
                <DetailRow label="Net P&L" value={`${net >= 0 ? "+" : "-"}${money(Math.abs(net))}`} />
                <DetailRow label="Account" value={accountLabel ?? "—"} />
              </div>

              <div className="mt-4 border-t border-border/60 pt-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Executions</div>
                {executionsQuery.isLoading ? (
                  <div className="py-3 text-xs text-muted-foreground">Loading fills…</div>
                ) : executionsQuery.isError ? (
                  <div className="py-3 text-xs text-muted-foreground">Could not load fills.</div>
                ) : (executionsQuery.data ?? []).length === 0 ? (
                  <div className="py-3 text-xs text-muted-foreground">No linked fills.</div>
                ) : (
                  <div className="mt-2 flex flex-col">
                    {executionsQuery.data!.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-[11px] last:border-b-0">
                        <span
                          className={`shrink-0 rounded px-1 text-center text-[9px] font-bold uppercase ${
                            e.side === "buy" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
                          }`}
                        >
                          {e.side}
                        </span>
                        <span className="truncate text-muted-foreground">{formatUtc(e.executed_at)}</span>
                        <span className="shrink-0 tabular-nums">
                          {e.qty} @ {money(e.price)}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{money(e.commission)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Journal</div>
                  {saveStatus === "saved" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                </div>

                {journalIsLoading ? (
                  <div className="py-3 text-xs text-muted-foreground">Loading journal…</div>
                ) : journalHasError ? (
                  <div className="py-3 text-xs text-muted-foreground">
                    Could not load existing journal entry.{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => {
                        journalQuery.refetch();
                        termsQuery.refetch();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="flex flex-col gap-1 text-[11px]">
                          <span className="text-muted-foreground">
                            Session
                            {computedSessionLabel && <span className="ml-1 normal-case text-muted-foreground/70">(closed during {computedSessionLabel})</span>}
                          </span>
                          <select
                            value={sessionToSelectValue(draftSession)}
                            onChange={(e) => setDraftSession(selectValueToSession(e.target.value))}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                          >
                            <option value="">No session</option>
                            {(Object.keys(SESSION_LABELS) as (keyof typeof SESSION_LABELS)[]).map((s) => (
                              <option key={s} value={s}>
                                {SESSION_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {draftSession && <AnalyzeLink context={journalContext} kind="session" value={draftSession} label="Analyze this Session" />}
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="flex flex-col gap-1 text-[11px]">
                          <span className="text-muted-foreground">Grade</span>
                          <select
                            value={draftGrade ?? ""}
                            onChange={(e) => setDraftGrade(e.target.value === "" ? null : (e.target.value as TradeGrade))}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                          >
                            <option value="">No grade</option>
                            {GRADE_VALUES.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </label>
                        {draftGrade && <AnalyzeLink context={journalContext} kind="grade" value={draftGrade} label="Analyze this Grade" />}
                      </div>
                    </div>
                    <p className="-mt-1 text-[10px] text-muted-foreground/70">Grade reflects execution quality, not outcome — a loss can be A+; a win can be F.</p>

                    <div className="flex flex-col gap-1">
                      <JournalChipField
                        label="Setup"
                        value={draftSetup ? [draftSetup] : []}
                        onChange={(next) => setDraftSetup(next[0] ?? null)}
                        suggestions={suggestionsFor("setup")}
                        multi={false}
                        placeholder="e.g. Order Block"
                        datalistId="journal-setup-suggestions"
                      />
                      {draftSetup && <AnalyzeLink context={journalContext} kind="setup" value={draftSetup} label="Analyze this Setup" />}
                    </div>

                    <div className="flex flex-col gap-1">
                      <JournalChipField
                        label="Strategy"
                        value={draftStrategy ? [draftStrategy] : []}
                        onChange={(next) => setDraftStrategy(next[0] ?? null)}
                        suggestions={suggestionsFor("strategy")}
                        multi={false}
                        placeholder="e.g. Breakout Retest"
                        datalistId="journal-strategy-suggestions"
                      />
                      {draftStrategy && <AnalyzeLink context={journalContext} kind="strategy" value={draftStrategy} label="Analyze this Strategy" />}
                    </div>

                    <div className="flex flex-col gap-1">
                      <JournalChipField
                        label="Emotion"
                        value={draftEmotion ? [draftEmotion] : []}
                        onChange={(next) => setDraftEmotion(next[0] ?? null)}
                        suggestions={suggestionsFor("emotion")}
                        multi={false}
                        placeholder="e.g. Focused"
                        datalistId="journal-emotion-suggestions"
                      />
                      {draftEmotion && <AnalyzeLink context={journalContext} kind="emotion" value={draftEmotion} label="Analyze this Emotion" />}
                    </div>

                    <div className="flex flex-col gap-1">
                      <JournalChipField
                        label="Mistakes"
                        value={draftMistakes}
                        onChange={setDraftMistakes}
                        suggestions={suggestionsFor("mistake")}
                        multi
                        placeholder="Add a mistake…"
                        datalistId="journal-mistake-suggestions"
                      />
                      {draftMistakes.length > 0 && (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {draftMistakes.map((m) => (
                            <AnalyzeLink key={m} context={journalContext} kind="mistake" value={m} label={`Analyze "${m}"`} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <JournalChipField
                        label="Tags"
                        value={draftTags}
                        onChange={setDraftTags}
                        suggestions={suggestionsFor("tag")}
                        multi
                        placeholder="Add a tag…"
                        datalistId="journal-tag-suggestions"
                      />
                      {draftTags.length > 0 && (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {draftTags.map((t) => (
                            <AnalyzeLink key={t} context={journalContext} kind="tag" value={t} label={`Analyze "${t}"`} />
                          ))}
                        </div>
                      )}
                    </div>

                    <label className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted-foreground">Notes</span>
                      <textarea
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        rows={5}
                        placeholder="Setup, execution, what to repeat…"
                        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-brand"
                      />
                    </label>

                    <div className="flex flex-col gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">Screenshots</span>
                      {screenshots.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {screenshots.map((s) => (
                            <div key={s.id} className="group relative">
                              <button type="button" onClick={() => setPreviewUrl(s.signedUrl)} className="block h-14 w-14 overflow-hidden rounded-md border border-border">
                                <img src={s.signedUrl} alt="Trade screenshot" className="h-full w-full object-cover" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteScreenshotMutation.mutate(s.id)}
                                aria-label="Delete screenshot"
                                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadMutation.mutate(file);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploadMutation.isPending}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-brand hover:text-foreground disabled:opacity-50"
                      >
                        {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                        Add Screenshot
                      </button>
                      {screenshotError && <p className="text-[10px] text-destructive">{screenshotError}</p>}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={!isDirty || saveStatus === "saving"}
                        onClick={() => saveMutation.mutate(currentDraft)}
                        className="flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {saveStatus === "saving" ? "Saving…" : "Save Journal"}
                      </button>
                      {savedAt && saveStatus !== "saving" && <span className="text-[10px] text-muted-foreground">Last saved {formatUtc(savedAt)}</span>}
                    </div>

                    {saveStatus === "error" && saveError && <p className="text-[10px] text-destructive">{saveError}</p>}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">AI Trade Review</div>
                  <button
                    type="button"
                    disabled={generateReviewMutation.isPending}
                    onClick={() => generateReviewMutation.mutate()}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-brand hover:text-foreground disabled:opacity-50"
                  >
                    {generateReviewMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Generate AI Review
                  </button>
                </div>

                {reviewError && <p className="mt-2 text-[10px] text-destructive">{reviewError}</p>}

                {latestReviewQuery.isLoading ? (
                  <div className="py-3 text-xs text-muted-foreground">Loading…</div>
                ) : latestReview ? (
                  <div className="mt-2 flex flex-col gap-2 text-[11px]">
                    <ReviewPart label="What You Did Well" text={latestReview.content.didWell} />
                    <ReviewPart label="What Could Improve" text={latestReview.content.couldImprove} />
                    <ReviewPart label="Execution Review" text={latestReview.content.executionReview} />
                    <ReviewPart label="Risk & Discipline" text={latestReview.content.riskDiscipline} />
                    <ReviewPart label="Key Lesson" text={latestReview.content.keyLesson} />
                    <ReviewPart label="Focus For Next Trade" text={latestReview.content.focusNext} />
                    <p className="text-[10px] text-muted-foreground/70">Generated {formatUtc(latestReview.created_at)}</p>
                  </div>
                ) : (
                  !generateReviewMutation.isPending && <p className="py-2 text-xs text-muted-foreground">No AI review yet for this trade.</p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={discardDialogOpen} onOpenChange={(open) => !open && handleKeepEditing()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved journal changes?</AlertDialogTitle>
            <AlertDialogDescription>Your journal notes for this trade haven't been saved yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleKeepEditing}>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardConfirmed}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl border-border bg-card p-2">
          {previewUrl && <img src={previewUrl} alt="Trade screenshot preview" className="max-h-[80vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
});

function ReviewPart({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{label}</div>
      <p className="text-foreground/90">{text}</p>
    </div>
  );
}
