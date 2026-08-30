import { LineChart } from "lucide-react";

/**
 * Phase 5A-1 — Live Preview region, SHELL ONLY.
 *
 * Deliberately does NOT import `StudioChart`, `lightweight-charts`, or any
 * market-data fetcher — per the Phase 5A audit's "one canonical chain"
 * rule, the real preview (Phase 5A-4) must mount the SAME renderer Chart
 * Studio uses, never a second implementation. Faking candles or a
 * decorative chart here would be exactly the kind of second rendering
 * system that rule exists to prevent, so this shell shows only an honest
 * empty state instead.
 */
export function PreviewPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Live Preview</span>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <span>Symbol —</span>
          <span aria-hidden="true">·</span>
          <span>Timeframe —</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
        <LineChart className="h-5 w-5 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Chart preview will appear after a successful build.</p>
      </div>
    </div>
  );
}
