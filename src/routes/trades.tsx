import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkStudioAccess, isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { AppNavRail } from "@/components/AppNavRail";
import { MetricCard, toneOf } from "@/components/dashboard/MetricCard";
import { listDashboardAccounts } from "@/lib/dashboard.functions";
import { listClosedTradesPage, MAX_FETCH_ROWS } from "@/lib/trades.functions";
import { classifyTrade, netPnlForTrade, SESSION_LABELS, type ClosedTrade, type TradeClassification } from "@/lib/dashboard/metrics";
import { summarizeTrades, tradeDurationMs, formatDuration, type Direction, type Outcome, type SessionFilter, type SortDir, type SortKey } from "@/lib/dashboard/tradeExplorer";
import { EnvBadge } from "@/components/studio/AccountBar";
import { TradeDetailDrawer, type TradeDetailDrawerHandle } from "@/components/trades/TradeDetailDrawer";

/**
 * Phase 4D — Trade Explorer (`/trades`). Gated exactly like Studio/
 * Dashboard: same `beforeLoad`/`checkStudioAccess` policy, not a third
 * independent subscription check — copied verbatim from `dashboard.tsx`'s
 * own `Route`/`DashboardRoute`, which itself copied it from `studio.tsx`
 * for the same documented reason (client-only auth check; no server-side
 * Supabase session to check during SSR, hence `ssr: false`).
 */

type TradesSearch = {
  accountId?: string;
  symbol?: string;
  from?: string;
  to?: string;
  direction?: Direction;
  outcome?: Outcome;
  session?: SessionFilter;
  sortKey?: SortKey;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
};

const VALID_DIRECTIONS = new Set(["all", "long", "short"]);
const VALID_OUTCOMES = new Set(["all", "win", "loss", "breakeven"]);
const VALID_SESSIONS = new Set(["all", "asia", "london", "overlap", "newYork", "offHours"]);
const VALID_SORT_KEYS = new Set(["closedAt", "symbol", "netPnl", "duration"]);
const VALID_PAGE_SIZES = new Set([25, 50, 100]);

export const Route = createFileRoute("/trades")({
  ssr: false,
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  // Filter/sort/page state lives in the URL so refresh and back/forward
  // navigation don't wipe the user's current view — TanStack Router's own
  // documented mechanism for this, matching the plain-function
  // (non-zod-schema) `validateSearch` convention already used by
  // src/routes/auth.tsx and src/routes/checkout.return.tsx.
  validateSearch: (search: Record<string, unknown>): TradesSearch => ({
    accountId: typeof search.accountId === "string" ? search.accountId : undefined,
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    direction: VALID_DIRECTIONS.has(search.direction as string) ? (search.direction as Direction) : undefined,
    outcome: VALID_OUTCOMES.has(search.outcome as string) ? (search.outcome as Outcome) : undefined,
    session: VALID_SESSIONS.has(search.session as string) ? (search.session as SessionFilter) : undefined,
    sortKey: VALID_SORT_KEYS.has(search.sortKey as string) ? (search.sortKey as SortKey) : undefined,
    sortDir: search.sortDir === "asc" || search.sortDir === "desc" ? search.sortDir : undefined,
    page: typeof search.page === "number" && search.page >= 1 ? Math.floor(search.page) : undefined,
    pageSize: VALID_PAGE_SIZES.has(Number(search.pageSize)) ? Number(search.pageSize) : undefined,
  }),
  pendingComponent: TradesLoadingScreen,
  head: () => ({
    meta: [
      { title: "Trade Explorer — Signal Goat AI" },
      { name: "description", content: "Review, filter, and inspect your real closed trades." },
    ],
  }),
  component: TradesRoute,
});

function TradesLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Trade Explorer…</p>
      </div>
    </div>
  );
}

/** Same two-layer gate shape as Studio's/Dashboard's own top-level route
 * component: `beforeLoad` stops a fresh navigation, this additionally
 * watches auth/subscription state changing while already mounted. */
