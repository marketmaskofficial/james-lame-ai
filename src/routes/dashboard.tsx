import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkStudioAccess, isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { AppNavRail } from "@/components/AppNavRail";
import { listTradingAccounts } from "@/lib/trading.functions";
import { listClosedTrades } from "@/lib/dashboard.functions";
import {
  computeDashboardMetrics,
  cumulativePnlSeries,
  dailyPnlSeries,
  derivedBalanceSeries,
  computeDrawdown,
  type ClosedTrade,
} from "@/lib/dashboard/metrics";
import { MetricCard, toneOf } from "@/components/dashboard/MetricCard";
import { CumulativePnlChart, DailyPnlChart, DerivedBalanceChart, DrawdownChart } from "@/components/dashboard/DashboardCharts";
import { TradingCalendar } from "@/components/dashboard/TradingCalendar";
import { PerformanceBreakdowns } from "@/components/dashboard/PerformanceBreakdowns";
import { EnvBadge } from "@/components/studio/AccountBar";

// Phase 4A: Trading Dashboard is gated exactly like Chart Studio — same
// `beforeLoad`/`checkStudioAccess` policy, not a second/independent
// subscription check. `/dashboard` must never be reachable when `/studio`
// isn't. See studio.tsx's own `Route` definition for the full rationale
// (ssr:false + client-only auth check, since the Supabase client has no
// server-side session) — copied here verbatim, not reinvented.
export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  pendingComponent: DashboardLoadingScreen,
  head: () => ({
    meta: [
      { title: "Trading Dashboard — Signal Goat AI" },
      {
        name: "description",
        content: "Real trading performance: net P&L, win rate, profit factor, and equity/drawdown from your own closed trades.",
      },
    ],
  }),
  component: DashboardRoute,
});

function DashboardLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Trading Dashboard…</p>
      </div>
    </div>
  );
}

/** Same two-layer gate shape as Studio's `Studio` component: `beforeLoad`
 * above stops a fresh navigation, this additionally watches auth/
 * subscription state changing while already mounted. */
function DashboardRoute() {
  const navigate = useNavigate();
  const testBypassed = isStudioGateTestBypassed();
  const localPaidBypassed = isStudioGateLocalPaidBypassed();
  const { user, loading: authLoading } = useAuth();
  const { isActive: isPaid, loading: subLoading } = useSubscription();
  const ready = !authLoading && !subLoading;
  const effectivelyPaid = isPaid || localPaidBypassed;
  const authorized = testBypassed || (ready && !!user && effectivelyPaid);

  useEffect(() => {
    if (testBypassed || !ready) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (!effectivelyPaid) {
      navigate({ to: "/pricing", replace: true });
    }
  }, [testBypassed, ready, user, effectivelyPaid, navigate]);

  if (!authorized) return <DashboardLoadingScreen />;
  return <DashboardWorkspace />;
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

function ratio(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}

/** Local "YYYY-MM-DD" (from a native `<input type="date">`) to a UTC day
 * boundary. Phase 4A has no per-account trading timezone (see the audit),
 * so day boundaries are UTC, not the viewer's browser-local timezone —
 * deliberately NOT `new Date("YYYY-MM-DD")` interpreted locally. */
function dayStartUtc(day: string): string {
  return `${day}T00:00:00.000Z`;
}
function dayEndUtc(day: string): string {
  return `${day}T23:59:59.999Z`;
}

function DashboardWorkspace() {
  const listAccountsFn = useServerFn(listTradingAccounts);
  const listClosedTradesFn = useServerFn(listClosedTrades);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [symbol, setSymbol] = useState<string>("");

  const accountsQuery = useQuery({
    queryKey: ["dashboard-accounts"],
    queryFn: () => listAccountsFn(),
  });

  useEffect(() => {
    if (accountId) return;
    const accounts = accountsQuery.data;
    if (accounts && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accountsQuery.data, accountId]);

  const activeAccount = useMemo(
    () => accountsQuery.data?.find((a) => a.id === accountId) ?? null,
    [accountsQuery.data, accountId],
  );

  const tradesQuery = useQuery({
    queryKey: ["dashboard-closed-trades", accountId, fromDate, toDate],
    queryFn: () =>
      listClosedTradesFn({
        data: {
          accountId: accountId as string,
          fromUtc: fromDate ? dayStartUtc(fromDate) : undefined,
          toUtc: toDate ? dayEndUtc(toDate) : undefined,
        },
      }),
    enabled: !!accountId,
  });

  const allTrades: ClosedTrade[] = tradesQuery.data ?? [];
  const symbols = useMemo(() => [...new Set(allTrades.map((t) => t.symbol))].sort(), [allTrades]);
  const trades = useMemo(() => (symbol ? allTrades.filter((t) => t.symbol === symbol) : allTrades), [allTrades, symbol]);

  const metrics = useMemo(() => computeDashboardMetrics(trades), [trades]);
  const cumulative = useMemo(() => cumulativePnlSeries(trades), [trades]);
  const daily = useMemo(() => dailyPnlSeries(trades), [trades]);
  const balanceSeries = useMemo(
    () => (activeAccount ? derivedBalanceSeries(trades, activeAccount.starting_balance) : []),
    [trades, activeAccount],
  );
  const drawdown = useMemo(() => computeDrawdown(balanceSeries), [balanceSeries]);

  // Phase 4B-1: the Trading Calendar deliberately queries its own month
  // window instead of the header's date range (see TradingCalendar.tsx's
  // doc comment) — same canonical `listClosedTrades` call, just with
  // different boundaries, never a second data path.
  const fetchCalendarMonth = useCallback(
    (args: { accountId: string; symbol?: string; fromUtc: string; toUtc: string }) =>
      listClosedTradesFn({ data: args }),
    [listClosedTradesFn],
  );
  // Clicking a trading day sets the SAME header date-range filter a manual
  // "from"/"to" pick would — a drill-down shortcut, not a new filter path.
  const handleSelectCalendarDay = useCallback((dayUtc: string) => {
    setFromDate(dayUtc);
    setToDate(dayUtc);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="studio-scrollbars flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-col gap-3 border-b border-border bg-sidebar px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-sm font-semibold">Trading Dashboard</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <select
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                value={accountId ?? ""}
                onChange={(e) => setAccountId(e.target.value || null)}
              >
                {(accountsQuery.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.environment})
                  </option>
                ))}
              </select>
              {activeAccount && <EnvBadge env={activeAccount.environment} />}
            </div>
            <input
              type="date"
              aria-label="From date"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              aria-label="To date"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
              >
                Clear
              </button>
            )}
            {symbols.length > 0 && (
              <select
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              >
                <option value="">All symbols</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <DashboardBody
            accountsQuery={accountsQuery}
            tradesQuery={tradesQuery}
            accountId={accountId}
            symbol={symbol}
            trades={trades}
            metrics={metrics}
            cumulative={cumulative}
            daily={daily}
            balanceSeries={balanceSeries}
            drawdown={drawdown}
            fetchCalendarMonth={fetchCalendarMonth}
            onSelectCalendarDay={handleSelectCalendarDay}
          />
        </div>
      </div>
    </div>
  );
}

