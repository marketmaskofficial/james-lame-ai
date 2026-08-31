import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { sortJournalGroups, type JournalGroupSummary, type JournalSortKey } from "@/lib/dashboard/journalAnalytics";

/**
 * Phase 4F — the one shared sortable performance table behind every Journal
 * Analytics breakdown (Setup, Strategy, Grade, Emotion, Mistake, Tag,
 * Session). Desktop renders a real `<table>` with sortable headers (same
 * `Th`/`SortIcon` idiom `src/routes/trades.tsx` already established);
 * mobile collapses to stacked cards, the same "table on desktop, cards on
 * mobile" split Trade Explorer already uses — no new responsive pattern.
 *
 * Deliberately generic over the row's own label field (`getLabel`) rather
 * than one component per breakdown — Setup/Strategy/Grade/Emotion/Tag all
 * differ only in their label and which optional columns they emphasize.
 */

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const ratio = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const toneClass = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-foreground");

export type JournalTableColumn = "avgWin" | "avgLoss" | "breakevens";

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
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
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th className={`px-2 py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        >
          {children}
          <SortIcon active={!!active} dir={dir ?? "desc"} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function JournalPerformanceTable<T extends JournalGroupSummary>({
  title,
  note,
  rows,
  getLabel,
  extraColumns = [],
  defaultSortKey = "netPnl",
  defaultSortDir = "desc",
  activeFocusValue,
  onRowClick,
  emptyLabel = "No journaled trades match this filter yet.",
}: {
  title: string;
  note?: string;
  rows: T[];
  getLabel: (row: T) => string;
  /** Optional extra metric columns beyond the five every table always
   * shows (Trades, Win Rate, Net P&L, Avg Trade, Profit Factor) — used to
   * emphasize e.g. Avg Loss for Mistake Impact. */
  extraColumns?: JournalTableColumn[];
  defaultSortKey?: JournalSortKey;
  defaultSortDir?: "asc" | "desc";
  /** The current drill-down focus value, if this table's kind is the
   * active one — highlights the matching row. */
  activeFocusValue?: string | null;
  /** Activates the at-most-one metadata focus filter for this row's label. */
  onRowClick?: (label: string) => void;
  emptyLabel?: string;
}) {
  const [sortKey, setSortKey] = useState<JournalSortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => sortJournalGroups(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  const onSort = (key: JournalSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const showAvgWin = extraColumns.includes("avgWin");
  const showAvgLoss = extraColumns.includes("avgLoss");
  const showBreakevens = extraColumns.includes("breakevens");

  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      {note && <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{note}</div>}

      {rows.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        <>
          {/* Desktop sortable table */}
          <div className="mt-1.5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">{title.replace(/ Performance$| Impact$/, "")}</th>
                  <Th onClick={() => onSort("tradeCount")} active={sortKey === "tradeCount"} dir={sortDir} align="right">
                    Trades
                  </Th>
                  {showBreakevens && <th className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">BE</th>}
                  <Th onClick={() => onSort("winRatePct")} active={sortKey === "winRatePct"} dir={sortDir} align="right">
                    Win Rate
                  </Th>
                  <Th onClick={() => onSort("netPnl")} active={sortKey === "netPnl"} dir={sortDir} align="right">
                    Net P&L
                  </Th>
                  <Th onClick={() => onSort("avgNetTrade")} active={sortKey === "avgNetTrade"} dir={sortDir} align="right" className="hidden lg:table-cell">
                    Avg Trade
                  </Th>
                  {showAvgWin && <th className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">Avg Win</th>}
                  {showAvgLoss && <th className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">Avg Loss</th>}
                  <Th
                    onClick={() => onSort("profitFactor")}
                    active={sortKey === "profitFactor"}
                    dir={sortDir}
                    align="right"
                    className="hidden lg:table-cell"
                  >
                    Profit Factor
                  </Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const label = getLabel(row);
                  const active = activeFocusValue === label;
                  return (
                    <tr
                      key={label}
                      onClick={onRowClick ? () => onRowClick(label) : undefined}
                      className={`border-b border-border/50 last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-accent/40" : ""} ${
                        active ? "bg-brand/10" : ""
                      }`}
                    >
                      <td className="px-2 py-1.5 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {label}
                          {row.isLowSample && (
                            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                              Low sample
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{row.tradeCount}</td>
                      {showBreakevens && <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{row.breakevens}</td>}
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{pct(row.winRatePct)}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${toneClass(row.netPnl)}`}>{row.tradeCount === 0 ? "—" : money(row.netPnl)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground lg:table-cell">
                        {row.tradeCount === 0 ? "—" : money(row.avgNetTrade)}
                      </td>
                      {showAvgWin && (
                        <td className="hidden px-2 py-1.5 text-right tabular-nums text-emerald-400/80 xl:table-cell">
                          {row.avgWin == null ? "—" : money(row.avgWin)}
                        </td>
                      )}
                      {showAvgLoss && (
                        <td className="hidden px-2 py-1.5 text-right tabular-nums text-red-400/80 xl:table-cell">
                          {row.avgLoss == null ? "—" : money(row.avgLoss)}
                        </td>
                      )}
                      <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground lg:table-cell">{ratio(row.profitFactor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="mt-1.5 flex flex-col gap-1.5 md:hidden">
            {sorted.map((row) => {
              const label = getLabel(row);
              const active = activeFocusValue === label;
              const Wrapper = onRowClick ? "button" : "div";
              return (
                <Wrapper
                  key={label}
                  type={onRowClick ? "button" : undefined}
                  onClick={onRowClick ? () => onRowClick(label) : undefined}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-2 text-left text-xs ${
                    active ? "border-brand/60 bg-brand/10" : "border-border/60"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{label}</span>
                    {row.isLowSample && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Low sample</span>
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2.5 tabular-nums">
                    <span className="text-muted-foreground">{row.tradeCount === 0 ? "—" : `${row.tradeCount} trd`}</span>
                    <span className="text-muted-foreground">{pct(row.winRatePct)}</span>
                    <span className={`font-semibold ${toneClass(row.netPnl)}`}>{row.tradeCount === 0 ? "—" : money(row.netPnl)}</span>
                  </div>
                </Wrapper>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
