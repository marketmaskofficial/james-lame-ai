import { useMemo, useState } from "react";
import { addMonths, format, getDay, getDaysInMonth, startOfMonth, subMonths } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDayBuckets, type CalendarDayBucket, type ClosedTrade } from "@/lib/dashboard/metrics";

/**
 * Phase 4B-1 Trading Calendar. A dedicated month grid — NOT the shadcn
 * `Calendar`/`react-day-picker` wrapper in `src/components/ui/calendar.tsx`,
 * which is a small single-date-picker control for form inputs elsewhere in
 * the app and isn't built to carry per-cell P&L/trade-count content.
 *
 * The month cursor is deliberately a plain browser-local `Date` used ONLY
 * for `date-fns` calendar layout math (which weekday a day-of-month falls
 * under, month navigation) — it never leaves this component. The actual
 * data query and every day-cell key are built as explicit UTC strings
 * ("YYYY-MM-DD"/ISO), matching `utcDayKey` and this dashboard's established
 * UTC-day-boundary convention (see `dashboard.tsx`'s `dayStartUtc`/
 * `dayEndUtc` doc comment) rather than the viewer's local timezone. As with
 * that existing convention, there is one accepted edge case: right at a
 * month boundary in a timezone far from UTC, the locally-labeled "current
 * month" and the UTC month containing "now" can differ by a day — the same
 * category of approximation Phase 4A already accepted for the date-range
 * inputs, not a new one introduced here.
 */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function TradingCalendar({
  accountId,
  symbol,
  fetchMonth,
  onSelectDay,
}: {
  accountId: string | null;
  symbol: string;
  /** The SAME `listClosedTrades` server function the rest of the dashboard
   * uses, called with this calendar's own month boundaries instead of the
   * header's date-range filter — a second call to one canonical data path,
   * not a second data architecture. */
  fetchMonth: (args: { accountId: string; symbol?: string; fromUtc: string; toUtc: string }) => Promise<ClosedTrade[]>;
  /** UTC day key ("YYYY-MM-DD") of the clicked trading day. */
  onSelectDay: (dayUtc: string) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = getDaysInMonth(cursor);
  const leadingBlanks = (getDay(cursor) + 6) % 7;

  const fromUtc = `${year}-${pad2(month + 1)}-01T00:00:00.000Z`;
  const toUtc = `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}T23:59:59.999Z`;

  const monthQuery = useQuery({
    queryKey: ["dashboard-calendar", accountId, symbol, year, month],
    queryFn: () => fetchMonth({ accountId: accountId as string, symbol: symbol || undefined, fromUtc, toUtc }),
    enabled: !!accountId,
  });

  const buckets = useMemo(() => {
    const map = new Map<string, CalendarDayBucket>();
    for (const b of calendarDayBuckets(monthQuery.data ?? [])) map.set(b.day, b);
    return map;
  }, [monthQuery.data]);

  const cells = useMemo(() => {
    const out: { day: number; key: string }[] = [];
    for (let d = 1; d <= daysInMonth; d++) out.push({ day: d, key: `${year}-${pad2(month + 1)}-${pad2(d)}` });
    return out;
  }, [year, month, daysInMonth]);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trading Calendar</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setCursor((c) => subMonths(c, 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-28 text-center text-xs font-medium">{format(cursor, "MMMM yyyy")}</span>
          <button
            type="button"
            aria-label="Next month"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setCursor((c) => addMonths(c, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            Today
          </button>
        </div>
      </div>

      {monthQuery.isLoading ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">Loading…</div>
      ) : monthQuery.isError ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">Could not load this month.</div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {cells.map(({ day, key }) => {
              const bucket = buckets.get(key);
              const hasTrades = !!bucket && bucket.tradeCount > 0;
              const tone = !hasTrades ? "empty" : bucket!.netPnl > 0 ? "positive" : bucket!.netPnl < 0 ? "negative" : "neutral";
              const toneClass =
                tone === "positive"
                  ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
                  : tone === "negative"
                    ? "border-red-900/60 bg-red-950/30 text-red-300"
                    : tone === "neutral"
                      ? "border-border bg-muted/30 text-foreground"
                      : "border-border/60 bg-transparent text-muted-foreground";
              return (
                <button
                  type="button"
                  key={key}
                  disabled={!hasTrades}
                  onClick={() => onSelectDay(key)}
                  className={`flex aspect-square flex-col items-start justify-between rounded-md border p-1.5 text-left text-[10px] transition ${toneClass} ${
                    hasTrades ? "cursor-pointer hover:opacity-80" : "cursor-default"
                  }`}
                >
                  <span className="font-medium">{day}</span>
                  {hasTrades && (
                    <span className="w-full truncate font-semibold tabular-nums">
                      {bucket!.netPnl >= 0 ? "+" : "-"}$
                      {Math.abs(bucket!.netPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  )}
                  {hasTrades && (
                    <span className="text-[9px] opacity-80">
                      {bucket!.tradeCount} trade{bucket!.tradeCount === 1 ? "" : "s"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
