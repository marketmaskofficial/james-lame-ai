import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkStudioAccess, isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { AppNavRail } from "@/components/AppNavRail";
import { listDashboardAccounts } from "@/lib/dashboard.functions";
import { listJournalAnalyticsTrades, ANALYTICS_TRADE_HARD_CEILING } from "@/lib/journalAnalytics.functions";
import {
  applyJournalFocusFilter,
  journaledVsNonJournaled,
  bySetup,
  byStrategy,
  byGrade,
  byEmotion,
  byMistake,
  byTag,
  byJournalSession,
  byGradeAndSetup,
  byEmotionAndOutcome,
  byMistakeAndSetup,
  type JournalAnalyticsTrade,
  type JournalFocusFilter,
  type JournalFocusKind,
} from "@/lib/dashboard/journalAnalytics";
import { EnvBadge } from "@/components/studio/AccountBar";
import { JournalPerformanceTable } from "@/components/journal/JournalPerformanceTable";
import { JournaledComparisonCard } from "@/components/journal/JournaledComparisonCard";
import { GradeDistributionBar } from "@/components/journal/GradeDistributionBar";

/**
 * Phase 4F — Journal Analytics (`/journal`). Gated exactly like Studio/
 * Dashboard/Trade Explorer: same `beforeLoad`/`checkStudioAccess` policy —
 * copied verbatim from `trades.tsx`'s own `Route`, which itself copied it
 * from `dashboard.tsx` for the same documented reason (client-only auth
 * check; no server-side Supabase session during SSR, hence `ssr: false`).
 *
 * This is a DEDICATED page, deliberately not a Dashboard tab or a Trade
 * Explorer addendum (see the Phase 4F audit's routing recommendation) — it
 * reuses the Dashboard/Trade Explorer's own filter/data primitives
 * (`listDashboardAccounts`, the URL-search-param filter convention) without
 * duplicating either page's own layout.
 */

const VALID_FOCUS_KINDS = new Set(["setup", "strategy", "grade", "emotion", "mistake", "tag", "session"]);

type JournalSearch = {
  accountId?: string;
  symbol?: string;
  from?: string;
  to?: string;
  focusKind?: JournalFocusKind;
  focusValue?: string;
};

export const Route = createFileRoute("/journal")({
  ssr: false,
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  validateSearch: (search: Record<string, unknown>): JournalSearch => ({
    accountId: typeof search.accountId === "string" ? search.accountId : undefined,
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    focusKind: VALID_FOCUS_KINDS.has(search.focusKind as string) ? (search.focusKind as JournalFocusKind) : undefined,
    focusValue: typeof search.focusValue === "string" && search.focusValue ? search.focusValue : undefined,
  }),
  pendingComponent: JournalLoadingScreen,
  head: () => ({
    meta: [
      { title: "Journal Analytics — Signal Goat AI" },
      { name: "description", content: "Performance by Setup, Strategy, Grade, Emotion, Mistake, Tag, and Session — built from your real closed trades and journal entries." },
    ],
  }),
  component: JournalRoute,
});

function JournalLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Journal Analytics…</p>
      </div>
    </div>
  );
}

function JournalRoute() {
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

  if (!authorized) return <JournalLoadingScreen />;
  return <JournalWorkspace />;
}

function dayStartUtc(day: string): string {
  return `${day}T00:00:00.000Z`;
}
function dayEndUtc(day: string): string {
  return `${day}T23:59:59.999Z`;
}

const FOCUS_KIND_LABELS: Record<JournalFocusKind, string> = {
  setup: "Setup",
  strategy: "Strategy",
  grade: "Grade",
  emotion: "Emotion",
  mistake: "Mistake",
  tag: "Tag",
  session: "Session",
};

function JournalWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const accountId = search.accountId ?? null;
  const symbol = search.symbol ?? "";
  const from = search.from ?? "";
  const to = search.to ?? "";
  const focus: JournalFocusFilter = search.focusKind && search.focusValue ? { kind: search.focusKind, value: search.focusValue } : null;

  const [symbolInput, setSymbolInput] = useState(symbol);
  useEffect(() => setSymbolInput(symbol), [symbol]);

  const listAccountsFn = useServerFn(listDashboardAccounts);
  const listAnalyticsFn = useServerFn(listJournalAnalyticsTrades);

  const accountsQuery = useQuery({ queryKey: ["journal-accounts"], queryFn: () => listAccountsFn() });

  useEffect(() => {
    if (accountId) return;
    const accounts = accountsQuery.data;
    if (accounts && accounts.length > 0) {
      navigate({ search: (prev) => ({ ...prev, accountId: accounts[0].id }), replace: true });
    }
  }, [accountsQuery.data, accountId, navigate]);

  const activeAccount = useMemo(() => accountsQuery.data?.find((a) => a.id === accountId) ?? null, [accountsQuery.data, accountId]);

  function updateSearch(patch: Partial<JournalSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  }

  const hasActiveFilters = Boolean(symbol || from || to);

  function clearFilters() {
    navigate({ search: (prev) => ({ accountId: prev.accountId, focusKind: prev.focusKind, focusValue: prev.focusValue }), replace: true });
  }

  function setFocus(kind: JournalFocusKind, value: string) {
    updateSearch({ focusKind: kind, focusValue: value });
  }
  function clearFocus() {
    updateSearch({ focusKind: undefined, focusValue: undefined });
  }

  const analyticsQuery = useQuery({
    queryKey: ["journal-analytics", accountId, symbol, from, to],
    queryFn: () =>
      listAnalyticsFn({
        data: {
          accountId: accountId as string,
          symbol: symbol || undefined,
          fromUtc: from ? dayStartUtc(from) : undefined,
          toUtc: to ? dayEndUtc(to) : undefined,
        },
      }),
    enabled: !!accountId,
  });

  const allTrades: JournalAnalyticsTrade[] = analyticsQuery.data?.trades ?? [];
  // The at-most-one metadata drill-down narrows the SAME already-fetched
  // dataset client-side — no second network round trip, same "drill-down
  // narrows the shared dataset" idiom the Dashboard's Trading Calendar
  // day-click already established.
  const trades = useMemo(() => applyJournalFocusFilter(allTrades, focus), [allTrades, focus]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="studio-scrollbars flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-col gap-3 border-b border-border bg-sidebar px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold">Journal Analytics</h1>
            <p className="text-[11px] text-muted-foreground">Performance by Setup, Strategy, Grade, Emotion, Mistake, Tag, and Session</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Account"
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

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (symbolInput !== symbol) updateSearch({ symbol: symbolInput || undefined });
              }}
              className="contents"
            >
              <input
                type="text"
                aria-label="Symbol"
                placeholder="Exact symbol"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                onBlur={() => {
                  if (symbolInput !== symbol) updateSearch({ symbol: symbolInput || undefined });
                }}
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

            {hasActiveFilters && (
              <button type="button" className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          {focus && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Focused on:</span>
              <button
                type="button"
                onClick={clearFocus}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20"
              >
                {FOCUS_KIND_LABELS[focus.kind]}: {focus.value}
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <JournalBody accountsQuery={accountsQuery} analyticsQuery={analyticsQuery} accountId={accountId} trades={trades} focus={focus} onSetFocus={setFocus} />
        </div>
      </div>
    </div>
  );
}

function JournalBody({
  accountsQuery,
  analyticsQuery,
  accountId,
  trades,
  focus,
  onSetFocus,
}: {
  accountsQuery: { isLoading: boolean; isError: boolean; error: unknown; data: unknown[] | undefined };
  analyticsQuery: { isLoading: boolean; isError: boolean; error: unknown; data: { truncated: boolean } | undefined };
  accountId: string | null;
  trades: JournalAnalyticsTrade[];
  focus: JournalFocusFilter;
  onSetFocus: (kind: JournalFocusKind, value: string) => void;
}) {
  if (accountsQuery.isLoading) return <CenteredState icon={<Loader2 className="h-5 w-5 animate-spin" />} text="Loading accounts…" />;
  if (accountsQuery.isError) {
    return <CenteredState icon={<AlertTriangle className="h-5 w-5 text-red-400" />} text={`Could not load trading accounts: ${errorMessage(accountsQuery.error)}`} />;
  }
  if (!accountsQuery.data || accountsQuery.data.length === 0 || !accountId) {
    return <CenteredState icon={<AlertTriangle className="h-5 w-5 text-muted-foreground" />} text="No trading account found." />;
  }
  if (analyticsQuery.isLoading) return <CenteredState icon={<Loader2 className="h-5 w-5 animate-spin" />} text="Loading journal analytics…" />;
  if (analyticsQuery.isError) {
    return <CenteredState icon={<AlertTriangle className="h-5 w-5 text-red-400" />} text={`Could not load journal analytics: ${errorMessage(analyticsQuery.error)}`} />;
  }

  return (
    <JournalAnalyticsSections trades={trades} focus={focus} onSetFocus={onSetFocus} truncated={analyticsQuery.data?.truncated ?? false} />
  );
}

function JournalAnalyticsSections({
  trades,
  focus,
  onSetFocus,
  truncated,
}: {
  trades: JournalAnalyticsTrade[];
  focus: JournalFocusFilter;
  onSetFocus: (kind: JournalFocusKind, value: string) => void;
  truncated: boolean;
}) {
  const comparison = useMemo(() => journaledVsNonJournaled(trades), [trades]);
  const setups = useMemo(() => bySetup(trades), [trades]);
  const strategies = useMemo(() => byStrategy(trades), [trades]);
  const grades = useMemo(() => byGrade(trades), [trades]);
  const emotions = useMemo(() => byEmotion(trades), [trades]);
  const mistakes = useMemo(() => byMistake(trades), [trades]);
  const tags = useMemo(() => byTag(trades), [trades]);
  const sessions = useMemo(() => byJournalSession(trades), [trades]);
  const gradeSetup = useMemo(() => byGradeAndSetup(trades), [trades]);
  const emotionOutcome = useMemo(() => byEmotionAndOutcome(trades), [trades]);
  const mistakeSetup = useMemo(() => byMistakeAndSetup(trades), [trades]);

  if (trades.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {focus ? "No closed trades match the current focus and filters." : "No closed trades in this period."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {truncated && (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
          This account has more than {ANALYTICS_TRADE_HARD_CEILING.toLocaleString("en-US")} closed trades matching this filter — analytics below are
          incomplete. Narrow the date range or symbol filter for exact totals.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <JournaledComparisonCard comparison={comparison} />
        <GradeDistributionBar grades={grades} activeFocusValue={focus?.kind === "grade" ? focus.value : null} onSelect={(g) => onSetFocus("grade", g)} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <JournalPerformanceTable
          title="Setup Performance"
          rows={setups}
          getLabel={(r) => r.setup}
          extraColumns={["avgWin", "avgLoss"]}
          activeFocusValue={focus?.kind === "setup" ? focus.value : null}
          onRowClick={(v) => onSetFocus("setup", v)}
          emptyLabel="No trades have a Setup recorded yet."
        />
        <JournalPerformanceTable
          title="Strategy Performance"
          rows={strategies}
          getLabel={(r) => r.strategy}
          extraColumns={["avgWin", "avgLoss"]}
          activeFocusValue={focus?.kind === "strategy" ? focus.value : null}
          onRowClick={(v) => onSetFocus("strategy", v)}
          emptyLabel="No trades have a Strategy recorded yet."
        />
      </div>

      <JournalPerformanceTable
        title="Mistake Impact"
        note="Sorted by net P&L ascending by default — the most costly mistakes appear first."
        rows={mistakes}
        getLabel={(r) => r.mistake}
        extraColumns={["avgLoss"]}
        defaultSortKey="netPnl"
        defaultSortDir="asc"
        activeFocusValue={focus?.kind === "mistake" ? focus.value : null}
        onRowClick={(v) => onSetFocus("mistake", v)}
        emptyLabel="No mistakes recorded in this filter yet."
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <JournalPerformanceTable
          title="Grade Performance"
          rows={grades.filter((g) => g.tradeCount > 0 || true)}
          getLabel={(r) => r.grade}
          extraColumns={["avgWin", "avgLoss"]}
          defaultSortKey="tradeCount"
          activeFocusValue={focus?.kind === "grade" ? focus.value : null}
          onRowClick={(v) => onSetFocus("grade", v)}
        />
        <JournalPerformanceTable
          title="Emotion Performance"
          rows={emotions}
          getLabel={(r) => r.emotion}
          extraColumns={["avgWin", "avgLoss"]}
          activeFocusValue={focus?.kind === "emotion" ? focus.value : null}
          onRowClick={(v) => onSetFocus("emotion", v)}
          emptyLabel="No trades have an Emotion recorded yet."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <JournalPerformanceTable
          title="Journal Session Performance"
          note="The trader's own manually-entered session — a distinct signal from the Dashboard's computed UTC session breakdown."
          rows={sessions}
          getLabel={(r) => r.label}
          extraColumns={["avgWin", "avgLoss"]}
          defaultSortKey="tradeCount"
          activeFocusValue={focus?.kind === "session" ? sessions.find((s) => s.session === focus.value)?.label ?? null : null}
          onRowClick={(label) => {
            const match = sessions.find((s) => s.label === label);
            if (match) onSetFocus("session", match.session);
          }}
        />
        <JournalPerformanceTable
          title="Tag Performance"
          rows={tags}
          getLabel={(r) => r.tag}
          extraColumns={["avgWin", "avgLoss"]}
          activeFocusValue={focus?.kind === "tag" ? focus.value : null}
          onRowClick={(v) => onSetFocus("tag", v)}
          emptyLabel="No tags recorded in this filter yet."
        />
      </div>

      <div className="rounded-md border border-border bg-card p-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Combination Insights</div>
        <div className="mt-2 grid grid-cols-1 gap-3 xl:grid-cols-3">
          <JournalPerformanceTable
            title="Grade × Setup"
            rows={gradeSetup}
            getLabel={(r) => `${r.grade} · ${r.setup}`}
            emptyLabel="Not enough graded, set-up trades yet."
          />
          <JournalPerformanceTable
            title="Emotion × Outcome"
            rows={emotionOutcome}
            getLabel={(r) => `${r.emotion} · ${r.outcome === "win" ? "Win" : r.outcome === "loss" ? "Loss" : "Breakeven"}`}
            emptyLabel="Not enough emotion-tagged trades yet."
          />
          <JournalPerformanceTable
            title="Mistake × Setup"
            rows={mistakeSetup}
            getLabel={(r) => `${r.mistake} · ${r.setup}`}
            defaultSortKey="netPnl"
            defaultSortDir="asc"
            emptyLabel="Not enough mistake-and-setup trades yet."
          />
        </div>
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
