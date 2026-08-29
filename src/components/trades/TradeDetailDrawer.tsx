import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listExecutionsForPosition, getJournalEntryForPosition } from "@/lib/trades.functions";
import { classifyTrade, netPnlForTrade, type ClosedTrade } from "@/lib/dashboard/metrics";
import { formatDuration, tradeDurationMs } from "@/lib/dashboard/tradeExplorer";

/**
 * Phase 4D — Trade Explorer detail drawer. Opens on top of the table/cards
 * rather than navigating away, per the phase brief. Executions and the
 * journal entry are fetched only when a trade is open (`enabled: !!trade`),
 * never preloaded for every row in the table — both reads are RLS-scoped
 * (`requireSupabaseAuth`/`context.supabase`), same as every other Dashboard
 * read this session has built.
 */

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

export function TradeDetailDrawer({
  trade,
  accountLabel,
  onOpenChange,
}: {
  trade: ClosedTrade | null;
  accountLabel: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const listExecutionsFn = useServerFn(listExecutionsForPosition);
  const getJournalFn = useServerFn(getJournalEntryForPosition);

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

  return (
    <Sheet open={!!trade} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-border bg-card sm:max-w-md">
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
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Journal</div>
              {journalQuery.isLoading ? (
                <div className="py-3 text-xs text-muted-foreground">Loading…</div>
              ) : journalQuery.isError ? (
                <div className="py-3 text-xs text-muted-foreground">Could not load journal entry.</div>
              ) : !journalQuery.data ? (
                <div className="py-3 text-xs text-muted-foreground">No journal entry for this trade.</div>
              ) : (
                <div className="mt-2 text-xs">
                  {journalQuery.data.session && <DetailRow label="Session" value={journalQuery.data.session} />}
                  {journalQuery.data.timeframe && <DetailRow label="Timeframe" value={journalQuery.data.timeframe} />}
                  {journalQuery.data.notes && <p className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">{journalQuery.data.notes}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
