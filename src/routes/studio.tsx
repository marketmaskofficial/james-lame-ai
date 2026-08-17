import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Check,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Copy,
  Crosshair,
  ChevronDown,
  History,
  CopyPlus,
  RotateCcw,
  Loader2,
  Minus,
  MousePointer2,
  ArrowUpRight,
  MapPin,
  Layers,
  Pencil,
  Play,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Rewind,
  Ruler,
  Save,
  Search,
  Settings2,
  Sliders,
  Square,
  Trash2,
  TrendingUp,
  TrendingDown,
  Type as TypeIcon,
  Maximize,
  Maximize2,
  Minimize,
  ChevronsRight,
  PanelBottomClose,
  PanelBottomOpen,
  Star,
  Wallet,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { fetchBars, TIMEFRAMES, timeframeLabel } from "@/lib/marketdata";
import {
  DEFAULT_FAVORITE_TIMEFRAMES,
  getFavoriteTimeframes,
  pushRecentSymbol,
  resolveSymbol,
  toggleFavoriteTimeframe,
} from "@/lib/symbols";
import { subscribeKlines, type LiveStatus } from "@/lib/live-feed";

import type { Bar, InputSpec, RunResult } from "@/lib/sgscript/types";
import { runIndicator } from "@/lib/sgscript/client";
import { DEFAULT_SCRIPT, SGSCRIPT_REFERENCE } from "@/lib/sgscript/examples";
import {
  StudioChart,
  type Drawing,
  type DrawTool,
  type LoadedIndicator,
  type ChartType,
  type ChartSettings,
  type ChartControls,
  type CrosshairInfo,
  type ChartTrade,
  type PositionPlan,
  type RenderStats,
  DEFAULT_CHART_SETTINGS,
} from "@/components/studio/StudioChart";
import { BrokerConnections } from "@/components/studio/BrokerConnections";
import { SymbolSearch } from "@/components/studio/SymbolSearch";
import { WatchlistPanel } from "@/components/studio/WatchlistPanel";
import { CodeEditor } from "@/components/studio/CodeEditor";
import {
  createIndicator,
  deleteIndicator,
  duplicateIndicator,
  listIndicators,
  listVersions,
  restoreVersion,
  updateIndicator,
} from "@/lib/indicators.functions";
import { repairSgScript, translateToSgScript } from "@/lib/sgscript.functions";
import { loadDrawings, saveDrawings, takeStudioHandoff } from "@/lib/studio-handoff";
import {
  TradingPanel,
  type OrderDraft,
  type TicketPrefill,
} from "@/components/studio/TradingPanel";
import { AccountBar, EnvBadge } from "@/components/studio/AccountBar";
import { FeedbackButton } from "@/components/FeedbackButton";
import { ChartLegendStrip } from "@/components/studio/ChartLegendStrip";

import { mergeLiveBar, prependBars } from "@/lib/market/candles";
import { TradingTables } from "@/components/studio/TradingTables";
import { DrawingInspector } from "@/components/studio/DrawingInspector";
import { AlertsSidePanel } from "@/components/studio/AlertsSidePanel";
import { AiSidePanel } from "@/components/studio/AiSidePanel";
import type { IndicatorSpec } from "@/lib/spec/types";
import { JournalPanel } from "@/components/studio/JournalPanel";
import { StrategyTester } from "@/components/studio/StrategyTester";
import type { BacktestTrade } from "@/lib/backtest/engine";
import { track } from "@/lib/telemetry";
import type { AccountSnapshot, TradingAccount } from "@/lib/trading/types";
import type { TradeLine } from "@/components/studio/StudioChart";
import { getInstrument, pnlPerUnit } from "@/lib/trading/instruments";
import {
  cancelTradeOrder,
  closeTradePosition,
  flattenAllPositions,
  getTradingSnapshot,
  listTradingAccounts,
  createPaperTradingAccount,
  renameTradingAccount,
  reverseTradePosition,
  breakevenTradePosition,
  deleteTradingAccount,
  modifyTradeOrder,
  setPositionBrackets,
  resetPaperAccount,
  submitTradeOrder,
} from "@/lib/trading.functions";


export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Chart Studio — run your indicators on live charts" },
      {
        name: "description",
        content:
          "Signal Goat Chart Studio: write SGScript indicators, run them on live candles, draw on the chart, and save your strategies.",
      },
      { property: "og:title", content: "Signal Goat Chart Studio" },
      {
        property: "og:description",
        content:
          "Write, run and save custom indicators on live candlestick charts inside Signal Goat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

/** `group` only drives a subtle divider between clusters in the toolbar — it
 * has no effect on tool behaviour. */
const TOOLS: { id: DrawTool; icon: typeof MousePointer2; label: string; group: string }[] = [
  { id: "cursor", icon: MousePointer2, label: "Cursor", group: "select" },
  { id: "select", icon: MousePointer2, label: "Select / move drawings", group: "select" },
  { id: "trend", icon: TrendingUp, label: "Trend line", group: "shapes" },
  { id: "ray", icon: Crosshair, label: "Ray", group: "shapes" },
  { id: "hline", icon: Minus, label: "Horizontal line", group: "shapes" },
  { id: "vline", icon: Minus, label: "Vertical line", group: "shapes" },
  { id: "rect", icon: Square, label: "Rectangle", group: "shapes" },
  { id: "fib", icon: Ruler, label: "Fib retracement", group: "annotate" },
  { id: "text", icon: TypeIcon, label: "Text", group: "annotate" },
  { id: "arrow", icon: ArrowUpRight, label: "Arrow", group: "annotate" },
  { id: "marker", icon: MapPin, label: "Marker", group: "annotate" },
  { id: "measure", icon: Pencil, label: "Measure", group: "annotate" },
  { id: "long", icon: TrendingUp, label: "Long position", group: "position" },
  { id: "short", icon: TrendingDown, label: "Short position", group: "position" },
  { id: "erase", icon: Trash2, label: "Erase", group: "erase" },
];

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "heikin", label: "Heikin Ashi" },
];

type StudioIndicator = LoadedIndicator & {
  code: string;
  settings: Record<string, number | boolean | string>;
  savedId?: string;
};

type DockTab =
  | "code"
  | "tester"
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "saved"
  | "docs";
type RightTab = "watchlist" | "trade" | "ai" | "alerts";

const RIGHT_TABS: { id: RightTab; label: string; icon: typeof Star }[] = [
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "trade", label: "Trade", icon: Wallet },
  { id: "ai", label: "AI", icon: Wand2 },
  { id: "alerts", label: "Alerts", icon: Bell },
];

// A script can run to completion (no throw, `result.ok`) while still
// producing nothing visible — a session/condition that never fires, a
// primitive call the AI silently dropped, a coordinate bug upstream of
// this. "Compiled" and "executed" both being true says nothing about
// whether anything will actually show up on the chart, so treat that as
// its own distinct outcome instead of folding it into a generic success
// message the user has no way to act on.
const DRAWING_CALL_RE = /(^|[^.\w])(plot\w*|hist|hline|box|line|label|signal|fill)\s*\(/;

function totalVisualObjects(result: RunResult): number {
  return (
    result.plots.length +
    result.boxes.length +
    result.lines.length +
    result.labels.length +
    result.markers.length +
    result.hlines.length +
    result.fills.length
  );
}

/**
 * Turns runtime output + real render telemetry for one indicator into either
 * null (fine to report as a normal success) or a specific, actionable
 * message. This is the only thing allowed to justify a success notice —
 * "compiled", "executed" and "state updated" are all necessary but none of
 * them are sufficient, which is exactly the gap that let this bug hide
 * behind a false "Indicator updated on the chart." before.
 */
function describeRenderOutcome(
  source: string,
  result: RunResult,
  stats: RenderStats | undefined,
): string | null {
  if (!DRAWING_CALL_RE.test(source)) return null; // nothing was ever going to draw — not this script's problem
  if (totalVisualObjects(result) === 0) {
    const hint = result.warnings?.length ? ` (${result.warnings[0]})` : "";
    return `Ran successfully but drew nothing on the chart${hint} — check whether its condition(s) ever actually fire against the loaded bars.`;
  }
  if (!stats) return "Indicator executed, but its render status could not be determined yet.";

  const types = ["boxes", "lines", "labels", "plots", "markers", "fills", "hlines"] as const;
  let received = 0, drawn = 0, offscreen = 0, waiting = 0, failed = 0;
  for (const t of types) {
    received += stats[t].received;
    drawn += stats[t].drawn;
    offscreen += stats[t].offscreen;
    waiting += stats[t].waitingForGeometry;
    failed += stats[t].failed;
  }
  if (received === 0) return null; // e.g. this indicator is only plots/markers/hlines, which don't need this check
  if (drawn > 0) return null; // at least one requested, currently-relevant visual actually rendered

  if (!stats.chartGeometryReady || waiting === received) {
    return "Indicator executed, but the chart is still initializing — it will render automatically as soon as it's ready.";
  }
  if (failed > 0 && offscreen === 0) {
    return `Indicator generated ${received} object${received === 1 ? "" : "s"}, but ${failed} failed coordinate conversion.`;
  }
  if (offscreen > 0) {
    return `Indicator executed, but its ${received} drawing${received === 1 ? " is" : "s are"} outside the current visible range — pan or zoom to see ${received === 1 ? "it" : "them"}.`;
  }
  return `Indicator generated ${received} object${received === 1 ? "" : "s"}, but none rendered.`;
}

// Correlates one Add to Chart click through translation, execution and
// rendering for the console — a permanent (not stripped after this fix)
// lightweight diagnostic, per the same principle as describeRenderOutcome:
// don't make debugging a rendering problem require re-deriving this from
// scratch. window.__lastRenderDiagnostics holds the latest summary for
// inspection from devtools; logRenderOutcome prints one consolidated line
// instead of one line per pipeline stage.
declare global {
  interface Window {
    __lastRenderDiagnostics?: {
      runId: string;
      key: string;
      source: string;
      result: { plots: number; lines: number; boxes: number; labels: number; markers: number; fills: number; hlines: number };
      stats: RenderStats | undefined;
    };
  }
}

function newTraceRunId(): string {
  return crypto.randomUUID();
}

function logRenderOutcome(
  runId: string,
  key: string,
  source: string,
  result: RunResult,
  stats: RenderStats | undefined,
): void {
  const resultCounts = {
    plots: result.plots.length,
    lines: result.lines.length,
    boxes: result.boxes.length,
    labels: result.labels.length,
    markers: result.markers.length,
    fills: result.fills.length,
    hlines: result.hlines.length,
  };
  if (typeof window !== "undefined") {
    window.__lastRenderDiagnostics = { runId, key, source, result: resultCounts, stats };
  }
  if (!import.meta.env.DEV) return;
  const s = stats;
  const totals = s
    ? (["boxes", "lines", "labels", "plots", "markers", "fills", "hlines"] as const).reduce(
        (acc, t) => ({
          drawn: acc.drawn + s[t].drawn,
          offscreen: acc.offscreen + s[t].offscreen,
          waiting: acc.waiting + s[t].waitingForGeometry,
          failed: acc.failed + s[t].failed,
        }),
        { drawn: 0, offscreen: 0, waiting: 0, failed: 0 },
      )
    : null;
  // eslint-disable-next-line no-console
  console.log(
    `[render ${runId.slice(0, 8)}] key=${key} runtime=${JSON.stringify(resultCounts)} rendered=${
      totals ? JSON.stringify(totals) : "no stats yet"
    } geometryReady=${s?.chartGeometryReady ?? "?"}`,
  );
}

const DOCK_TABS: Array<{ id: DockTab; label: string }> = [
  { id: "code", label: "Code" },
  { id: "tester", label: "Strategy tester" },
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "history", label: "History" },
  { id: "journal", label: "Journal" },
  { id: "saved", label: "Saved" },
  { id: "docs", label: "Reference" },
];