function TradesRoute() {
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

  if (!authorized) return <TradesLoadingScreen />;
  return <TradesWorkspace />;
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function dayStartUtc(day: string): string {
  return `${day}T00:00:00.000Z`;
}
function dayEndUtc(day: string): string {
  return `${day}T23:59:59.999Z`;
}
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatClosedUtc(iso: string): string {
  const d = new Date(iso);
  const month = MONTH_ABBR[d.getUTCMonth()];
  const day = d.getUTCDate();
  let hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm}`;
}
function resultLabel(cls: TradeClassification): string {
  return cls === "win" ? "Win" : cls === "loss" ? "Loss" : "BE";
}
function toneClassFor(cls: TradeClassification): string {
  return cls === "win" ? "text-emerald-400" : cls === "loss" ? "text-red-400" : "text-foreground";
}

/** Explicit accessible name for a mobile trade card — the desktop table's
 * `<tr>` rows carry the same information as visible cell text, but a
 * mobile card's content is only readable via its layout, not exposed as a
 * single accessible name by default. Built from the trade's own real
 * values, not a generic "Open trade details". */
function mobileTradeCardLabel(t: ClosedTrade): string {
  const net = netPnlForTrade(t);
  const direction = t.side === "buy" ? "Long" : "Short";
  const sign = net >= 0 ? "+" : "-";
  return `Open ${t.symbol} ${direction} trade closed ${formatClosedUtc(t.closedAt)}, net P&L ${sign}${money(Math.abs(net))}`;
}

/**
 * AUDIT FINDING (Phase 4D, confirmed against real hosted data, not guessed):
 * `ClosedTrade.qty` — `trade_positions.qty` — is the position's REMAINING
 * open quantity, which `oms.server.ts` explicitly zeroes out the moment a
 * position fully closes (`applyFill`, the `qty: 0` update alongside
 * `status: 'closed'`). Every real closed trade therefore reports `qty: 0`
 * here — not a placeholder, an actually-zero real value that would be
 * actively misleading if displayed as "the trade's quantity". There is no
 * table/view column that preserves the originally-traded size once a
 * position closes; the real number only exists in the sum of that
 * position's own `trade_executions` fills. This table intentionally has NO
 * Qty column as a result. The detail drawer instead derives a real
 * quantity from the fetched executions (see `TradeDetailDrawer.tsx`) rather
 * than showing this always-zero field.
 */

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function TradesWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const accountId = search.accountId ?? null;
  const symbol = search.symbol ?? "";
  const from = search.from ?? "";
  const to = search.to ?? "";
  const direction = search.direction ?? "all";
  const outcome = search.outcome ?? "all";
  const session = search.session ?? "all";
  const sortKey = search.sortKey ?? "closedAt";
  const sortDir = search.sortDir ?? "desc";
  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? 25;

  const [symbolInput, setSymbolInput] = useState(symbol);
  useEffect(() => setSymbolInput(symbol), [symbol]);

  const [selectedTrade, setSelectedTrade] = useState<ClosedTrade | null>(null);
  const drawerRef = useRef<TradeDetailDrawerHandle>(null);

  /** The single gate every row/card click goes through — the drawer itself
   * decides whether it's safe to switch (no unsaved journal edits) or
   * whether to show the discard-confirmation dialog first. `selectedTrade`
   * only ever changes once the drawer has said it's safe to, so the parent
   * and the drawer can never disagree about which trade is showing. */
  function handleSelectTrade(next: ClosedTrade) {
    if (drawerRef.current) drawerRef.current.confirmDiscardThen(() => setSelectedTrade(next));
    else setSelectedTrade(next);
  }

  const listAccountsFn = useServerFn(listDashboardAccounts);
  const listTradesPageFn = useServerFn(listClosedTradesPage);

  const accountsQuery = useQuery({ queryKey: ["trades-accounts"], queryFn: () => listAccountsFn() });

  useEffect(() => {
    if (accountId) return;
    const accounts = accountsQuery.data;
    if (accounts && accounts.length > 0) {
      navigate({ search: (prev) => ({ ...prev, accountId: accounts[0].id }), replace: true });
    }
  }, [accountsQuery.data, accountId, navigate]);

  const activeAccount = useMemo(() => accountsQuery.data?.find((a) => a.id === accountId) ?? null, [accountsQuery.data, accountId]);

  function updateSearch(patch: Partial<TradesSearch>, resetPage = true) {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: resetPage ? 1 : (patch.page ?? prev.page) }), replace: true });
  }

  /** Shared by both the symbol input's form-submit (Enter) and its onBlur —
   * guarded so a value that hasn't actually changed never triggers a
   * second, redundant navigation/refetch regardless of which event (or
   * both, in sequence) fires. */
  function applySymbolFilter() {
    if (symbolInput !== symbol) updateSearch({ symbol: symbolInput || undefined });
  }

  const hasActiveFilters = Boolean(symbol || from || to || direction !== "all" || outcome !== "all" || session !== "all");

  function clearFilters() {
    navigate({
      search: (prev) => ({ accountId: prev.accountId }),
      replace: true,
    });
  }

  const tradesQuery = useQuery({
    queryKey: ["trades-page", accountId, symbol, from, to, direction, outcome, session, sortKey, sortDir, page, pageSize],
    queryFn: () =>
      listTradesPageFn({
        data: {
          accountId: accountId as string,
          symbol: symbol || undefined,
          fromUtc: from ? dayStartUtc(from) : undefined,
          toUtc: to ? dayEndUtc(to) : undefined,
          direction,
          outcome,
          session,
          sortKey,
          sortDir,
          page,
          pageSize,
        },
      }),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });

  const rows = tradesQuery.data?.rows ?? [];
  const summary = useMemo(() => summarizeTrades(rows), [rows]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      updateSearch({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      updateSearch({ sortKey: key, sortDir: "desc" });
    }
  }

  const isRefetching = tradesQuery.isFetching && !tradesQuery.isLoading;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="studio-scrollbars flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-col gap-3 border-b border-border bg-sidebar px-4 py-3">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-sm font-semibold">Trade Explorer</h1>
              <p className="text-[11px] text-muted-foreground">Review, filter, and inspect closed trades</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <select
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                value={accountId ?? ""}
                onChange={(e) => updateSearch({ accountId: e.target.value || undefined })}
              >
                {(accountsQuery.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.environment})
                  </option>
                ))}
              </select>
              {activeAccount && <EnvBadge env={activeAccount.environment} />}
            </div>

            {/* A real <form onSubmit> is the standard, reliable way to
                capture "Enter pressed in this text field" — a raw
                onKeyDown check for e.key === "Enter" was observed to be
                inconsistent during QA. `applySymbolFilter` is shared with
                onBlur and guards on "did the value actually change" so
                Enter-then-blur (or blur-then-Enter) can never fire two
                navigations for the same value. `contents` keeps the form
                itself out of the surrounding flex layout. */}
            <form onSubmit={(e) => { e.preventDefault(); applySymbolFilter(); }} className="contents">
              <input
                type="text"
                aria-label="Symbol"
                placeholder="Exact symbol"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                onBlur={applySymbolFilter}
                className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </form>

            <input
              type="date"
              aria-label="From date"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={from}
              max={to || undefined}
              onChange={(e) => updateSearch({ from: e.target.value || undefined })}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              aria-label="To date"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={to}
              min={from || undefined}
              onChange={(e) => updateSearch({ to: e.target.value || undefined })}
            />

            <select
              aria-label="Direction"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={direction}
              onChange={(e) => updateSearch({ direction: e.target.value as Direction })}
            >
              <option value="all">All directions</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>

            <select
              aria-label="Outcome"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={outcome}
              onChange={(e) => updateSearch({ outcome: e.target.value as Outcome })}
            >
              <option value="all">All outcomes</option>
              <option value="win">Winners</option>
              <option value="loss">Losers</option>
              <option value="breakeven">Breakeven</option>
            </select>

            <select
              aria-label="Session"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={session}
              onChange={(e) => updateSearch({ session: e.target.value as SessionFilter })}
            >
              <option value="all">All sessions</option>
              {(Object.keys(SESSION_LABELS) as (keyof typeof SESSION_LABELS)[]).map((s) => (
                <option key={s} value={s}>
                  {SESSION_LABELS[s]}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button type="button" className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TradesBody
            accountsQuery={accountsQuery}
            tradesQuery={tradesQuery}
            accountId={accountId}
            rows={rows}
            summary={summary}
            hasActiveFilters={hasActiveFilters}
            clearFilters={clearFilters}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSelectTrade={handleSelectTrade}
            isRefetching={isRefetching}
            pagination={tradesQuery.data}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => updateSearch({ page: p }, false)}
            onPageSizeChange={(ps) => updateSearch({ pageSize: ps })}
          />
        </div>
      </div>

      <TradeDetailDrawer
        ref={drawerRef}
        trade={selectedTrade}
        accountLabel={activeAccount?.label ?? null}
        onOpenChange={(open) => !open && setSelectedTrade(null)}
      />
    </div>
  );
}

function TradesBody({
  accountsQuery,
  tradesQuery,
  accountId,
  rows,
  summary,
  hasActiveFilters,
  clearFilters,
  sortKey,
  sortDir,
  onSort,
  onSelectTrade,
  isRefetching,
  pagination,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  accountsQuery: { isLoading: boolean; isError: boolean; error: unknown; data: unknown[] | undefined };
  tradesQuery: { isLoading: boolean; isError: boolean; error: unknown };
  accountId: string | null;
  rows: ClosedTrade[];
  summary: ReturnType<typeof summarizeTrades>;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onSelectTrade: (t: ClosedTrade) => void;
  isRefetching: boolean;
  pagination: { totalCount: number; totalPages: number; truncated: boolean } | undefined;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Net P&L" value={money(summary.netPnl)} tone={toneOf(summary.netPnl)} />
        <MetricCard label="Total Trades" value={String(summary.totalTrades)} />
        <MetricCard label="Wins" value={String(summary.wins)} tone="positive" />
        <MetricCard label="Losses" value={String(summary.losses)} tone="negative" />
        <MetricCard label="Win Rate" value={pct(summary.winRatePct)} />
        <MetricCard
          label="Avg Trade"
          value={summary.avgTrade == null ? "—" : money(summary.avgTrade)}
          sub={summary.breakevens > 0 ? `${summary.breakevens} breakeven` : undefined}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card px-3 py-10 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-5 w-5" />
          {hasActiveFilters ? (
            <>
              <p>No trades match these filters.</p>
              <button type="button" onClick={clearFilters} className="text-xs font-medium text-brand hover:underline">
                Clear filters
              </button>
            </>
          ) : (
            <p>No closed trades yet.</p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop/tablet table */}
          <div className={`hidden overflow-x-auto rounded-md border border-border bg-card transition-opacity md:block ${isRefetching ? "opacity-60" : ""}`}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Th onClick={() => onSort("closedAt")} active={sortKey === "closedAt"} dir={sortDir}>
                    Closed
                  </Th>
                  <Th onClick={() => onSort("symbol")} active={sortKey === "symbol"} dir={sortDir}>
                    Symbol
                  </Th>
                  <th className="px-2 py-2 text-left font-medium">Side</th>
                  <th className="px-2 py-2 text-right font-medium">Entry</th>
                  <th className="px-2 py-2 text-right font-medium">Exit</th>
                  <th className="hidden px-2 py-2 text-right font-medium xl:table-cell">Gross P&L</th>
                  <th className="hidden px-2 py-2 text-right font-medium xl:table-cell">Fees</th>
                  <Th onClick={() => onSort("netPnl")} active={sortKey === "netPnl"} dir={sortDir} align="right">
                    Net P&L
                  </Th>
                  <Th onClick={() => onSort("duration")} active={sortKey === "duration"} dir={sortDir} align="right" className="hidden lg:table-cell">
                    Duration
                  </Th>
                  <th className="px-2 py-2 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const net = netPnlForTrade(t);
                  const cls = classifyTrade(t);
                  return (
                    <tr
                      key={t.positionId}
                      onClick={() => onSelectTrade(t)}
                      className="cursor-pointer border-b border-border/50 last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{formatClosedUtc(t.closedAt)}</td>
                      <td className="px-2 py-1.5 font-medium">{t.symbol}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                            t.side === "buy" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
                          }`}
                        >
                          {t.side === "buy" ? "Long" : "Short"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(t.avgEntry)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.exitPrice == null ? "—" : money(t.exitPrice)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{money(t.realizedPnl)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{money(t.commission)}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${toneClassFor(cls)}`}>
                        {net >= 0 ? "+" : "-"}
                        {money(Math.abs(net))}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground lg:table-cell">{formatDuration(tradeDurationMs(t))}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold ${toneClassFor(cls)}`}>{resultLabel(cls)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className={`flex flex-col gap-2 md:hidden ${isRefetching ? "opacity-60" : ""}`}>
            {rows.map((t) => {
              const net = netPnlForTrade(t);
              const cls = classifyTrade(t);
              return (
                <button
                  key={t.positionId}
                  type="button"
                  onClick={() => onSelectTrade(t)}
                  aria-label={mobileTradeCardLabel(t)}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left text-xs"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                          t.side === "buy" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
                        }`}
                      >
                        {t.side === "buy" ? "Long" : "Short"}
                      </span>
                      <span className="truncate font-medium">{t.symbol}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{formatClosedUtc(t.closedAt)}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`font-semibold tabular-nums ${toneClassFor(cls)}`}>
                      {net >= 0 ? "+" : "-"}
                      {money(Math.abs(net))}
                    </span>
                    <span className={`text-[10px] font-semibold ${toneClassFor(cls)}`}>{resultLabel(cls)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {pagination?.truncated && (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
              Showing results from the first {MAX_FETCH_ROWS.toLocaleString("en-US")} matching trades. Narrow your filters for complete results.
            </div>
          )}

          {pagination && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, pagination.totalCount)} of{" "}
                {pagination.truncated ? `at least ${pagination.totalCount}` : pagination.totalCount}
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Page size"
                  className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px]"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </button>
                <span>
                  Page {pagination.totalPages === 0 ? 1 : page} of {Math.max(1, pagination.totalPages)}
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => onPageChange(page + 1)}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {children}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
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
