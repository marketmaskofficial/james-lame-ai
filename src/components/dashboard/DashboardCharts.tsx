import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BalancePoint, CumulativePnlPoint, DailyPnlPoint, DrawdownPoint } from "@/lib/dashboard/metrics";

/**
 * Trading Dashboard chart visualizations. Built on `recharts` — the library
 * already used for exactly this kind of chart in
 * `src/components/studio/StrategyTester.tsx` (`EquityChart`/
 * `DrawdownChart`) — matching its convention (small `ResponsiveContainer`,
 * hidden axes, a plain-text tooltip, `#34d399`/`#f87171` green/red,
 * non-animated) rather than introducing `lightweight-charts` here, which
 * this codebase reserves for OHLC price series only.
 *
 * Phase 4C: these are card-free visualization bodies (no title, no border,
 * no fixed height) consumed by `PerformanceChartTabs`, which supplies the
 * one shared card/tab chrome around whichever chart is active. No
 * calculation changed from Phase 4A/4B-1 — only the wrapper each chart used
 * to carry itself moved into the tab workspace.
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

export function EmptyVizNote({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{label}</div>;
}

/** A chart with real data but too few points to look like anything other
 * than a single sparse bar/line — shown instead of rendering a technically
 * "real" but visually meaningless chart. Never fabricates points; it's
 * purely a copy choice for the same real (short) series. */
export function LowHistoryNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="max-w-[220px] text-[10px] leading-snug text-muted-foreground">{body}</div>
    </div>
  );
}

export function CumulativePnlViz({ points }: { points: CumulativePnlPoint[] }) {
  if (points.length < 2) return <EmptyVizNote label="Not enough data yet" />;
  const up = points[points.length - 1].cumulative >= 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="time" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={(t: string) => new Date(t).toLocaleString()} contentStyle={tooltipStyle} />
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
  );
}

export function DailyPnlViz({ points }: { points: DailyPnlPoint[] }) {
  if (points.length === 0) return <EmptyVizNote label="Not enough data yet" />;
  if (points.length === 1) {
    return <LowHistoryNote title="More trading days needed" body="Daily P&L will populate as more sessions are recorded." />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="day" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={(d: string) => d} contentStyle={tooltipStyle} />
        <Bar dataKey="netPnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {points.map((p) => (
            <Cell key={p.day} fill={p.netPnl > 0 ? "#34d399" : p.netPnl < 0 ? "#f87171" : "var(--color-muted-foreground)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DerivedBalanceViz({ points }: { points: BalancePoint[] }) {
  if (points.length < 2) return <EmptyVizNote label="Not enough data yet" />;
  const up = points[points.length - 1].balance >= points[0].balance;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="time" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip formatter={(v: number) => money(v)} labelFormatter={(t: string) => new Date(t).toLocaleString()} contentStyle={tooltipStyle} />
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
  );
}

export function DrawdownViz({ points }: { points: DrawdownPoint[] }) {
  if (points.length < 2) return <EmptyVizNote label="Not enough data yet" />;
  const data = points.map((p) => ({ time: p.time, dd: -p.drawdownPct }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="time" hide />
        <YAxis hide domain={["dataMin", 0]} />
        <Tooltip formatter={(v: number) => `${Math.abs(v).toFixed(2)}%`} labelFormatter={(t: string) => new Date(t).toLocaleString()} contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="dd" stroke="#f87171" fill="#f8717133" strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
