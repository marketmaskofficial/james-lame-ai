import { Link } from "@tanstack/react-router";
import { classifyTrade, netPnlForTrade, type ClosedTrade } from "@/lib/dashboard/metrics";

/**
 * Phase 4C: a compact recent-trades list for the workstation layout. Reuses
 * the SAME `trades: ClosedTrade[]` the rest of the Dashboard already loaded
 * (`listClosedTrades` via `DashboardWorkspace`) — no new network request,
 * no new server function. `netPnlForTrade`/`classifyTrade` are the exact
 * same pure functions every other Dashboard P&L figure already goes
 * through, so "won"/"lost"/net amount here can never disagree with the KPI
 * row or Performance Score.
 *
 * Avg Winning/Losing Trade are passed in from the already-computed
 * `computeDashboardMetrics` result (Phase 4C moved them out of the primary
 * KPI row, not out of the product) rather than recomputed here.
 */

const RECENT_TRADES_LIMIT = 8;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact UTC date/time — explicitly labeled UTC, matching this
 * dashboard's established convention (Hour of Day (UTC), Day of Week
 * (UTC)) rather than silently rendering in the viewer's local timezone. */
function formatCloseUtc(iso: string): string {
  const d = new Date(iso);
  const month = MONTH_ABBR[d.getUTCMonth()];
  const day = d.getUTCDate();
  let hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm} UTC`;
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function RecentTrades({
  trades,
  avgWinningTrade,
  avgLosingTrade,
  accountId,
}: {
  trades: ClosedTrade[];
  avgWinningTrade: number | null;
  avgLosingTrade: number | null;
  /** Passed through to the Trade Explorer link so "View All Trades" opens
   * on the same account already selected here, instead of Trade Explorer
   * defaulting back to the first account. */
  accountId: string | null;
}) {
  const recent = [...trades].sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, RECENT_TRADES_LIMIT);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent Trades</div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span>
            Avg Win <span className="font-medium tabular-nums text-emerald-400">{avgWinningTrade == null ? "—" : money(avgWinningTrade)}</span>
          </span>
          <span>
            Avg Loss <span className="font-medium tabular-nums text-red-400">{avgLosingTrade == null ? "—" : money(avgLosingTrade)}</span>
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-col">
        {recent.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No closed trades yet.</div>
        ) : (
          recent.map((t) => {
            const net = netPnlForTrade(t);
            const cls = classifyTrade(t);
            const toneClass = cls === "win" ? "text-emerald-400" : cls === "loss" ? "text-red-400" : "text-foreground";
            return (
              <div key={t.positionId} className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 text-xs last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold uppercase ${
                      t.side === "buy" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
                    }`}
                  >
                    {t.side === "buy" ? "Long" : "Short"}
                  </span>
                  <span className="truncate font-medium">{t.symbol}</span>
                </div>
                <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{formatCloseUtc(t.closedAt)}</span>
                <span className={`shrink-0 text-right font-semibold tabular-nums ${toneClass}`}>
                  {net >= 0 ? "+" : "-"}
                  {money(Math.abs(net))}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Phase 4D: a real destination now that /trades exists. */}
      <div className="mt-2 border-t border-border/60 pt-2">
        <Link
          to="/trades"
          search={accountId ? { accountId } : undefined}
          className="block w-full rounded-md border border-border/60 py-1.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground transition hover:border-border hover:text-foreground"
        >
          View All Trades
        </Link>
      </div>
    </div>
  );
}
