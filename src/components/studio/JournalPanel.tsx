import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  deleteJournalEntry,
  listJournal,
  saveJournalEntry,
} from "@/lib/journal.functions";

/** Trade journal: notes per symbol/account, ready to be linked to positions. */
export function JournalPanel({
  accountId,
  symbol,
  timeframe,
  signedIn,
}: {
  accountId: string | null;
  symbol: string;
  timeframe: string;
  signedIn: boolean;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const journal = useQuery({
    queryKey: ["journal", accountId],
    queryFn: () => listJournal({ data: accountId ? { accountId } : {} }),
    enabled: signedIn,
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["journal", accountId] });

  const save = useMutation({
    mutationFn: () =>
      saveJournalEntry({
        data: {
          accountId: accountId ?? undefined,
          symbol,
          timeframe,
          notes: notes.trim(),
        },
      }),
    onSuccess: () => {
      setNotes("");
      setError(null);
      invalidate();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not save entry"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteJournalEntry({ data: { id } }),
    onSuccess: invalidate,
  });

  if (!signedIn) {
    return (
      <div className="p-4 text-center text-[11px] text-muted-foreground">
        Sign in to keep a trade journal.
      </div>
    );
  }

  const rows = journal.data ?? [];

  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 shrink-0 space-y-1.5 border-r border-border p-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          New entry · {symbol} · {timeframe}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Setup, execution, mistakes, what to repeat…"
          className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
        />
        <button
          disabled={!notes.trim() || save.isPending}
          onClick={() => save.mutate()}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-brand py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
        >
          {save.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Add to journal
        </button>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {journal.isLoading && (
          <p className="text-[11px] text-muted-foreground">Loading journal…</p>
        )}
        {!journal.isLoading && rows.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No journal entries yet.
          </p>
        )}
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded border border-border bg-card p-2 text-[11px]"
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono text-foreground">{r.symbol}</span>
                {r.timeframe && <span>{r.timeframe}</span>}
                {r.realized_pnl !== null && (
                  <span
                    className={
                      Number(r.realized_pnl) >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {Number(r.realized_pnl).toFixed(2)}
                  </span>
                )}
                <span className="ml-auto">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                <button
                  onClick={() => remove.mutate(r.id)}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{r.notes}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