function Studio() {

  const { user } = useAuth();
  const qc = useQueryClient();

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalStr] = useState<string>("15m");
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [barsLoading, setBarsLoading] = useState(true);

  const [code, setCode] = useState(DEFAULT_SCRIPT);
  const [indicators, setIndicators] = useState<StudioIndicator[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [activeInputs, setActiveInputs] = useState<InputSpec[]>([]);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // AI build session: the spec being patched by follow-up messages, plus the
  // chart slot its output owns so edits replace it instead of stacking.
  const [projectSpec, setProjectSpec] = useState<IndicatorSpec | null>(null);
  const builtKeyRef = useRef<string | null>(null);
  const [tool, setTool] = useState<DrawTool>("cursor");
  // Backtest overlay: entry/exit markers from the last run of the current project.
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[] | null>(null);
  // Prompt handed to the AI panel when the tester asks for missing rules.
  const [aiSeed, setAiSeed] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [objectsOpen, setObjectsOpen] = useState(false);
  const [dock, setDock] = useState<DockTab>("code");
  const [dockHeight, setDockHeight] = useState(320);
  const [dockState, setDockState] = useState<"collapsed" | "normal" | "maximized">("normal");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const [live, setLive] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  // workspace chrome
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [chartSettings, setChartSettings] = useState<ChartSettings>(
    DEFAULT_CHART_SETTINGS,
  );
  const [crosshair, setCrosshair] = useState<CrosshairInfo | null>(null);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [menu, setMenu] = useState<null | "tf" | "type" | "settings">(null);
  const [favTfs, setFavTfs] = useState<string[]>(DEFAULT_FAVORITE_TIMEFRAMES);
  const [sidebarState, setSidebarState] = useState<"expanded" | "collapsed">("expanded");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [rightTab, setRightTab] = useState<RightTab>("watchlist");
  const controlsRef = useRef<ChartControls | null>(null);
  const onChartReady = useCallback((c: ChartControls) => {
    controlsRef.current = c;
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  useEffect(() => setFavTfs(getFavoriteTimeframes()), []);
  useEffect(() => {
    pushRecentSymbol(symbol);
  }, [symbol]);

  // Persist the workspace so a reload lands back on the same chart.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sg.studio.layout");
      if (!raw) return;
      const l = JSON.parse(raw) as Partial<{
        symbol: string;
        interval: string;
        chartType: ChartType;
        settings: ChartSettings;
        dock: DockTab;
        dockHeight: number;
        dockState: "collapsed" | "normal" | "maximized";
        rightTab: RightTab;
        sidebarState: "expanded" | "collapsed";
        sidebarWidth: number;
      }>;
      if (l.symbol) setSymbol(l.symbol);
      if (l.interval) setIntervalStr(l.interval);
      if (l.chartType) setChartType(l.chartType);
      if (l.settings) setChartSettings({ ...DEFAULT_CHART_SETTINGS, ...l.settings });
      if (l.dock) setDock(l.dock);
      if (typeof l.dockHeight === "number") setDockHeight(l.dockHeight);
      if (l.dockState) setDockState(l.dockState);
      if (l.rightTab) setRightTab(l.rightTab);
      if (l.sidebarState) setSidebarState(l.sidebarState);
      if (typeof l.sidebarWidth === "number") setSidebarWidth(l.sidebarWidth);
    } catch {
      /* first visit */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "sg.studio.layout",
        JSON.stringify({
          symbol,
          interval,
          chartType,
          settings: chartSettings,
          dock,
          dockHeight,
          dockState,
          rightTab,
          sidebarState,
          sidebarWidth,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [
    symbol,
    interval,
    chartType,
    chartSettings,
    dock,
    dockHeight,
    dockState,
    rightTab,
    sidebarState,
    sidebarWidth,
  ]);

  const dockVisible = dockState !== "collapsed";
  const openDock = useCallback(
    () => setDockState((s) => (s === "collapsed" ? "normal" : s)),
    [],
  );
  const toggleDockCollapse = useCallback(
    () => setDockState((s) => (s === "collapsed" ? "normal" : "collapsed")),
    [],
  );
  const toggleDockMaximize = useCallback(
    () => setDockState((s) => (s === "maximized" ? "normal" : "maximized")),
    [],
  );
  const openSidebar = useCallback(() => setSidebarState("expanded"), []);

  const listIndicatorsFn = useServerFn(listIndicators);
  const createIndicatorFn = useServerFn(createIndicator);
  const updateIndicatorFn = useServerFn(updateIndicator);
  const deleteIndicatorFn = useServerFn(deleteIndicator);
  const duplicateIndicatorFn = useServerFn(duplicateIndicator);
  const listVersionsFn = useServerFn(listVersions);
  const restoreVersionFn = useServerFn(restoreVersion);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const translateFn = useServerFn(translateToSgScript);
  const repairFn = useServerFn(repairSgScript);

  const savedQuery = useQuery({
    queryKey: ["indicators"],
    queryFn: () => listIndicatorsFn(),
    enabled: !!user,
  });

  // ---- paper trading (central OMS) ---------------------------------------
  const snapshotFn = useServerFn(getTradingSnapshot);
  const listAccountsFn = useServerFn(listTradingAccounts);
  const createAccountFn = useServerFn(createPaperTradingAccount);
  const deleteAccountFn = useServerFn(deleteTradingAccount);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [brokersOpen, setBrokersOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const submitOrderFn = useServerFn(submitTradeOrder);
  const cancelOrderFn = useServerFn(cancelTradeOrder);
  const closePositionFn = useServerFn(closeTradePosition);
  const flattenFn = useServerFn(flattenAllPositions);
  const resetAccountFn = useServerFn(resetPaperAccount);
  const modifyOrderFn = useServerFn(modifyTradeOrder);
  const setBracketsFn = useServerFn(setPositionBrackets);
  const renameAccountFn = useServerFn(renameTradingAccount);
  const reversePositionFn = useServerFn(reverseTradePosition);
  const breakevenFn = useServerFn(breakevenTradePosition);
  /** Ticket population coming from the chart (right-click / position tool). */
  const [prefill, setPrefill] = useState<TicketPrefill | null>(null);
  const [chartMenu, setChartMenu] = useState<
    { x: number; y: number; price: number } | null
  >(null);

  const [tradeError, setTradeError] = useState<string | null>(null);

  const accountsQuery = useQuery<TradingAccount[]>({
    queryKey: ["trading-accounts"],
    queryFn: () => listAccountsFn() as Promise<TradingAccount[]>,
    enabled: !!user,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  // Never guess: the panel trades whichever account is selected here.
  useEffect(() => {
    if (!accounts.length) return;
    setAccountId((cur) =>
      cur && accounts.some((a) => a.id === cur) ? cur : accounts[0].id,
    );
  }, [accounts]);

  const tradingQuery = useQuery<AccountSnapshot>({
    queryKey: ["trading-snapshot", accountId],
    queryFn: () =>
      snapshotFn({
        data: accountId ? { accountId } : {},
      }) as Promise<AccountSnapshot>,
    enabled: !!user,
    refetchInterval: 4000,
  });
  const snapshot = tradingQuery.data ?? null;

  const applySnapshot = useCallback(
    (next: AccountSnapshot) =>
      qc.setQueryData(["trading-snapshot", accountId], next),
    [qc, accountId],
  );

  const accountMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; label: string; startingBalance: number }
        | { kind: "delete"; id: string }
        | { kind: "rename"; id: string; label: string },
    ): Promise<TradingAccount[]> =>
      action.kind === "rename"
        ? ((await renameAccountFn({
            data: { accountId: action.id, label: action.label },
          })) as TradingAccount[])
        : action.kind === "create"
        ? ((await createAccountFn({
            data: { label: action.label, startingBalance: action.startingBalance },
          })) as TradingAccount[])
        : ((await deleteAccountFn({
            data: { accountId: action.id },
          })) as TradingAccount[]),
    onSuccess: (list) => {
      qc.setQueryData(["trading-accounts"], list);
      void qc.invalidateQueries({ queryKey: ["trading-snapshot"] });
    },
    onError: (e: unknown) =>
      setTradeError(e instanceof Error ? e.message : "Account action failed"),
  });

  const tradeMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "submit"; draft: OrderDraft }
        | { kind: "cancel"; id: string }
        | { kind: "close"; id: string }
        | { kind: "reverse"; id: string }
        | { kind: "breakeven"; id: string }
        | { kind: "flatten" }
        | { kind: "reset" },
    ): Promise<AccountSnapshot> => {
      if (action.kind === "submit") {
        const res = (await submitOrderFn({
          data: {
            ...(accountId ? { accountId } : {}),
            symbol,
            timeframe: interval,
            side: action.draft.side,
            type: action.draft.type,
            qty: action.draft.qty,
            ...(action.draft.limitPrice ? { limitPrice: action.draft.limitPrice } : {}),
            ...(action.draft.stopPrice ? { stopPrice: action.draft.stopPrice } : {}),
            ...(action.draft.stopLoss ? { stopLoss: action.draft.stopLoss } : {}),
            ...(action.draft.takeProfit ? { takeProfit: action.draft.takeProfit } : {}),
          },
        })) as { rejected: string | null; snapshot: AccountSnapshot };
        if (res.rejected) throw new Error(res.rejected);
        track("paper_trade_created", {
          side: action.draft.side,
          type: action.draft.type,
        });
        return res.snapshot;
      }
      if (action.kind === "reverse")
        return (await reversePositionFn({
          data: { positionId: action.id, ...(accountId ? { accountId } : {}) },
        })) as AccountSnapshot;
      if (action.kind === "breakeven")
        return (await breakevenFn({
          data: { positionId: action.id, ...(accountId ? { accountId } : {}) },
        })) as AccountSnapshot;
      if (action.kind === "cancel")
        return (await cancelOrderFn({
          data: { orderId: action.id, ...(accountId ? { accountId } : {}) },
        })) as AccountSnapshot;
      if (action.kind === "close")
        return (await closePositionFn({
          data: { positionId: action.id, ...(accountId ? { accountId } : {}) },
        })) as AccountSnapshot;
      if (action.kind === "flatten")
        return (await flattenFn({
          data: accountId ? { accountId } : {},
        })) as AccountSnapshot;
      return (await resetAccountFn({
        data: accountId ? { accountId } : {},
      })) as AccountSnapshot;
    },
    onMutate: () => setTradeError(null),
    onSuccess: applySnapshot,
    onError: (e: unknown) =>
      setTradeError(e instanceof Error ? e.message : "Order rejected"),
  });

  // Entry / stop / target / working-order levels for the symbol on screen.
  // Stops, targets and pending entries are draggable; fills never are.
  const chartTrades = useMemo<ChartTrade[]>(() => {
    if (!snapshot) return [];
    const sym = symbol.toUpperCase();
    const inst = getInstrument(symbol);
    const out: ChartTrade[] = [];
    for (const p of snapshot.positions) {
      if (p.symbol.toUpperCase() !== sym) continue;
      const qty = Number(p.qty);
      out.push({
        id: `pos:${p.id}`,
        kind: "entry",
        price: Number(p.avg_entry),
        label: `${p.side === "buy" ? "LONG" : "SHORT"} ${qty}`,
        color: p.side === "buy" ? "#22c55e" : "#ef4444",
        draggable: false,
        detail:
          p.unrealized === undefined
            ? undefined
            : `${p.unrealized >= 0 ? "+" : "-"}$${Math.abs(p.unrealized).toFixed(2)}`,
      });
      if (p.stop_price)
        out.push({
          id: `pos-stop:${p.id}`,
          kind: "stop",
          price: Number(p.stop_price),
          label: "SL",
          color: "#ef4444",
          draggable: true,
          detail: `−$${Math.abs(
            pnlPerUnit(inst, Number(p.avg_entry) - Number(p.stop_price)) * qty,
          ).toFixed(2)}`,
        });
      if (p.target_price)
        out.push({
          id: `pos-target:${p.id}`,
          kind: "target",
          price: Number(p.target_price),
          label: "TP",
          color: "#22c55e",
          draggable: true,
          detail: `+$${Math.abs(
            pnlPerUnit(inst, Number(p.target_price) - Number(p.avg_entry)) * qty,
          ).toFixed(2)}`,
        });
    }
    for (const o of snapshot.orders) {
      if (o.symbol.toUpperCase() !== sym) continue;
      if (!["working", "accepted", "created"].includes(o.status)) continue;
      const px = o.limit_price ?? o.stop_price;
      if (!px) continue;
      out.push({
        id: `ord:${o.id}`,
        kind: "order",
        price: Number(px),
        label: `${o.side.toUpperCase()} ${o.order_type.replace("_", "-").toUpperCase()} ${Number(o.qty)}`,
        color:
          o.purpose === "stop" ? "#ef4444" : o.purpose === "target" ? "#22c55e" : "#e6b800",
        draggable: true,
      });
    }
    return out;
  }, [snapshot, symbol]);

  const tradeLines = useMemo<TradeLine[]>(() => [], []);

  // Drag release -> ask the OMS to modify. The level stays where the OMS says.
  const dragTradeMutation = useMutation({
    mutationFn: async (v: { t: ChartTrade; price: number }): Promise<AccountSnapshot> => {
      const [prefix, id] = v.t.id.split(":");
      if (prefix === "ord") {
        const order = snapshot?.orders.find((o) => o.id === id);
        const usesStop =
          order?.order_type === "stop" || order?.order_type === "stop_limit";
        return (await modifyOrderFn({
          data: {
            orderId: id!,
            ...(accountId ? { accountId } : {}),
            ...(usesStop ? { stopPrice: v.price } : { limitPrice: v.price }),
          },
        })) as AccountSnapshot;
      }
      return (await setBracketsFn({
        data: {
          positionId: id!,
          ...(accountId ? { accountId } : {}),
          ...(prefix === "pos-stop"
            ? { stopLoss: v.price }
            : { takeProfit: v.price }),
        },
      })) as AccountSnapshot;
    },

    onMutate: () => setTradeError(null),
    onSuccess: applySnapshot,
    onError: (e: unknown) =>
      setTradeError(e instanceof Error ? e.message : "Could not modify level"),
  });


  // ---- market data --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setBarsLoading(true);
    setBarsError(null);
    setLastPrice(null);
    setBars([]);
    fetchBars(symbol, interval, 500)
      .then((b) => {
        if (cancelled) return;
        setBars(b);
        setLastPrice(b.length ? b[b.length - 1].close : null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBarsError(e instanceof Error ? e.message : "Market data unavailable");
      })
      .finally(() => !cancelled && setBarsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  // Progressive history: fetch older candles and prepend without reordering.
  const loadOlderHistory = useCallback(async () => {
    if (loadingHistory) return;
    const first = bars[0];
    if (!first) return;
    setLoadingHistory(true);
    try {
      const older = await fetchBars(symbol, interval, 1000, first.time * 1000 - 1);
      if (older.length) setBars((prev) => prependBars(older, prev));
    } catch {
      /* keep existing history on failure */
    } finally {
      setLoadingHistory(false);
    }
  }, [bars, symbol, interval, loadingHistory]);

  // ---- live tick feed -----------------------------------------------------
  useEffect(() => {
    if (!live) {
      setLiveStatus("offline");
      return;
    }
    setLiveStatus("connecting");
    const stop = subscribeKlines(symbol, interval, {
      onStatus: setLiveStatus,
      onBar: (bar) => {
        setLastPrice(bar.close);
        setBars((prev) => mergeLiveBar(prev, bar));
      },
    });
    return stop;
  }, [symbol, interval, live]);


  // ---- drawings persistence ----------------------------------------------
  useEffect(() => {
    setDrawings(loadDrawings(symbol, interval) as Drawing[]);
  }, [symbol, interval]);
  useEffect(() => {
    saveDrawings(symbol, interval, drawings);
  }, [symbol, interval, drawings]);

  const addDrawing = useCallback(
    (d: Drawing) => setDrawings((prev) => [...prev, d]),
    [],
  );
  const removeDrawing = useCallback((id: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    setSelectedDrawing((cur) => (cur === id ? null : cur));
  }, []);
  const updateDrawing = useCallback(
    (next: Drawing) =>
      setDrawings((prev) => prev.map((d) => (d.id === next.id ? next : d))),
    [],
  );
  const duplicateDrawing = useCallback((d: Drawing) => {
    const copy = { ...d, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    setDrawings((prev) => [...prev, copy]);
    setSelectedDrawing(copy.id);
  }, []);

  // ---- run / add to chart -------------------------------------------------
  const barsLiveRef = useRef<Bar[]>(bars);
  barsLiveRef.current = bars;

  // Candles can still be in flight when someone pastes a script — wait for
  // them (briefly) instead of failing the run.
  const waitForBars = useCallback(async () => {
    for (let i = 0; i < 60; i++) {
      if (barsLiveRef.current.length > 0) return barsLiveRef.current;
      await new Promise((r) => setTimeout(r, 200));
    }
    return barsLiveRef.current;
  }, []);

  // Set by runCode on every successful run, read by callers right after to
  // decide whether the normal success notice is honest or needs overriding —
  // see describeRenderOutcome() above.
  const lastVisualWarningRef = useRef<string | null>(null);
  const finalNotice = useCallback(
    (defaultMsg: string) => lastVisualWarningRef.current ?? defaultMsg,
    [],
  );

  // Latest per-indicator render telemetry reported by StudioChart's draw
  // loop. Rendering runs on an independent rAF loop decoupled from React's
  // commit, so a just-added indicator's real outcome isn't known the instant
  // setIndicators() returns — waitForRenderStats briefly polls this ref
  // until the draw loop has actually reported on the new indicator's key.
  const renderStatsRef = useRef<Record<string, RenderStats>>({});
  const handleRenderStats = useCallback(
    (stats: Record<string, RenderStats>) => {
      renderStatsRef.current = stats;
    },
    [],
  );
  const waitForRenderStats = useCallback(
    async (key: string, timeoutMs = 800): Promise<RenderStats | undefined> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const s = renderStatsRef.current[key];
        if (s) return s;
        await new Promise((r) => setTimeout(r, 50));
      }
      return renderStatsRef.current[key];
    },
    [],
  );

  const runCode = useCallback(
    async (
      source: string,
      opts: {
        settings?: Record<string, number | boolean | string>;
        key?: string;
        savedId?: string;
        silent?: boolean;
      } = {},
    ): Promise<string | null> => {
      const data = await waitForBars();
      if (data.length === 0) {
        const msg = "Market data is still loading — try again in a moment.";
        if (!opts.silent) setRunError(msg);
        return msg;
      }
      setRunning(true);
      if (!opts.silent) setRunError(null);
      try {
        const result: RunResult = await runIndicator(
          source,
          data,
          opts.settings ?? {},
        );
        const key = opts.key ?? `i${Date.now()}`;
        const next: StudioIndicator = {
          key,
          name: result.meta.name,
          visible: true,
          result,
          code: source,
          settings: opts.settings ?? {},
          ...(opts.savedId ? { savedId: opts.savedId } : {}),
        };
        setIndicators((prev) => {
          const idx = prev.findIndex((p) => p.key === key);
          if (idx === -1) return [...prev, next];
          const copy = [...prev];
          copy[idx] = next;
          return copy;
        });
        setEditingKey(key);
        setActiveInputs(result.inputs);
        setSettings(
          Object.fromEntries(result.inputs.map((i) => [i.name, i.value])),
        );
        setRunError(null);

        // Only worth waiting on the draw loop when there's something for it
        // to actually draw — strategy-only / plotless scripts skip the wait.
        const stats =
          totalVisualObjects(result) > 0
            ? await waitForRenderStats(key)
            : undefined;
        logRenderOutcome(newTraceRunId(), key, source, result, stats);
        lastVisualWarningRef.current = describeRenderOutcome(source, result, stats);
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Script failed";
        if (!opts.silent) setRunError(msg);
        return msg;
      } finally {
        setRunning(false);
      }
    },
    [waitForBars, waitForRenderStats],
  );

  // Pine (or anything non-SGScript) gets ported to SGScript before running.
  // NOTE: SGScript shares `input.*`, `math.*` and `color.*` helpers with Pine,
  // so those are NOT Pine markers — only constructs SGScript can never contain
  // count, and a positive SGScript signal always wins.
  const looksLikePine = useCallback((src: string) => {
    const s = src.toLowerCase();
    // Positive SGScript markers: it is a JS subset, Pine has none of these.
    if (
      /^\s*(const|let)\s+\w+\s*=/m.test(s) ||
      /=>/.test(s) ||
      /\bplot\s*\([^)]*,\s*\{/.test(s)
    ) {
      return false;
    }
    return (
      /\/\/@version\s*=\s*\d/.test(s) ||
      /\bstrategy\s*\(/.test(s) ||
      /\bta\.\w+/.test(s) ||
      /\bindicator\s*\(\s*["']/.test(s) ||
      /\bstudy\s*\(/.test(s) ||
      /\brequest\.security\s*\(/.test(s) ||
      /\b(plotshape|plotchar|barcolor|bgcolor|hline)\s*\(/.test(s) ||
      /\bvar\s+(float|int|bool|line|label|box)\s/.test(s) ||
      /\b(array|str|matrix)\.\w+\s*\(/.test(s)
    );
  }, []);


  // Pasted text often arrives wrapped in markdown fences or with the model's
  // prose around it — keep only the code.
  const cleanPasted = useCallback((raw: string) => {
    const text = raw.replace(/\r\n/g, "\n").trim();
    const fenced = /```[a-z]*\s*\n([\s\S]*?)```/i.exec(text);
    if (fenced?.[1]) return fenced[1].trim();
    const open = /```[a-z]*\s*\n([\s\S]*)$/i.exec(text);
    if (open?.[1]) return open[1].trim();
    return text;
  }, []);

  const friendlyErr = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unauthor|401|not authenticated/i.test(msg))
      return "Sign in to convert scripts — conversion runs on the server.";
    return msg || "Could not convert the script";
  }, []);

  // Any pasted source ends up on the chart: SGScript runs directly, anything
  // else (Pine, or SGScript with mistakes) is ported/repaired by the model and
  // retried until it plots.
  const runSource = useCallback(
    async (source: string, opts: { key?: string } = {}): Promise<string | null> => {
      let src = cleanPasted(source);
      if (!src) return "Nothing to run.";
      const key = opts.key;
      const attempt = (code: string) =>
        runCode(code, {
          settings: {},
          silent: true,
          ...(key ? { key } : {}),
        });

      let err: string | null = null;

      if (looksLikePine(src)) {
        setTranslating(true);
        setRunError(null);
        setNotice("Converting your script into a runnable Signal Goat indicator…");
        try {
          const r = await translateFn({ data: { source: src } });
          src = r.code;
          setCode(src);
          setNotice("Converted — plotting…");
        } catch (e) {
          setTranslating(false);
          setNotice(null);
          const msg = friendlyErr(e);
          setRunError(msg);
          return msg;
        }
        setTranslating(false);
        err = await attempt(src);
      } else {
        // Try it as SGScript first — instant when it already is one.
        setRunError(null);
        err = await attempt(src);
        if (err && !/still loading/i.test(err)) {
          // Not valid SGScript — treat it as foreign code and port it.
          setTranslating(true);
          setNotice("Converting your script into a runnable Signal Goat indicator…");
          try {
            const r = await translateFn({
              data: { source: src, note: `Previous run failed with: ${err}` },
            });
            src = r.code;
            setCode(src);
            err = await attempt(src);
          } catch (e) {
            setTranslating(false);
            setNotice(null);
            const msg = friendlyErr(e);
            setRunError(msg);
            return msg;
          }
          setTranslating(false);
        }
      }

      if (!err) {
        setNotice(finalNotice("Indicator plotted on the chart."));
        return null;
      }

      // Self-heal: hand the runtime error back to the model, twice if needed.
      setTranslating(true);
      for (let i = 0; i < 2 && err; i++) {
        setNotice(
          i === 0 ? "Fixing a problem in the script…" : "One more fix attempt…",
        );
        try {
          const fixed = await repairFn({ data: { source: src, error: err } });
          src = fixed.code;
          setCode(src);
          err = await attempt(src);
        } catch (e) {
          err = friendlyErr(e);
          break;
        }
      }
      setTranslating(false);

      if (err) {
        setNotice(null);
        setRunError(err);
      } else {
        setNotice(finalNotice("Script repaired and plotted on the chart."));
      }
      return err ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [looksLikePine, cleanPasted, runCode, friendlyErr],
  );

  const addToChart = () => {
    const src = cleanPasted(code);
    if (!src) {
      setRunError("Nothing to run — paste or write a script first.");
      return;
    }
    if (src !== code) setCode(src);
    if (looksLikePine(src) || !editingKey) {
      void runSource(src).then((e) =>
        track(e ? "add_to_chart_failed" : "add_to_chart_succeeded", {
          translated: looksLikePine(src),
        }),
      );
      return;
    }
    // Editing an existing indicator: run in place, but fall back to the full
    // convert/repair pipeline if it now fails.
    void (async () => {
      const err = await runCode(src, {
        settings,
        key: editingKey,
        silent: true,
      });
      if (err) {
        const err2 = await runSource(src, { key: editingKey });
        track(err2 ? "add_to_chart_failed" : "add_to_chart_succeeded", { repaired: true });
      } else {
        track("add_to_chart_succeeded", { repaired: false });
        setNotice(finalNotice("Indicator updated on the chart."));
      }
    })();
  };



  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setRunError("Your clipboard is empty — copy a script first.");
        return;
      }
      setCode(text);
      setEditingKey(null);
      setDock("code");
      await runSource(text);
    } catch {
      setRunError(
        "Clipboard access was blocked — paste into the editor with Ctrl+V instead.",
      );
    }
  };

  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setRunError("Could not copy — select the code and press Ctrl+C.");
    }
  };


  // Re-run every loaded indicator as new data arrives (throttled for live ticks).
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const indicatorsRef = useRef(indicators);
  indicatorsRef.current = indicators;
  const recomputingRef = useRef(false);
  const lastRecomputeRef = useRef(0);
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always the CURRENT symbol/interval, read by recompute() at execution
  // time — not the value captured when the effect scheduled it, since a
  // symbol switch fires this effect twice (once immediately when bars
  // resets to [] and no-ops on the empty-data guard below, again once the
  // new bars actually arrive) and only the second firing does real work.
  const symbolIntervalRef = useRef(`${symbol}:${interval}`);
  symbolIntervalRef.current = `${symbol}:${interval}`;
  // The symbol/interval a recompute last actually completed FOR, only set
  // once real work happens — never on the no-op empty-bars firing.
  const recomputedForRef = useRef<string | null>(null);

  const recompute = useCallback(async () => {
    const list = indicatorsRef.current;
    const data = barsRef.current;
    if (list.length === 0 || data.length === 0 || recomputingRef.current) return;
    recomputingRef.current = true;
    lastRecomputeRef.current = Date.now();
    const keyAtRun = symbolIntervalRef.current;
    try {
      const failures: string[] = [];
      const updated = await Promise.all(
        list.map(async (ind) => {
          try {
            const result = await runIndicator(ind.code, data, ind.settings);
            return { ...ind, result };
          } catch (e) {
            // Keeping stale output silently would make the chart lie. Say so.
            const msg = e instanceof Error ? e.message : "unknown error";
            console.error(`[studio] live recompute failed for ${ind.name}`, e);
            failures.push(`${ind.name}: ${msg}`);
            return ind;
          }
        }),
      );
      setRunError(
        failures.length === 0
          ? null
          : `Live update failed — ${failures[0]}. The chart is showing the last good calculation.`,
      );
      setIndicators((prev) =>
        prev.length === updated.length &&
        prev.every((p, i) => p.key === updated[i].key)
          ? updated
          : prev,
      );
      recomputedForRef.current = keyAtRun;
    } finally {
      recomputingRef.current = false;
    }
  }, []);

  const lastBarTime = bars.length ? bars[bars.length - 1].time : 0;
  const lastClose = bars.length ? bars[bars.length - 1].close : 0;
  useEffect(() => {
    if (indicators.length === 0) return;
    // A symbol/timeframe switch resets `bars` to a different date range
    // immediately, but existing indicator results still hold the OLD
    // symbol's box/label timestamps until they recompute. Debouncing that
    // recompute (fine for live-tick throttling, the other trigger for this
    // effect) left up to 1.5s where the chart rendered stale boxes/labels
    // against the new bars — every one of them outside the new range,
    // collapsing to the chart's left edge via timeToLogical's out-of-range
    // fallback. A symbol/timeframe change is a discrete, deliberate action:
    // recompute immediately instead of waiting out that debounce.
    //
    // This effect fires twice on a symbol switch: once immediately when
    // `bars` resets to [] (recompute() no-ops on its empty-data guard —
    // there's nothing to compute yet), and again once the real bars arrive.
    // Comparing against the symbol recompute last actually COMPLETED for
    // (set inside recompute() itself, only on real work) rather than the
    // symbol at schedule time means both firings correctly get wait=0 —
    // the first is a no-op regardless, and the second is the one that
    // matters. Comparing against schedule-time state instead made the
    // first (no-op) firing consume the "just changed" flag, leaving the
    // second — the one with actual new data — to fall back into the
    // debounce, which is what caused the chart to render nothing at all
    // instead of stale-but-visible boxes: timeToLogical's null-return for
    // out-of-range points (added alongside this fix) hid the still-stale
    // pre-recompute result instead of mispositioning it, and then nothing
    // replaced it until the debounce finally elapsed.
    const key = `${symbol}:${interval}`;
    const needsImmediate = recomputedForRef.current !== key;
    const since = Date.now() - lastRecomputeRef.current;
    const wait = needsImmediate ? 0 : Math.max(0, 1500 - since);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => void recompute(), wait);
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBarTime, lastClose, bars.length, symbol, interval]);


  // ---- hand-off from the AI chat -----------------------------------------
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current) return;
    handoffDone.current = true;
    const payload = takeStudioHandoff();
    if (!payload) return;
    if (payload.symbol) setSymbol(payload.symbol);
    if (payload.interval) setIntervalStr(payload.interval);
    if (payload.language === "sgscript") {
      setCode(payload.code);
      setNotice("Indicator loaded from chat — press Add to Chart to run it.");
      return;
    }
    // Pine can't execute here; port it into SGScript first.
    setTranslating(true);
    setNotice("Converting your Pine Script into a runnable Signal Goat indicator…");
    translateFn({ data: { source: payload.code } })
      .then((r) => {
        setCode(r.code);
        setNotice("Converted to SGScript — press Add to Chart to run it.");
      })
      .catch((e: unknown) =>
        setRunError(
          e instanceof Error ? e.message : "Could not convert the script",
        ),
      )
      .finally(() => setTranslating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- saved indicators ---------------------------------------------------
  const saveMut = useMutation({
    mutationFn: async () => {
      const name = indicators.find((i) => i.key === editingKey)?.name ?? "Untitled indicator";
      const current = indicators.find((i) => i.key === editingKey);
      if (current?.savedId) {
        await updateIndicatorFn({
          data: {
            id: current.savedId,
            name,
            code,
            settings,
            snapshot: true,
            changelog: `Saved from Chart Studio (${symbol} ${interval})`,
            symbol,
            timeframe: interval,
          },
        });
        return current.savedId;
      }
      const row = await createIndicatorFn({
        data: {
          name,
          code,
          settings,
          symbol,
          timeframe: interval,
          isOverlay: current?.result.meta.overlay ?? true,
        },
      });
      setIndicators((prev) =>
        prev.map((p) => (p.key === editingKey ? { ...p, savedId: row.id } : p)),
      );
      return row.id;
    },
    onSuccess: () => {
      setNotice("Indicator saved to your account.");
      qc.invalidateQueries({ queryKey: ["indicators"] });
    },
    onError: (e: unknown) =>
      setRunError(e instanceof Error ? e.message : "Could not save"),
  });

  const renameMut = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      updateIndicatorFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateIndicatorFn({ data: { id } }),
    onSuccess: () => {
      setNotice("Indicator duplicated.");
      qc.invalidateQueries({ queryKey: ["indicators"] });
    },
    onError: (e: unknown) =>
      setRunError(e instanceof Error ? e.message : "Could not duplicate"),
  });
  const versionsQuery = useQuery({
    queryKey: ["indicator-versions", historyFor],
    enabled: Boolean(historyFor),
    queryFn: () => listVersionsFn({ data: { indicatorId: historyFor as string } }),
  });
  const restoreMut = useMutation({
    mutationFn: (v: { indicatorId: string; version: number }) =>
      restoreVersionFn({ data: v }),
    onSuccess: (row) => {
      setCode(row.restored.code);
      setDock("code");
      setNotice("Version restored — press Add to Chart to run it.");
      qc.invalidateQueries({ queryKey: ["indicators"] });
      qc.invalidateQueries({ queryKey: ["indicator-versions"] });
    },
    onError: (e: unknown) =>
      setRunError(e instanceof Error ? e.message : "Could not restore version"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteIndicatorFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indicators"] }),
  });

  const hasOscPane = indicators.some(
    (i) =>
      i.visible &&
      (i.result.plots.some((p) => p.pane === "osc") ||
        i.result.hlines.some((h) => h.pane === "osc")),
  );

  // The project the tester backtests: the AI build session's chart slot when
  // there is one, otherwise the indicator currently being edited, otherwise the
  // last one added. Always a *loaded* run, so chart and backtest read the same
  // strategy declarations — there is no second implementation.
  const testerProject = useMemo(() => {
    if (indicators.length === 0) return null;
    const built = builtKeyRef.current
      ? indicators.find((i) => i.key === builtKeyRef.current)
      : undefined;
    const active =
      built ??
      indicators.find((i) => i.key === editingKey) ??
      indicators[indicators.length - 1];
    return { name: active.result.meta.name, strategy: active.result.strategy, code: active.code };
  }, [indicators, editingKey]);

  // Backtest fills drawn on the chart so the rules can be verified visually.
  const backtestMarkers = useMemo(() => {
    if (!backtestTrades) return [];
    return backtestTrades.flatMap((t) => [
      {
        time: t.entryTime,
        side: (t.direction === "long" ? "buy" : "sell") as "buy" | "sell",
        text: `#${t.id} ${t.direction === "long" ? "Long" : "Short"} @ ${t.entryPrice}`,
        color: t.direction === "long" ? "#22c55e" : "#ef4444",
      },
      {
        time: t.exitTime,
        side: (t.direction === "long" ? "sell" : "buy") as "buy" | "sell",
        text: `#${t.id} ${t.exitReason} ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`,
        color: t.pnl >= 0 ? "#38bdf8" : "#f97316",
      },
    ]);
  }, [backtestTrades]);

  return (
    <div ref={rootRef} className="flex h-screen flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 py-1.5">
        <Link
          to="/app"
          className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Back to chat"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <span className="hidden text-[13px] font-medium tracking-tight text-muted-foreground md:inline">
          Chart Studio
        </span>
        <div className="h-4 w-px bg-border" />

        <button
          onClick={() => setSymbolOpen(true)}
          className="flex items-center gap-2 rounded-[6px] border border-border bg-card px-2.5 py-1 text-xs hover:border-brand"
          title="Search markets (symbol)"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono font-medium">{symbol}</span>
          <span className="hidden text-muted-foreground md:inline">
            {resolveSymbol(symbol).exchange}
          </span>
        </button>

        {/* timeframe */}
        <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-card p-0.5">
          {favTfs.map((tf) => (
            <button
              key={tf}
              onClick={() => setIntervalStr(tf)}
              className={`rounded-[4px] px-2 py-0.5 text-[11px] ${
                interval === tf
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {tf}
            </button>
          ))}
          <div className="relative">
            <button
              onClick={() => setMenu((m) => (m === "tf" ? null : "tf"))}
              className="flex items-center rounded-[4px] px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title="All timeframes"
            >
              {favTfs.includes(interval) ? "" : interval}
              <ChevronDown className="h-3 w-3" />
            </button>
            {menu === "tf" && (
              <div className="absolute left-0 z-40 mt-1 max-h-72 w-52 overflow-auto rounded-[8px] border border-border bg-popover p-1 shadow-xl">
                {TIMEFRAMES.map((tf) => (
                  <div
                    key={tf}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] hover:bg-accent ${
                      interval === tf ? "text-brand" : ""
                    }`}
                  >
                    <button
                      onClick={() => {
                        setIntervalStr(tf);
                        setMenu(null);
                      }}
                      className="flex-1 text-left"
                    >
                      {timeframeLabel(tf)}
                    </button>
                    <button
                      title="Pin to toolbar"
                      onClick={() => setFavTfs(toggleFavoriteTimeframe(tf))}
                      className={
                        favTfs.includes(tf)
                          ? "text-brand"
                          : "text-muted-foreground hover:text-foreground"
                      }
                    >
                      <Star
                        className="h-3 w-3"
                        fill={favTfs.includes(tf) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* chart type */}
        <div className="relative">
          <button
            onClick={() => setMenu((m) => (m === "type" ? null : "type"))}
            title="Chart type"
            className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {CHART_TYPES.find((c) => c.id === chartType)?.label}
            <ChevronDown className="h-3 w-3" />
          </button>
          {menu === "type" && (
            <div className="absolute left-0 z-40 mt-1 w-40 rounded-[8px] border border-border bg-popover p-1 shadow-xl">
              {CHART_TYPES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setChartType(c.id);
                    setMenu(null);
                  }}
                  className={`block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-accent ${
                    chartType === c.id ? "text-brand" : ""
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* indicators */}
        <button
          onClick={() => {
            setDock("saved");
            openDock();
          }}
          title="Indicators"
          className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Sliders className="h-3.5 w-3.5" />
        </button>

        {/* chart settings */}
        <div className="relative">
          <button
            onClick={() => setMenu((m) => (m === "settings" ? null : "settings"))}
            title="Chart settings"
            className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {menu === "settings" && (
            <div className="absolute left-0 z-40 mt-1 w-56 space-y-2 rounded-[8px] border border-border bg-popover p-2.5 text-[11px] shadow-xl">
              {(
                [
                  ["showVolume", "Volume"],
                  ["grid", "Grid"],
                  ["crosshairMagnet", "Magnet crosshair"],
                  ["logScale", "Logarithmic scale"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(chartSettings[k])}
                    onChange={(e) =>
                      setChartSettings((c) => ({ ...c, [k]: e.target.checked }))
                    }
                  />
                </label>
              ))}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Up / down</span>
                <span className="flex gap-1">
                  <input
                    type="color"
                    value={chartSettings.upColor}
                    onChange={(e) =>
                      setChartSettings((c) => ({ ...c, upColor: e.target.value }))
                    }
                    className="h-5 w-6 rounded border border-border bg-transparent"
                  />
                  <input
                    type="color"
                    value={chartSettings.downColor}
                    onChange={(e) =>
                      setChartSettings((c) => ({ ...c, downColor: e.target.value }))
                    }
                    className="h-5 w-6 rounded border border-border bg-transparent"
                  />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {barsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {user && accounts.length > 0 && (
            <AccountBar
              accounts={accounts}
              activeId={accountId}
              snapshot={snapshot}
              busy={accountMutation.isPending}
              onSelect={setAccountId}
              onRename={({ id, label }) =>
                accountMutation.mutate({ kind: "rename", id, label })
              }
              onCreate={({ label, startingBalance }) =>
                accountMutation.mutate({ kind: "create", label, startingBalance })
              }
              onReset={() => tradeMutation.mutate({ kind: "reset" })}

              onDelete={(id) => accountMutation.mutate({ kind: "delete", id })}
              onOpenBrokers={() => setBrokersOpen(true)}
            />
          )}
          {lastPrice !== null && (
            <span className="px-1.5 font-mono text-[13px] tabular-nums text-foreground">
              {lastPrice.toLocaleString("en-US", {
                maximumFractionDigits: lastPrice >= 100 ? 2 : 6,
              })}
            </span>
          )}
          <button
            onClick={() => setLive((v) => !v)}
            title={live ? "Pause live updates" : "Resume live updates"}
            className={`flex items-center gap-1 rounded-[6px] px-2 py-0.5 ${
              live && liveStatus !== "offline"
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Radio
              className={`h-3.5 w-3.5 ${
                live && (liveStatus === "live" || liveStatus === "polling")
                  ? "animate-pulse"
                  : ""
              }`}
            />
            {!live
              ? "Paused"
              : liveStatus === "live"
                ? "Live"
                : liveStatus === "polling"
                  ? "Live (5s)"
                  : liveStatus === "connecting"
                    ? "Connecting"
                    : "Offline"}
          </button>
          <button
            onClick={() => void loadOlderHistory()}
            disabled={loadingHistory || bars.length === 0}
            title="Load older history"
            className="hidden rounded-[6px] px-1.5 py-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40 lg:inline-flex lg:items-center lg:gap-1"
          >
            {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {bars.length} bars +
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          <button
            title="Fit chart"
            onClick={() => controlsRef.current?.fit()}
            className="rounded-[6px] p-1 hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            title="Jump to latest bar"
            onClick={() => controlsRef.current?.toLatest()}
            className="rounded-[6px] p-1 hover:bg-accent hover:text-foreground"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
          <button
            title="Replay (coming soon)"
            disabled
            className="rounded-[6px] p-1 text-muted-foreground/40"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          <button
            title={dockVisible ? "Hide editor panel" : "Show editor panel"}
            onClick={toggleDockCollapse}
            className="rounded-[6px] p-1 hover:bg-accent hover:text-foreground"
          >
            {dockVisible ? (
              <PanelBottomClose className="h-3.5 w-3.5" />
            ) : (
              <PanelBottomOpen className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            title={sidebarState === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() =>
              setSidebarState((s) => (s === "expanded" ? "collapsed" : "expanded"))
            }
            className={`rounded-[6px] p-1 hover:bg-accent hover:text-foreground ${
              sidebarState === "expanded" ? "text-brand" : ""
            }`}
          >
            {sidebarState === "expanded" ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
            className="rounded-[6px] p-1 hover:bg-accent hover:text-foreground"
          >
            {isFullscreen ? (
              <Minimize className="h-3.5 w-3.5" />
            ) : (
              <Maximize className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <FeedbackButton
          page="studio"
          symbol={symbol}
          timeframe={interval}
          {...(indicators.find((i) => i.key === editingKey)?.savedId
            ? {
                projectId: indicators.find((i) => i.key === editingKey)!
                  .savedId as string,
              }
            : {})}
        />
      </header>


      <div className="flex min-h-0 flex-1">
        {/* drawing rail */}
        <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
          {TOOLS.map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 && t.group !== TOOLS[i - 1].group && (
                <div className="my-1 h-px w-6 bg-border" />
              )}
              <button
                title={t.label}
                onClick={() => setTool(t.id)}
                className={`rounded-[6px] p-2 ${
                  tool === t.id
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <t.icon className="h-4 w-4" />
              </button>
            </Fragment>
          ))}
          <button
            title="Objects & styles"
            onClick={() => setObjectsOpen((v) => !v)}
            className={`mt-2 rounded-[6px] p-2 ${
              objectsOpen
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Layers className="h-4 w-4" />
          </button>
          {drawings.length > 0 && (
            <button
              title="Clear all drawings"
              onClick={() => setDrawings([])}
              className="mt-2 rounded-[6px] p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="text-[10px]">clr</span>
            </button>
          )}
        </nav>

        {/* chart */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className={`relative min-h-0 overflow-hidden ${
              dockState === "maximized" ? "flex-none basis-14" : "flex-1"
            }`}
          >
            <ChartLegendStrip
              symbol={symbol}
              intervalLabel={timeframeLabel(interval)}
              crosshair={crosshair}
              indicators={indicators}
              editingKey={editingKey}
              onSelectIndicator={(key) => {
                const ind = indicators.find((i) => i.key === key);
                if (!ind) return;
                setEditingKey(key);
                setCode(ind.code);
                setActiveInputs(ind.result.inputs);
                setSettings(ind.settings);
                setDock("code");
              }}
              onToggleVisible={(key) =>
                setIndicators((prev) =>
                  prev.map((p) => (p.key === key ? { ...p, visible: !p.visible } : p)),
                )
              }
              onRemoveIndicator={(key) =>
                setIndicators((prev) => prev.filter((p) => p.key !== key))
              }
              onOpenSettings={(key) => {
                const ind = indicators.find((i) => i.key === key);
                if (!ind) return;
                setEditingKey(key);
                setCode(ind.code);
                setActiveInputs(ind.result.inputs);
                setSettings(ind.settings);
                setDock("code");
                openDock();
              }}
              onPickTemplate={(templateCode) => {
                setEditingKey(null);
                setCode(templateCode ?? DEFAULT_SCRIPT);
                setDock("code");
                openDock();
                // Start a fresh AI build session too.
                setProjectSpec(null);
                builtKeyRef.current = null;
              }}
            />
            {barsError ? (
              <div className="flex h-full items-center justify-center text-xs text-destructive">
                {barsError}
              </div>
            ) : (
              <StudioChart
                bars={bars}
                indicators={indicators}
                tool={tool}
                drawings={drawings}
                onAddDrawing={addDrawing}
                onRemoveDrawing={removeDrawing}
                onUpdateDrawing={updateDrawing}
                selectedId={selectedDrawing}
                onSelectDrawing={setSelectedDrawing}
                hasOscPane={hasOscPane}
                extraMarkers={backtestMarkers}
                tradeLines={tradeLines}
                trades={chartTrades}
                instrument={{
                  tickSize: getInstrument(symbol).tickSize,
                  valuePerPoint: pnlPerUnit(getInstrument(symbol), 1),
                }}
                onTradeDrag={(t, price) => dragTradeMutation.mutate({ t, price })}
                onChartPrice={(price, screen) =>
                  setChartMenu({ price, x: screen.x, y: screen.y })
                }
                onPlanOrder={(plan: PositionPlan) => {
                  setPrefill({
                    nonce: Date.now(),
                    side: plan.side,
                    type: "limit",
                    limitPrice: plan.entry,
                    stopLoss: plan.stop,
                    takeProfit: plan.target,
                  });
                  setRightTab("trade");
                  openSidebar();
                }}
                chartType={chartType}
                settings={chartSettings}
                onCrosshair={setCrosshair}
                onReady={onChartReady}
                onRenderStats={handleRenderStats}
              />
            )}

            {objectsOpen && (
              <DrawingInspector
                drawings={drawings}
                selectedId={selectedDrawing}
                onSelect={setSelectedDrawing}
                onUpdate={updateDrawing}
                onRemove={removeDrawing}
                onDuplicate={duplicateDrawing}
                onClose={() => setObjectsOpen(false)}
              />
            )}

            {/* Right-click trading menu: places the clicked price in the ticket. */}
            {chartMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setChartMenu(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setChartMenu(null);
                  }}
                />
                <div
                  className="absolute z-50 w-52 overflow-hidden rounded-[8px] border border-border bg-panel py-1 text-xs shadow-xl"
                  style={{ left: chartMenu.x, top: chartMenu.y }}
                >
                  <div className="px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                    {chartMenu.price.toLocaleString("en-US", {
                      maximumFractionDigits: 6,
                    })}
                  </div>
                  {(
                    [
                      ["buy", "limit", "Buy limit here"],
                      ["sell", "limit", "Sell limit here"],
                      ["buy", "stop", "Buy stop here"],
                      ["sell", "stop", "Sell stop here"],
                    ] as const
                  ).map(([side, type, label]) => (
                    <button
                      key={label}
                      onClick={() => {
                        setPrefill({
                          nonce: Date.now(),
                          side,
                          type,
                          ...(type === "limit"
                            ? { limitPrice: chartMenu.price }
                            : { stopPrice: chartMenu.price }),
                        });
                        setRightTab("trade");
                        openSidebar();
                        setChartMenu(null);
                      }}
                      className={`block w-full px-2.5 py-1.5 text-left hover:bg-accent ${
                        side === "buy" ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* bottom dock: editor / saved indicators / reference */}
          <section
            className={`flex shrink-0 flex-col border-t border-border bg-panel ${
              dockState === "maximized" ? "flex-1" : ""
            }`}
            style={dockState === "normal" ? { height: dockHeight, minHeight: 160 } : undefined}
          >
          {dockState === "normal" && (
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = dockHeight;
                const move = (ev: PointerEvent) =>
                  setDockHeight(
                    Math.min(
                      Math.max(160, startH + (startY - ev.clientY)),
                      window.innerHeight - 240,
                    ),
                  );
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              className="group/resize flex h-2.5 w-full shrink-0 cursor-row-resize items-center justify-center hover:bg-brand/10"
            >
              <div className="h-1 w-10 rounded-full bg-border transition-colors group-hover/resize:bg-brand/70" />
            </div>
          )}
          <div className="flex h-10 items-center gap-1 border-b border-border px-2">
            <button
              onClick={toggleDockCollapse}
              title={dockVisible ? "Collapse panel" : "Expand panel"}
              className="rounded-[6px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {dockVisible ? (
                <PanelBottomClose className="h-3.5 w-3.5" />
              ) : (
                <PanelBottomOpen className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={toggleDockMaximize}
              title={dockState === "maximized" ? "Restore panel" : "Maximize panel"}
              className="rounded-[6px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {dockState === "maximized" ? (
                <ChevronsDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUp className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="mx-0.5 h-4 w-px bg-border" />
            {DOCK_TABS.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setDock(d.id);
                  openDock();
                }}
                className={`rounded-[6px] px-2 py-1 text-[13px] ${
                  dock === d.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={pasteFromClipboard}
                disabled={running || translating}
                title="Paste code from clipboard and plot it"
                className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ClipboardPaste className="h-3.5 w-3.5" /> Paste
              </button>
              <button
                onClick={copyCode}
                title="Copy this script"
                className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-brand" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={addToChart}
                disabled={running || translating || bars.length === 0}
                className="flex items-center gap-1 rounded-[6px] bg-brand px-2.5 py-1 text-[13px] font-medium text-brand-foreground disabled:opacity-50"
              >
                {running || translating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Add to Chart
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={!user || saveMut.isPending || !editingKey}
                title={user ? "Save indicator" : "Sign in to save"}
                className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            </div>

          </div>

          {dockVisible && dock === "code" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                <CodeEditor value={code} onChange={setCode} />
              </div>

              {activeInputs.length > 0 && (
                <div className="max-h-56 shrink-0 overflow-auto border-t border-border p-3">
                  <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                    Settings
                  </p>
                  <div className="space-y-2">
                    {activeInputs.map((inp) => (
                      <label
                        key={inp.name}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-muted-foreground">{inp.label}</span>
                        {inp.type === "bool" ? (
                          <input
                            type="checkbox"
                            checked={Boolean(settings[inp.name])}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                [inp.name]: e.target.checked,
                              }))
                            }
                          />
                        ) : (
                          <input
                            type={inp.type === "number" ? "number" : "text"}
                            value={String(settings[inp.name] ?? "")}
                            min={inp.min}
                            max={inp.max}
                            step={inp.step}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                [inp.name]:
                                  inp.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              }))
                            }
                            className="w-28 rounded border border-border bg-card px-2 py-1 outline-none focus:border-brand"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={addToChart}
                    className="mt-3 w-full rounded-[6px] border border-border py-1 text-[11px] hover:bg-accent"
                  >
                    Apply settings
                  </button>
                </div>
              )}

              {(notice || runError) && (
                <div
                  onClick={() => setNoticeExpanded((v) => !v)}
                  className={`shrink-0 cursor-pointer border-t border-border px-2 py-1 text-[11px] ${
                    noticeExpanded ? "" : "truncate"
                  } ${runError ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {runError ?? notice}
                </div>
              )}
            </div>
          )}

          {dockVisible && dock === "saved" && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!user && (
                <p className="text-xs text-muted-foreground">
                  <Link to="/auth" className="text-brand underline">
                    Sign in
                  </Link>{" "}
                  to save indicators to your account.
                </p>
              )}
              {user && savedQuery.isLoading && (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
              {user && savedQuery.data?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No saved indicators yet. Write one and press the save icon.
                </p>
              )}
              <ul className="space-y-1.5">
                {savedQuery.data?.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-md border border-border bg-card px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs">{row.name}</span>
                      <button
                        title="Add to chart"
                        onClick={() =>
                          void runCode(row.code, {
                            settings: (row.settings ?? {}) as Record<
                              string,
                              number | boolean | string
                            >,
                            key: `saved-${row.id}`,
                            savedId: row.id,
                          }).then(() => setCode(row.code))
                        }
                        className="rounded p-1 text-muted-foreground hover:text-brand"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Edit code"
                        onClick={() => {
                          setCode(row.code);
                          setEditingKey(`saved-${row.id}`);
                          setDock("code");
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Rename"
                        onClick={() => {
                          const name = window.prompt("Rename indicator", row.name);
                          if (name?.trim())
                            renameMut.mutate({ id: row.id, name: name.trim() });
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <TypeIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Duplicate"
                        onClick={() => duplicateMut.mutate(row.id)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Version history"
                        onClick={() =>
                          setHistoryFor((cur) => (cur === row.id ? null : row.id))
                        }
                        className={`rounded p-1 hover:text-foreground ${historyFor === row.id ? "text-brand" : "text-muted-foreground"}`}
                      >
                        <History className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => deleteMut.mutate(row.id)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Updated {new Date(row.updated_at).toLocaleString()}
                    </p>
                    {historyFor === row.id && (
                      <div className="mt-2 space-y-1 border-t border-border pt-2">
                        {versionsQuery.isLoading && (
                          <p className="text-[10px] text-muted-foreground">
                            Loading history…
                          </p>
                        )}
                        {versionsQuery.data?.length === 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            No saved versions yet — save again to create one.
                          </p>
                        )}
                        {versionsQuery.data?.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center gap-2 text-[10px] text-muted-foreground"
                          >
                            <span className="font-mono text-foreground">
                              v{v.version}
                            </span>
                            <span className="flex-1 truncate">
                              {v.changelog ?? "Snapshot"}
                            </span>
                            <button
                              title="Load this version into the editor"
                              onClick={() => {
                                setCode(v.code);
                                setDock("code");
                                setNotice(`Loaded v${v.version} into the editor.`);
                              }}
                              className="rounded p-1 hover:text-foreground"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              title="Restore this version"
                              onClick={() =>
                                restoreMut.mutate({
                                  indicatorId: row.id,
                                  version: v.version,
                                })
                              }
                              className="rounded p-1 hover:text-brand"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dockVisible && dock === "docs" && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <BookOpen className="h-3.5 w-3.5 text-brand" /> SGScript reference
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                Pine Script only runs on TradingView, so Signal Goat indicators run
                in our own runtime: SGScript. Ask the AI for an SGScript indicator,
                or paste Pine and press{" "}
                <span className="inline-flex items-center gap-1 text-brand">
                  <Wand2 className="h-3 w-3" /> convert
                </span>{" "}
                below.
              </p>
              <button
                onClick={() => {
                  setTranslating(true);
                  setRunError(null);
                  setNotice("Converting to SGScript…");
                  translateFn({ data: { source: code } })
                    .then((r) => {
                      setCode(r.code);
                      setDock("code");
                      setNotice("Converted — press Add to Chart.");
                    })
                    .catch((e: unknown) =>
                      setRunError(
                        e instanceof Error ? e.message : "Conversion failed",
                      ),
                    )
                    .finally(() => setTranslating(false));
                }}
                disabled={!user || translating}
                className="mb-3 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
              >
                {translating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3" />
                )}
                Convert editor code to SGScript
              </button>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 text-[10.5px] leading-relaxed text-muted-foreground">
                {SGSCRIPT_REFERENCE}
              </pre>
            </div>
          )}

          {dockVisible && dock === "tester" && (
            <StrategyTester
              symbol={symbol}
              interval={interval}
              signedIn={!!user}
              bars={bars}
              project={testerProject}
              onShowTrades={setBacktestTrades}
              onDefineRules={(suggestion) => {
                openSidebar();
                setRightTab("ai");
                setAiSeed(suggestion);
              }}
            />
          )}

          {dockVisible && dock === "journal" && (
            <JournalPanel
              accountId={accountId}
              symbol={symbol}
              timeframe={interval}
              signedIn={!!user}
            />
          )}

          {dockVisible &&
            (dock === "positions" || dock === "orders" || dock === "history") && (
              <TradingTables
                snapshot={snapshot}
                busy={tradeMutation.isPending}
                tab={dock}
                showTabs={false}
                onClosePosition={(id) => tradeMutation.mutate({ kind: "close", id })}
                onCancelOrder={(id) => tradeMutation.mutate({ kind: "cancel", id })}
                onBreakeven={(id) => tradeMutation.mutate({ kind: "breakeven", id })}
                onReverse={(id) => tradeMutation.mutate({ kind: "reverse", id })}
                onModifyOrder={(id) => {
                  const order = snapshot?.orders.find((o) => o.id === id);
                  if (!order) return;
                  const current =
                    order.order_type === "stop" || order.order_type === "stop_limit"
                      ? order.stop_price
                      : order.limit_price;
                  const next = window.prompt(
                    `New price for ${order.side.toUpperCase()} ${order.symbol}`,
                    current === null || current === undefined ? "" : String(current),
                  );
                  const price = Number(next);
                  if (!next || !Number.isFinite(price) || price <= 0) return;
                  dragTradeMutation.mutate({
                    t: { id: `ord:${id}` } as ChartTrade,
                    price,
                  });
                }}
                onFlattenAll={() => tradeMutation.mutate({ kind: "flatten" })}
                onCancelAll={() => {
                  for (const o of snapshot?.orders ?? [])
                    if (
                      ["working", "accepted", "created", "partially_filled"].includes(
                        o.status,
                      )
                    )
                      tradeMutation.mutate({ kind: "cancel", id: o.id });
                }}
                onSelectSymbol={setSymbol}
              />
            )}
          </section>
        </main>

        {sidebarState === "collapsed" && (
          <aside className="hidden w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-panel py-2 lg:flex">
            {RIGHT_TABS.map((t) => (
              <button
                key={t.id}
                title={t.label}
                onClick={() => {
                  setRightTab(t.id);
                  setSidebarState("expanded");
                }}
                className={`rounded-[6px] p-2 ${
                  rightTab === t.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <t.icon className="h-4 w-4" />
              </button>
            ))}
          </aside>
        )}

        {sidebarState === "expanded" && (
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = sidebarWidth;
              const move = (ev: PointerEvent) =>
                setSidebarWidth(Math.min(Math.max(240, startW + (startX - ev.clientX)), 420));
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            className="hidden w-1.5 shrink-0 cursor-col-resize hover:bg-brand/10 lg:block"
          />
        )}
        {sidebarState === "expanded" && (
          <aside
            className="hidden shrink-0 flex-col overflow-y-auto border-l border-border bg-panel lg:flex"
            style={{ width: sidebarWidth }}
          >
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              {RIGHT_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRightTab(t.id)}
                  className={`flex-1 rounded-[6px] px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide transition ${
                    rightTab === t.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <button
                title="Collapse sidebar"
                onClick={() => setSidebarState("collapsed")}
                className="rounded-[6px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
            {rightTab === "ai" ? (
              <AiSidePanel
                seedPrompt={aiSeed}
                onSeedConsumed={() => setAiSeed(null)}
                code={code}
                symbol={symbol}
                interval={interval}
                signedIn={!!user}
                converting={translating}
                spec={projectSpec}
                onBuilt={(r) => {
                  setProjectSpec(r.spec);
                  setCode(r.sgscript);
                  setDock("code");
                  openDock();
                  // Reuse the same chart slot across the whole build session so
                  // a follow-up edit replaces the indicator instead of stacking.
                  const key = builtKeyRef.current ?? `ai${Date.now()}`;
                  builtKeyRef.current = key;
                  void (async () => {
                    const err = await runCode(r.sgscript, {
                      settings: {},
                      silent: true,
                      key,
                    });
                    if (err) {
                      const err2 = await runSource(r.sgscript, { key });
                      track(err2 ? "add_to_chart_failed" : "add_to_chart_succeeded", {
                        repaired: true,
                      });
                    } else {
                      track("add_to_chart_succeeded", { repaired: false });
                      setNotice(finalNotice("Indicator plotted on the chart."));
                    }
                  })();
                }}
                onConvert={() => {
                  setTranslating(true);
                  setRunError(null);
                  setNotice("Converting to SGScript…");
                  translateFn({ data: { source: code } })
                    .then((r) => {
                      setCode(r.code);
                      setDock("code");
                      openDock();
                      setNotice("Converted — press Add to Chart.");
                    })
                    .catch((e: unknown) =>
                      setRunError(
                        e instanceof Error ? e.message : "Conversion failed",
                      ),
                    )
                    .finally(() => setTranslating(false));
                }}
              />
            ) : rightTab === "alerts" ? (
              <AlertsSidePanel
                symbol={symbol}
                lastPrice={lastPrice}
                signedIn={!!user}
              />
            ) : rightTab === "trade" ? (
              <TradingPanel
                symbol={symbol}
                timeframe={interval}
                lastPrice={lastPrice}
                snapshot={snapshot}
                busy={tradeMutation.isPending}
                error={tradeError}
                signedIn={!!user}
                onSubmit={(draft) => {
                  tradeMutation.mutate({ kind: "submit", draft });
                  setDock("positions");
                  openDock();
                }}
                onFlatten={() => tradeMutation.mutate({ kind: "flatten" })}
                onReset={() => tradeMutation.mutate({ kind: "reset" })}
                prefill={prefill}
              />

            ) : (
            <WatchlistPanel
              activeSymbol={symbol}
              signedIn={!!user}
              onSelect={(t) => setSymbol(t)}
            />
            )}
          </aside>
        )}

      </div>

      {brokersOpen && <BrokerConnections onClose={() => setBrokersOpen(false)} />}

      {symbolOpen && (
        <SymbolSearch
          symbol={symbol}
          onSelect={(sym) => setSymbol(sym.ticker)}
          onClose={() => setSymbolOpen(false)}
        />
      )}
    </div>
  );
}
