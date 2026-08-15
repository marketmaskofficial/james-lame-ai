import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FeedbackButton } from "@/components/FeedbackButton";

import {
  MessageSquarePlus,
  Sparkles,
  Bell,
  History,
  Image as ImageIcon,
  ArrowUp,
  ChevronsLeft,
  LineChart,
  Code2,
  RefreshCw,
  LogOut,
  Trash2,
  User as UserIcon,
  Share2,
  Check,
  Copy,
  Download,
  Lock,
  Crown,
  Star,
  X,
  BarChart3,
  Play,
  TrendingUp,
  TrendingDown,
  Paperclip,
  FileCode,
  CandlestickChart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import {
  listScripts,
  createScript,
  deleteScript,
  listMessages,
  appendTurn,
  setScriptPublic,
} from "@/lib/scripts.functions";
import {
  listWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlists.functions";
import {
  listAlerts,
  createAlert,
  toggleAlert,
  deleteAlert,
  listAlertNotifications,
  markNotificationsRead,
  dismissNotification,
} from "@/lib/alerts.functions";
import { runBacktest } from "@/lib/backtest.functions";
import { analyzeIndicator, type AnalyzeResult } from "@/lib/analyze.functions";
import { setStudioHandoff } from "@/lib/studio-handoff";



const FREE_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);
const FREE_INTERVALS = new Set(["15m", "1h", "1d"]);
const FREE_HISTORY_LIMIT = 5;

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Signal Goat AI — Chat & iterate on Pine Script" },
      {
        name: "description",
        content:
          "Chat with Signal Goat AI to build and refine TradingView Pine Script indicators, with live BTC preview.",
      },
    ],
  }),
  component: Index,
});

type ChatMsg = { role: "user" | "assistant"; content: string; images?: string[] };

