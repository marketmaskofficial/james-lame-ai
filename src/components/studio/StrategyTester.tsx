import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Play, Save, Trash2, Wand2 } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { runBacktest } from "@/lib/backtest.functions";
import { deleteBacktestRun, listBacktestRuns, saveBacktestRun } from "@/lib/backtest-runs.functions";
import {
  DEFAULT_SETTINGS,
  EXECUTION_SEMANTICS,
  runBacktestEngine,
  type BacktestOutcome,
  type BacktestReport,
  type BacktestSettings,
  type BacktestTrade,
  type Metrics,
} from "@/lib/backtest/engine";
import type { Bar, StrategyOut } from "@/lib/sgscript/types";
import { track } from "@/lib/telemetry";

type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const SUPPORTED: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export type TesterProject = {
  name: string;
  strategy: StrategyOut;
  code: string;
};

const STORE_KEY = "sg.studio.backtest";

function loadSettings(): BacktestSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as BacktestSettings) };
  } catch {
    /* first run */
  }
  return DEFAULT_SETTINGS;
}

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toFixed(2)}%`;
const r = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}R`);
function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Strategy tester.
 *
 * Primary behaviour: backtest the CURRENT project — the same script the chart
 * is running — using the rules it declared. The two preset strategies remain
 * only as runnable examples, never as the main path.
 */
