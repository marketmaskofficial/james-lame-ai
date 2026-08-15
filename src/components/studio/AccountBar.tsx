import { useState } from "react";
import { ChevronDown, Loader2, Pencil, Plug, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AccountSnapshot, TradingAccount } from "@/lib/trading/types";

const money = (n: number, ccy = "USD") =>
  `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 2,
  })}`;

/** Environment badge — paper/demo/live must never be mistaken for each other. */
export function EnvBadge({ env, className = "" }: { env: string; className?: string }) {
  const label = env.toUpperCase();
  const tone =
    env === "live"
      ? "border-red-500 bg-red-500/15 text-red-300"
      : env === "demo"
        ? "border-sky-500/50 bg-sky-500/10 text-sky-300"
        : "border-amber-500/50 bg-amber-500/10 text-amber-300";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${tone} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * Account switcher + summary for the studio header. Trading always targets the
 * account selected here — nothing is ever implied.
 */
export function AccountBar({
  accounts,
  activeId,
  snapshot,
  busy,
  onSelect,
  onCreate,
  onReset,
  onDelete,
  onOpenBrokers,
  onRename,
}: {
  accounts: TradingAccount[];
  activeId: string | null;
  snapshot: AccountSnapshot | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (input: { label: string; startingBalance: number }) => void;
  onReset: () => void;
  onDelete: (id: string) => void;
  onOpenBrokers: () => void;
  onRename?: (input: { id: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("My Futures Demo");
  const [balance, setBalance] = useState("50000");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const active =
    accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;
  const acct = snapshot?.account ?? active;
  const equity = acct ? Number(acct.balance) + (snapshot?.openPnl ?? 0) : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-brand"
        title="Trading account"
      >
        <EnvBadge env={acct?.environment ?? "paper"} />
        <span className="max-w-[140px] truncate">{acct?.label ?? "No account"}</span>
        <span className="font-mono text-muted-foreground">
          {equity === null ? "—" : money(equity, acct?.currency)}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-border bg-popover p-2 text-[11px] shadow-xl">
          <div className="mb-1 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            Accounts
          </div>
          <div className="max-h-56 space-y-0.5 overflow-auto">
            {accounts.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent ${
                  a.id === active?.id ? "bg-accent/60" : ""
                }`}
              >
                {renamingId === a.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameValue.trim()) {
                        onRename?.({ id: a.id, label: renameValue.trim() });
                        setRenamingId(null);
                      }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => {
                      if (renameValue.trim() && renameValue.trim() !== a.label)
                        onRename?.({ id: a.id, label: renameValue.trim() });
                      setRenamingId(null);
                    }}
                    className="flex-1 rounded border border-brand bg-background px-1 py-0.5 text-[11px] outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      onSelect(a.id);
                      setOpen(false);
                    }}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <EnvBadge env={a.environment} />
                    <span className="flex-1 truncate">{a.label}</span>
                    <span className="font-mono text-muted-foreground">
                      {money(Number(a.balance), a.currency)}
                    </span>
                  </button>
                )}
                {onRename && renamingId !== a.id && (
                  <button
                    title="Rename account"
                    onClick={() => {
                      setRenamingId(a.id);
                      setRenameValue(a.label);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                {a.environment === "paper" && accounts.length > 1 && (
                  <button
                    title="Delete paper account"
                    onClick={() => onDelete(a.id)}
                    className="text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}

          </div>

          {/* summary */}
          {snapshot && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-md border border-border bg-card/60 p-2 font-mono">
              <Stat label="Balance" value={money(Number(snapshot.account.balance), snapshot.account.currency)} />
              <Stat
                label="Open P&L"
                value={money(snapshot.openPnl, snapshot.account.currency)}
                tone={snapshot.openPnl >= 0 ? "up" : "down"}
              />
              <Stat
                label="Daily P&L"
                value={money(snapshot.dailyPnl, snapshot.account.currency)}
                tone={snapshot.dailyPnl >= 0 ? "up" : "down"}
              />
              <Stat label="Positions" value={String(snapshot.positions.length)} />
              <Stat label="Buying power" value="unavailable" />
              <Stat label="Realized" value={money(Number(snapshot.account.realized_pnl), snapshot.account.currency)} />
            </div>
          )}

          {creating ? (
            <div className="mt-2 space-y-1.5 rounded-md border border-border p-2">
              <label className="block">
                <span className="text-[9px] uppercase text-muted-foreground">Account name</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
                />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase text-muted-foreground">Starting balance (USD)</span>
                <input
                  type="number"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
                />
              </label>
              <div className="flex gap-1.5">
                <button
                  disabled={busy || !label.trim() || Number(balance) <= 0}
                  onClick={() => {
                    onCreate({ label: label.trim(), startingBalance: Number(balance) });
                    setCreating(false);
                  }}
                  className="flex-1 rounded bg-brand px-2 py-1 text-[11px] font-semibold text-brand-foreground disabled:opacity-40"
                >
                  {busy ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : "Create paper account"}
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                onClick={() => setCreating(true)}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent"
              >
                <Plus className="h-3 w-3" /> New paper
              </button>
              <button
                onClick={() => {
                  if (
                    active &&
                    window.confirm(
                      `Reset "${active.label}"? This clears simulated positions, orders, executions and P&L.`,
                    )
                  )
                    onReset();
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1 hover:bg-accent"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
          )}

          <button
            onClick={() => {
              setOpen(false);
              onOpenBrokers();
            }}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plug className="h-3 w-3" /> Broker connections
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : ""
        }
      >
        {value}
      </div>
    </div>
  );
}
