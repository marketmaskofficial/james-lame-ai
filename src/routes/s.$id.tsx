import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Copy, Check, Download, MessageSquare } from "lucide-react";
import { getPublicScript } from "@/lib/scripts.functions";

const scriptQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["public-script", id],
    queryFn: () => getPublicScript({ data: { id } }),
  });

export const Route = createFileRoute("/s/$id")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(scriptQueryOptions(params.id));
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const title = loaderData?.script.title
      ? `${loaderData.script.title} — Signal Goat AI`
      : "Shared script — Signal Goat AI";
    const desc = "A Pine Script indicator built with Signal Goat AI.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ShareView,
  errorComponent: ({ error }) => (
    <ShareShell>
      <p className="text-sm text-muted-foreground">
        Could not load this script: {error.message}
      </p>
    </ShareShell>
  ),
  notFoundComponent: () => (
    <ShareShell>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This script is private or does not exist.
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-brand hover:underline">
        Go home
      </Link>
    </ShareShell>
  ),
});

function ShareView() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(scriptQueryOptions(id));
  if (!data) return null;
  const { script, messages } = data;
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!script.code) return;
    await navigator.clipboard.writeText(script.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadPine = () => {
    const filename = `${(script.title || "signal-goat").replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.pine`;
    const blob = new Blob([script.code ?? ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ShareShell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-brand">Shared Pine Script</div>
          <h1 className="mt-1 truncate text-2xl font-bold">{script.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Updated {new Date(script.updated_at).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={copyCode}
            disabled={!script.code}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={downloadPine}
            disabled={!script.code}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> .pine
          </button>
        </div>
      </div>

      {script.code ? (
        <pre className="max-h-[520px] overflow-auto rounded-lg border border-border bg-card p-4 text-xs leading-relaxed">
          <code className="whitespace-pre font-mono">{script.code}</code>
        </pre>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No code generated yet.
        </div>
      )}

      {messages.length > 0 && (
        <details className="mt-8 rounded-lg border border-border bg-card p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-brand" />
            Conversation ({messages.length} messages)
          </summary>
          <div className="mt-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className="text-sm">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {m.role}
                </div>
                <div className="mt-1 whitespace-pre-wrap rounded-md bg-background/60 p-3 text-xs leading-relaxed">
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-10 rounded-xl border border-brand/40 bg-brand/5 p-6 text-center">
        <h2 className="text-lg font-semibold">Build your own trading indicators with AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe a strategy, let Signal Goat AI write the Pine Script.
        </p>
        <Link
          to="/app"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:opacity-90"
        >
          Try Signal Goat AI
        </Link>
      </div>
    </ShareShell>
  );
}

function ShareShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand font-black text-brand-foreground">G</div>
            <span className="text-sm font-semibold tracking-tight">Signal Goat AI</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}
