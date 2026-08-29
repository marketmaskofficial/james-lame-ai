import { useMemo } from "react";
import {
  bySymbol,
  byDirection,
  byDayOfWeek,
  byHourOfDay,
  bySession,
  type ClosedTrade,
  type GroupSummary,
  type HourOfDayPerformance,
} from "@/lib/dashboard/metrics";

/**
 * Phase 4B-1 performance breakdowns — Symbol, Long vs Short, Day of Week,
 * Hour of Day, and the approximate Trading Session split. All five reuse the
 * same `StatRow`/`SectionCard` pair rather than five bespoke layouts, and
 * all five read the exact same `GroupSummary` shape the pure grouping
 * functions in `src/lib/dashboard/metrics.ts` already produce — nothing
 * here computes P&L or win rate itself.
 */

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function SectionCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {note && <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{note}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function EmptyNote() {
  return <div className="py-3 text-center text-xs text-muted-foreground">No closed trades in this period.</div>;
}

function StatRow({ label, group }: { label: string; group: GroupSummary }) {
  const toneClass =
    group.tradeCount === 0
      ? "text-muted-foreground"
      : group.netPnl > 0
        ? "text-emerald-400"
        : group.netPnl < 0
          ? "text-red-400"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1 text-xs last:border-b-0">
      <span className="min-w-0 truncate font-medium">{label}</span>
      <div className="flex shrink-0 items-center gap-2.5 tabular-nums sm:gap-3">
        {group.isLowSample && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Low sample</span>
        )}
        <span className="w-14 text-right text-muted-foreground">{group.tradeCount === 0 ? "—" : `${group.tradeCount} trd`}</span>
        <span className="w-10 text-right text-muted-foreground">{group.winRatePct == null ? "—" : `${group.winRatePct.toFixed(0)}%`}</span>
        <span className={`w-16 text-right font-semibold ${toneClass}`}>{group.tradeCount === 0 ? "—" : money(group.netPnl)}</span>
      </div>
    </div>
  );
}

function HourBars({ hours }: { hours: HourOfDayPerformance[] }) {
  const maxAbs = Math.max(1, ...hours.map((h) => Math.abs(h.netPnl)));
  return (
    <div>
      <div className="flex h-14 items-end gap-0.5">
        {hours.map((h) => {
          const heightPct = h.tradeCount === 0 ? 4 : Math.max(6, (Math.abs(h.netPnl) / maxAbs) * 100);
          const toneClass =
            h.tradeCount === 0
              ? "bg-muted/40"
              : h.netPnl > 0
                ? "bg-emerald-500/70"
                : h.netPnl < 0
                  ? "bg-red-500/70"
                  : "bg-muted-foreground/40";
          const title = `${String(h.hourUtc).padStart(2, "0")}:00 UTC — ${h.tradeCount} trade${h.tradeCount === 1 ? "" : "s"}${
            h.tradeCount > 0 ? `, ${money(h.netPnl)}` : ""
          }${h.isLowSample ? " (low sample)" : ""}`;
          // The percentage height is set directly on this flex item (not a
          // nested child) — a child of a height:auto flex item can't resolve
          // a percentage height against it, which silently collapses to 0.
          return <div key={h.hourUtc} title={title} className={`flex-1 rounded-t-sm ${toneClass}`} style={{ height: `${heightPct}%` }} />;
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[8px] text-muted-foreground">
        {hours.map((h) => (
          <div key={h.hourUtc} className="flex-1 text-center">
            {h.hourUtc % 4 === 0 ? String(h.hourUtc).padStart(2, "0") : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PerformanceBreakdowns({ trades }: { trades: ClosedTrade[] }) {
  const symbols = useMemo(() => bySymbol(trades), [trades]);
  const directions = useMemo(() => byDirection(trades), [trades]);
  const days = useMemo(() => byDayOfWeek(trades), [trades]);
  const hours = useMemo(() => byHourOfDay(trades), [trades]);
  const sessions = useMemo(() => bySession(trades), [trades]);

  // Ordered (and the parent grid kept to a max of 2 columns, see
  // dashboard.tsx) so no section is ever left alone in a row with empty
  // cells beside it: Symbol+Direction pair, Day of Week+Session pair, then
  // Hour of Day spans the full width last.
  return (
    <>
      <SectionCard title="Performance by Symbol">
        {symbols.length === 0 ? <EmptyNote /> : symbols.map((s) => <StatRow key={s.symbol} label={s.symbol} group={s} />)}
      </SectionCard>

      <SectionCard title="Long vs Short">
        {directions.map((d) => (
          <StatRow key={d.direction} label={d.direction === "long" ? "Long" : "Short"} group={d} />
        ))}
      </SectionCard>

      <SectionCard title="Day of Week (UTC)">
        {days.map((d) => (
          <StatRow key={d.dayOfWeek} label={d.label} group={d} />
        ))}
      </SectionCard>

      <SectionCard
        title="Approximate Trading Session"
        note="Approximate sessions based on fixed UTC windows. DST and market-specific hours may shift actual session boundaries."
      >
        {sessions.map((s) => (
          <StatRow key={s.session} label={s.label} group={s} />
        ))}
      </SectionCard>

      <div className="md:col-span-2">
        <SectionCard title="Hour of Day (UTC)">
          <HourBars hours={hours} />
        </SectionCard>
      </div>
    </>
  );
}