function extractCode(text: string): string | null {
  // Closed fenced block.
  const closed = text.match(/```(?:pinescript|pine)?\s*\n([\s\S]*?)```/i);
  if (closed) return closed[1].trim();
  // Unclosed fence — stream in progress. Show whatever has arrived after the opener.
  const open = text.match(/```(?:pinescript|pine)?\s*\n([\s\S]*)$/i);
  if (open) return open[1].replace(/\s+$/, "");
  return null;
}

function Index() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isActive: isPro } = useSubscription();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"chart" | "code">("chart");
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const [interval, setIntervalStr] = useState<string>("15m");
  const [prompt, setPrompt] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  // Local turns for the in-flight session (also seeded from server on load).
  const [localMessages, setLocalMessages] = useState<ChatMsg[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<string>("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; content: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const codeFileInputRef = useRef<HTMLInputElement | null>(null);

  const listScriptsFn = useServerFn(listScripts);
  const createScriptFn = useServerFn(createScript);
  const deleteScriptFn = useServerFn(deleteScript);
  const listMessagesFn = useServerFn(listMessages);
  const appendTurnFn = useServerFn(appendTurn);
  const listWatchlistFn = useServerFn(listWatchlist);
  const addWatchlistFn = useServerFn(addToWatchlist);
  const removeWatchlistFn = useServerFn(removeFromWatchlist);

  const watchlistQuery = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => listWatchlistFn(),
    enabled: !!user,
  });

  const addWatchlistMut = useMutation({
    mutationFn: (sym: string) => addWatchlistFn({ data: { symbol: sym } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
  const removeWatchlistMut = useMutation({
    mutationFn: (sym: string) => removeWatchlistFn({ data: { symbol: sym } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const watchlist = watchlistQuery.data ?? [];
  const isStarred = watchlist.some((w) => w.symbol === symbol);
  const toggleStar = () => {
    if (!user) return;
    if (isStarred) removeWatchlistMut.mutate(symbol);
    else addWatchlistMut.mutate(symbol);
  };

  const listAlertsFn = useServerFn(listAlerts);
  const createAlertFn = useServerFn(createAlert);
  const toggleAlertFn = useServerFn(toggleAlert);
  const deleteAlertFn = useServerFn(deleteAlert);
  const listNotificationsFn = useServerFn(listAlertNotifications);
  const markNotificationsReadFn = useServerFn(markNotificationsRead);
  const dismissNotificationFn = useServerFn(dismissNotification);
  const runBacktestFn = useServerFn(runBacktest);
  const analyzeFn = useServerFn(analyzeIndicator);

  const openAnalyze = async () => {
    if (!latestCode) return;
    setShowAnalyze(true);
    setAnalyzeError(null);
    setAnalyzeResult(null);
    setAnalyzeLoading(true);
    try {
      const res = await analyzeFn({
        data: { code: latestCode, symbol, interval: interval as "1m" | "5m" | "15m" | "1h" | "4h" | "1d" },
      });
      setAnalyzeResult(res);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: () => listAlertsFn(),
    enabled: !!user,
  });
  const notificationsQuery = useQuery({
    queryKey: ["alert-notifications"],
    queryFn: () => listNotificationsFn(),
    enabled: !!user,
    refetchInterval: 30_000,
  });
  const unreadCount =
    notificationsQuery.data?.filter((n) => !n.read).length ?? 0;

  const createAlertMut = useMutation({
    mutationFn: (input: {
      symbol: string;
      condition: "above" | "below";
      threshold: number;
    }) => createAlertFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const toggleAlertMut = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      toggleAlertFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const deleteAlertMut = useMutation({
    mutationFn: (id: string) => deleteAlertFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const dismissNotifMut = useMutation({
    mutationFn: (id: string) => dismissNotificationFn({ data: { id } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["alert-notifications"] }),
  });

  const historyQuery = useQuery({
    queryKey: ["scripts"],
    queryFn: () => listScriptsFn(),
    enabled: !!user,
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", activeScriptId],
    queryFn: () =>
      listMessagesFn({ data: { scriptId: activeScriptId as string } }),
    enabled: !!user && !!activeScriptId,
  });

  // Seed local messages when switching scripts.
  useEffect(() => {
    if (messagesQuery.data) {
      setLocalMessages(
        messagesQuery.data.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      );
      setStreamingAssistant("");
    }
  }, [messagesQuery.data]);

  const createMut = useMutation({
    mutationFn: () => createScriptFn({ data: {} }),
    onSuccess: (row) => {
      setActiveScriptId(row.id);
      setLocalMessages([]);
      setStreamingAssistant("");
      qc.invalidateQueries({ queryKey: ["scripts"] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteScriptFn({ data: { id } }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["scripts"] });
      if (activeScriptId === id) {
        setActiveScriptId(null);
        setLocalMessages([]);
        setStreamingAssistant("");
      }
    },
  });

  // Derive the latest code shown in the right pane from the newest assistant message.
  const latestCode = useMemo(() => {
    const streamingCode = streamingAssistant ? extractCode(streamingAssistant) : null;
    if (streamingCode) return streamingCode;
    for (let i = localMessages.length - 1; i >= 0; i--) {
      if (localMessages[i].role === "assistant") {
        const c = extractCode(localMessages[i].content);
        if (c) return c;
      }
    }
    return "";
  }, [localMessages, streamingAssistant]);

  // When generation finishes and we have fresh code, jump straight to the code tab
  // (do NOT auto-open the backtest modal — user opens it manually via the Backtest button).
  const lastAutoRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!latestCode || latestCode.trim().length === 0) return;
    if (lastAutoRunRef.current === latestCode) return;
    lastAutoRunRef.current = latestCode;
    setTab("code");
  }, [loading, latestCode]);

  const threadRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [localMessages, streamingAssistant]);

  // Enforce free-tier limits: bounce non-Pro users off locked symbols/intervals.
  useEffect(() => {
    if (isPro) return;
    if (!FREE_SYMBOLS.has(symbol)) setSymbol("BTCUSDT");
    if (!FREE_INTERVALS.has(interval)) setIntervalStr("15m");
  }, [isPro, symbol, interval]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    const imgs = pendingImages;
    const files = pendingFiles;
    if ((!trimmed && imgs.length === 0 && files.length === 0) || loading) return;
    if (!user) {
      setError("Sign in to chat with Signal Goat AI.");
      return;
    }
    setLoading(true);
    setError(null);
    setPrompt("");
    setPendingImages([]);
    setPendingFiles([]);
    setTab("code");

    // Build the effective text: user prompt + any attached code files as fenced blocks.
    const filesBlock = files.length
      ? "\n\n" +
        files
          .map(
            (f) =>
              `Attached file: ${f.name}\n\`\`\`pinescript\n${f.content}\n\`\`\``,
          )
          .join("\n\n") +
        "\n\nCombine / merge the attached code above with my request. Preserve every input, function, and structural element from the attached script unless I explicitly asked you to change it. Emit ONE complete merged Pine v6 script."
      : "";

    const baseText =
      trimmed ||
      (imgs.length > 0
        ? "Analyze this chart image: identify the setup, indicators, patterns, price action, and any signals visible. Then recreate the exact setup as a complete TradingView Pine Script v6 indicator."
        : files.length > 0
          ? "Review the attached Pine Script code, fix any issues, and improve it."
          : "");

    const effectiveText = baseText + filesBlock;

    // Ensure we have an active script.
    let scriptId = activeScriptId;
    if (!scriptId) {
      try {
        const row = await createScriptFn({ data: { title: (trimmed || files[0]?.name || "Chart image analysis").slice(0, 60) } });
        scriptId = row.id;
        setActiveScriptId(scriptId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start chat");
        setLoading(false);
        return;
      }
    }

    // Optimistic user turn (with image previews).
    const userMsg: ChatMsg = { role: "user", content: effectiveText, images: imgs.length ? imgs : undefined };
    const priorMessages = [...localMessages, userMsg];
    setLocalMessages(priorMessages);
    setStreamingAssistant("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sign in to generate indicators.");
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ messages: priorMessages }),
      });
      if (res.status === 401) throw new Error("Your session expired — sign in again.");
      if (res.status === 429) {
        const info = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(info?.message ?? "Too many requests — please wait a moment.");
      }
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamingAssistant(acc);
      }

      if (acc.trim()) {
        // Commit turn.
        setLocalMessages([
          ...priorMessages,
          { role: "assistant", content: acc },
        ]);
        setStreamingAssistant("");
        const code = extractCode(acc) ?? undefined;
        try {
          await appendTurnFn({
            data: {
              scriptId,
              userMessage: effectiveText + (imgs.length ? `\n[${imgs.length} image${imgs.length > 1 ? "s" : ""} attached]` : ""),
              assistantMessage: acc,
              code,
              titleIfEmpty: effectiveText.slice(0, 200) || "Chart image analysis",
            },
          });
          qc.invalidateQueries({ queryKey: ["scripts"] });
          qc.invalidateQueries({ queryKey: ["messages", scriptId] });
        } catch (e) {
          console.warn("failed to persist turn", e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
  };

  const startNewChat = () => {
    setActiveScriptId(null);
    setLocalMessages([]);
    setStreamingAssistant("");
    setPrompt("");
    setError(null);
    setShowHistory(false);
    setShowAlerts(false);
  };

  const isEmpty = localMessages.length === 0 && !streamingAssistant;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left rail */}
      <aside className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-border bg-sidebar py-4">
        <div className="flex flex-col items-center gap-4">
          <Link to="/" className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-black text-brand-foreground">
            G
          </Link>
          <RailIcon
            icon={<MessageSquarePlus className="h-5 w-5" />}
            active={!showHistory && !showAlerts && !activeScriptId}
            title="New chat"
            onClick={startNewChat}
          />
          <div className="relative">
            <RailIcon
              icon={<Bell className="h-5 w-5" />}
              active={showAlerts}
              title="Alerts"
              onClick={() => {
                setShowAlerts((v) => !v);
                setShowHistory(false);
              }}
            />
            {user && unreadCount > 0 && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-brand-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <RailIcon
            icon={<History className="h-5 w-5" />}
            active={showHistory}
            title="History"
            onClick={() => {
              setShowHistory((v) => !v);
              setShowAlerts(false);
            }}
          />

        </div>
        <div className="flex flex-col items-center gap-3">
          {user ? (
            <>
              {isPro ? (
                <div
                  title="Signal Goat AI Pro"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-brand text-brand-foreground"
                >
                  <Crown className="h-4 w-4" />
                </div>
              ) : (
                <Link
                  to="/pricing"
                  title="Upgrade to Pro"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-brand/40 text-brand hover:bg-brand/10"
                >
                  <Crown className="h-4 w-4" />
                </Link>
              )}
              <div
                title={user.email ?? ""}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-foreground"
              >
                {(user.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <button
                onClick={signOut}
                title="Sign out"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <Link to="/auth" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                Log In
              </Link>
              <Link to="/auth" className="rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90">
                Sign Up
              </Link>
            </>
          )}
        </div>
      </aside>

      {/* History panel */}
      {showHistory && (
        <section className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
            <span className="font-medium">History</span>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewChat}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="New chat"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {!user ? (
              <div className="p-4 text-xs text-muted-foreground">
                <Link to="/auth" className="text-brand hover:underline">Sign in</Link>{" "}
                to save and revisit your chats.
              </div>
            ) : historyQuery.isLoading ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : (historyQuery.data ?? []).length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                No chats yet. Start one to see it here.
              </div>
            ) : (
              <ul className="space-y-1">
                {(isPro
                  ? historyQuery.data!
                  : historyQuery.data!.slice(0, FREE_HISTORY_LIMIT)
                ).map((s) => (
                  <li key={s.id} className="group">
                    <div
                      className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-xs ${
                        activeScriptId === s.id ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setActiveScriptId(s.id);
                          setShowHistory(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate font-medium">{s.title}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {new Date(s.updated_at).toLocaleString()}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMut.mutate(s.id);
                        }}
                        className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
                {!isPro && historyQuery.data!.length > FREE_HISTORY_LIMIT && (
                  <li>
                    <Link
                      to="/pricing"
                      className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-brand/40 bg-brand/5 px-2 py-2 text-[11px] text-brand hover:bg-brand/10"
                    >
                      <Lock className="h-3 w-3" />
                      {historyQuery.data!.length - FREE_HISTORY_LIMIT} more hidden — Upgrade to Pro
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>
      )}

      {showAlerts && (
        <AlertsPanel
          user={!!user}
          currentSymbol={symbol}
          alerts={alertsQuery.data ?? []}
          notifications={notificationsQuery.data ?? []}
          onClose={() => setShowAlerts(false)}
          onCreate={(input) => createAlertMut.mutate(input)}
          creating={createAlertMut.isPending}
          onToggle={(id, active) => toggleAlertMut.mutate({ id, active })}
          onDelete={(id) => deleteAlertMut.mutate(id)}
          onDismissNotif={(id) => dismissNotifMut.mutate(id)}
          onMarkAllRead={() => {
            if (unreadCount === 0) return;
            markNotificationsReadFn().then(() =>
              qc.invalidateQueries({ queryKey: ["alert-notifications"] }),
            );
          }}
          onOpenSymbol={(sym) => {
            if (!isPro && !FREE_SYMBOLS.has(sym)) {
              window.location.href = "/pricing";
              return;
            }
            setSymbol(sym);
            setShowAlerts(false);
          }}
        />
      )}



      {/* Chat panel */}
      <section className="flex w-[440px] shrink-0 flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <button className="rounded-md bg-accent px-3 py-1 text-xs font-medium">Chat</button>
          </div>
          {activeScriptId && (
            <button
              onClick={startNewChat}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" /> New
            </button>
          )}
        </div>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              What do you want to create?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Describe a strategy or indicator. Refine it with follow-up messages.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Chip onClick={() => setPrompt("RSI(14) mean reversion with 200 EMA trend filter")}>
                RSI mean reversion
              </Chip>
              <Chip onClick={() => setPrompt("Bollinger Band squeeze breakout strategy")}>
                BB squeeze breakout
              </Chip>
              <Chip onClick={() => setPrompt("MACD + volume divergence alerts")}>
                MACD divergence
              </Chip>
            </div>
          </div>
        ) : (
          <div ref={threadRef} className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {localMessages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} images={m.images} />
            ))}
            {streamingAssistant && (
              <MessageBubble role="assistant" content={streamingAssistant} streaming />
            )}
          </div>
        )}

        <div className="border-t border-border p-3">
          {loading && (
            <div className="mb-2 overflow-hidden rounded-full bg-muted/60">
              <div className="loading-bar h-1.5 w-full rounded-full bg-brand" />
              <p className="mt-1 text-[11px] text-muted-foreground text-center">
                Generating Pine Script…
              </p>
            </div>
          )}
          <div className="rounded-2xl border border-border bg-card p-3 shadow-lg">
            {pendingImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingImages.map((src, i) => (
                  <div key={i} className="relative h-16 w-16 overflow-hidden rounded-md border border-border">
                    <img src={src} alt="attachment" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPendingImages((arr) => arr.filter((_, j) => j !== i))}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white hover:bg-black"
                      aria-label="Remove image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingFiles.map((f, i) => (
                  <div
                    key={i}
                    className="group relative flex items-center gap-2 rounded-md border border-border bg-background/60 py-1 pl-2 pr-6"
                  >
                    <FileCode className="h-3.5 w-3.5 text-brand" />
                    <span className="max-w-[160px] truncate text-xs">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {(f.content.length / 1024).toFixed(1)}kb
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((arr) => arr.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Remove file"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={async (e) => {
                const items = Array.from(e.clipboardData?.items ?? []);
                const files = items
                  .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
                  .map((it) => it.getAsFile())
                  .filter((f): f is File => !!f);
                if (files.length === 0) return;
                e.preventDefault();
                const dataUrls = await Promise.all(
                  files.map(
                    (f) =>
                      new Promise<string>((resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(r.result as string);
                        r.onerror = reject;
                        r.readAsDataURL(f);
                      }),
                  ),
                );
                setPendingImages((arr) => [...arr, ...dataUrls].slice(0, 6));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                isEmpty
                  ? "Ask for an indicator, or paste a chart image…"
                  : "Refine, ask a follow-up, or paste a chart image…"
              }
              rows={2}
              disabled={loading}
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex items-center justify-between pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length === 0) return;
                  const dataUrls = await Promise.all(
                    files.map(
                      (f) =>
                        new Promise<string>((resolve, reject) => {
                          const r = new FileReader();
                          r.onload = () => resolve(r.result as string);
                          r.onerror = reject;
                          r.readAsDataURL(f);
                        }),
                    ),
                  );
                  setPendingImages((arr) => [...arr, ...dataUrls].slice(0, 6));
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach chart image"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                <input
                  ref={codeFileInputRef}
                  type="file"
                  accept=".pine,.pinescript,.ps,.txt,.md,text/plain,application/octet-stream"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0) return;
                    const MAX_BYTES = 200_000;
                    const read = await Promise.all(
                      files.map(
                        (f) =>
                          new Promise<{ name: string; content: string }>((resolve, reject) => {
                            if (f.size > MAX_BYTES) {
                              reject(new Error(`${f.name} is too large (max 200KB)`));
                              return;
                            }
                            const r = new FileReader();
                            r.onload = () =>
                              resolve({ name: f.name, content: String(r.result ?? "") });
                            r.onerror = reject;
                            r.readAsText(f);
                          }),
                      ),
                    ).catch((err) => {
                      setError(err instanceof Error ? err.message : "Could not read file");
                      return [] as { name: string; content: string }[];
                    });
                    if (read.length) setPendingFiles((arr) => [...arr, ...read].slice(0, 4));
                    if (codeFileInputRef.current) codeFileInputRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => codeFileInputRef.current?.click()}
                  title="Attach code file (.pine, .txt) to combine with your request"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleSubmit}
                disabled={loading || (!prompt.trim() && pendingImages.length === 0 && pendingFiles.length === 0)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {loading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            Past performance is not indicative of future results.
          </p>
        </div>
      </section>

      {/* Main area: chart / code */}
      <main className="flex flex-1 flex-col min-w-0 bg-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md bg-card p-0.5">
              <button
                onClick={() => setTab("chart")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
                  tab === "chart" ? "bg-accent text-foreground" : "text-muted-foreground"
                }`}
              >
                <LineChart className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTab("code")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
                  tab === "code" ? "bg-accent text-foreground" : "text-muted-foreground"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={() => setShowBacktest(true)}
              title="Backtest a strategy on this symbol/timeframe"
              className="flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <BarChart3 className="h-3.5 w-3.5" /> Backtest
            </button>
            <button
              onClick={openAnalyze}
              disabled={!latestCode || analyzeLoading}
              title={
                latestCode
                  ? "Analyze this script against current market data"
                  : "Generate a script first"
              }
              className="flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" /> {analyzeLoading ? "Analyzing…" : "Analyze"}
            </button>
            <button
              onClick={() => {
                setStudioHandoff({
                  code: latestCode,
                  language: "pine",
                  symbol,
                  interval,
                });
                navigate({ to: "/studio" });
              }}
              disabled={!latestCode}
              title="Open this script in Chart Studio"
              className="flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CandlestickChart className="h-3.5 w-3.5" /> Chart Studio
            </button>

            <FeedbackButton
              page="chat"
              symbol={symbol}
              timeframe={interval}
              {...(activeScriptId ? { projectId: activeScriptId } : {})}
              className="flex items-center gap-1 rounded-md bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            />




            <div className="flex items-center gap-2 pl-2 text-sm">
              <span className="font-medium">
                {historyQuery.data?.find((s) => s.id === activeScriptId)?.title ??
                  "My script"}
              </span>
            </div>
          </div>
          <ShareBar
            scriptId={activeScriptId}
            code={latestCode}
            title={
              historyQuery.data?.find((s) => s.id === activeScriptId)?.title ?? null
            }
            isPublic={
              historyQuery.data?.find((s) => s.id === activeScriptId)?.is_public ?? false
            }
          />
        </div>

        <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <SymbolSelect value={symbol} onChange={setSymbol} isPro={isPro} />
            {user && (
              <button
                onClick={toggleStar}
                title={isStarred ? "Remove from watchlist" : "Add to watchlist"}
                className={`rounded-md p-1.5 transition-colors ${
                  isStarred
                    ? "text-amber-400 hover:bg-accent"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Star
                  className={`h-4 w-4 ${isStarred ? "fill-current" : ""}`}
                />
              </button>
            )}
            <IntervalSelect value={interval} onChange={setIntervalStr} isPro={isPro} />
            {!isPro && (
              <Link
                to="/pricing"
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/20"
              >
                <Crown className="h-3 w-3" /> Upgrade for all symbols & timeframes
              </Link>
            )}
          </div>
          {user && watchlist.length > 0 && (
            <WatchlistStrip
              items={watchlist}
              activeSymbol={symbol}
              isPro={isPro}
              onPick={(sym) => {
                if (!isPro && !FREE_SYMBOLS.has(sym)) {
                  window.location.href = "/pricing";
                  return;
                }
                setSymbol(sym);
              }}
              onRemove={(sym) => removeWatchlistMut.mutate(sym)}
            />
          )}
        </div>


        <div className="relative flex-1 overflow-hidden">
          {tab === "chart" ? (
            <ChartCanvas symbol={symbol} interval={interval} code={latestCode} loading={loading} />
          ) : (
            <CodeView text={latestCode} loading={loading && !latestCode} />
          )}
          <div className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground">
            UTC+0
          </div>
        </div>
      </main>

      {showBacktest && (
        <BacktestModal
          symbol={symbol}
          interval={interval}
          onClose={() => setShowBacktest(false)}
          run={(input) => runBacktestFn({ data: input })}
        />
      )}
      {showAnalyze && (
        <AnalyzeModal
          symbol={symbol}
          interval={interval}
          loading={analyzeLoading}
          error={analyzeError}
          result={analyzeResult}
          onClose={() => setShowAnalyze(false)}
          onRetry={openAnalyze}
        />
      )}
    </div>

  );
}

function MessageBubble({
  role,
  content,
  streaming,
  images,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  images?: string[];
}) {
  const isUser = role === "user";
  // Split assistant content around ```code``` blocks for readable rendering.
  const parts = isUser
    ? [{ type: "text" as const, text: content }]
    : splitAssistant(content);

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
          isUser ? "bg-brand text-brand-foreground" : "bg-accent text-foreground"
        }`}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : "G"}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? "bg-brand/15 text-foreground"
            : "bg-card text-foreground"
        }`}
      >
        {images && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="chart attachment"
                className="max-h-48 rounded-md border border-border object-contain"
              />
            ))}
          </div>
        )}
        {parts.map((p, i) =>
          p.type === "code" ? (
            <pre
              key={i}
              className="my-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] font-mono leading-relaxed"
            >
              <code className="whitespace-pre-wrap">{p.text}</code>
            </pre>
          ) : (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {p.text}
            </p>
          ),
        )}
        {streaming && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-brand align-middle" />
        )}
      </div>
    </div>
  );
}

