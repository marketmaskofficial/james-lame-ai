import type { JournaledComparison } from "@/lib/dashboard/journalAnalytics";

/**
 * Phase 4F — the Journaled vs. Non-Journaled comparison card. A trade
 * counts as Journaled exactly when it has a real `journal_entries` row
 * linked to its closed position (the Phase 4E-2 relationship) — never
 * inferred from whether any individual field like Setup or Grade happens to
 * be set. The two counts always sum to the base filtered closed-trade
 * total, by construction (see `journaledVsNonJournaled` in
 * `journalAnalytics.ts`).
 */

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const ratio = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const toneClass = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-foreground");

function Row({ label, journaled, nonJournaled }: { label: string; journaled: React.ReactNode; nonJournaled: React.ReactNode }) {
  return (
    <>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="px-2 py-1.5 text-right tabular-nums">{journaled}</div>
      <div className="px-2 py-1.5 text-right tabular-nums">{nonJournaled}</div>
    </>
  );
}

export function JournaledComparisonCard({
  comparison,
  title = "Journaled vs. Non-Journaled",
}: {
  comparison: JournaledComparison;
  /** Phase 4G's Trade Explorer reuse of this card is scoped to the current
   * page's already-loaded rows, not the full filtered dataset `/journal`
   * itself summarizes — the caller overrides this label (e.g. "...(This
   * Page)") so that distinction is never silently lost. */
  title?: string;
}) {
  const { journaled, nonJournaled } = comparison;
  const total = journaled.tradeCount + nonJournaled.tradeCount;

  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {total === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">No closed trades in this filter.</div>
      ) : (
        <div className="mt-1.5 grid grid-cols-[1fr_auto_auto] gap-x-1">
          <div />
          <div className="px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-wide text-brand">Journaled</div>
          <div className="px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Non-Journaled</div>

          <Row label="Trades" journaled={journaled.tradeCount} nonJournaled={nonJournaled.tradeCount} />
          <Row label="Win Rate" journaled={pct(journaled.winRatePct)} nonJournaled={pct(nonJournaled.winRatePct)} />
          <Row
            label="Net P&L"
            journaled={<span className={`font-semibold ${toneClass(journaled.netPnl)}`}>{journaled.tradeCount === 0 ? "—" : money(journaled.netPnl)}</span>}
            nonJournaled={
              <span className={`font-semibold ${toneClass(nonJournaled.netPnl)}`}>{nonJournaled.tradeCount === 0 ? "—" : money(nonJournaled.netPnl)}</span>
            }
          />
          <Row
            label="Avg Trade"
            journaled={journaled.tradeCount === 0 ? "—" : money(journaled.avgNetTrade)}
            nonJournaled={nonJournaled.tradeCount === 0 ? "—" : money(nonJournaled.avgNetTrade)}
          />
          <Row label="Profit Factor" journaled={ratio(journaled.profitFactor)} nonJournaled={ratio(nonJournaled.profitFactor)} />
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-muted-foreground">
        {total.toLocaleString("en-US")} closed trade{total === 1 ? "" : "s"} in this filter — {journaled.tradeCount} journaled, {nonJournaled.tradeCount} not.
      </div>
    </div>
  );
}
