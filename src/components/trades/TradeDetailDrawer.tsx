import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Check } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { listExecutionsForPosition, getJournalEntryForPosition, saveTradeJournalForPosition } from "@/lib/trades.functions";
import { classifyTrade, netPnlForTrade, SESSION_LABELS, type ClosedTrade } from "@/lib/dashboard/metrics";
import { formatDuration, tradeDurationMs, tradeSession } from "@/lib/dashboard/tradeExplorer";
import {
  isJournalDraftDirty,
  selectValueToSession,
  sessionToSelectValue,
  type JournalDraft,
  type JournalSessionValue,
} from "@/lib/dashboard/journalDraft";

/**
 * Phase 4D — Trade Explorer detail drawer. Opens on top of the table/cards
 * rather than navigating away, per the phase brief. Executions and the
 * journal entry are fetched only when a trade is open (`enabled: !!trade`),
 * never preloaded for every row in the table — both reads are RLS-scoped
 * (`requireSupabaseAuth`/`context.supabase`), same as every other Dashboard
 * read this session has built.
 *
 * Phase 4E-1 adds an editable Notes/Session journal editor in place of the
 * old read-only block. Unsaved-edit protection (closing the drawer or
 * switching to another trade while dirty) is exposed to the parent
 * (`src/routes/trades.tsx`) via `TradeDetailDrawerHandle` — the parent's
 * `selectedTrade` state is the single source of truth and is only ever
 * changed after this component confirms it's safe to do so, so there's
 * never a case where the parent thinks one trade is selected while this
 * drawer is still showing another.
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

const EMPTY_DRAFT: JournalDraft = { notes: "", session: null };

export const TradeDetailDrawer = forwardRef<TradeDetailDrawerHandle, {
  trade: ClosedTrade | null;
  accountLabel: string | null;
  onOpenChange: (open: boolean) => void;
}>(function TradeDetailDrawer({ trade, accountLabel, onOpenChange }, ref) {
  const listExecutionsFn = useServerFn(listExecutionsForPosition);
  const getJournalFn = useServerFn(getJournalEntryForPosition);
  const saveJournalFn = useServerFn(saveTradeJournalForPosition);
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

  const [savedDraft, setSavedDraft] = useState<JournalDraft>(EMPTY_DRAFT);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftSession, setDraftSession] = useState<JournalSessionValue>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  const syncedPositionIdRef = useRef<string | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  // Populate the editor from the loaded journal entry exactly once per
  // position — not on every background refetch of the SAME position,
  // which would otherwise stomp on text the user is actively typing.
  useEffect(() => {
    if (!trade) {
      syncedPositionIdRef.current = null;
      return;
    }
    if (syncedPositionIdRef.current === trade.positionId) return;
    if (journalQuery.isLoading) return;
    syncedPositionIdRef.current = trade.positionId;
    const loaded: JournalDraft = {
      notes: journalQuery.data?.notes ?? "",
      session: (journalQuery.data?.session as JournalSessionValue) ?? null,
    };
    setSavedDraft(loaded);
    setDraftNotes(loaded.notes);
    setDraftSession(loaded.session);
    setSavedAt(journalQuery.data?.updated_at ?? null);
    setSaveStatus("idle");
    setSaveError(null);
  }, [trade, journalQuery.isLoading, journalQuery.data]);

  const isDirty = isJournalDraftDirty(savedDraft, { notes: draftNotes, session: draftSession });

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
    mutationFn: (draft: JournalDraft) =>
      saveJournalFn({
        data: {
          positionId: trade!.positionId,
          accountId: trade!.accountId,
          symbol: trade!.symbol,
          notes: draft.notes,
          session: draft.session,
        },
      }),
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
      savedTimeoutRef.current = setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    },
    onError: (e: unknown) => {
      setSaveStatus("error");
      setSaveError(e instanceof Error ? e.message : "Could not save journal entry.");
    },
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

  // `trade.qty` (trade_positions.qty) is the position's REMAINING open
  // quantity, which the OMS explicitly zeroes out once a position fully
  // closes — always 0 for every real closed trade, confirmed against
  // oms.server.ts, not something this UI can treat as "the trade's size".
  // The real originally-traded quantity only survives in that position's
  // own fills, so it's derived here from the opening-side executions once
  // they've loaded, rather than shown as a static (always-wrong) 0.
  const openingQty = trade ? executionsQuery.data?.filter((e) => e.side === trade.side).reduce((s, e) => s + e.qty, 0) : undefined;
  const quantityValue = executionsQuery.isLoading ? "…" : openingQty && openingQty > 0 ? String(openingQty) : "—";

  const net = trade ? netPnlForTrade(trade) : 0;
  const cls = trade ? classifyTrade(trade) : "breakeven";
  const netToneClass = cls === "win" ? "text-emerald-400" : cls === "loss" ? "text-red-400" : "text-foreground";
  const resultBadgeClass =
    cls === "win" ? "bg-emerald-950/40 text-emerald-300" : cls === "loss" ? "bg-red-950/30 text-red-300" : "bg-muted text-muted-foreground";

  const computedSessionLabel = trade ? SESSION_LABELS[tradeSession(trade)] : null;

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

                {journalQuery.isLoading ? (
                  <div className="py-3 text-xs text-muted-foreground">Loading journal…</div>
                ) : journalQuery.isError ? (
                  <div className="py-3 text-xs text-muted-foreground">
                    Could not load existing journal entry.{" "}
                    <button type="button" className="underline hover:text-foreground" onClick={() => journalQuery.refetch()}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted-foreground">
                        Session
                        {computedSessionLabel && <span className="ml-1 normal-case text-muted-foreground/70">(trade closed during {computedSessionLabel})</span>}
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

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={!isDirty || saveStatus === "saving"}
                        onClick={() => saveMutation.mutate({ notes: draftNotes, session: draftSession })}
                        className="flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {saveStatus === "saving" ? "Saving…" : "Save Journal"}
                      </button>
                      {savedAt && saveStatus !== "saving" && (
                        <span className="text-[10px] text-muted-foreground">Last saved {formatUtc(savedAt)}</span>
                      )}
                    </div>

                    {saveStatus === "error" && saveError && <p className="text-[10px] text-destructive">{saveError}</p>}
                  </div>
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
    </>
  );
});
