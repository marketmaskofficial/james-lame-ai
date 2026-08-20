import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2, Pencil, Trash2, X } from "lucide-react";
import {
  createAlert,
  deleteAlert,
  dismissNotification,
  listAlertNotifications,
  listAlerts,
  markNotificationsRead,
  toggleAlert,
  updateAlert,
} from "@/lib/alerts.functions";
import type { WidgetInstance, ChartInstanceOption } from "@/lib/workspace/types";

export type AlertsConfig = NonNullable<WidgetInstance["alertsConfig"]>;

export const DEFAULT_ALERTS_CONFIG: AlertsConfig = {
  boundChartInstanceId: "active",
};

type Condition = "above" | "below";

/**
 * Derived alert status — none of this is a stored column, all three states
 * come straight out of the two columns the `alerts` table already has
 * (`active`, `last_triggered_at`) plus its existing `cooldown_seconds`
 * re-arm window, so no migration was needed to add this distinction:
 *   - "disabled": user paused it (toggled off) and it has never fired.
 *   - "triggered": it fired, and is still inside its post-fire cooldown
 *     window (the same cooldown that already prevents duplicate re-inserts
 *     into `alert_notifications` on every subsequent cron poll — see
 *     src/routes/api/public/hooks/check-alerts.ts's existing
 *     `now - last < cooldown_seconds * 1000` guard, unchanged here).
 *   - "active": everything else — never fired yet, or fired and the
 *     cooldown has since elapsed so it's armed again.
 */
function alertStatus(a: {
  active: boolean;
  cooldown_seconds: number;
  last_triggered_at: string | null;
}): "active" | "triggered" | "disabled" {
  if (!a.active) return "disabled";
  if (a.last_triggered_at) {
    const sinceMs = Date.now() - new Date(a.last_triggered_at).getTime();
    if (sinceMs < a.cooldown_seconds * 1000) return "triggered";
  }
  return "active";
}

const STATUS_DOT: Record<ReturnType<typeof alertStatus>, string> = {
  active: "bg-emerald-400",
  triggered: "bg-amber-400 animate-pulse",
  disabled: "bg-muted-foreground",
};

export type { ChartInstanceOption };

type Props = {
  chartInstances: ChartInstanceOption[];
  activeChartInstanceId: string;
  config: AlertsConfig | undefined;
  onConfigChange: (next: AlertsConfig) => void;
  signedIn: boolean;
};

/**
 * Real, DB-backed price alerts (UI-4h-4 upgrade of the widget that already
 * shipped earlier — `public.alerts` / `public.alert_notifications`,
 * evaluated server-side against real Binance prices by the existing
 * `/api/public/hooks/check-alerts` cron hook; see that file for the
 * evaluation loop, unchanged by this pass). This upgrade adds: editing,
 * a derived active/triggered/disabled status, the recent-triggers feed
 * (the `alert_notifications` table and its list/mark-read/dismiss server
 * fns already existed but were never wired to any UI until now), and
 * bound-chart-instance targeting for the create-alert form's defaults,
 * same convention as Volume Profile/Watchlist (`boundChartInstanceId`,
 * `"active"` | a specific chart's instanceId).
 *
 * Deliberately only two condition types (price above / price below a
 * threshold) — "crosses above" / "crosses below" as truly distinct
 * edge-triggered conditions need the `alerts.condition` CHECK constraint
 * loosened to accept two more values, a real (if small) schema change this
 * pass wrote as a migration file but did NOT apply against the live
 * Supabase project; see the migration under supabase/migrations and the
 * task report for exactly what it does and why it's pending approval
 * rather than applied. Shipping a selector that would fail against the
 * live constraint would be worse than not offering it yet.
 */