function splitAssistant(text: string): Array<{ type: "text" | "code"; text: string }> {
  const out: Array<{ type: "text" | "code"; text: string }> = [];
  const re = /```(?:pinescript|pine)?\s*\n?([\s\S]*?)```/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const t = text.slice(last, m.index).trim();
      if (t) out.push({ type: "text", text: t });
    }
    out.push({ type: "code", text: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const t = text.slice(last).trim();
    if (t) out.push({ type: "text", text: t });
  }
  if (out.length === 0) out.push({ type: "text", text });
  return out;
}

function RailIcon({
  icon,
  active,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function ShareBar({
  scriptId,
  code,
  title,
  isPublic,
}: {
  scriptId: string | null;
  code: string;
  title: string | null;
  isPublic: boolean;
}) {
  const qc = useQueryClient();
  const setPublicFn = useServerFn(setScriptPublic);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const shareUrl =
    scriptId && typeof window !== "undefined"
      ? `${window.location.origin}/s/${scriptId}`
      : "";

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied("code");
    setTimeout(() => setCopied(null), 1500);
  };

  const downloadPine = () => {
    const filename = `${(title || "signal-goat").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "signal-goat"}.pine`;
    const blob = new Blob([code || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePublic = async () => {
    if (!scriptId) return;
    setBusy(true);
    try {
      await setPublicFn({ data: { id: scriptId, isPublic: !isPublic } });
      qc.invalidateQueries({ queryKey: ["scripts"] });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied("link");
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        onClick={copyCode}
        disabled={!code}
        title="Copy code"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        {copied === "code" ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />}
      </button>
      <button
        onClick={downloadPine}
        disabled={!code}
        title="Download .pine"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!scriptId}
        title="Share"
        className={`rounded-md p-1.5 hover:bg-accent hover:text-foreground disabled:opacity-40 ${
          isPublic ? "text-brand" : "text-muted-foreground"
        }`}
      >
        <Share2 className="h-4 w-4" />
      </button>
      {open && scriptId && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Share this script</div>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{isPublic ? "Public" : "Private"}</span>
              <button
                onClick={togglePublic}
                disabled={busy}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  isPublic ? "bg-brand" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                    isPublic ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isPublic
              ? "Anyone with the link can view the code and conversation."
              : "Turn on public sharing to generate a link."}
          </p>
          {isPublic && (
            <div className="mt-3 flex items-stretch gap-1.5">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
              />
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90"
              >
                {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "link" ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type WatchlistItem = {
  id: string;
  symbol: string;
  label: string | null;
  position: number;
  created_at: string;
};

function WatchlistStrip({
  items,
  activeSymbol,
  isPro,
  onPick,
  onRemove,
}: {
  items: WatchlistItem[];
  activeSymbol: string;
  isPro: boolean;
  onPick: (sym: string) => void;
  onRemove: (sym: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Watchlist
      </span>
      {items.map((w) => {
        const meta = SYMBOLS.find((s) => s.value === w.symbol);
        const locked = !isPro && !FREE_SYMBOLS.has(w.symbol);
        const active = w.symbol === activeSymbol;
        return (
          <span
            key={w.id}
            className={`group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              active
                ? "border-brand/60 bg-brand/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <button
              onClick={() => onPick(w.symbol)}
              className="flex items-center gap-1"
              title={locked ? "Upgrade to Pro" : w.symbol}
            >
              {meta && (
                <span
                  className="flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-bold text-black"
                  style={{ background: meta.color }}
                >
                  {meta.icon}
                </span>
              )}
              <span className="font-medium">{meta?.label ?? w.symbol}</span>
              {locked && <Lock className="h-2.5 w-2.5" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(w.symbol);
              }}
              className="ml-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              title="Remove"
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}




function Chip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent"
    >
      {children}
    </button>
  );
}

const SYMBOLS: Array<{ value: string; label: string; icon: string; color: string }> = [
  { value: "BTCUSDT", label: "BTC", icon: "₿", color: "#f7931a" },
  { value: "ETHUSDT", label: "ETH", icon: "Ξ", color: "#627eea" },
  { value: "SOLUSDT", label: "SOL", icon: "◎", color: "#14f195" },
  { value: "BNBUSDT", label: "BNB", icon: "◆", color: "#f3ba2f" },
  { value: "XRPUSDT", label: "XRP", icon: "✕", color: "#23292f" },
  { value: "DOGEUSDT", label: "DOGE", icon: "Ð", color: "#c2a633" },
  { value: "ADAUSDT", label: "ADA", icon: "₳", color: "#0033ad" },
  { value: "AVAXUSDT", label: "AVAX", icon: "▲", color: "#e84142" },
];

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

function SymbolSelect({
  value,
  onChange,
  isPro,
}: {
  value: string;
  onChange: (v: string) => void;
  isPro: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = SYMBOLS.find((s) => s.value === value) ?? SYMBOLS[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-xs hover:bg-accent"
      >
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black"
          style={{ background: current.color }}
        >
          {current.icon}
        </span>
        <span className="font-medium">{current.label}USD</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border border-border bg-card shadow-xl">
            {SYMBOLS.map((s) => {
              const locked = !isPro && !FREE_SYMBOLS.has(s.value);
              return (
                <button
                  key={s.value}
                  onClick={() => {
                    if (locked) {
                      setOpen(false);
                      window.location.href = "/pricing";
                      return;
                    }
                    onChange(s.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent ${
                    s.value === value ? "bg-accent" : ""
                  } ${locked ? "opacity-60" : ""}`}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black"
                    style={{ background: s.color }}
                  >
                    {s.icon}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                    {locked ? (
                      <>
                        <Lock className="h-3 w-3" /> Pro
                      </>
                    ) : (
                      "USDT"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function IntervalSelect({
  value,
  onChange,
  isPro,
}: {
  value: string;
  onChange: (v: string) => void;
  isPro: boolean;
}) {
  return (
    <div className="flex rounded-md bg-card p-0.5">
      {INTERVALS.map((iv) => {
        const locked = !isPro && !FREE_INTERVALS.has(iv);
        return (
          <button
            key={iv}
            onClick={() => {
              if (locked) {
                window.location.href = "/pricing";
                return;
              }
              onChange(iv);
            }}
            title={locked ? "Upgrade to Pro to unlock" : undefined}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              iv === value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            } ${locked ? "opacity-50" : ""}`}
          >
            {locked && <Lock className="h-2.5 w-2.5" />}
            {iv}
          </button>
        );
      })}
    </div>
  );
}

// ----- Pine-code -> chart overlay helpers -----

type OverlaySpec =
  | { kind: "ma"; type: "sma" | "ema" | "wma" | "rma" | "vwma"; length: number; source: "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4"; color: string; label: string }
  | { kind: "bb"; length: number; mult: number; source: "close" | "hl2" | "hlc3"; color: string };

const OVERLAY_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#f472b6", "#22d3ee", "#eab308"];

function pickSource(name: string): OverlaySpec extends { source: infer S } ? S : never {
  const s = name.trim();
  if (s === "open" || s === "high" || s === "low" || s === "hl2" || s === "hlc3" || s === "ohlc4") return s as never;
  return "close" as never;
}

function parseOverlays(code: string | null | undefined): { overlays: OverlaySpec[]; nonOverlayNote: string | null } {
  if (!code) return { overlays: [], nonOverlayNote: null };
  const overlays: OverlaySpec[] = [];
  const maRe = /ta\.(sma|ema|wma|rma|vwma)\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*(\d+)\s*\)/g;
  let m: RegExpExecArray | null;
  let colorIdx = 0;
  const seen = new Set<string>();
  while ((m = maRe.exec(code))) {
    const type = m[1] as "sma" | "ema" | "wma" | "rma" | "vwma";
    const source = pickSource(m[2]);
    const length = parseInt(m[3], 10);
    if (!Number.isFinite(length) || length < 2 || length > 500) continue;
    const key = `${type}:${source}:${length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    overlays.push({
      kind: "ma",
      type,
      length,
      source,
      color: OVERLAY_COLORS[colorIdx++ % OVERLAY_COLORS.length],
      label: `${type.toUpperCase()}(${length})`,
    });
    if (overlays.length >= 6) break;
  }
  // Simple Bollinger detection: presence of ta.stdev(...) with a nearby "* N" multiplier
  const bbMatch = code.match(/ta\.stdev\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*(\d+)\s*\)\s*\*\s*(\d+(?:\.\d+)?)/);
  if (bbMatch) {
    overlays.push({
      kind: "bb",
      length: parseInt(bbMatch[2], 10),
      mult: parseFloat(bbMatch[3]),
      source: pickSource(bbMatch[1]) as "close" | "hl2" | "hlc3",
      color: "#94a3b8",
    });
  }
  // Detect non-overlay indicators for a hint
  const nonOverlay: string[] = [];
  if (/ta\.rsi\s*\(/.test(code)) nonOverlay.push("RSI");
  if (/ta\.macd\s*\(/.test(code)) nonOverlay.push("MACD");
  if (/ta\.stoch\s*\(/.test(code)) nonOverlay.push("Stochastic");
  const nonOverlayNote =
    nonOverlay.length > 0 && overlays.length === 0
      ? `${nonOverlay.join(", ")} detected — runs in a separate pane in TradingView.`
      : null;
  return { overlays, nonOverlayNote };
}

type Bar = { time: number; open: number; high: number; low: number; close: number };

function seriesFromSource(bars: Bar[], src: string): number[] {
  return bars.map((b) => {
    switch (src) {
      case "open": return b.open;
      case "high": return b.high;
      case "low": return b.low;
      case "hl2": return (b.high + b.low) / 2;
      case "hlc3": return (b.high + b.low + b.close) / 3;
      case "ohlc4": return (b.open + b.high + b.low + b.close) / 4;
      default: return b.close;
    }
  });
}

function sma(values: number[], length: number): number[] {
  const out: number[] = Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}
function ema(values: number[], length: number): number[] {
  const out: number[] = Array(values.length).fill(NaN);
  const k = 2 / (length + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === length - 1) {
      let s = 0;
      for (let j = 0; j < length; j++) s += values[j];
      prev = s / length;
      out[i] = prev;
    } else if (i >= length) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}
function wma(values: number[], length: number): number[] {
  const out: number[] = Array(values.length).fill(NaN);
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < length; j++) s += values[i - j] * (length - j);
    out[i] = s / denom;
  }
  return out;
}
function rma(values: number[], length: number): number[] {
  const out: number[] = Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === length - 1) {
      let s = 0;
      for (let j = 0; j < length; j++) s += values[j];
      prev = s / length;
      out[i] = prev;
    } else if (i >= length) {
      prev = (prev * (length - 1) + values[i]) / length;
      out[i] = prev;
    }
  }
  return out;
}
function stdev(values: number[], length: number): number[] {
  const out: number[] = Array(values.length).fill(NaN);
  for (let i = length - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < length; j++) s += values[i - j];
    const mean = s / length;
    let v = 0;
    for (let j = 0; j < length; j++) {
      const d = values[i - j] - mean;
      v += d * d;
    }
    out[i] = Math.sqrt(v / length);
  }
  return out;
}

function computeMA(type: "sma" | "ema" | "wma" | "rma" | "vwma", values: number[], length: number, bars: Bar[]): number[] {
  switch (type) {
    case "sma": return sma(values, length);
    case "ema": return ema(values, length);
    case "wma": return wma(values, length);
    case "rma": return rma(values, length);
    case "vwma": {
      // No volume in bars type -> fall back to SMA
      void bars;
      return sma(values, length);
    }
  }
}

// In-platform candlestick chart powered by lightweight-charts. Parses the
// generated Pine script and draws any moving averages / Bollinger bands it
// finds directly on top of the price series so the user can visually verify
// their indicator without leaving the app.

function ChartCanvas({
  symbol,
  interval,
  code,
  loading,
}: {
  symbol: string;
  interval: string;
  code?: string;
  loading?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const chartRef = useRef<{
    chart: {
      remove: () => void;
      addSeries: (t: unknown, opts?: unknown) => { setData: (d: unknown) => void; applyOptions: (o: unknown) => void };
      removeSeries: (s: unknown) => void;
      timeScale: () => { fitContent: () => void };
      applyOptions: (o: { width: number; height: number }) => void;
    };
    LineSeries: unknown;
    overlaySeries: Array<unknown>;
  } | null>(null);

  const [loadedCode, setLoadedCode] = useState<string | undefined>(undefined);
  const { overlays, nonOverlayNote } = useMemo(() => parseOverlays(loadedCode), [loadedCode]);
  const hasCode = !!code && code.trim().length > 0;
  const isLoaded = !!loadedCode && loadedCode === code;

  // Auto-load the indicator once streaming finishes and code is present/changed.
  useEffect(() => {
    if (loading) return;
    if (!code || code.trim().length === 0) return;
    if (loadedCode === code) return;
    setLoadedCode(code);
  }, [loading, code, loadedCode]);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      try {
        const el = containerRef.current;
        if (!el) return;
        const { createChart, CandlestickSeries, LineSeries } = await import("lightweight-charts");
        const res = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=300`,
        );
        if (!res.ok) throw new Error(`klines ${res.status}`);
        const raw = (await res.json()) as Array<[number, string, string, string, string, ...unknown[]]>;
        if (disposed) return;
        const parsed: Bar[] = raw.map((k) => ({
          time: k[0] / 1000,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
        const candleData = parsed.map((b) => ({
          time: b.time as never,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }));

        const c = createChart(el, {
          width: el.clientWidth,
          height: el.clientHeight,
          layout: { background: { color: "transparent" }, textColor: "#8b93a7" },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" },
          },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
          timeScale: {
            borderColor: "rgba(255,255,255,0.08)",
            timeVisible: true,
            secondsVisible: false,
          },
          crosshair: { mode: 0 },
        });
        const series = c.addSeries(CandlestickSeries, {
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderVisible: false,
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        });
        series.setData(candleData);
        c.timeScale().fitContent();

        chartRef.current = {
          chart: c as never,
          LineSeries,
          overlaySeries: [],
        };
        setBars(parsed);

        ro = new ResizeObserver(() => {
          if (!el) return;
          c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        });
        ro.observe(el);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load chart");
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.chart.remove();
      chartRef.current = null;
    };
  }, [symbol, interval]);

  // Draw / redraw overlays whenever the parsed code or bars change.
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || bars.length === 0) return;

    for (const s of ref.overlaySeries) {
      try {
        ref.chart.removeSeries(s);
      } catch {
        /* ignore */
      }
    }
    ref.overlaySeries = [];

    const addLine = (values: number[], color: string, width = 2) => {
      const line = ref.chart.addSeries(ref.LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const d = bars
        .map((b, i) => ({ time: b.time as never, value: values[i] }))
        .filter((p) => Number.isFinite(p.value as number));
      line.setData(d);
      ref.overlaySeries.push(line);
    };

    for (const o of overlays) {
      if (o.kind === "ma") {
        const src = seriesFromSource(bars, o.source);
        const vals = computeMA(o.type, src, o.length, bars);
        addLine(vals, o.color, 2);
      } else if (o.kind === "bb") {
        const src = seriesFromSource(bars, o.source);
        const basis = sma(src, o.length);
        const dev = stdev(src, o.length);
        const upper = basis.map((b, i) => b + dev[i] * o.mult);
        const lower = basis.map((b, i) => b - dev[i] * o.mult);
        addLine(basis, o.color, 1);
        addLine(upper, o.color, 1);
        addLine(lower, o.color, 1);
      }
    }
  }, [overlays, bars]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        {hasCode && isLoaded && (
          <button
            type="button"
            onClick={() => setLoadedCode(undefined)}
            className="rounded-md border border-border/60 bg-panel/90 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur hover:text-foreground"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          disabled={!hasCode}
          onClick={() => setLoadedCode(code)}
          className="rounded-md border border-brand/40 bg-brand/20 px-2.5 py-1.5 text-[11px] font-medium text-brand backdrop-blur hover:bg-brand/30 disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-panel/60 disabled:text-muted-foreground"
          title={hasCode ? "Draw the current script's indicators on the chart" : "Generate a script first"}
        >
          {isLoaded ? "Reload indicator" : "Load indicator to chart"}
        </button>
      </div>
      {(overlays.length > 0 || nonOverlayNote) && (
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-md bg-panel/80 px-2 py-1.5 text-[11px] backdrop-blur">
          {overlays.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: o.color }} />
              <span className="text-foreground">
                {o.kind === "ma"
                  ? `${o.type.toUpperCase()}(${o.length})`
                  : `BB(${o.length}, ${o.mult})`}
              </span>
            </div>
          ))}
          {nonOverlayNote && <div className="text-muted-foreground">{nonOverlayNote}</div>}
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Chart unavailable: {err}
        </div>
      )}
    </div>
  );
}



function CodeView({ text, loading }: { text: string; loading: boolean }) {
  const placeholder = `//@version=5
indicator("Signal Goat AI", overlay=true)

// Chat with Signal Goat AI in the left panel.
// Your generated Pine Script will appear here.`;
  const content = text || placeholder;
  return (
    <pre className="h-full overflow-auto bg-panel p-6 text-xs leading-relaxed text-foreground/90">
      <code className="whitespace-pre-wrap font-mono">{content}</code>
      {loading && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" />
      )}
    </pre>
  );
}

// ---------------- Alerts Panel ----------------

type AlertRow = {
  id: string;
  symbol: string;
  condition: string;
  threshold: number;
  active: boolean;
  cooldown_seconds: number;
  last_triggered_at: string | null;
  created_at: string;
};

type NotifRow = {
  id: string;
  alert_id: string;
  symbol: string;
  condition: string;
  threshold: number;
  triggered_price: number;
  read: boolean;
  triggered_at: string;
};

function AlertsPanel({
  user,
  currentSymbol,
  alerts,
  notifications,
  onClose,
  onCreate,
  creating,
  onToggle,
  onDelete,
  onDismissNotif,
  onMarkAllRead,
  onOpenSymbol,
}: {
  user: boolean;
  currentSymbol: string;
  alerts: AlertRow[];
  notifications: NotifRow[];
  onClose: () => void;
  onCreate: (input: {
    symbol: string;
    condition: "above" | "below";
    threshold: number;
  }) => void;
  creating: boolean;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onDismissNotif: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenSymbol: (sym: string) => void;
}) {
  const [sym, setSym] = useState(currentSymbol);
  const [cond, setCond] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");

  useEffect(() => setSym(currentSymbol), [currentSymbol]);

  const submit = () => {
    const t = parseFloat(threshold);
    if (!Number.isFinite(t) || t <= 0) return;
    onCreate({ symbol: sym.toUpperCase(), condition: cond, threshold: t });
    setThreshold("");
  };

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <section className="flex w-[320px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
        <span className="font-medium">Alerts</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          title="Close"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      {!user ? (
        <div className="p-4 text-xs text-muted-foreground">
          <Link to="/auth" className="text-brand hover:underline">
            Sign in
          </Link>{" "}
          to create price alerts.
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Notifications */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Recent triggers
              </div>
              {unread > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="text-[10px] text-brand hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                No alerts triggered yet.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {notifications.slice(0, 15).map((n) => (
                  <li
                    key={n.id}
                    className={`group flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-[11px] ${
                      n.read
                        ? "border-border bg-card"
                        : "border-brand/40 bg-brand/5"
                    }`}
                  >
                    <button
                      onClick={() => onOpenSymbol(n.symbol)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        {n.condition === "above" ? (
                          <TrendingUp className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-400" />
                        )}
                        {n.symbol} {n.condition} {formatNum(n.threshold)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        Hit @ {formatNum(n.triggered_price)} ·{" "}
                        {new Date(n.triggered_at).toLocaleString()}
                      </div>
                    </button>
                    <button
                      onClick={() => onDismissNotif(n.id)}
                      className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Create new alert */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              New alert
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={sym}
                onChange={(e) => setSym(e.target.value.toUpperCase())}
                placeholder="BTCUSDT"
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <div className="flex gap-2">
                <select
                  value={cond}
                  onChange={(e) => setCond(e.target.value as "above" | "below")}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-brand"
                >
                  <option value="above">Price above</option>
                  <option value="below">Price below</option>
                </select>
                <input
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  type="number"
                  step="any"
                  placeholder="Threshold"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
              </div>
              <button
                onClick={submit}
                disabled={creating || !threshold}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create alert"}
              </button>
              <p className="text-[10px] text-muted-foreground">
                Checked every minute. 1-hour cooldown between re-triggers.
              </p>
            </div>
          </div>

          {/* Existing alerts */}
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              Active rules ({alerts.length})
            </div>
            {alerts.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                No alert rules yet.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className="group flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-[11px]"
                  >
                    <button
                      onClick={() => onOpenSymbol(a.symbol)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5 font-medium">
                        {a.condition === "above" ? (
                          <TrendingUp className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-400" />
                        )}
                        {a.symbol} {a.condition} {formatNum(a.threshold)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {a.last_triggered_at
                          ? `Last: ${new Date(a.last_triggered_at).toLocaleString()}`
                          : "Not triggered yet"}
                      </div>
                    </button>
                    <button
                      onClick={() => onToggle(a.id, !a.active)}
                      title={a.active ? "Pause" : "Resume"}
                      className={`relative h-4 w-7 rounded-full transition-colors ${
                        a.active ? "bg-brand" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform ${
                          a.active ? "translate-x-3.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => onDelete(a.id)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function formatNum(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

// ---------------- Backtest Modal ----------------

type BacktestResult = {
  label: string;
  symbol: string;
  interval: string;
  bars: number;
  startTime: number | null;
  endTime: number | null;
  totalPct: number;
  trades: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  maxDrawdownPct: number;
  tradeList: Array<{
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    pnlPct: number;
  }>;
};

type BacktestInput = {
  symbol: string;
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  strategy: "rsi" | "ma_cross";
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  fastLen?: number;
  slowLen?: number;
};

function BacktestModal({
  symbol,
  interval,
  onClose,
  run,
}: {
  symbol: string;
  interval: string;
  onClose: () => void;
  run: (input: BacktestInput) => Promise<BacktestResult>;
}) {
  const [strategy, setStrategy] = useState<"rsi" | "ma_cross">("rsi");
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [fastLen, setFastLen] = useState(20);
  const [slowLen, setSlowLen] = useState(50);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const validIntervals = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
  const iv = (validIntervals as readonly string[]).includes(interval)
    ? (interval as (typeof validIntervals)[number])
    : "15m";

  const submit = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await run({
        symbol,
        interval: iv,
        strategy,
        rsiPeriod,
        rsiOversold,
        rsiOverbought,
        fastLen,
        slowLen,
      });
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-brand" />
            Backtest — {symbol} · {iv}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto p-4">
          {/* Strategy config */}
          <div className="mb-4 space-y-3 rounded-lg border border-border bg-background p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setStrategy("rsi")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  strategy === "rsi"
                    ? "bg-brand text-brand-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                RSI mean reversion
              </button>
              <button
                onClick={() => setStrategy("ma_cross")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  strategy === "ma_cross"
                    ? "bg-brand text-brand-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                MA cross
              </button>
            </div>

            {strategy === "rsi" ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <NumberField label="Period" value={rsiPeriod} onChange={setRsiPeriod} />
                <NumberField label="Oversold" value={rsiOversold} onChange={setRsiOversold} />
                <NumberField label="Overbought" value={rsiOverbought} onChange={setRsiOverbought} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <NumberField label="Fast MA" value={fastLen} onChange={setFastLen} />
                <NumberField label="Slow MA" value={slowLen} onChange={setSlowLen} />
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand py-2 text-xs font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Run backtest
                </>
              )}
            </button>
            {err && <p className="text-[11px] text-destructive">{err}</p>}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="text-[11px] text-muted-foreground">
                {result.label} · {result.bars} bars
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Stat
                  label="Return"
                  value={`${result.totalPct >= 0 ? "+" : ""}${result.totalPct.toFixed(2)}%`}
                  positive={result.totalPct >= 0}
                />
                <Stat label="Trades" value={String(result.trades)} />
                <Stat
                  label="Win rate"
                  value={`${result.winRate.toFixed(1)}%`}
                />
                <Stat
                  label="Max DD"
                  value={`${result.maxDrawdownPct.toFixed(2)}%`}
                  positive={false}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <div>
                  Avg win:{" "}
                  <span className="text-emerald-400">
                    +{result.avgWinPct.toFixed(2)}%
                  </span>
                </div>
                <div>
                  Avg loss:{" "}
                  <span className="text-red-400">
                    {result.avgLossPct.toFixed(2)}%
                  </span>
                </div>
              </div>

              {result.tradeList.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Recent trades
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-background text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium">Entry</th>
                          <th className="px-2 py-1.5 text-right font-medium">In</th>
                          <th className="px-2 py-1.5 text-right font-medium">Out</th>
                          <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.tradeList.map((t, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {new Date(t.entryTime).toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {formatNum(t.entryPrice)}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {formatNum(t.exitPrice)}
                            </td>
                            <td
                              className={`px-2 py-1.5 text-right font-medium ${
                                t.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {t.pnlPct >= 0 ? "+" : ""}
                              {t.pnlPct.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Simulated on close prices without fees or slippage. Past performance
                is not indicative of future results.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-brand"
      />
    </label>
  );
}

function Stat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold ${
          positive === true
            ? "text-emerald-400"
            : positive === false
              ? "text-red-400"
              : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}


// ---------------- Analyze Modal ----------------

function AnalyzeModal({
  symbol,
  interval,
  loading,
  error,
  result,
  onClose,
  onRetry,
}: {
  symbol: string;
  interval: string;
  loading: boolean;
  error: string | null;
  result: AnalyzeResult | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const signalColor =
    result?.signal === "buy"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : result?.signal === "sell"
        ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
        : "text-muted-foreground bg-muted/40 border-border";
  const SignalIcon =
    result?.signal === "buy" ? TrendingUp : result?.signal === "sell" ? TrendingDown : Sparkles;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <h2 className="text-sm font-semibold">
              AI analysis — {symbol} · {interval}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin text-brand" />
              Analyzing script against live market data…
            </div>
          )}
          {!loading && error && (
            <div className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <p>{error}</p>
              <button
                onClick={onRetry}
                className="rounded-md border border-destructive/40 px-3 py-1 text-xs hover:bg-destructive/20"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && result && (
            <div className="space-y-4 text-sm">
              <div className={`flex items-center gap-3 rounded-md border px-3 py-2 ${signalColor}`}>
                <SignalIcon className="h-5 w-5" />
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wide opacity-70">
                    Current signal
                  </div>
                  <div className="text-base font-semibold capitalize">
                    {result.signal}{" "}
                    <span className="text-xs font-normal opacity-70">
                      · {result.confidence} confidence
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs opacity-70">
                  Last close
                  <div className="font-mono text-sm text-foreground">
                    {result.lastClose}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {result.strategyType}
                </div>
                <p className="mt-1 text-foreground">{result.summary}</p>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reasoning
                </div>
                <p className="mt-1 text-foreground">{result.reasoning}</p>
              </div>

              {result.keyLevels.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Key levels
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {result.keyLevels.map((l, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="text-[11px] text-muted-foreground">{l.label}</div>
                        <div className="font-mono text-sm">{l.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {result.strengths.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                      Strengths
                    </div>
                    <ul className="mt-1 space-y-1 text-foreground">
                      {result.strengths.map((s, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-emerald-400">+</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.risks.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-rose-400">
                      Risks
                    </div>
                    <ul className="mt-1 space-y-1 text-foreground">
                      {result.risks.map((s, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-rose-400">−</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {result.suggestions.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">
                    Suggestions
                  </div>
                  <ul className="mt-1 space-y-1 text-foreground">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-brand">→</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="pt-2 text-[11px] text-muted-foreground">
                AI-generated analysis over {result.bars} recent bars. Not financial advice.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
