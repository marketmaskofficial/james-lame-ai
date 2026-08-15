import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2, Trash2 } from "lucide-react";
import {
  createAlert,
  deleteAlert,
  listAlerts,
  toggleAlert,
} from "@/lib/alerts.functions";

/** Price alerts for the chart's symbol. Alerts are evaluated server-side. */
export function AlertsSidePanel({
  symbol,
  lastPrice,
  signedIn,
}: {
  symbol: string;
  lastPrice: number | null;
  signedIn: boolean;
}) {
  const qc = useQueryClient();
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: () => listAlerts(),
    enabled: signedIn,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["alerts"] });

  const create = useMutation({
    mutationFn: (v: { symbol: string; condition: "above" | "below"; threshold: number }) =>
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
      <div className="space-y-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <Bell className="h-3.5 w-3.5 text-brand" /> Alert on {symbol}
        </div>
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
          placeholder={lastPrice ? String(lastPrice) : "Price"}
          inputMode="decimal"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
        />
        <button
          disabled={create.isPending}
          onClick={() => {
            const value = Number(threshold || lastPrice);
            if (!Number.isFinite(value) || value <= 0) {
              setError("Enter a valid price");
              return;
            }
            create.mutate({ symbol, condition, threshold: value });
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
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px]"
            >
              <button
                onClick={() => toggle.mutate({ id: a.id, active: !a.active })}
                title={a.active ? "Pause alert" : "Activate alert"}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  a.active ? "bg-emerald-400" : "bg-muted-foreground"
                }`}
              />
              <span className="flex-1 truncate">
                {a.symbol}{" "}
                <span className="text-muted-foreground">{a.condition}</span>{" "}
                <span className="font-mono">{Number(a.threshold)}</span>
              </span>
              <button
                onClick={() => remove.mutate(a.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
