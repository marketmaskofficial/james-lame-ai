import { useState } from "react";
import { CumulativePnlViz, DailyPnlViz, DerivedBalanceViz, DrawdownViz } from "@/components/dashboard/DashboardCharts";
import type { BalancePoint, CumulativePnlPoint, DailyPnlPoint, DrawdownResult } from "@/lib/dashboard/metrics";

/**
 * Phase 4C: one compact chart workspace replacing the four simultaneous
 * chart cards Phase 4A/4B shipped (Cumulative P&L, Daily Net P&L, Derived
 * Trading Balance, Drawdown). All four series are already computed once by
 * `DashboardWorkspace` (`cumulativePnlSeries`/`dailyPnlSeries`/
 * `derivedBalanceSeries`/`computeDrawdown`) and passed straight through as
 * props — switching tabs only changes which already-computed series is
 * rendered, never refetches or recomputes anything. Every visualization's
 * own math and empty/low-history states live in `DashboardCharts.tsx`
 * unchanged; this component only owns the tab chrome and active-tab state.
 */

type TabId = "pnl" | "daily" | "balance" | "drawdown";

const TABS: { id: TabId; label: string }[] = [
  { id: "pnl", label: "P&L" },
  { id: "daily", label: "Daily" },
  { id: "balance", label: "Balance" },
  { id: "drawdown", label: "Drawdown" },
];

export function PerformanceChartTabs({
  cumulative,
  daily,
  balanceSeries,
  drawdown,
}: {
  cumulative: CumulativePnlPoint[];
  daily: DailyPnlPoint[];
  balanceSeries: BalancePoint[];
  drawdown: DrawdownResult;
}) {
  const [tab, setTab] = useState<TabId>("pnl");

  const contextNote =
    tab === "drawdown"
      ? `Current ${drawdown.currentDrawdownPct.toFixed(2)}% · Max ${drawdown.maxDrawdownPct.toFixed(2)}%`
      : tab === "balance"
        ? "Starting balance + cumulative net realized P&L — a derived equity progression, not a full banking ledger."
        : undefined;

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">Performance</span>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition ${
                tab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {contextNote && <div className="truncate text-[10px] text-muted-foreground">{contextNote}</div>}
      </div>
      <div className="mt-2 h-[220px]">
        {tab === "pnl" && <CumulativePnlViz points={cumulative} />}
        {tab === "daily" && <DailyPnlViz points={daily} />}
        {tab === "balance" && <DerivedBalanceViz points={balanceSeries} />}
        {tab === "drawdown" && <DrawdownViz points={drawdown.curve} />}
      </div>
    </div>
  );
}
