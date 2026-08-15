import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  connectTradovate,
  disconnectBroker,
  importBrokerAccount,
  listBrokerConnections,
  verifyBrokerConnection,
} from "@/lib/brokers.functions";

type BrokerAccountLite = {
  brokerAccountId: string;
  label: string;
  accountNumber: string;
  currency: string;
  balance: number | null;
  equity: number | null;
};

const FIELDS = [
  { key: "name", label: "Username", type: "text", hint: "Your Tradovate login" },
  { key: "password", label: "Password", type: "password", hint: "" },
  { key: "appId", label: "App ID", type: "text", hint: "e.g. Signal Goat" },
  { key: "appVersion", label: "App version", type: "text", hint: "e.g. 1.0" },
  { key: "cid", label: "API key (cid)", type: "text", hint: "Tradovate → API Access" },
  { key: "sec", label: "API secret (sec)", type: "password", hint: "" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function BrokerConnections({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listBrokerConnections);
  const connect = useServerFn(connectTradovate);
  const verify = useServerFn(verifyBrokerConnection);
  const importAcct = useServerFn(importBrokerAccount);
  const disconnect = useServerFn(disconnectBroker);

  const [form, setForm] = useState<Record<FieldKey, string>>({
    name: "",
    password: "",
    appId: "Signal Goat",
    appVersion: "1.0",
    cid: "",
    sec: "",
  });
  const [showForm, setShowForm] = useState(false);
  const [accounts, setAccounts] = useState<
    { connectionId: string; rows: BrokerAccountLite[] } | null
  >(null);

  const connections = useQuery({
    queryKey: ["broker-connections"],
    queryFn: () => list(),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["broker-connections"] });
    void qc.invalidateQueries({ queryKey: ["trading"] });
  };

  const connectMutation = useMutation({
    mutationFn: () =>
      connect({ data: { environment: "demo" as const, credentials: form } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        refresh();
        return;
      }
      toast.success("Tradovate Demo connected");
      setAccounts({
        connectionId: res.connection.id,
        rows: res.accounts as unknown as BrokerAccountLite[],
      });
      setShowForm(false);
      setForm((f) => ({ ...f, password: "", sec: "" }));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: (connectionId: string) => verify({ data: { connectionId } }),
    onSuccess: (res, connectionId) => {
      if (!res.ok) {
        toast.error(res.error);
        refresh();
        return;
      }
      setAccounts({
        connectionId,
        rows: res.accounts as unknown as BrokerAccountLite[],
      });
      toast.success(`${res.accounts.length} broker account(s) found`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMutation = useMutation({
    mutationFn: (v: { connectionId: string; brokerAccountId: string }) =>
      importAcct({ data: v }),
    onSuccess: () => {
      toast.success("Broker account added to your account switcher");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) => disconnect({ data: { connectionId } }),
    onSuccess: () => {
      setAccounts(null);
      toast.success("Disconnected");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = connections.data?.connections ?? [];
  const tradovate = rows.find((c) => c.broker === "tradovate");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-popover p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Broker connections</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Signal Goat routes every order through its own OMS, so a connected broker
          uses the same ticket, positions and history you already see.
        </p>

        <div className="mt-3 space-y-2">
          {/* Paper */}
          <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
            <div className="flex-1">
              <div className="text-xs font-medium">Signal Goat Paper</div>
              <div className="text-[11px] text-muted-foreground">Simulated</div>
            </div>
            <span className="text-[11px] text-emerald-400">Connected</span>
          </div>

          {/* Tradovate */}
          <div className="rounded-md border border-border bg-card p-2.5">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-xs font-medium">
                  Tradovate
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] uppercase text-amber-400">
                    Beta · Demo only
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground">
                  {tradovate
                    ? tradovate.status === "connected"
                      ? "Authenticated with Tradovate Demo"
                      : (tradovate.last_error ?? tradovate.status)
                    : "Futures — real demo routing"}
                </div>
              </div>
              {tradovate ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => verifyMutation.mutate(tradovate.id)}
                    disabled={verifyMutation.isPending}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:bg-accent"
                  >
                    {verifyMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                    Verify
                  </button>
                  <button
                    onClick={() => disconnectMutation.mutate(tradovate.id)}
                    className="rounded-md border border-border p-1 text-muted-foreground hover:bg-accent"
                    title="Disconnect"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowForm((v) => !v)}
                  className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground"
                >
                  <Plug className="h-3 w-3" /> Connect
                </button>
              )}
            </div>

            {(showForm || (tradovate && tradovate.status !== "connected")) && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </span>
                    <input
                      type={f.type}
                      value={form[f.key]}
                      autoComplete="off"
                      onChange={(e) =>
                        setForm((s) => ({ ...s, [f.key]: e.target.value }))
                      }
                      placeholder={f.hint}
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  </label>
                ))}
                <button
                  onClick={() => connectMutation.mutate()}
                  disabled={
                    connectMutation.isPending ||
                    FIELDS.some((f) => !form[f.key].trim())
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {connectMutation.isPending && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  Connect Tradovate Demo
                </button>
                <p className="text-[10px] text-muted-foreground">
                  Credentials are encrypted on the server and never sent back to the
                  browser. Get your API key (cid/sec) from Tradovate → Application
                  Settings → API Access.
                </p>
              </div>
            )}

            {accounts && tradovate && accounts.connectionId === tradovate.id && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Broker accounts
                </div>
                {accounts.rows.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Tradovate returned no accounts for this login.
                  </div>
                )}
                {accounts.rows.map((a) => (
                  <div
                    key={a.brokerAccountId}
                    className="flex items-center gap-2 rounded-md border border-border p-2"
                  >
                    <div className="flex-1">
                      <div className="text-xs font-medium">{a.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {a.accountNumber} ·{" "}
                        {a.balance === null
                          ? "balance unavailable"
                          : `${a.balance.toLocaleString()} ${a.currency}`}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        importMutation.mutate({
                          connectionId: accounts.connectionId,
                          brokerAccountId: a.brokerAccountId,
                        })
                      }
                      disabled={importMutation.isPending}
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">
          Live routing stays disabled until demo testing is signed off — only
          Tradovate Demo can place orders today.
        </p>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-md border border-border py-1.5 text-[11px] hover:bg-accent"
        >
          Close
        </button>
      </div>
    </div>
  );
}