function DashboardBody({
  accountsQuery,
  tradesQuery,
  accountId,
  symbol,
  trades,
  metrics,
  cumulative,
  daily,
  balanceSeries,
  drawdown,
  fetchCalendarMonth,
  onSelectCalendarDay,
}: {
  accountsQuery: { isLoading: boolean; isError: boolean; error: unknown; data: unknown[] | undefined };
  tradesQuery: { isLoading: boolean; isError: boolean; error: unknown };
  accountId: string | null;
  symbol: string;
  trades: ClosedTrade[];
  metrics: ReturnType<typeof computeDashboardMetrics>;
  cumulative: ReturnType<typeof cumulativePnlSeries>;
  daily: ReturnType<typeof dailyPnlSeries>;
  balanceSeries: ReturnType<typeof derivedBalanceSeries>;
  drawdown: ReturnType<typeof computeDrawdown>;
  fetchCalendarMonth: (args: { accountId: string; symbol?: string; fromUtc: string; toUtc: string }) => Promise<ClosedTrade[]>;
  onSelectCalendarDay: (dayUtc: string) => void;
}) {
  if (accountsQuery.isLoading) return <CenteredState icon={<Loader2 className="h-5 w-5 animate-spin" />} text="Loading accounts…" />;
  if (accountsQuery.isError) {
    return (
      <CenteredState
        icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
        text={`Could not load trading accounts: ${errorMessage(accountsQuery.error)}`}
      />
    );
  }
  if (!accountsQuery.data || accountsQuery.data.length === 0 || !accountId) {
    return <CenteredState icon={<AlertTriangle className="h-5 w-5 text-muted-foreground" />} text="No trading account found." />;
  }
  if (tradesQuery.isLoading) return <CenteredState icon={<Loader2 className="h-5 w-5 animate-spin" />} text="Loading trades…" />;
  if (tradesQuery.isError) {
    return (
      <CenteredState
        icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
        text={`Could not load closed trades: ${errorMessage(tradesQuery.error)}`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {trades.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No closed trades in this period.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <MetricCard label="Net P&L" value={money(metrics.netPnl)} tone={toneOf(metrics.netPnl)} />
            <MetricCard label="Trade Win %" value={pct(metrics.winRatePct)} tone={toneOf(metrics.winRatePct == null ? null : metrics.winRatePct - 50)} />
            <MetricCard label="Profit Factor" value={ratio(metrics.profitFactor)} tone={toneOf(metrics.profitFactor == null ? null : metrics.profitFactor - 1)} />
            <MetricCard label="Day Win %" value={pct(metrics.dayWinRatePct)} tone={toneOf(metrics.dayWinRatePct == null ? null : metrics.dayWinRatePct - 50)} />
            <MetricCard label="Avg Winning Trade" value={metrics.avgWinningTrade == null ? "—" : money(metrics.avgWinningTrade)} tone="positive" />
            <MetricCard label="Avg Losing Trade" value={metrics.avgLosingTrade == null ? "—" : money(metrics.avgLosingTrade)} tone="negative" />
            <MetricCard label="Avg Win/Loss Ratio" value={ratio(metrics.avgWinLossRatio)} tone={toneOf(metrics.avgWinLossRatio == null ? null : metrics.avgWinLossRatio - 1)} />
            <MetricCard label="Total Trades" value={String(metrics.totalTrades)} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CumulativePnlChart points={cumulative} />
            <DailyPnlChart points={daily} />
            <DerivedBalanceChart points={balanceSeries} />
            <DrawdownChart points={drawdown.curve} maxDrawdownPct={drawdown.maxDrawdownPct} currentDrawdownPct={drawdown.currentDrawdownPct} />
          </div>
        </>
      )}

      {/* Phase 4B-1: the calendar intentionally has its own month window
          (see TradingCalendar.tsx) so it still renders here even when the
          header's date-range filter above has zero trades in range. */}
      <TradingCalendar accountId={accountId} symbol={symbol} fetchMonth={fetchCalendarMonth} onSelectDay={onSelectCalendarDay} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <PerformanceBreakdowns trades={trades} />
      </div>
    </div>
  );
}

function CenteredState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      {icon}
      <p>{text}</p>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}
