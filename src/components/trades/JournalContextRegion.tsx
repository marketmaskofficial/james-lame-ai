import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { journaledVsNonJournaled, type JournaledTrade } from "@/lib/dashboard/journalAnalytics";
import { JournaledComparisonCard } from "@/components/journal/JournaledComparisonCard";

/**
 * Phase 4G — the one lightweight contextual region below Trade Explorer's
 * table/pagination. Deliberately NOT a second analytics surface: the
 * Journaled/Non-Journaled summary below is computed from `rows` — the SAME
 * page of trades Trade Explorer already fetched via `listClosedTradesPage`
 * — never a new `listJournalAnalyticsTrades` call, never the full-dataset
 * fetch `/journal` itself owns. It exists to fill the natural under-fill
 * left by a small dataset with something real, not to duplicate the
 * dedicated analytics page.
 *
 * Desktop/tablet (`md:` and up): the mini summary card + a "View Full
 * Journal Analytics" CTA side by side. Mobile: ONLY the compact CTA — no
 * card, no preview, nothing else — per the Phase 4G scope decision that
 * split-panel-style density must never reach mobile.
 */

export type JournalContextLink = { accountId: string; symbol?: string; from?: string; to?: string };

function journalAnalyticsSearch(link: JournalContextLink) {
  return {
    accountId: link.accountId,
    symbol: link.symbol || undefined,
    from: link.from || undefined,
    to: link.to || undefined,
  };
}

export function JournalContextRegion({ rows, link }: { rows: JournaledTrade[]; link: JournalContextLink }) {
  const comparison = useMemo(() => journaledVsNonJournaled(rows), [rows]);
  const search = journalAnalyticsSearch(link);

  return (
    <>
      {/* Desktop/tablet: compact page-scoped summary + CTA, side by side. */}
      <div className="hidden gap-3 md:grid md:grid-cols-[2fr_1fr]">
        <JournaledComparisonCard comparison={comparison} title="Journaled vs. Non-Journaled (This Page)" />
        <Link
          to="/journal"
          search={search}
          className="flex flex-col items-center justify-center gap-1 rounded-md border border-border bg-card p-2.5 text-center transition hover:border-brand"
        >
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Deeper analysis</span>
          <span className="text-xs font-medium text-brand">View Full Journal Analytics →</span>
        </Link>
      </div>

      {/* Mobile: only the compact CTA — no card, no preview. */}
      <Link
        to="/journal"
        search={search}
        className="block w-full rounded-md border border-border bg-card py-2 text-center text-xs font-medium text-brand md:hidden"
      >
        View Full Journal Analytics →
      </Link>
    </>
  );
}
