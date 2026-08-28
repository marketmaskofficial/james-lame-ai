/**
 * One reusable metric tile for the Trading Dashboard (Phase 4A). Matches the
 * existing `Stat` convention already used on `/account` and in Chart
 * Studio's `AccountBar` (`rounded border bg-card`, bold value over a small
 * uppercase muted label) rather than introducing a new visual pattern.
 * Positive values are green, negative are red, neutral values use the
 * ordinary foreground color — Signal Goat's brand yellow is reserved for
 * selection/accent elsewhere (the active account/date-range control), never
 * used here for a metric value.
 */
export type MetricTone = "positive" | "negative" | "neutral";

export function MetricCard({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  sub?: string;
}) {
  const toneClass = tone === "positive" ? "text-emerald-400" : tone === "negative" ? "text-red-400" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className={`truncate text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Tone from a signed number — the common case (P&L-flavored metrics). */
export function toneOf(n: number | null): MetricTone {
  if (n == null) return "neutral";
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "neutral";
}
