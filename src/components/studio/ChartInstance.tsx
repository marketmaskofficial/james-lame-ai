import { useEffect, type ReactNode } from "react";
import { subscribeKlines, type LiveStatus } from "@/lib/live-feed";
import type { Bar } from "@/lib/sgscript/types";

type ChartInstanceProps = {
  /**
   * Stable identity of this chart within the workspace tree — the same
   * `WidgetInstance.instanceId` the chart's leaf already carries. UI-4g-1
   * has exactly one chart instance, so this doesn't change subscription
   * behavior yet; it exists so the effect below is keyed per-instance from
   * day one, ready for UI-4g-2's second chart without another rewrite here.
   */
  instanceId: string;
  symbol: string;
  interval: string;
  live: boolean;
  onLiveBar: (bar: Bar) => void;
  onStatusChange: (status: LiveStatus) => void;
  children: ReactNode;
};

/**
 * Owns the live-tick WebSocket subscription for one chart instance —
 * relocated here (UI-4g-1) from studio.tsx's former page-level effect, which
 * assumed there was only ever one chart to subscribe for. `subscribeKlines`
 * itself (src/lib/live-feed.ts) has no shared/module-level connection state,
 * so multiple ChartInstances can each own an independent subscription later
 * without any change here.
 *
 * Deliberately does NOT take ownership of `bars`/drawings/backtest overlay
 * data — those stay exactly where they already work correctly today
 * (studio.tsx), reported into this component as the `children` it renders
 * unchanged. Only the subscribe/unsubscribe lifecycle relocates; StudioChart
 * still receives `bars` as a plain prop from its existing call site.
 */
export function ChartInstance({
  instanceId,
  symbol,
  interval,
  live,
  onLiveBar,
  onStatusChange,
  children,
}: ChartInstanceProps) {
  useEffect(() => {
    if (!live) {
      onStatusChange("offline");
      return;
    }
    onStatusChange("connecting");
    const stop = subscribeKlines(symbol, interval, {
      onStatus: onStatusChange,
      onBar: onLiveBar,
    });
    return stop;
    // Same dependency set as the page-level effect this replaced
    // (symbol/interval/live only) — onLiveBar/onStatusChange are expected to
    // be stable (useCallback/useState setters) from the caller, and
    // instanceId doesn't change for a mounted instance, so including either
    // would just risk spurious resubscribes without changing behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, live]);

  return <>{children}</>;
}
