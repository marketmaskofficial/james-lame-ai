import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BalancePoint, CumulativePnlPoint, DailyPnlPoint, DrawdownPoint } from "@/lib/dashboard/metrics";

/**
 * Trading Dashboard charts (Phase 4A). Built on `recharts` — the library
 * already used for exactly this kind of chart in
 * `src/components/studio/StrategyTester.tsx` (`EquityChart`/
 * `DrawdownChart`) — matching its convention (small `ResponsiveContainer`,
 * hidden axes, a plain-text tooltip, `#34d399`/`#f87171` green/red,
 * non-animated) rather than introducing `lightweight-charts` here, which
 * this codebase reserves for OHLC price series only.
 */

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontSize: 11,
  padding: "4px 8px",
} as const;

export function CumulativePnlChart({ points }: { points: CumulativePnlPoint[] }) {
  if (points.length < 2) return <EmptyChartNote label="Cumulative P&L" />;
  const up = points[points.length - 1].cumulative >= 0;
  return (
    <ChartCard title="Cumulative P&L">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            formatter={(v: number) => money(v)}
            labelFormatter={(t: string) => new Date(t).toLocaleString()}
            contentStyle={tooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={up ? "#34d399" : "#f87171"}
            fill={up ? "#34d39933" : "#f8717133"}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DailyPnlChart({ points }: { points: DailyPnlPoint[] }) {
  if (points.length === 0) return <EmptyChartNote label="Daily Net P&L" />;
  return (
    <ChartCard title="Daily Net P&L">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="day" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            formatter={(v: number) => money(v)}
            labelFormatter={(d: string) => d}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="netPnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {points.map((p) => (
              <Cell key={p.day} fill={p.netPnl > 0 ? "#34d399" : p.netPnl < 0 ? "#f87171" : "var(--color-muted-foreground)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DerivedBalanceChart({ points }: { points: BalancePoint[] }) {
  if (points.length < 2) return <EmptyChartNote label="Derived Trading Balance" />;
  const up = points[points.length - 1].balance >= points[0].balance;
  return (
    <ChartCard
      title="Derived Trading Balance"
      note="Starting balance + cumulative net realized P&L — a derived equity progression, not a full banking ledger."
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            formatter={(v: number) => money(v)}
            labelFormatter={(t: string) => new Date(t).toLocaleString()}
            contentStyle={tooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={up ? "#34d399" : "#f87171"}
            fill={up ? "#34d39933" : "#f8717133"}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DrawdownChart({
  points,
  maxDrawdownPct,
  currentDrawdownPct,
}: {
  points: DrawdownPoint[];
  maxDrawdownPct: number;
  currentDrawdownPct: number;
}) {
  if (points.length < 2) return <EmptyChartNote label="Drawdown" />;
  const data = points.map((p) => ({ time: p.time, dd: -p.drawdownPct }));
  return (
    <ChartCard
      title="Drawdown"
      note={`Current ${currentDrawdownPct.toFixed(2)}% · Max ${maxDrawdownPct.toFixed(2)}%`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="time" hide />
          <YAxis hide domain={["dataMin", 0]} />
          <Tooltip
            formatter={(v: number) => `${Math.abs(v).toFixed(2)}%`}
            labelFormatter={(t: string) => new Date(t).toLocaleString()}
            contentStyle={tooltipStyle}
          />
          <Area type="monotone" dataKey="dd" stroke="#f87171" fill="#f8717133" strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        {note && <div className="truncate text-[10px] text-muted-foreground">{note}</div>}
      </div>
      <div className="mt-2 h-32">{children}</div>
    </div>
  );
}

function EmptyChartNote({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">Not enough data yet</div>
    </div>
  );
}