export function StrategyTester({
  symbol,
  interval,
  signedIn,
  bars,
  project,
  onDefineRules,
  onShowTrades,
}: {
  symbol: string;
  interval: string;
  signedIn: boolean;
  bars: Bar[];
  project: TesterProject | null;
  onDefineRules: (suggestion: string) => void;
  onShowTrades: (trades: BacktestTrade[] | null) => void;
}) {
  const [tab, setTab] = useState<"project" | "saved" | "examples">("project");
  const [settings, setSettings] = useState<BacktestSettings>(DEFAULT_SETTINGS);
  const [outcome, setOutcome] = useState<BacktestOutcome | null>(null);
  const [semantics, setSemantics] = useState(false);
  const [showTrades, setShowTrades] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!project || !outcome?.ok) throw new Error("Nothing to save yet");
      return saveBacktestRun({
        data: {
          strategyName: project.name,
          code: project.code,
          symbol,
          interval,
          settings: settings as unknown as Record<string, unknown>,
          report: outcome as unknown as Record<string, unknown>,
        },
      });
    },
    onSuccess: () => {
      setSaveMessage("Saved.");
      void queryClient.invalidateQueries({ queryKey: ["backtest-runs"] });
    },
    onError: (e: unknown) =>
      setSaveMessage(e instanceof Error ? e.message : "Could not save this run"),
  });

  useEffect(() => setSettings(loadSettings()), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  // A new symbol/timeframe invalidates any previous report.
  useEffect(() => {
    setOutcome(null);
    onShowTrades(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  const set = <K extends keyof BacktestSettings>(k: K, v: BacktestSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  const run = () => {
    if (!project) return;
    track("backtest_started", { symbol, interval });
    try {
      const result = runBacktestEngine({
        bars,
        strategy: project.strategy,
        symbol,
        interval,
        strategyName: project.name,
        settings,
      });
      setOutcome(result);
      setError(null);
      if (result.ok) {
        track("backtest_succeeded", { trades: result.trades.length });
        if (showTrades) onShowTrades(result.trades);
      } else {
        track("backtest_blocked", { reason: result.reason });
        onShowTrades(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Backtest failed";
      setError(msg);
      track("backtest_failed", { message: msg });
    }
  };

  const report = outcome?.ok ? outcome : null;

  useEffect(() => {
    onShowTrades(showTrades && report ? report.trades : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTrades, report]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
        {(
          [
            ["project", "Current project"],
            ["saved", "Saved runs"],
            ["examples", "Examples"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
              tab === id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="font-mono text-muted-foreground">
          {symbol} · {interval} · {bars.length} bars
        </span>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={showTrades}
            onChange={(e) => setShowTrades(e.target.checked)}
            className="accent-[color:var(--brand,#e6b800)]"
          />
          Show trades on chart
        </label>
        <button
          onClick={() => setSemantics((v) => !v)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3 w-3" /> Execution rules
        </button>
      </div>

      {semantics && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-b border-border bg-card p-2 text-[10px] leading-relaxed text-muted-foreground">
          {EXECUTION_SEMANTICS}
        </pre>
      )}

      {tab === "examples" ? (
        <ExampleTester symbol={symbol} interval={interval} signedIn={signedIn} />
      ) : tab === "saved" ? (
        <SavedRuns signedIn={signedIn} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
            <span className="font-medium">
              {project ? project.name : "No indicator on the chart"}
            </span>
            <Num
              label="Capital"
              value={settings.startingCapital}
              onChange={(v) => set("startingCapital", v)}
              width="w-20"
            />
            <select
              value={settings.sizing.mode}
              onChange={(e) => {
                const mode = e.target.value as "fixed_qty" | "fixed_cash" | "percent_equity" | "risk_percent";
                set(
                  "sizing",
                  mode === "fixed_qty"
                    ? { mode, qty: 1 }
                    : mode === "fixed_cash"
                      ? { mode, cash: 5000 }
                      : mode === "risk_percent"
                        ? { mode, percent: 1 }
                        : { mode, percent: 10 },
                );
              }}
              className="rounded border border-border bg-background px-1.5 py-1 outline-none focus:border-brand"
            >
              <option value="percent_equity">% of equity</option>
              <option value="risk_percent">% risk (needs stop)</option>
              <option value="fixed_cash">Fixed $</option>
              <option value="fixed_qty">Fixed qty</option>
            </select>
            <Num
              label="Size"
              value={
                settings.sizing.mode === "fixed_qty"
                  ? settings.sizing.qty
                  : settings.sizing.mode === "fixed_cash"
                    ? settings.sizing.cash
                    : settings.sizing.percent
              }
              onChange={(v) =>
                set(
                  "sizing",
                  settings.sizing.mode === "fixed_qty"
                    ? { mode: "fixed_qty", qty: v }
                    : settings.sizing.mode === "fixed_cash"
                      ? { mode: "fixed_cash", cash: v }
                      : settings.sizing.mode === "risk_percent"
                        ? { mode: "risk_percent", percent: v }
                        : { mode: "percent_equity", percent: v },
                )
              }
            />
            <Num
              label="Commission/unit"
              value={settings.commissionPerUnit}
              onChange={(v) => set("commissionPerUnit", v)}
            />
            <Num
              label="Slippage ticks"
              value={settings.slippageTicks}
              onChange={(v) => set("slippageTicks", v)}
            />
            <DateField
              label="From"
              value={settings.from}
              onChange={(v) => set("from", v)}
            />
            <DateField label="To" value={settings.to} onChange={(v) => set("to", v)} />
            <button
              disabled={!project || bars.length === 0}
              onClick={run}
              className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 font-medium text-brand-foreground disabled:opacity-50"
            >
              <Play className="h-3 w-3" /> Backtest current project
            </button>
            <button
              disabled={!signedIn || !outcome?.ok || saveMutation.isPending}
              onClick={() => {
                setSaveMessage(null);
                saveMutation.mutate();
              }}
              title={!signedIn ? "Sign in to save backtest runs" : "Save this run so you can compare it later"}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-medium hover:bg-accent disabled:opacity-50"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save run
            </button>
            {error && <span className="text-destructive">{error}</span>}
            {saveMessage && <span className="text-muted-foreground">{saveMessage}</span>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!project && (
              <p className="p-4 text-center text-[11px] text-muted-foreground">
                Build an indicator or add a script to the chart, then backtest it here.
              </p>
            )}

            {project && !outcome && (
              <p className="p-4 text-center text-[11px] text-muted-foreground">
                Ready to test {project.name} on {symbol} {interval}.
              </p>
            )}

            {outcome && !outcome.ok && (
              <div className="space-y-3 p-4 text-[11px]">
                <p className="font-medium">{outcome.message}</p>
                {outcome.missing.length > 0 && (
                  <p className="text-muted-foreground">
                    Missing: {outcome.missing.join(", ")}
                  </p>
                )}
                {outcome.reason === "no-rules" && (
                  <button
                    onClick={() =>
                      onDefineRules(
                        "Add strategy rules to this indicator: define the long entry, the short entry (if it applies), the exit, the stop and the target. Use strategy.long / strategy.short / strategy.close in the SGScript.",
                      )
                    }
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent"
                  >
                    <Wand2 className="h-3 w-3" /> Define strategy rules
                  </button>
                )}
              </div>
            )}

            {report && <Report report={report} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Report({ report }: { report: BacktestReport }) {
  const m = report.metrics;
  const rows: Array<[string, string]> = [
    ["Net P&L", money(m.netPnl)],
    ["Return", pct(m.returnPct)],
    ["Gross profit", money(m.grossProfit)],
    ["Gross loss", money(-m.grossLoss)],
    ["Total trades", String(m.totalTrades)],
    ["Winners", String(m.winningTrades)],
    ["Losers", String(m.losingTrades)],
    ["Win rate", pct(m.winRate)],
    ["Profit factor", m.profitFactor === null ? "—" : m.profitFactor.toFixed(2)],
    ["Max drawdown", `${money(m.maxDrawdown)} (${pct(m.maxDrawdownPct)})`],
    ["Avg trade", money(m.avgTrade)],
    ["Avg win", money(m.avgWin)],
    ["Avg loss", money(m.avgLoss)],
    ["Win/loss ratio", m.winLossRatio === null ? "—" : m.winLossRatio.toFixed(2)],
    ["Largest win", money(m.largestWin)],
    ["Largest loss", money(m.largestLoss)],
    ["Max win streak", String(m.maxWinStreak)],
    ["Max loss streak", String(m.maxLossStreak)],
    ["Avg hold time", duration(m.avgHoldingSeconds)],
    ["Avg MFE", `${money(m.avgMfe)} (${r(m.avgMfeR)})`],
    ["Avg MAE", `${money(m.avgMae)} (${r(m.avgMaeR)})`],
    ["Avg R", m.avgR === null ? "—" : `${m.avgR.toFixed(2)}R`],
    ["Expectancy", money(m.expectancy)],
  ];

  return (
    <div className="text-[11px]">
      <div className="grid grid-cols-5 gap-2 border-b border-border p-2 font-mono">
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              {k}
            </div>
            <div>{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 border-b border-border p-2 sm:grid-cols-2">
        <EquityChart curve={report.equityCurve} />
        <DrawdownChart curve={report.drawdownCurve} />
      </div>

      <div className="grid gap-2 border-b border-border p-2 sm:grid-cols-2">
        <Breakdown title="Long trades" m={report.longMetrics} />
        <Breakdown title="Short trades" m={report.shortMetrics} />
      </div>

      {report.sessionMetrics.length > 0 && (
        <div className="grid gap-2 border-b border-border p-2 sm:grid-cols-4">
          {report.sessionMetrics.map((s) => (
            <Breakdown key={s.session} title={s.session} m={s} />
          ))}
        </div>
      )}

      {report.dayOfWeekMetrics.length > 0 && (
        <div className="grid grid-cols-3 gap-2 border-b border-border p-2 sm:grid-cols-7">
          {report.dayOfWeekMetrics.map((d) => (
            <Breakdown key={d.day} title={d.day} m={d} />
          ))}
        </div>
      )}

      {report.limitations.length > 0 && (
        <ul className="list-disc space-y-0.5 border-b border-border p-2 pl-6 text-[10px] text-muted-foreground">
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}

      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            {[
              "#",
              "Dir",
              "Entry",
              "Entry px",
              "Exit",
              "Exit px",
              "Qty",
              "Stop",
              "Target",
              "P&L",
              "R",
              "Reason",
            ].map((h) => (
              <th key={h} className="px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.trades.map((t) => (
            <tr key={t.id} className="border-b border-border/30">
              <td className="px-2 py-1 text-muted-foreground">{t.id}</td>
              <td
                className={`px-2 py-1 ${t.direction === "long" ? "text-emerald-400" : "text-red-400"}`}
              >
                {t.direction}
              </td>
              <td className="px-2 py-1 text-muted-foreground">
                {new Date(t.entryTime * 1000).toLocaleString()}
              </td>
              <td className="px-2 py-1">{t.entryPrice}</td>
              <td className="px-2 py-1 text-muted-foreground">
                {new Date(t.exitTime * 1000).toLocaleString()}
              </td>
              <td className="px-2 py-1">{t.exitPrice}</td>
              <td className="px-2 py-1">{t.qty}</td>
              <td className="px-2 py-1">{t.stop ?? "—"}</td>
              <td className="px-2 py-1">{t.target ?? "—"}</td>
              <td
                className={`px-2 py-1 ${t.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {money(t.pnl)}
              </td>
              <td className="px-2 py-1">
                {t.rMultiple === null ? "—" : `${t.rMultiple.toFixed(2)}R`}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{t.exitReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EquityChart({ curve }: { curve: BacktestReport["equityCurve"] }) {
  if (curve.length < 2) return null;
  const data = curve.map((p) => ({ t: p.time, equity: p.equity }));
  const up = curve[curve.length - 1].equity >= curve[0].equity;
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        Equity curve
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip
              formatter={(v: number) => money(v)}
              labelFormatter={(t: number) => new Date(t * 1000).toLocaleString()}
              contentStyle={{ fontSize: 10, padding: "2px 6px" }}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={up ? "#34d399" : "#f87171"}
              fill={up ? "#34d39933" : "#f8717133"}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DrawdownChart({ curve }: { curve: BacktestReport["drawdownCurve"] }) {
  if (curve.length < 2) return null;
  const data = curve.map((p) => ({ t: p.time, dd: -p.drawdownPct }));
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        Drawdown %
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["dataMin", 0]} />
            <Tooltip
              formatter={(v: number) => `${Math.abs(v).toFixed(2)}%`}
              labelFormatter={(t: number) => new Date(t * 1000).toLocaleString()}
              contentStyle={{ fontSize: 10, padding: "2px 6px" }}
            />
            <Area
              type="monotone"
              dataKey="dd"
              stroke="#f87171"
              fill="#f8717133"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Breakdown({ title, m }: { title: string; m: Metrics }) {
  return (
    <div className="rounded border border-border/60 p-2 font-mono">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div>
        {m.totalTrades} trades · {pct(m.winRate)} win · {money(m.netPnl)}
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  width = "w-16",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  width?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-muted-foreground">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${width} rounded border border-border bg-background px-1 py-1 font-mono text-foreground outline-none focus:border-brand`}
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const asDate = value ? new Date(value * 1000).toISOString().slice(0, 10) : "";
  return (
    <label className="flex items-center gap-1 text-muted-foreground">
      {label}
      <input
        type="date"
        value={asDate}
        onChange={(e) =>
          onChange(e.target.value ? Math.floor(Date.parse(e.target.value) / 1000) : null)
        }
        className="rounded border border-border bg-background px-1 py-1 font-mono text-foreground outline-none focus:border-brand"
      />
    </label>
  );
}

/** The two original presets, kept as runnable examples only. */
/**
 * Saved backtest runs — enough metadata bundled with each one (the exact
 * SGScript, symbol/timeframe, settings, and full computed report) to
 * compare results later ("1R vs 2R vs 3R") without re-running anything.
 */
function SavedRuns({ signedIn }: { signedIn: boolean }) {
  const queryClient = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ["backtest-runs"],
    queryFn: () => listBacktestRuns(),
    enabled: signedIn,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBacktestRun({ data: { id } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["backtest-runs"] }),
  });

  if (!signedIn) {
    return (
      <p className="p-4 text-center text-[11px] text-muted-foreground">
        Sign in to save and compare backtest runs across sessions.
      </p>
    );
  }
  if (runsQuery.isLoading) {
    return (
      <p className="flex items-center justify-center gap-1.5 p-4 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading saved runs…
      </p>
    );
  }
  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return (
      <p className="p-4 text-center text-[11px] text-muted-foreground">
        No saved runs yet — backtest your project, then "Save run" to keep it here.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto text-[11px]">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            {["Saved", "Strategy", "Symbol", "Net P&L", "Return", "Trades", "Win rate", "Max DD", ""].map((h) => (
              <th key={h} className="px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((row) => {
            const report = row.report as unknown as BacktestReport;
            const m = report?.metrics;
            return (
              <tr key={row.id} className="border-b border-border/30">
                <td className="px-2 py-1 text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-2 py-1">{row.strategy_name}</td>
                <td className="px-2 py-1 text-muted-foreground">
                  {row.symbol} · {row.interval}
                </td>
                {m ? (
                  <>
                    <td className={`px-2 py-1 ${m.netPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {money(m.netPnl)}
                    </td>
                    <td className="px-2 py-1">{pct(m.returnPct)}</td>
                    <td className="px-2 py-1">{m.totalTrades}</td>
                    <td className="px-2 py-1">{pct(m.winRate)}</td>
                    <td className="px-2 py-1">{pct(m.maxDrawdownPct)}</td>
                  </>
                ) : (
                  <td className="px-2 py-1 text-muted-foreground" colSpan={4}>
                    —
                  </td>
                )}
                <td className="px-2 py-1">
                  <button
                    onClick={() => deleteMutation.mutate(row.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete this saved run"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExampleTester({
  symbol,
  interval,
  signedIn,
}: {
  symbol: string;
  interval: string;
  signedIn: boolean;
}) {
  const [strategy, setStrategy] = useState<"rsi" | "ma_cross">("ma_cross");
  const [fastLen, setFastLen] = useState(20);
  const [slowLen, setSlowLen] = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runBacktest>> | null>(
    null,
  );

  const safeInterval = useMemo(
    () => (SUPPORTED.includes(interval as Interval) ? interval : "1h") as Interval,
    [interval],
  );

  const run = useMutation({
    mutationFn: () =>
      runBacktest({
        data: {
          symbol,
          interval: safeInterval,
          strategy,
          ...(strategy === "ma_cross" ? { fastLen, slowLen } : { rsiPeriod }),
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Backtest failed"),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">
          Reference examples — these do not use your project.
        </span>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "rsi" | "ma_cross")}
          className="rounded border border-border bg-background px-1.5 py-1 outline-none focus:border-brand"
        >
          <option value="ma_cross">MA cross</option>
          <option value="rsi">RSI reversion</option>
        </select>
        {strategy === "ma_cross" ? (
          <>
            <Num label="Fast" value={fastLen} onChange={setFastLen} />
            <Num label="Slow" value={slowLen} onChange={setSlowLen} />
          </>
        ) : (
          <Num label="Period" value={rsiPeriod} onChange={setRsiPeriod} />
        )}
        <button
          disabled={!signedIn || run.isPending}
          onClick={() => run.mutate()}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-medium hover:bg-accent disabled:opacity-50"
        >
          {run.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Run example
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]">
        {!result ? (
          <p className="p-4 text-center text-muted-foreground">No example run yet.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <Stat k="Net %" v={result.totalPct.toFixed(2)} />
            <Stat k="Trades" v={String(result.trades)} />
            <Stat k="Win rate" v={`${result.winRate.toFixed(1)}%`} />
            <Stat k="Max DD" v={`${result.maxDrawdownPct.toFixed(2)}%`} />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div>{v}</div>
    </div>
  );
}
