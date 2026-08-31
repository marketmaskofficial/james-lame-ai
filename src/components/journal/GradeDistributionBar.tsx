import type { GradePerformance } from "@/lib/dashboard/journalAnalytics";

/**
 * Phase 4F — "does better execution grading actually correlate with better
 * results": a compact 6-bar distribution (A+ through F, always all six —
 * see `byGrade`'s own doc comment), bar height by trade count, bar color by
 * that grade's own net P&L sign. Plain CSS, no chart library — the same
 * technique `PerformanceBreakdowns.tsx`'s `HourBars` already established
 * for exactly this kind of compact categorical bar.
 */

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function GradeDistributionBar({ grades, activeFocusValue, onSelect }: { grades: GradePerformance[]; activeFocusValue?: string | null; onSelect?: (grade: string) => void }) {
  const maxCount = Math.max(1, ...grades.map((g) => g.tradeCount));
  const totalTrades = grades.reduce((s, g) => s + g.tradeCount, 0);

  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Grade Distribution</div>
      {totalTrades === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">No graded trades in this filter yet.</div>
      ) : (
        <>
          <div className="mt-2 flex h-20 items-end gap-1.5">
            {grades.map((g) => {
              const heightPct = g.tradeCount === 0 ? 4 : Math.max(6, (g.tradeCount / maxCount) * 100);
              const toneClass = g.tradeCount === 0 ? "bg-muted/40" : g.netPnl > 0 ? "bg-emerald-500/70" : g.netPnl < 0 ? "bg-red-500/70" : "bg-muted-foreground/40";
              const active = activeFocusValue === g.grade;
              const title = `Grade ${g.grade} — ${g.tradeCount} trade${g.tradeCount === 1 ? "" : "s"}${g.tradeCount > 0 ? `, ${money(g.netPnl)}` : ""}${
                g.isLowSample ? " (low sample)" : ""
              }`;
              // The percentage height below is set directly on this flex
              // ITEM (not a nested child) — a child of a height:auto flex
              // item can't resolve a percentage height against it, which
              // silently collapses to 0. Same rule `HourBars` in
              // `PerformanceBreakdowns.tsx` documents; the clickable
              // variant must therefore be the flex item itself (a `button`
              // in flex-row's cross axis), never a div-in-button wrapper.
              return onSelect ? (
                <button
                  key={g.grade}
                  type="button"
                  title={title}
                  aria-label={title}
                  onClick={() => onSelect(g.grade)}
                  className={`flex-1 rounded-t-sm ${toneClass} ${active ? "ring-2 ring-brand" : ""}`}
                  style={{ height: `${heightPct}%` }}
                />
              ) : (
                <div key={g.grade} title={title} className={`flex-1 rounded-t-sm ${toneClass} ${active ? "ring-2 ring-brand" : ""}`} style={{ height: `${heightPct}%` }} />
              );
            })}
          </div>
          <div className="mt-1 flex gap-1.5 text-[10px] text-muted-foreground">
            {grades.map((g) => (
              <div key={g.grade} className="flex-1 text-center font-medium">
                {g.grade}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