export function AlertsSidePanel({
  chartInstances,
  activeChartInstanceId,
  config,
  onConfigChange,
  signedIn,
}: Props) {
  const cfg = config ?? DEFAULT_ALERTS_CONFIG;
  const boundInstanceId =
    cfg.boundChartInstanceId !== "active" &&
    chartInstances.some((c) => c.instanceId === cfg.boundChartInstanceId)
      ? cfg.boundChartInstanceId
      : activeChartInstanceId;
  const bound = chartInstances.find((c) => c.instanceId === boundInstanceId);
  const boundSymbol = bound?.symbol ?? "";
  const boundLastPrice = bound?.bars.at(-1)?.close ?? null;

  const qc = useQueryClient();
  const [symbol, setSymbol] = useState(boundSymbol);
  const [condition, setCondition] = useState<Condition>("above");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCondition, setEditCondition] = useState<Condition>("above");
  const [editThreshold, setEditThreshold] = useState("");

  // Follow the bound chart's symbol unless the user has already typed
  // something else into the create-alert field this session.
  const [symbolTouched, setSymbolTouched] = useState(false);
  const effectiveSymbol = symbolTouched ? symbol : boundSymbol;

  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: () => listAlerts(),
    enabled: signedIn,
  });
  const notificationsQuery = useQuery({
    queryKey: ["alert-notifications"],
    queryFn: () => listAlertNotifications(),
    enabled: signedIn,
    refetchInterval: 60_000,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["alerts"] });
  const invalidateNotifications = () =>
    void qc.invalidateQueries({ queryKey: ["alert-notifications"] });

  const create = useMutation({
    mutationFn: (v: { symbol: string; condition: Condition; threshold: number }) =>
      createAlert({ data: v }),
    onSuccess: () => {
      setThreshold("");
      setError(null);
      invalidate();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not create alert"),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleAlert({ data: v }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAlert({ data: { id } }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; condition: Condition; threshold: number }) =>
      updateAlert({ data: v }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not update alert"),
  });
  const markRead = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: invalidateNotifications,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissNotification({ data: { id } }),
    onSuccess: invalidateNotifications,
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  if (!signedIn) {
    return (
      <div className="p-3 text-[11px] text-muted-foreground">
        Sign in to create price alerts.
      </div>
    );
  }

  const rows = alertsQuery.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <Bell className="h-3.5 w-3.5 text-brand" /> Alerts
          {unreadCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 py-px text-[9px] font-semibold text-brand-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        {chartInstances.length > 1 && (
          <select
            title="Which chart's symbol the create-alert form defaults to"
            value={cfg.boundChartInstanceId}
            onChange={(e) => onConfigChange({ ...cfg, boundChartInstanceId: e.target.value })}
            className="h-6 rounded-[6px] border border-border bg-card px-1 text-[10px] outline-none focus:border-brand"
          >
            <option value="active">Active chart</option>
            {chartInstances.map((c) => (
              <option key={c.instanceId} value={c.instanceId}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-1.5 border-b border-border p-2">
        <div className="text-[10px] text-muted-foreground">
          New alert {bound ? `→ ${bound.label}` : ""}
        </div>
        <input
          value={effectiveSymbol}
          onChange={(e) => {
            setSymbolTouched(true);
            setSymbol(e.target.value.toUpperCase());
          }}
          placeholder="Symbol"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] uppercase outline-none focus:border-brand"
        />
        <div className="flex gap-1">
          {(["above", "below"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCondition(c)}
              className={`flex-1 rounded border px-2 py-1 text-[11px] capitalize ${
                condition === c
                  ? "border-brand text-brand"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder={boundLastPrice ? String(boundLastPrice) : "Price"}
          inputMode="decimal"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
        />
        <button
          disabled={create.isPending}
          onClick={() => {
            const value = Number(threshold || boundLastPrice);
            if (!effectiveSymbol) {
              setError("Enter a symbol");
              return;
            }
            if (!Number.isFinite(value) || value <= 0) {
              setError("Enter a valid price");
              return;
            }
            create.mutate({ symbol: effectiveSymbol, condition, threshold: value });
          }}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-brand py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Create alert
        </button>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {alertsQuery.isLoading && (
          <p className="text-[11px] text-muted-foreground">Loading alerts…</p>
        )}
        {!alertsQuery.isLoading && rows.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No alerts yet.</p>
        )}
        <ul className="space-y-1">
          {rows.map((a) => {
            const status = alertStatus(a);
            if (editingId === a.id) {
              return (
                <li
                  key={a.id}
                  className="space-y-1 rounded border border-brand bg-card px-2 py-1.5 text-[11px]"
                >
                  <div className="flex gap-1">
                    {(["above", "below"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditCondition(c)}
                        className={`flex-1 rounded border px-2 py-0.5 text-[10px] capitalize ${
                          editCondition === c
                            ? "border-brand text-brand"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <input
                    value={editThreshold}
                    onChange={(e) => setEditThreshold(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        const value = Number(editThreshold);
                        if (!Number.isFinite(value) || value <= 0) {
                          setError("Enter a valid price");
                          return;
                        }
                        update.mutate({ id: a.id, condition: editCondition, threshold: value });
                      }}
                      className="flex-1 rounded bg-brand py-1 text-[10px] font-medium text-brand-foreground"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 rounded border border-border py-1 text-[10px] text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={a.id}
                className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px]"
              >
                <button
                  onClick={() => toggle.mutate({ id: a.id, active: !a.active })}
                  title={
                    status === "triggered"
                      ? "Triggered — click to re-arm"
                      : a.active
                        ? "Pause alert"
                        : "Activate alert"
                  }
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                />
                <span className="flex-1 truncate">
                  {a.symbol}{" "}
                  <span className="text-muted-foreground">{a.condition}</span>{" "}
                  <span className="font-mono">{Number(a.threshold)}</span>
                  {status === "triggered" && (
                    <span className="ml-1 rounded bg-amber-400/20 px-1 text-[9px] text-amber-500">
                      triggered
                    </span>
                  )}
                  {status === "disabled" && (
                    <span className="ml-1 text-[9px] text-muted-foreground">disabled</span>
                  )}
                </span>
                <button
                  onClick={() => {
                    setEditingId(a.id);
                    setEditCondition(a.condition as Condition);
                    setEditThreshold(String(a.threshold));
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => remove.mutate(a.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>

        {notifications.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Recent triggers
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markRead.mutate()}
                  className="text-[10px] text-brand hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] ${
                    n.read ? "border-border" : "border-brand/60 bg-brand/5"
                  }`}
                >
                  <span className="flex-1 truncate">
                    {n.symbol} {n.condition} <span className="font-mono">{Number(n.threshold)}</span>{" "}
                    <span className="text-muted-foreground">
                      @ {Number(n.triggered_price)} · {new Date(n.triggered_at).toLocaleString()}
                    </span>
                  </span>
                  <button
                    onClick={() => dismiss.mutate(n.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
