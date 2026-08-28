import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
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
  ShieldCheck,
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
  X,
  MoreHorizontal,
  GripVertical,
  Plus,
  Link2,
  BarChart3,
  Gauge,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { checkStudioAccess, isStudioGateTestBypassed, isStudioGateLocalPaidBypassed } from "@/lib/subscription-status";
import { getOnboardingStatus } from "@/lib/profile.functions";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { fetchBars, TIMEFRAMES, timeframeLabel } from "@/lib/marketdata";
import {
  DEFAULT_FAVORITE_TIMEFRAMES,
  getFavoriteTimeframes,
  pushRecentSymbol,
  resolveSymbol,
  toggleFavoriteTimeframe,
} from "@/lib/symbols";
import type { LiveStatus } from "@/lib/live-feed";

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
  type MagnetMode,
  DEFAULT_CHART_SETTINGS,
} from "@/components/studio/StudioChart";
import { DrawToolbar } from "@/components/studio/DrawToolbar";
import { DrawingSettingsPopover } from "@/components/studio/DrawingSettingsPopover";
import { loadDrawingsFor, saveDrawingsFor } from "@/lib/workspace/drawings";
import { TOOL_BY_ID } from "@/lib/drawing/registry";
import { recordDrawingChange, undoDrawings, redoDrawings, clearDrawingHistory } from "@/lib/drawing/history";
import { BrokerConnections } from "@/components/studio/BrokerConnections";
import { SymbolSearch } from "@/components/studio/SymbolSearch";
import { WatchlistPanel } from "@/components/studio/WatchlistPanel";
import { ScannerPanel } from "@/components/studio/ScannerPanel";
import { VolumeProfilePanel } from "@/components/studio/VolumeProfilePanel";
import { MarketStatsPanel } from "@/components/studio/MarketStatsPanel";
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
import { takeStudioHandoff } from "@/lib/studio-handoff";
import {
  TradingPanel,
  type OrderDraft,
  type TicketPrefill,
} from "@/components/studio/TradingPanel";
import { AccountBar, EnvBadge } from "@/components/studio/AccountBar";
import { FeedbackButton } from "@/components/FeedbackButton";
import { AppNavRail } from "@/components/AppNavRail";
import { ChartLegendStrip } from "@/components/studio/ChartLegendStrip";
import { IndicatorSettingsPopout } from "@/components/studio/IndicatorSettingsPopout";
import { ChartInstance } from "@/components/studio/ChartInstance";
import { LayoutTree } from "@/components/studio/LayoutTree";

import { mergeLiveBar, prependBars } from "@/lib/market/candles";
import { TradingTables } from "@/components/studio/TradingTables";
import { DrawingInspector } from "@/components/studio/DrawingInspector";
import { AlertsSidePanel } from "@/components/studio/AlertsSidePanel";
import { AiSidePanel } from "@/components/studio/AiSidePanel";
import { coerceSpec, type IndicatorSpec } from "@/lib/spec/types";
import { JournalPanel } from "@/components/studio/JournalPanel";
import { StrategyTester } from "@/components/studio/StrategyTester";
import type { BacktestTrade } from "@/lib/backtest/engine";
import { track } from "@/lib/telemetry";
import type { AccountSnapshot, TradingAccount } from "@/lib/trading/types";
import {
  collectChartBearingNodeIds,
  collectWidgetTypeIds,
  findNodeById,
  findWidgetInstance,
  pathToLeaf,
  regionKindForNodeId,
  WELL_KNOWN_NODE_IDS,
  type LayoutNode,
  type WidgetInstance,
  type WidgetTypeId,
  type WorkspaceLayout,
} from "@/lib/workspace/types";
import { PRESETS, PRESET_ORDER, isPresetLocked, type PresetId } from "@/lib/workspace/presets";
import { getWidgetDef } from "@/lib/workspace/widgetRegistry";
import {
  addWidgetToNode,
  removeWidgetFromNode,
  reorderWithinNode,
  moveWidgetBetweenNodes,
  updateSplitSizes,
  setActiveTab as setActiveTabInTree,
  splitLeafWithWidget,
  isPortableForNewLeaf,
  createInstanceAsNewPane,
  updateChartConfig,
  updateVolumeProfileConfig,
  updateWatchlistConfig,
  updateAlertsConfig,
  updateMarketStatsConfig,
  type DropEdge,
} from "@/lib/workspace/mutations";
import { DockZone, pickDropZone, type DropZone } from "@/components/studio/DockZone";
import { AddWidgetMenu } from "@/components/studio/AddWidgetMenu";
import { LayoutMenu } from "@/components/studio/LayoutMenu";
import {
  CURRENT_LAYOUT_ID,
  defaultLocalStore,
  loadLocalStore,
  saveLocalStore,
  initialWorkspaceLayout,
  safeParseWorkspaceLayout,
  hasMigratedToCloud,
  markMigratedToCloud,
  type LocalWorkspaceStore,
} from "@/lib/workspace/persistence";
import {
  saveWorkspaceLayout,
  listWorkspaceLayouts,
  deleteWorkspaceLayout,
  setDefaultWorkspaceLayout,
} from "@/lib/workspace-layouts.functions";
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
  // UI-8: Chart Studio is the paid product surface. `ssr: false` means the
  // server NEVER renders this route's component or runs its `beforeLoad` —
  // both are skipped server-side and a neutral shell (`pendingComponent`
  // below) is sent instead, so a direct/unauthenticated request can never
  // receive real Studio markup in its initial HTML. This is load-bearing:
  // the Supabase client used everywhere in this app (see
  // src/integrations/supabase/client.ts) has no session storage on the
  // server (no cookie-forwarded session either), so a server-side
  // `beforeLoad` could never have told a real user apart from a guest
  // anyway — the only trustworthy place to check auth/subscription state is
  // the browser, and `ssr:false` is what keeps that check from being
  // bypassable by simply not waiting for JS.
  ssr: false,
  // Client-side gate that runs before the Studio component ever mounts, on
  // every navigation to this route (including a hard refresh, since
  // `ssr:false` forces a fresh client-side match). Reads the exact same
  // source of truth as the `useSubscription` hook (see
  // src/lib/subscription-status.ts) — not a second entitlement system.
  // A runtime guard inside the `Studio` component below (StudioAccessGate)
  // additionally covers the case where auth/subscription state CHANGES while
  // already mounted (logout, subscription lapsing) — beforeLoad alone only
  // re-runs on navigation.
  beforeLoad: async () => {
    const access = await checkStudioAccess();
    if (access === "unauthenticated") throw redirect({ to: "/auth" });
    if (access === "unpaid") throw redirect({ to: "/pricing" });
  },
  pendingComponent: StudioLoadingScreen,
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

/** Neutral loading shell shown while the server-skipped route resolves on
 * the client (see `ssr: false` above) and while the `Studio` gate component
 * below is still waiting on auth/subscription state. Deliberately renders
 * nothing about the product itself — no chart, no widgets, no cached data —
 * so there is never anything for an unpaid/unauthenticated viewer to see
 * flash by. */
function StudioLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <p className="text-sm text-muted-foreground">Loading Chart Studio…</p>
      </div>
    </div>
  );
}

/**
 * Route component: gates the real Studio workspace behind live auth +
 * subscription state, then renders it. `beforeLoad` above already prevents
 * an unpaid/unauthenticated user from reaching this component in the first
 * place on a fresh navigation; this additionally watches for the SAME state
 * changing while the component stays mounted (sign-out, a subscription
 * lapsing) via the ordinary reactive hooks (`useAuth`, `useSubscription`)
 * every other authenticated surface in this app already uses — no second
 * source of truth, no polling.
 *
 * Deliberately a thin wrapper around the pre-existing giant `StudioWorkspace`
 * component (renamed from `Studio`, otherwise untouched) rather than folding
 * this logic into it directly: `StudioWorkspace` calls dozens of hooks
 * unconditionally in a fixed order, so an early return for "not ready yet"
 * inside that same function would violate the Rules of Hooks the moment
 * loading state changed between renders.
 */
function Studio() {
  const navigate = useNavigate();
  const testBypassed = isStudioGateTestBypassed();
  // Local-dev-only, doubly-guarded (see isStudioGateLocalPaidBypassed's
  // docstring): unlike `testBypassed` above, this NEVER substitutes for a
  // real signed-in user below — it only ever widens what counts as "paid"
  // for a user who already passed the `!!user` check, so a signed-out
  // visitor is still redirected to /auth exactly as in production.
  const localPaidBypassed = isStudioGateLocalPaidBypassed();
  const { user, loading: authLoading } = useAuth();
  const { isActive: isPaid, loading: subLoading } = useSubscription();
  const ready = !authLoading && !subLoading;
  const effectivelyPaid = isPaid || localPaidBypassed;
  const authorized = testBypassed || (ready && !!user && effectivelyPaid);

  useEffect(() => {
    if (testBypassed || !ready) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }
    if (!effectivelyPaid) {
      navigate({ to: "/pricing", replace: true });
    }
  }, [testBypassed, ready, user, effectivelyPaid, navigate]);

  // UI-8 task 3: first-run onboarding. Checked once access is confirmed —
  // `null` = still checking, so the loading shell (not the real product,
  // not the onboarding flow) shows while this resolves. Fails open on any
  // error (see getOnboardingStatus's own docstring): a broken/unmigrated
  // check must never re-trap or block an existing paid user. Skipped
  // entirely under the render-regression test bypass (see
  // isStudioGateTestBypassed) since there is no authenticated user to look
  // an onboarding row up for.
  const getOnboardingStatusFn = useServerFn(getOnboardingStatus);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(testBypassed ? false : null);
  useEffect(() => {
    if (testBypassed || !authorized) return;
    let cancelled = false;
    getOnboardingStatusFn()
      .then((r) => {
        if (!cancelled) setNeedsOnboarding(!r.hasOnboarded);
      })
      .catch(() => {
        if (!cancelled) setNeedsOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [testBypassed, authorized, getOnboardingStatusFn]);

  if (!authorized || needsOnboarding === null) return <StudioLoadingScreen />;
  if (needsOnboarding) return <OnboardingFlow onDone={() => setNeedsOnboarding(false)} />;
  return <StudioWorkspace />;
}

// The old flat TOOLS array (cursor/select/trend/.../erase, one flavor-text
// "group" per divider) was replaced by the grouped-flyout toolbar
// (`DrawToolbar.tsx`), which reads its tool list from the shared
// `src/lib/drawing/registry.ts` instead.

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

/**
 * UI-4g-1: the shape of one chart's rendering-relevant state, keyed by its
 * workspace-tree `instanceId` (see `chartInstances` below). Exactly one
 * entry exists today (there is still only one chart, `WELL_KNOWN_NODE_IDS
 * .chartArea`'s single tab) — the underlying `symbol`/`interval`/etc. state
 * variables in the component are still the actual source of truth for this
 * phase (they're deeply read by backtest/trading/drawing logic elsewhere on
 * this page, which is out of this phase's scope to also relocate); this
 * type and the memo that builds it exist to prove the state is genuinely
 * addressable by instance id — driven by the real tree, not a hardcoded
 * literal — before UI-4g-2 adds a second chart that needs a second real
 * entry here.
 */
type ChartInstanceState = {
  symbol: string;
  interval: string;
  chartType: ChartType;
  chartSettings: ChartSettings;
  indicators: StudioIndicator[];
  bars: Bar[];
  drawings: Drawing[];
};

// Both unions now include every widget type placeable in EITHER region (not
// just the region it originally shipped in), because UI-4c lets a widget
// move sidebar<->dock. The tab-id string a widget maps to is the same
// regardless of which region renders it (WIDGET_TAB_ID below), so widening
// both unions to the shared full set is what makes a moved widget legally
// settable via setDock/setRightTab without a runtime cast.
type DockTab =
  | "code"
  | "tester"
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "saved"
  | "docs"
  | "watchlist"
  | "trade"
  | "ai"
  | "alerts"
  | "scanner"
  | "volprofile"
  | "marketstats";
type RightTab =
  | "watchlist"
  | "trade"
  | "ai"
  | "alerts"
  | "code"
  | "tester"
  | "positions"
  | "orders"
  | "history"
  | "journal"
  | "saved"
  | "docs"
  | "scanner"
  | "volprofile"
  | "marketstats";

// This route's tab ids/icons predate the workspace registry and are threaded
// through this file's state/switches everywhere below, so they stay as-is —
// only the LIST (which tabs, in what order, with what label) now comes from
// the registry's tree instead of being duplicated as a literal. One shared
// map covers both regions since the tab-id string per widget type doesn't
// depend on which region it's rendered in.
// UI-4f-5: every well-known region id can legitimately end up as a plain
// split's non-emphasized sibling -- chart-area sits beside whatever's on the
// dock's maximize path, and chart-column/right-sidebar sit beside each other
// at the root split during a sidebar collapse -- and each already has its
// own correct, self-managed sizing (chart-area's basis-14 sliver, the
// sidebar's own icon-rail-when-collapsed width, chart-column's ordinary
// flex-1 default). A first version of this fix protected only chart-area
// and broke sidebar-collapse outright: collapsing the sidebar made
// chart-column itself the "non-emphasized sibling" of the root split and hid
// the ENTIRE chart+dock area, confirmed by reproducing it directly (a fully
// blank workspace behind the collapsed icon rail). The correct rule is
// broader -- never suppress ANY well-known region, only a dynamically
// edge-drop-created one (which always gets a fresh "pane-"/"split-" id, so
// this set can never accidentally include one). LayoutTree stays generic
// either way -- it never hardcodes any of this itself, studio.tsx (which
// knows the well-known ids) supplies the opt-out. Module-level since it's a
// fixed set, not per-render state.
const NEVER_SUPPRESS_CHILD_IDS = new Set<string>(Object.values(WELL_KNOWN_NODE_IDS));

const WIDGET_TAB_ID: Partial<Record<WidgetTypeId, DockTab & RightTab>> = {
  watchlist: "watchlist",
  trade: "trade",
  "ai-builder": "ai",
  alerts: "alerts",
  "code-editor": "code",
  "strategy-tester": "tester",
  positions: "positions",
  orders: "orders",
  history: "history",
  journal: "journal",
  "saved-indicators": "saved",
  reference: "docs",
  scanner: "scanner",
  "volume-profile": "volprofile",
  "market-stats": "marketstats",
};
const TAB_ICON: Partial<Record<WidgetTypeId, typeof Star>> = {
  watchlist: Star,
  trade: Wallet,
  "ai-builder": Wand2,
  alerts: Bell,
  "saved-indicators": Save,
  history: History,
  reference: BookOpen,
  scanner: Search,
  "volume-profile": BarChart3,
  "market-stats": Gauge,
};

/**
 * Tab list for one workspace-tree "tabs" node — used for both the right
 * sidebar and bottom dock, live-derived from the current layout tree (not a
 * one-time snapshot), so add/remove/reorder/move actually re-render.
 */
type ComputedTab = {
  id: DockTab & RightTab;
  label: string;
  icon: typeof Star;
  instanceId: string;
  pinned: boolean;
  widgetTypeId: WidgetTypeId;
  /** Whether this widget's renderableRegions includes the OTHER region — gates the "Move to…" affordance. */
  canMoveToOtherRegion: boolean;
};

function computeTabsForNode(layout: WorkspaceLayout, nodeId: string): ComputedTab[] {
  const node = findNodeById(layout.root, nodeId);
  if (!node || node.kind !== "tabs") return [];
  const otherRegion = regionKindForNodeId(nodeId) === "sidebar" ? "dock" : "sidebar";
  const out: ComputedTab[] = [];
  for (const t of node.tabs) {
    const id = WIDGET_TAB_ID[t.widgetTypeId];
    if (!id) continue;
    out.push({
      id,
      label: t.title ?? getWidgetDef(t.widgetTypeId).label,
      icon: TAB_ICON[t.widgetTypeId] ?? Layers,
      instanceId: t.instanceId,
      pinned: Boolean(t.pinned),
      widgetTypeId: t.widgetTypeId,
      canMoveToOtherRegion: getWidgetDef(t.widgetTypeId).renderableRegions.includes(otherRegion),
    });
  }
  return out;
}

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


function StudioWorkspace() {

  const { user } = useAuth();
  const qc = useQueryClient();
  const signedIn = !!user;

  // UI-4g-2: chart runtime state is now genuinely per-instance, keyed by the
  // same workspace-tree instanceId UI-4g-1 already derived (was a
  // single-entry proof of concept there; now a second, independent entry can
  // exist). Every existing call site in this file that reads `symbol`,
  // `bars`, `indicators`, etc. or calls `setSymbol(...)`, `setIndicators(
  // ...)`, etc. keeps working completely unchanged below — those names
  // become derived getters/setters over "the ACTIVE chart's slice of this
  // map" instead of flat useState, so the large amount of existing
  // backtest-overlay/trade-line/drawing-tool/Code-Editor logic that assumes
  // "the chart" continues to work correctly, now correctly scoped to
  // whichever chart is active, without every one of those call sites having
  // to be individually rewritten. A second, non-active chart's own state is
  // read directly from this map by instance id (see `renderChartLeaf`),
  // bypassing the "active" derivation entirely.
  type ChartRuntimeState = {
    symbol: string;
    interval: string;
    chartType: ChartType;
    chartSettings: ChartSettings;
    bars: Bar[];
    barsError: string | null;
    barsLoading: boolean;
    indicators: StudioIndicator[];
    drawings: Drawing[];
    /** `"symbol:interval"` this instance's `bars` were actually fetched for — lets the fetch effect skip a redundant re-fetch when merely switching which chart is active, without re-fetching on every switch. */
    barsLoadedFor: string | null;
    /**
     * UI-4g-4: opt-in symbol/timeframe linking across chart instances — one
     * shared linked set, not named groups. Missing/"independent" never sends
     * or receives propagation; every chart from before this phase and every
     * newly-added chart defaults here. See `propagateLinkedChartField` for
     * the actual one-shot (non-chaining) propagation this drives.
     */
    linkMode: "independent" | "symbol" | "timeframe" | "both";
  };
  const DEFAULT_CHART_RUNTIME_STATE: ChartRuntimeState = {
    symbol: "BTCUSDT",
    interval: "15m",
    chartType: "candles",
    chartSettings: DEFAULT_CHART_SETTINGS,
    bars: [],
    barsError: null,
    barsLoading: true,
    indicators: [],
    drawings: [],
    barsLoadedFor: null,
    linkMode: "independent",
  };
  const [chartStatesMap, setChartStatesMap] = useState<Record<string, ChartRuntimeState>>({
    "chart-1": DEFAULT_CHART_RUNTIME_STATE,
  });
  // Mirrors `chartStatesMap` for synchronous reads from plain event-handler
  // functions (drawing create/edit/delete/undo/redo below) that must NOT
  // read state via a `setState` functional updater — see the long comment
  // above `addDrawing` for why. Kept in sync two ways: unconditionally every
  // render (covers the common case), AND eagerly inside `setChartField`
  // itself right when a new value is computed (covers back-to-back mutator
  // calls within the same synchronous tick, before React has re-rendered).
  // The eager write is safe to happen more than once for one call — like any
  // functional `setState` updater, React may invoke this one more than once
  // for a single commit (e.g. its eager-bailout check on an idle fiber), but
  // both invocations start from the same `prev` and so compute the same
  // `nextState`; assigning the same value to a ref twice is harmless. That
  // is the key distinction from the bug this file fixes: assignment is
  // idempotent, pushing a history entry is not.
  const chartStatesMapRef = useRef(chartStatesMap);
  chartStatesMapRef.current = chartStatesMap;
  const [activeChartInstanceId, setActiveChartInstanceId] = useState("chart-1");
  // Read inside the market-data effect's async .then() to confirm the fetch
  // is still for whichever chart is active NOW before touching the
  // page-level `lastPrice` display — a plain state read there could be
  // stale-closure-captured from whenever the effect was scheduled.
  const activeChartInstanceIdRef = useRef(activeChartInstanceId);
  useEffect(() => {
    activeChartInstanceIdRef.current = activeChartInstanceId;
  }, [activeChartInstanceId]);
  const setChartField = useCallback(
    <K extends keyof ChartRuntimeState>(
      instanceId: string,
      field: K,
      value: ChartRuntimeState[K] | ((prev: ChartRuntimeState[K]) => ChartRuntimeState[K]),
    ) => {
      setChartStatesMap((prev) => {
        const cur = prev[instanceId] ?? DEFAULT_CHART_RUNTIME_STATE;
        const nextVal = typeof value === "function" ? (value as (p: ChartRuntimeState[K]) => ChartRuntimeState[K])(cur[field]) : value;
        if (nextVal === cur[field]) return prev;
        const nextState = { ...prev, [instanceId]: { ...cur, [field]: nextVal } };
        chartStatesMapRef.current = nextState;
        return nextState;
      });
    },
    [],
  );
  /**
   * UI-4g-4: sets `field` on `forId` AND, in the same atomic update,
   * propagates the SAME new value to every OTHER chart instance whose own
   * `linkMode` also includes this field — one shot, not a chain (only
   * `prev`'s original entries are ever visited, so a propagated instance's
   * own resulting change is never itself treated as a new source to
   * propagate from). Only ever touches `symbol`/`interval` — indicators,
   * drawings, and chartSettings are never copied by linking, on purpose.
   * A chart whose own mode is "independent" neither sends (checked here)
   * nor receives (checked in the loop) propagation.
   */
  const propagateLinkedChartField = useCallback(
    (field: "symbol" | "interval", forId: string, value: string) => {
      setChartStatesMap((prev) => {
        const source = prev[forId] ?? DEFAULT_CHART_RUNTIME_STATE;
        let next = prev;
        if (next[forId]?.[field] !== value) {
          next = { ...next, [forId]: { ...(next[forId] ?? DEFAULT_CHART_RUNTIME_STATE), [field]: value } };
        }
        const sourceLinks =
          field === "symbol" ? source.linkMode === "symbol" || source.linkMode === "both"
          : source.linkMode === "timeframe" || source.linkMode === "both";
        if (!sourceLinks) return next;
        for (const [id, inst] of Object.entries(prev)) {
          if (id === forId) continue;
          const instLinks =
            field === "symbol" ? inst.linkMode === "symbol" || inst.linkMode === "both"
            : inst.linkMode === "timeframe" || inst.linkMode === "both";
          if (!instLinks || inst[field] === value) continue;
          next = { ...next, [id]: { ...inst, [field]: value } };
        }
        return next;
      });
    },
    [],
  );
  const activeChartState = chartStatesMap[activeChartInstanceId] ?? DEFAULT_CHART_RUNTIME_STATE;
  const symbol = activeChartState.symbol;
  const setSymbol = useCallback(
    (v: string | ((p: string) => string)) => {
      if (typeof v === "function") {
        setChartField(activeChartInstanceId, "symbol", v);
        return;
      }
      propagateLinkedChartField("symbol", activeChartInstanceId, v);
    },
    [activeChartInstanceId, setChartField, propagateLinkedChartField],
  );
  const interval = activeChartState.interval;
  const setIntervalStr = useCallback(
    (v: string | ((p: string) => string)) => {
      if (typeof v === "function") {
        setChartField(activeChartInstanceId, "interval", v);
        return;
      }
      propagateLinkedChartField("interval", activeChartInstanceId, v);
    },
    [activeChartInstanceId, setChartField, propagateLinkedChartField],
  );
  const bars = activeChartState.bars;
  const setBars = useCallback(
    (v: Bar[] | ((p: Bar[]) => Bar[])) => setChartField(activeChartInstanceId, "bars", v),
    [activeChartInstanceId, setChartField],
  );
  const barsError = activeChartState.barsError;
  const setBarsError = useCallback(
    (v: string | null | ((p: string | null) => string | null)) => setChartField(activeChartInstanceId, "barsError", v),
    [activeChartInstanceId, setChartField],
  );
  const barsLoading = activeChartState.barsLoading;
  const setBarsLoading = useCallback(
    (v: boolean | ((p: boolean) => boolean)) => setChartField(activeChartInstanceId, "barsLoading", v),
    [activeChartInstanceId, setChartField],
  );

  const [code, setCode] = useState(DEFAULT_SCRIPT);
  const indicators = activeChartState.indicators;
  const setIndicators = useCallback(
    (v: StudioIndicator[] | ((p: StudioIndicator[]) => StudioIndicator[])) =>
      setChartField(activeChartInstanceId, "indicators", v),
    [activeChartInstanceId, setChartField],
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [activeInputs, setActiveInputs] = useState<InputSpec[]>([]);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // UI-5d: which on-chart indicator's floating settings pop-out is open, if
  // any, and where the gear button that opened it sits (so the panel floats
  // beside it instead of a fixed corner). Purely a UI surface toggle — the
  // actual settings VALUES it edits are still `settings`/`activeInputs`
  // above, the same state the old inline Code-panel form used. Only one can
  // be open at a time, same as the code editor only ever edits one indicator
  // at a time today.
  const [settingsPopoutKey, setSettingsPopoutKey] = useState<string | null>(null);
  const [settingsPopoutAnchor, setSettingsPopoutAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // UI-5d: the manual code-edit workflow's own state — separate from
  // `runError`/`notice` (which cover many other flows: translating, paste,
  // AI build, live recompute) so a validation result never gets stomped by
  // or confused with an unrelated notice. `checkedSourceRef` remembers which
  // exact source string the last successful validation was FOR, so Apply
  // changes can tell a still-fresh validation from a stale one (the user
  // edited again since) without re-running the script twice for nothing.
  const [validation, setValidation] = useState<{ status: "idle" | "checking" | "valid" | "invalid"; error: string | null }>({
    status: "idle",
    error: null,
  });
  const checkedSourceRef = useRef<string | null>(null);
  // AI build session: the spec being patched by follow-up messages, plus the
  // chart slot its output owns so edits replace it instead of stacking.
  const [projectSpec, setProjectSpec] = useState<IndicatorSpec | null>(null);
  const builtKeyRef = useRef<string | null>(null);
  // UI-5c: the same AI build session's real, versioned identity
  // (public.indicators.id) once one exists — null until the first
  // successful Build. Kept alongside `projectSpec` (not owned by
  // AiSidePanel) so every place that already loads a saved project's spec
  // into the editor (Edit code / restore / version history) can point the
  // AI Builder's conversation at that SAME project instead of leaking a
  // different one's history into it.
  const [aiIndicatorId, setAiIndicatorId] = useState<string | null>(null);
  // "select" is the sole canonical Select/Cursor toolbar tool (Phase
  // 3D-15) — "cursor" itself still exists as a DrawTool value but is only
  // ever used internally now, for read-only chart panes (see the
  // hardcoded tool="cursor" further down).
  const [tool, setTool] = useState<DrawTool>("select");
  // Stable reference (Phase 3D-15 follow-up) — passed to StudioChart's
  // right-click-cancel handler, which lives inside an effect keyed in part
  // on this callback's identity. An inline arrow here would be a fresh
  // function every render, and this component re-renders very often (the
  // live price feed alone), which was tearing down and re-arming that
  // effect (and, with it, the Select-tool hover/pointerEvents state and
  // the crosshair position) far more often than any real tool change.
  // `setTool` itself is already stable (a useState setter), so an empty
  // dependency array is correct here, not a lint workaround.
  const handleCancelTool = useCallback(() => setTool("select"), []);
  // Backtest overlay: entry/exit markers from the last run of the current project.
  const [backtestTrades, setBacktestTrades] = useState<BacktestTrade[] | null>(null);
  // Prompt handed to the AI panel when the tester asks for missing rules.
  const [aiSeed, setAiSeed] = useState<string | null>(null);
  const drawings = activeChartState.drawings;
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [objectsOpen, setObjectsOpen] = useState(false);
  // Drawing-anchor snap strength (distinct from chartSettings.crosshairMagnet,
  // which only affects the crosshair display, not where a new anchor lands).
  // One studio-wide value, not per-chart — same rationale as `tool` itself.
  const [magnet, setMagnet] = useState<MagnetMode>("off");
  // Which drawing (by id) has its DrawingSettingsPopover open, if any, and
  // where (VIEWPORT coordinates) it should anchor near — set precisely from
  // the double-click position when opened that way (StudioChart's
  // onOpenDrawingSettings), or a sensible fixed near-the-chart default when
  // opened from the Objects panel's gear icon instead.
  const [drawingSettingsFor, setDrawingSettingsFor] = useState<string | null>(null);
  const [drawingSettingsAnchor, setDrawingSettingsAnchor] = useState<{ x: number; y: number }>({ x: 320, y: 110 });

  // UI-4c: live, mutable workspace layout tree — source of truth for which
  // widgets are open in the sidebar/dock and in what order.
  // UI-4d: persisted locally (localStorage) so add/remove/reorder/move
  // customizations, and any named saved layouts, survive a reload. Signed-in
  // Supabase persistence (src/lib/workspace-layouts.functions.ts) exists but
  // isn't wired into this initial-load path yet — local storage is the only
  // source of truth today, exactly like every other piece of Chart Studio's
  // per-device UI state.
  // Initialized with safe, SSR-identical defaults (PRESETS.beginner) — NOT
  // read from localStorage here, which would read real client-only data
  // during the very first client render (before hydration reconciles
  // against the server's markup) and produce a genuine hydration mismatch,
  // since the server never has localStorage to read at all. Loading the
  // real persisted store happens in the mount effect below instead, exactly
  // matching how the pre-existing `sg.studio.layout` persistence already
  // does it elsewhere in this file (read in an effect, not an initializer).
  const [workspaceStore, setWorkspaceStore] = useState<LocalWorkspaceStore>(() => defaultLocalStore());
  const [layout, setLayout] = useState<WorkspaceLayout>(PRESETS.beginner);
  // UI-4f-2: react-resizable-panels' Panel `defaultSize` is an
  // uncontrolled/mount-once prop, like HTML's `defaultValue` -- once a Panel
  // has mounted, changing `defaultSize` on a later render does NOT resize
  // it. Every place that WHOLESALE REPLACES `layout` with a different tree
  // (initial load from storage, a cloud sync, switching to a preset or a
  // named saved layout, the delete-active-layout fallback) can carry
  // different `sizes` than whatever's currently mounted, so the resizable
  // tree needs to remount for those to actually apply -- confirmed missing
  // via an explicit persists-across-reload check, not assumed. Bumping
  // `layoutKey` (used as LayoutTree's React `key`) forces exactly that.
  // Deliberately NOT bumped by the widget-mutation handlers (add/remove/
  // reorder/move, which don't touch sizes) or by a resize-drag commit
  // (which only writes back what's already live in the DOM from the drag
  // itself) -- remounting there would be unnecessary and would visibly
  // flash/reset the tree on every ordinary interaction.
  /**
   * UI-4g-2: rebuilds `chartStatesMap` from EVERY chart instance found in a
   * given tree, seeding each from its own persisted `chartConfig` (falling
   * back to defaults for one that has none — any layout saved before this
   * phase, or a freshly-created chart whose config write hasn't landed in
   * the tree yet). Called at every "wholesale replace the layout" site
   * (initial load, preset switch, named-layout switch, cloud sync,
   * delete-active-layout fallback) alongside `bumpLayoutKey` — both exist
   * for the same underlying reason: something just replaced the ENTIRE
   * layout, not an incremental edit, so every piece of per-instance runtime
   * state derived from it needs to be rebuilt to match, not just the tree
   * itself. Returns the id of the first chart instance found (or the
   * existing "chart-1" fallback if the tree somehow has none), for the
   * caller to also set as active.
   */
  const seedChartStatesFromLayout = useCallback((next: WorkspaceLayout) => {
    const found: Record<string, ChartRuntimeState> = {};
    function walk(node: LayoutNode) {
      if (node.kind === "tabs") {
        for (const tab of node.tabs) {
          if (tab.widgetTypeId !== "chart") continue;
          const cfg = tab.chartConfig;
          const symbol = cfg?.symbol ?? DEFAULT_CHART_RUNTIME_STATE.symbol;
          const interval = cfg?.interval ?? DEFAULT_CHART_RUNTIME_STATE.interval;
          found[tab.instanceId] = {
            ...DEFAULT_CHART_RUNTIME_STATE,
            symbol,
            interval,
            chartType: (cfg?.chartType as ChartType | undefined) ?? DEFAULT_CHART_RUNTIME_STATE.chartType,
            chartSettings: cfg?.settings
              ? ({ ...DEFAULT_CHART_SETTINGS, ...(cfg.settings as Partial<ChartSettings>) } as ChartSettings)
              : DEFAULT_CHART_RUNTIME_STATE.chartSettings,
            linkMode: cfg?.linkMode ?? DEFAULT_CHART_RUNTIME_STATE.linkMode,
            // This call REPLACES chartStatesMap wholesale (a plain
            // setChartStatesMap(found) below, not a merge) — every site that
            // triggers it (initial load, preset switch, named-layout
            // switch, cloud sync) would otherwise silently discard each
            // chart's drawings back to `[]`, since a fresh runtime-state
            // object built from DEFAULT_CHART_RUNTIME_STATE has no way to
            // know what was saved. Hydrating from the SAME persisted store
            // `StudioChart`'s own drawings-persistence effect reads keeps
            // this one atomic instead of racing that effect's async
            // setChartField (see the "justHydratedRef" comment further
            // down for the mount-order race this sidesteps entirely).
            drawings: loadDrawingsFor(tab.instanceId, symbol, interval) as Drawing[],
          };
        }
        return;
      }
      node.children.forEach(walk);
    }
    walk(next.root);
    const firstId = Object.keys(found)[0] ?? "chart-1";
    if (!found[firstId]) found[firstId] = DEFAULT_CHART_RUNTIME_STATE;
    setChartStatesMap(found);
    setActiveChartInstanceId(firstId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [layoutKey, setLayoutKey] = useState(0);
  const bumpLayoutKey = useCallback(() => setLayoutKey((k) => k + 1), []);
  useEffect(() => {
    const store = loadLocalStore();
    const initial = initialWorkspaceLayout(store);
    // initialWorkspaceLayout prefers defaultLayoutId over the stored active
    // pointer — if that's what actually got loaded, activeLayoutId must
    // reflect it too, or the Layouts menu would show "Current (unsaved)" as
    // active while a different, named layout is really on screen.
    const usedDefault = store.defaultLayoutId && store.layouts.some((l) => l.id === store.defaultLayoutId);
    setWorkspaceStore(usedDefault ? { ...store, activeLayoutId: store.defaultLayoutId as string } : store);
    setLayout(initial);
    seedChartStatesFromLayout(initial);
    bumpLayoutKey();
  }, [bumpLayoutKey, seedChartStatesFromLayout]);

  // Mirror the live tree into the store's scratch slot whenever it changes —
  // this is what "Current (unsaved)" means, and what makes a reload land
  // back on it without the user having to name/save anything first. Named
  // layouts (layouts[]) are NOT touched by this — they only change when the
  // user explicitly saves again (see saveActiveNamedLayout below).
  //
  // UI-8 bugfix: skip this effect's very first (mount) run, AND skip the
  // persist effect's very first run below, for the same reason. On mount,
  // EVERY effect in this component fires once in the SAME commit, each
  // using THAT render's closures — still `layout = PRESETS.beginner` and
  // `workspaceStore = defaultLocalStore()` (the `useState` initializers),
  // not yet whatever the load effect above just found via `loadLocalStore()`
  // (its `setLayout`/`setWorkspaceStore` calls only apply to the NEXT
  // render; sibling effects in the same commit don't see them). Left
  // unguarded, this effect used that stale `layout` to blow the real loaded
  // layout's name back to "Beginner" inside `workspaceStore`, and the
  // persist effect below then wrote that corrupted value to localStorage —
  // reproducible even without any onboarding/AI-Builder change involved,
  // just by switching to any non-Beginner preset via the ordinary Layouts
  // menu and reloading (confirmed via `git stash` against pre-UI-8 HEAD:
  // present there too). Because Chart Studio's route can genuinely remount
  // this whole component more than once during one page load (TanStack
  // Router's pending -> resolved swap under this route's `ssr: false`,
  // confirmed via instrumentation), guarding only the mirror effect was not
  // sufficient by itself — the persist effect's OWN stale first write could
  // still land on disk before a second mount's load effect ever ran, and
  // that second mount would then load the corrupted value as if it were the
  // real saved preference. Guarding both effects' first pass means neither
  // one ever touches `workspaceStore`/disk before the real loaded value is
  // in play, on any mount, so nothing is ever written to correct later.
  // Once `layout`/`workspaceStore` update for real (next render), each
  // effect reruns anyway (their own dependency), so skipping the mount run
  // loses nothing.
  const mirrorMountedRef = useRef(false);
  useEffect(() => {
    if (!mirrorMountedRef.current) {
      mirrorMountedRef.current = true;
      return;
    }
    setWorkspaceStore((prev) => (prev.currentLayout === layout ? prev : { ...prev, currentLayout: layout }));
  }, [layout]);

  // Persist the whole store — named layouts, active/default pointers, and
  // the mirrored scratch slot — whenever any of it changes. The only place
  // that writes to localStorage; every action below just calls
  // setWorkspaceStore and this effect does the actual autosave.
  const saveMountedRef = useRef(false);
  useEffect(() => {
    if (!saveMountedRef.current) {
      saveMountedRef.current = true;
      return;
    }
    saveLocalStore(workspaceStore);
  }, [workspaceStore]);

  // Cloud sync (UI-4d, signed-in half). Signed-out behavior above is
  // completely untouched -- everything below only ever runs when signedIn.
  // Reads always prefer the cloud once signed in; the only writes are the
  // one-time local->cloud import below and explicit user actions (save/
  // rename/set-default/delete) -- there is no automatic background push of
  // local state, so a stale local copy can never silently clobber something
  // newer server-side.
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const cloudReconciled = useRef(false);
  const cloudLayoutsQuery = useQuery({
    queryKey: ["workspace-layouts", user?.id],
    queryFn: () => listWorkspaceLayouts(),
    enabled: signedIn,
    retry: 1,
  });

  useEffect(() => {
    if (!signedIn) {
      cloudReconciled.current = false; // re-arm for the next sign-in
      return;
    }
    if (!cloudLayoutsQuery.isSuccess || cloudReconciled.current) return;
    cloudReconciled.current = true;

    const rows = cloudLayoutsQuery.data;
    (async () => {
      try {
        if (rows.length > 0) {
          // Cloud is authoritative -- parse every row through the same
          // resilience gate local data already goes through, so a
          // malformed `layout` JSONB value degrades exactly like a
          // corrupted localStorage value does (repair or fall back to
          // Beginner, never throw).
          const parsed: WorkspaceLayout[] = rows.map((r) => ({
            ...safeParseWorkspaceLayout(r.layout),
            id: r.id,
            name: r.name,
          }));
          const defaultRow = rows.find((r) => r.is_default);
          const activeId = (defaultRow ?? rows[0]).id as string;
          const active = parsed.find((p) => p.id === activeId) ?? parsed[0];
          setWorkspaceStore((prev) => ({
            ...prev,
            layouts: parsed,
            activeLayoutId: activeId,
            defaultLayoutId: (defaultRow?.id as string | undefined) ?? null,
          }));
          setLayout(active);
          seedChartStatesFromLayout(active);
          bumpLayoutKey();
          setCloudSyncError(null);
        } else if (!hasMigratedToCloud() && workspaceStore.layouts.length > 0) {
          // First sign-in with local customizations already made, and
          // nothing in the cloud yet -- import once, then treat the cloud
          // as authoritative from here on.
          for (const l of workspaceStore.layouts) {
            await saveWorkspaceLayout({
              data: { name: l.name, layout: l as unknown as Record<string, unknown> },
            });
          }
          markMigratedToCloud();
          await qc.invalidateQueries({ queryKey: ["workspace-layouts", user?.id] });
          cloudReconciled.current = false; // let the refetch's result run through this effect again
        } else {
          markMigratedToCloud();
        }
      } catch {
        // Network/server failure: keep whatever's already showing (the
        // local cache) and surface it honestly instead of pretending to
        // have synced.
        setCloudSyncError("Couldn't sync with your account — showing your local layouts.");
      }
    })();
    // workspaceStore.layouts is read only for the one-time-import branch,
    // deliberately not a dependency -- this effect is keyed on the sign-in
    // transition and the cloud query settling, not on local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, cloudLayoutsQuery.isSuccess, cloudLayoutsQuery.data, qc, user?.id]);

  const switchToLayout = useCallback(
    (id: string) => {
      if (id === CURRENT_LAYOUT_ID) {
        setLayout(workspaceStore.currentLayout);
        seedChartStatesFromLayout(workspaceStore.currentLayout);
        bumpLayoutKey();
        setWorkspaceStore((prev) => ({ ...prev, activeLayoutId: CURRENT_LAYOUT_ID }));
        return;
      }
      const found = workspaceStore.layouts.find((l) => l.id === id);
      if (!found) return;
      setLayout(found);
      seedChartStatesFromLayout(found);
      bumpLayoutKey();
      setWorkspaceStore((prev) => ({ ...prev, activeLayoutId: id }));
    },
    [workspaceStore, bumpLayoutKey, seedChartStatesFromLayout],
  );
  const saveAsNewLayout = useCallback(
    async (name: string) => {
      if (signedIn) {
        try {
          const res = await saveWorkspaceLayout({
            data: { name, layout: layout as unknown as Record<string, unknown> },
          });
          const saved: WorkspaceLayout = { ...layout, id: res.id, name, isPreset: false };
          setWorkspaceStore((prev) => ({ ...prev, layouts: [...prev.layouts, saved], activeLayoutId: res.id }));
          setCloudSyncError(null);
        } catch {
          setCloudSyncError("Couldn't save to your account -- try again.");
        }
        return;
      }
      const id = crypto.randomUUID();
      const saved: WorkspaceLayout = { ...layout, id, name, isPreset: false };
      setWorkspaceStore((prev) => ({ ...prev, layouts: [...prev.layouts, saved], activeLayoutId: id }));
    },
    [layout, signedIn],
  );
  const saveActiveNamedLayout = useCallback(async () => {
    if (workspaceStore.activeLayoutId === CURRENT_LAYOUT_ID) return;
    const existing = workspaceStore.layouts.find((l) => l.id === workspaceStore.activeLayoutId);
    if (!existing) return;
    const updated: WorkspaceLayout = { ...layout, id: existing.id, name: existing.name, isPreset: false };
    if (signedIn) {
      try {
        await saveWorkspaceLayout({
          data: { id: updated.id, name: updated.name, layout: updated as unknown as Record<string, unknown> },
        });
        setCloudSyncError(null);
      } catch {
        setCloudSyncError("Couldn't save to your account -- try again.");
        return; // server write failed -- don't let local state drift ahead of the cloud
      }
    }
    setWorkspaceStore((prev) => ({
      ...prev,
      layouts: prev.layouts.map((l) => (l.id === updated.id ? updated : l)),
    }));
  }, [layout, signedIn, workspaceStore]);
  const renameLayout = useCallback(
    async (id: string, name: string) => {
      const existing = workspaceStore.layouts.find((l) => l.id === id);
      if (!existing) return;
      if (signedIn) {
        try {
          await saveWorkspaceLayout({
            data: { id, name, layout: existing as unknown as Record<string, unknown> },
          });
          setCloudSyncError(null);
        } catch {
          setCloudSyncError("Couldn't rename in your account -- try again.");
          return;
        }
      }
      setWorkspaceStore((prev) => ({
        ...prev,
        layouts: prev.layouts.map((l) => (l.id === id ? { ...l, name } : l)),
      }));
    },
    [signedIn, workspaceStore],
  );
  const deleteLayout = useCallback(
    async (id: string) => {
      if (signedIn) {
        try {
          await deleteWorkspaceLayout({ data: { id } });
          setCloudSyncError(null);
        } catch {
          setCloudSyncError("Couldn't delete from your account -- try again.");
          return; // keep it locally too, so local and cloud don't drift apart
        }
      }
      const wasActive = workspaceStore.activeLayoutId === id;
      setWorkspaceStore((prev) => ({
        ...prev,
        layouts: prev.layouts.filter((l) => l.id !== id),
        activeLayoutId: prev.activeLayoutId === id ? CURRENT_LAYOUT_ID : prev.activeLayoutId,
        defaultLayoutId: prev.defaultLayoutId === id ? null : prev.defaultLayoutId,
      }));
      if (wasActive) {
        setLayout(workspaceStore.currentLayout);
        seedChartStatesFromLayout(workspaceStore.currentLayout);
        bumpLayoutKey();
      }
    },
    [workspaceStore, signedIn, bumpLayoutKey, seedChartStatesFromLayout],
  );
  const setDefaultLayout = useCallback(
    async (id: string | null) => {
      if (signedIn) {
        try {
          await setDefaultWorkspaceLayout({ data: { id } });
          setCloudSyncError(null);
        } catch {
          setCloudSyncError("Couldn't update your default layout -- try again.");
          return;
        }
      }
      setWorkspaceStore((prev) => ({ ...prev, defaultLayoutId: id }));
    },
    [signedIn],
  );
  const presetOptions = useMemo(
    () =>
      PRESET_ORDER.map((id) => ({
        id,
        name: PRESETS[id].name,
        locked: isPresetLocked(PRESETS[id]),
      })),
    [],
  );
  const rightTabs = useMemo(
    () => computeTabsForNode(layout, WELL_KNOWN_NODE_IDS.rightSidebar),
    [layout],
  );
  const dockTabsList = useMemo(
    () => computeTabsForNode(layout, WELL_KNOWN_NODE_IDS.bottomDock),
    [layout],
  );
  const rightWidgetTypeIds = useMemo(() => {
    const node = findNodeById(layout.root, WELL_KNOWN_NODE_IDS.rightSidebar);
    return node && node.kind === "tabs" ? node.tabs.map((t) => t.widgetTypeId) : [];
  }, [layout]);
  const dockWidgetTypeIds = useMemo(() => {
    const node = findNodeById(layout.root, WELL_KNOWN_NODE_IDS.bottomDock);
    return node && node.kind === "tabs" ? node.tabs.map((t) => t.widgetTypeId) : [];
  }, [layout]);

  /** Keeps the legacy `dock`/`rightTab` selection state in sync with a node's activeInstanceId after any layout mutation that could change it. */
  const syncActiveTab = useCallback((newLayout: WorkspaceLayout, nodeId: string) => {
    const node = findNodeById(newLayout.root, nodeId);
    if (!node || node.kind !== "tabs") return;
    const active = node.tabs.find((t) => t.instanceId === node.activeInstanceId);
    const id = active ? WIDGET_TAB_ID[active.widgetTypeId] : undefined;
    if (!id) return;
    if (nodeId === WELL_KNOWN_NODE_IDS.rightSidebar) setRightTab(id);
    else if (nodeId === WELL_KNOWN_NODE_IDS.bottomDock) setDock(id);
  }, []);

  const switchToPreset = useCallback(
    (presetId: PresetId) => {
      const next = PRESETS[presetId];
      setLayout(next);
      seedChartStatesFromLayout(next);
      bumpLayoutKey();
      syncActiveTab(next, WELL_KNOWN_NODE_IDS.rightSidebar);
      syncActiveTab(next, WELL_KNOWN_NODE_IDS.bottomDock);
      setWorkspaceStore((prev) => ({ ...prev, activeLayoutId: CURRENT_LAYOUT_ID }));
    },
    [syncActiveTab, bumpLayoutKey, seedChartStatesFromLayout],
  );

  const addWidget = useCallback(
    (nodeId: string, widgetTypeId: WidgetTypeId) => {
      setLayout((prev) => {
        const next = addWidgetToNode(prev, nodeId, widgetTypeId);
        syncActiveTab(next, nodeId);
        return next;
      });
    },
    [syncActiveTab],
  );
  const removeWidget = useCallback(
    (nodeId: string, instanceId: string) => {
      setLayout((prev) => {
        const next = removeWidgetFromNode(prev, nodeId, instanceId);
        syncActiveTab(next, nodeId);
        return next;
      });
    },
    [syncActiveTab],
  );
  const reorderWidget = useCallback((nodeId: string, fromIndex: number, toIndex: number) => {
    setLayout((prev) => reorderWithinNode(prev, nodeId, fromIndex, toIndex));
  }, []);
  const moveWidget = useCallback(
    (instanceId: string, fromNodeId: string, toNodeId: string) => {
      setLayout((prev) => {
        const next = moveWidgetBetweenNodes(prev, instanceId, fromNodeId, toNodeId);
        syncActiveTab(next, fromNodeId);
        syncActiveTab(next, toNodeId);
        return next;
      });
    },
    [syncActiveTab],
  );
  /**
   * Edge-drop (UI-4f-4): wraps `targetNodeId` in a brand-new split pane
   * holding the dragged widget. Unlike ordinary widget add/remove, this
   * changes the TREE SHAPE itself (a new split + a new leaf, not just a
   * tabs array) — `Panel.defaultSize` is uncontrolled (see the layoutKey
   * comment above), so the newly-created Panels need a clean remount to
   * pick up their initial 50/50 sizes correctly, same as a preset switch.
   */
  const splitWidget = useCallback(
    (instanceId: string, fromNodeId: string, targetNodeId: string, edge: DropEdge) => {
      setLayout((prev) => {
        const next = splitLeafWithWidget(prev, instanceId, fromNodeId, targetNodeId, edge);
        if (next === prev) return prev;
        syncActiveTab(next, fromNodeId);
        bumpLayoutKey();
        return next;
      });
    },
    [syncActiveTab, bumpLayoutKey],
  );
  /** Sets the active tab within a generically-rendered leaf (UI-4f-4) — new
   * leaves have no `dock`/`rightTab`-style state variable of their own, they
   * read/write `activeInstanceId` straight off the tree node itself. */
  const setActiveTabInLeaf = useCallback((nodeId: string, instanceId: string) => {
    setLayout((prev) => setActiveTabInTree(prev, nodeId, instanceId));
  }, []);

  /** UI-4g-2: the id of whichever "tabs" leaf currently holds a given widget instance, or null. */
  const findLeafIdHoldingInstance = useCallback((root: LayoutNode, instanceId: string): string | null => {
    if (root.kind === "tabs") {
      return root.tabs.some((t) => t.instanceId === instanceId) ? root.id : null;
    }
    for (const child of root.children) {
      const found = findLeafIdHoldingInstance(child, instanceId);
      if (found) return found;
    }
    return null;
  }, []);

  /**
   * UI-4g-2: "Add Chart" — creates a brand-new, independent chart instance
   * as a new pane split to the right of whichever chart is currently active,
   * seeded with that same chart's current symbol/interval/type/settings (a
   * sensible "duplicate this chart, then change it" starting point) so it
   * isn't just a blank BTCUSDT/15m every time. Enforces the 4-instance cap
   * at the mutator level (createInstanceAsNewPane) — a no-op past the cap,
   * not a silent partial success.
   */
  const addChartInstance = useCallback(() => {
    const hostLeafId = findLeafIdHoldingInstance(layout.root, activeChartInstanceId) ?? WELL_KNOWN_NODE_IDS.chartArea;
    const seedFrom = chartStatesMap[activeChartInstanceId] ?? DEFAULT_CHART_RUNTIME_STATE;
    const chartConfig: WidgetInstance["chartConfig"] = {
      symbol: seedFrom.symbol,
      interval: seedFrom.interval,
      chartType: seedFrom.chartType,
      settings: seedFrom.chartSettings as unknown as Record<string, unknown>,
    };
    const { layout: nextLayout, instanceId: newId } = createInstanceAsNewPane(
      layout,
      "chart",
      hostLeafId,
      "right",
      chartConfig,
    );
    if (!newId) return; // rejected: cap reached, or target not found
    setChartStatesMap((prev) => ({
      ...prev,
      [newId]: {
        ...DEFAULT_CHART_RUNTIME_STATE,
        symbol: seedFrom.symbol,
        interval: seedFrom.interval,
        chartType: seedFrom.chartType,
        chartSettings: seedFrom.chartSettings,
      },
    }));
    setLayout(nextLayout);
    bumpLayoutKey();
    setActiveChartInstanceId(newId);
  }, [layout, activeChartInstanceId, chartStatesMap, findLeafIdHoldingInstance, bumpLayoutKey]);

  /**
   * UI-4g-2: closes one chart instance. Routes through the exact same
   * `removeWidget` path every other widget close already uses — the
   * mutator's own `wouldLeaveNoInstancesOfType` check rejects closing the
   * LAST remaining chart regardless of which node currently hosts it, same
   * as clicking close on it would. If the closed instance was active,
   * activation falls back to whichever chart instance remains.
   */
  const closeChartInstance = useCallback(
    (instanceId: string, nodeId: string) => {
      setLayout((prev) => {
        const next = removeWidgetFromNode(prev, nodeId, instanceId);
        if (next === prev) return prev; // rejected (last remaining chart)
        setChartStatesMap((prevStates) => {
          const { [instanceId]: _removed, ...rest } = prevStates;
          return rest;
        });
        clearDrawingHistory(instanceId);
        if (activeChartInstanceId === instanceId) {
          const stillThere = findLeafIdHoldingInstance(next.root, instanceId);
          if (!stillThere) {
            // Find any surviving chart instance to activate instead.
            function firstChartId(n: LayoutNode): string | null {
              if (n.kind === "tabs") {
                const t = n.tabs.find((tab) => tab.widgetTypeId === "chart");
                return t ? t.instanceId : null;
              }
              for (const c of n.children) {
                const found = firstChartId(c);
                if (found) return found;
              }
              return null;
            }
            const fallback = firstChartId(next.root);
            if (fallback) setActiveChartInstanceId(fallback);
          }
        }
        bumpLayoutKey();
        return next;
      });
    },
    [activeChartInstanceId, findLeafIdHoldingInstance, bumpLayoutKey],
  );

  const [dock, setDock] = useState<DockTab>("code");
  const [dockState, setDockState] = useState<"collapsed" | "normal" | "maximized">("normal");
  /**
   * Cross-strip tab drag (UI-4f-3, extended UI-4f-4). `draggingTab` is set on
   * dragstart and cleared on dragend/drop; `canCrossRegion` mirrors the same
   * `canMoveToOtherRegion` capability check already computed per-tab, so the
   * drop-target highlight in `dragOverNodeId` only ever lights up a strip
   * the dragged widget could actually land in — the authoritative rejection
   * still happens in `moveWidgetBetweenNodes` itself either way, this is
   * just the UI not offering what would be rejected anyway. `widgetTypeId`
   * (UI-4f-4) additionally gates whether the new edge-drop zones appear at
   * all, via `isPortableForNewLeaf` — a widget without proven portable
   * content rendering (see mutations.ts) never shows edge zones, only the
   * pre-existing center-drop.
   */
  const [draggingTab, setDraggingTab] = useState<{
    fromNodeId: string;
    instanceId: string;
    canCrossRegion: boolean;
    widgetTypeId: WidgetTypeId;
  } | null>(null);
  /**
   * Which of the 5 zones (UI-4f-4) a cross-leaf drag is currently hovering,
   * if any — purely a visual concern, computed cheaply from pointer position
   * on every dragover (see `pickDropZone`), never touching the persisted
   * layout until an actual drop. `dragOverNodeId` (UI-4f-3) stays a separate,
   * simpler highlight for the two well-known regions' own container-level
   * drop handlers, which this doesn't replace.
   */
  const [dragZone, setDragZone] = useState<{ nodeId: string; zone: DropZone } | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const [live, setLive] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  // workspace chrome
  const chartType = activeChartState.chartType;
  const setChartType = useCallback(
    (v: ChartType | ((p: ChartType) => ChartType)) => setChartField(activeChartInstanceId, "chartType", v),
    [activeChartInstanceId, setChartField],
  );
  const chartSettings = activeChartState.chartSettings;
  const setChartSettings = useCallback(
    (v: ChartSettings | ((p: ChartSettings) => ChartSettings)) =>
      setChartField(activeChartInstanceId, "chartSettings", v),
    [activeChartInstanceId, setChartField],
  );
  const [crosshair, setCrosshair] = useState<CrosshairInfo | null>(null);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [menu, setMenu] = useState<null | "tf" | "type" | "settings">(null);
  const [favTfs, setFavTfs] = useState<string[]>(DEFAULT_FAVORITE_TIMEFRAMES);
  const [sidebarState, setSidebarState] = useState<"expanded" | "collapsed">("expanded");
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
  // UI-4g-2: deliberately does NOT restore symbol/interval/chartType/
  // settings from this blob anymore -- it predates multi-chart and is
  // chart-instance-agnostic (one global "last touched" value), so restoring
  // from it here raced with seedChartStatesFromLayout on mount: both fire
  // in the same initial commit, this effect's setSymbol/setIntervalStr shim
  // closures still resolve to render-1's default activeChartInstanceId
  // ("chart-1"), and unconditionally overwrote chart-1's freshly-seeded,
  // correct per-instance config with whatever chart was last active before
  // reload. Each chart's own config now lives in the tree itself
  // (WidgetInstance.chartConfig) and is restored per-instance by
  // seedChartStatesFromLayout instead. dock/rightTab/sidebar state aren't
  // chart-specific and aren't part of the tree, so they still restore here.
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
        dockState: "collapsed" | "normal" | "maximized";
        rightTab: RightTab;
        sidebarState: "expanded" | "collapsed";
      }>;
      if (l.dock) setDock(l.dock);
      if (l.dockState) setDockState(l.dockState);
      if (l.rightTab) setRightTab(l.rightTab);
      if (l.sidebarState) setSidebarState(l.sidebarState);
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
          dockState,
          rightTab,
          sidebarState,
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
    dockState,
    rightTab,
    sidebarState,
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

  /**
   * UI-5 close-out gap #1: Chart / Split / Code is a thin derived view over
   * `dock`/`dockState` — NOT a second layout/visibility engine. "Chart" is
   * exactly `dockState === "collapsed"` (whatever tab was last docked stays
   * remembered, just hidden). "Split" and "Code" both mean the dock is
   * showing the code surface (`dock === "code"`), just at `"normal"` vs
   * `"maximized"` size. Because this only ever calls setDock/setDockState —
   * the exact same setters every pre-existing dock control already uses —
   * it can never reset chart/project/version/editing state, and
   * activeChartInstanceId (multi-chart targeting) is untouched entirely.
   * `viewMode` is `null` when the dock is open on some other tab (e.g. the
   * user picked "Saved"/"Watchlist" from the dock's own tab strip) — none of
   * the three segments claims to represent that state.
   */
  type ViewMode = "chart" | "split" | "code";
  const viewMode: ViewMode | null = !dockVisible
    ? "chart"
    : dock !== "code"
      ? null
      : dockState === "maximized"
        ? "code"
        : "split";
  const setViewMode = useCallback((m: ViewMode) => {
    if (m === "chart") {
      setDockState("collapsed");
      return;
    }
    setDock("code");
    setDockState(m === "code" ? "maximized" : "normal");
  }, []);

  /**
   * UI-5c-studio-shell-fix: makes a widget instance's tab the visible one,
   * wherever it currently lives (right sidebar, bottom dock, or a
   * generic edge-drop leaf), and if it isn't open ANYWHERE in the current
   * layout, adds one to the right sidebar first — every preset that
   * includes this widget already places it there, and `addWidgetToNode`
   * itself already sets a freshly-added tab as its node's active one. This
   * is the shared "make this singleton widget visible" primitive the
   * global rail's New/History/Alerts shortcuts all use — it never touches
   * indicator/AI build state itself, only which tab is showing.
   */
  const focusWidgetTab = useCallback(
    (widgetTypeId: WidgetTypeId) => {
      const tabId = WIDGET_TAB_ID[widgetTypeId];
      const existing = findWidgetInstance(layout.root, widgetTypeId);
      if (existing) {
        const leafId = findLeafIdHoldingInstance(layout.root, existing.instanceId);
        if (leafId === WELL_KNOWN_NODE_IDS.rightSidebar) {
          openSidebar();
          if (tabId) setRightTab(tabId);
        } else if (leafId === WELL_KNOWN_NODE_IDS.bottomDock) {
          openDock();
          if (tabId) setDock(tabId);
        } else if (leafId) {
          setActiveTabInLeaf(leafId, existing.instanceId);
        }
        return;
      }
      setLayout((prev) => addWidgetToNode(prev, WELL_KNOWN_NODE_IDS.rightSidebar, widgetTypeId));
      openSidebar();
      if (tabId) setRightTab(tabId);
    },
    [layout, findLeafIdHoldingInstance, openSidebar, openDock, setActiveTabInLeaf],
  );

  const listIndicatorsFn = useServerFn(listIndicators);
  const createIndicatorFn = useServerFn(createIndicator);
  const updateIndicatorFn = useServerFn(updateIndicator);
  const deleteIndicatorFn = useServerFn(deleteIndicator);
  const duplicateIndicatorFn = useServerFn(duplicateIndicator);
  const listVersionsFn = useServerFn(listVersions);
  const restoreVersionFn = useServerFn(restoreVersion);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  /**
   * UI-5c-studio-shell-fix: the ONE "start a fresh AI Builder project"
   * reset — same three lines "Pick a template" already used inline before
   * this pass (see the onPickTemplate handler below). Factored out so the
   * global rail's New icon triggers this exact mechanism instead of a
   * second, competing one.
   */
  const resetAiBuildSession = useCallback(() => {
    setProjectSpec(null);
    setAiIndicatorId(null);
    builtKeyRef.current = null;
  }, []);

  /** Global rail "New": starts a fresh AI Builder project and brings the AI panel into view. */
  const handleNewAiProject = useCallback(() => {
    setEditingKey(null);
    setCode(DEFAULT_SCRIPT);
    resetAiBuildSession();
    focusWidgetTab("ai-builder");
  }, [resetAiBuildSession, focusWidgetTab]);

  /**
   * Global rail "History": opens Chart Studio's persisted AI-project
   * history surface — the Saved dock panel (per-project version history via
   * `historyFor`/`listVersions`), NOT the dock's own "history" tab (that one
   * is unrelated trade-order history, see the DockTab union above). If an
   * AI Builder project is currently open, its own version-history row is
   * expanded immediately instead of leaving the user to find it in the list.
   */
  const handleOpenAiHistory = useCallback(() => {
    focusWidgetTab("saved-indicators");
    if (aiIndicatorId) setHistoryFor(aiIndicatorId);
  }, [focusWidgetTab, aiIndicatorId]);

  /**
   * Global rail "Alerts": no distinct site-wide notifications system exists
   * in this codebase (confirmed by search) — the old /app bell's real
   * backing data now lives entirely inside Chart Studio's own trading
   * Alerts widget (AlertsSidePanel, `alert_notifications`). This is an
   * honest shortcut to that SAME widget instance, not a second one.
   */
  const handleOpenAlerts = useCallback(() => {
    focusWidgetTab("alerts");
  }, [focusWidgetTab]);

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
  // UI-4g-2 fix: fetches EVERY chart instance's own bars independently of
  // which one is "active" — the original version of this effect only ever
  // fetched for `activeChartInstanceId`, so a second, non-active chart's
  // `bars` stayed permanently empty (confirmed by direct reproduction: a
  // two-chart layout loaded cold showed the active chart's candles but left
  // the other chart blank indefinitely, even seconds later). "Active" now
  // only governs the top-toolbar/lastPrice display (see the resync effect
  // below), never which chart's market data gets loaded.
  //
  // Depends on a derived signature (id:symbol:interval per instance, not the
  // raw `chartStatesMap`) so this only re-fires when an instance is added/
  // removed or a symbol/interval actually changes — not on every bars/
  // indicator/drawing update to any instance, which the raw map would
  // trigger on. `barsLoadedFor` still dedupes per instance: an instance
  // whose bars already match its own current symbol/interval is skipped.
  //
  // UI-4g-3 fix: `layoutKey` is included below too. `seedChartStatesFromLayout`
  // wholesale-replaces chartStatesMap on every preset/named-layout switch,
  // resetting each instance's `bars`/`barsLoadedFor` to fresh (null) state —
  // but if the new preset's chart happens to reuse the same instance id AND
  // the same symbol/interval as what was already on screen (e.g. switching
  // into "Single Chart", BTCUSDT/15m, from the also-BTCUSDT/15m default),
  // the `id:symbol:interval` signature string is byte-identical before and
  // after, so this effect would never re-fire and the just-wiped bars would
  // stay empty forever — confirmed by direct reproduction (a real "0 bars"
  // empty chart), the same class of bug UI-4g-2 fixed via a different path
  // (there it was a brand-new instance; here it's a same-id/same-symbol
  // reseed). `layoutKey` is the layout system's own existing signal for
  // "state was just wholesale-replaced, treat as fresh" (already used to
  // force LayoutTree's remount) — tying this effect to it too closes the
  // gap without weakening the dedup for ordinary symbol/interval changes.
  const chartInstanceSymbolsSignature = useMemo(
    () =>
      Object.entries(chartStatesMap)
        .map(([id, s]) => `${id}:${s.symbol}:${s.interval}`)
        .sort()
        .join("|"),
    [chartStatesMap],
  );
  useEffect(() => {
    let cancelled = false;
    for (const [forId, inst] of Object.entries(chartStatesMap)) {
      const loadedKey = `${inst.symbol}:${inst.interval}`;
      if (inst.barsLoadedFor === loadedKey) continue;
      setChartField(forId, "barsLoading", true);
      setChartField(forId, "barsError", null);
      setChartField(forId, "bars", []);
      if (forId === activeChartInstanceIdRef.current) setLastPrice(null);
      fetchBars(inst.symbol, inst.interval, 500)
        .then((b) => {
          if (cancelled) return;
          setChartField(forId, "bars", b);
          setChartField(forId, "barsLoadedFor", loadedKey);
          if (forId === activeChartInstanceIdRef.current) {
            setLastPrice(b.length ? b[b.length - 1].close : null);
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setChartField(forId, "barsError", e instanceof Error ? e.message : "Market data unavailable");
        })
        .finally(() => !cancelled && setChartField(forId, "barsLoading", false));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartInstanceSymbolsSignature, layoutKey]);
  // Resyncs the top-toolbar's lastPrice display when the ACTIVE chart
  // changes, independent of the fetch effect above — switching to an
  // already-loaded chart shouldn't refetch anything, just reflect its
  // current price immediately instead of waiting on the other effect's own
  // (signature-keyed, not active-keyed) trigger conditions.
  useEffect(() => {
    const inst = chartStatesMap[activeChartInstanceId];
    setLastPrice(inst?.bars.length ? inst.bars[inst.bars.length - 1].close : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChartInstanceId]);

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

  // ---- live tick feed -------------------------------------------------
  // UI-4g-1: the subscription lifecycle itself now lives in <ChartInstance>
  // (wrapping <StudioChart> in renderChartArea below) instead of this
  // page-level effect, which assumed exactly one chart. `bars`/`lastPrice`
  // stay owned here — read by backtest/trading logic elsewhere on this page
  // — and are updated via this stable callback passed down as a prop.
  // Frozen ([] deps) like runCode/recompute/the drawing callbacks above —
  // this is wired only to the ACTIVE chart's <ChartInstance> (the inactive
  // path below builds its own instanceId-scoped inline handler), so unlike
  // those async cases there's no capture-at-start needed: read the ref
  // synchronously at tick time, which is always "whichever chart this
  // subscription's ChartInstance is currently mounted for."
  const onLiveBar = useCallback((bar: Bar) => {
    setLastPrice(bar.close);
    setChartField(activeChartInstanceIdRef.current, "bars", (prev) => mergeLiveBar(prev, bar));
  }, [setChartField]);

  // UI-4g-2 wrote only the ACTIVE chart's config here. UI-4g-4 generalizes
  // this to every chart instance, per-instance — necessary once linking can
  // change a NON-active chart's symbol/interval (via propagation) and once
  // a chart's own link mode can be set directly on an inactive pane; both
  // need their own tree write, not just whichever chart happens to be
  // active. Keyed off a derived signature (not the raw map) so this only
  // re-fires when something persistable actually changed, not on every
  // bars/indicator/drawing update — same pattern as
  // `chartInstanceSymbolsSignature` below. Deliberately does NOT bump
  // layoutKey — this is a content update within existing nodes, not a
  // wholesale tree-shape replacement.
  const chartConfigPersistSignature = useMemo(
    () =>
      Object.entries(chartStatesMap)
        .map(
          ([id, s]) =>
            `${id}:${s.symbol}:${s.interval}:${s.chartType}:${JSON.stringify(s.chartSettings)}:${s.linkMode}`,
        )
        .sort()
        .join("|"),
    [chartStatesMap],
  );
  useEffect(() => {
    setLayout((prev) => {
      let next = prev;
      for (const [id, inst] of Object.entries(chartStatesMap)) {
        next = updateChartConfig(next, id, {
          symbol: inst.symbol,
          interval: inst.interval,
          chartType: inst.chartType,
          settings: inst.chartSettings as unknown as Record<string, unknown>,
          linkMode: inst.linkMode,
        });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartConfigPersistSignature]);

  // ---- drawings persistence ------------------------------------------------
  // Generalized across EVERY open chart instance (not just the active one) —
  // see src/lib/workspace/drawings.ts's doc comment for why the old
  // active-chart-only, symbol:interval-only version of this could silently
  // collide or lose non-active charts' drawings. Loading is keyed on each
  // instance's OWN (instanceId, symbol, interval) triple, tracked in a ref so
  // it only fires on a genuine symbol/timeframe change for that instance —
  // never re-fires (and never clobbers in-progress edits) on every
  // chartStatesMap update, e.g. a live price tick.
  //
  // `justHydratedRef` closes a real mount-time data-loss race: on first
  // mount (and again any time a chart instance is newly added), the LOAD
  // effect below correctly calls `setChartField(id, "drawings", ...)` with
  // whatever was in storage — but that's an async state update, so the SAVE
  // effect, which runs in the SAME commit right after, still sees this
  // render's STALE `chartStatesMap` (the instance's brand-new, still-empty
  // `drawings: []`) and would otherwise immediately overwrite the very data
  // LOAD just fetched with an empty array, a heartbeat before the loaded
  // value ever reaches a render. Reproduced directly: draw something, reload
  // — without this guard the drawing survives the in-memory reload (LOAD's
  // state update does land) but is gone again on the NEXT reload, because
  // SAVE's stale-empty write already clobbered localStorage right after the
  // first one. Marking an instance "just hydrated" and skipping exactly its
  // next SAVE pass (the SAVE effect fires again, with the now-current data,
  // as soon as LOAD's state update lands on the following render) fixes it
  // without needing the two effects to somehow run in the same tick.
  const drawingsLoadTrackRef = useRef<Record<string, string>>({});
  const justHydratedRef = useRef<Set<string>>(new Set());
  const chartSymbolIntervalSig = useMemo(
    () => Object.entries(chartStatesMap).map(([id, s]) => `${id}:${s.symbol}:${s.interval}`).join("|"),
    [chartStatesMap],
  );
  useEffect(() => {
    for (const [id, inst] of Object.entries(chartStatesMap)) {
      const combo = `${inst.symbol}:${inst.interval}`;
      if (drawingsLoadTrackRef.current[id] === combo) continue;
      drawingsLoadTrackRef.current[id] = combo;
      justHydratedRef.current.add(id);
      setChartField(id, "drawings", loadDrawingsFor(id, inst.symbol, inst.interval) as Drawing[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSymbolIntervalSig]);

  const drawingsSaveSig = useMemo(
    () => JSON.stringify(Object.entries(chartStatesMap).map(([id, s]) => [id, s.symbol, s.interval, s.drawings])),
    [chartStatesMap],
  );
  useEffect(() => {
    for (const [id, inst] of Object.entries(chartStatesMap)) {
      if (justHydratedRef.current.has(id)) {
        // Skip exactly the one pass immediately following this instance's
        // load — see the doc comment above. The next pass (triggered by
        // LOAD's own state update changing `drawingsSaveSig`) saves for
        // real, with the now-current, actually-loaded data.
        justHydratedRef.current.delete(id);
        continue;
      }
      saveDrawingsFor(id, inst.symbol, inst.interval, inst.drawings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingsSaveSig]);

  // ---- drawing mutators + undo/redo history --------------------------------
  // These are memoized once ([] deps, same hazard as runCode/recompute
  // above) so they can't close over a fresh per-active-chart `setDrawings`.
  // Route through the stable `setChartField` + `activeChartInstanceIdRef`
  // instead, so a drawing action always lands on whichever chart is
  // actually active at the moment it fires.
  //
  // History (src/lib/drawing/history.ts) is a full before/after array
  // snapshot per committed change. IMPORTANT: `recordDrawingChange` (and
  // `undoDrawings`/`redoDrawings`, which pop/push those same stacks) are
  // side-effecting — each call mutates history.ts's module-level stacks by
  // one entry. They must therefore never be called from INSIDE a functional
  // `setState` updater passed to `setChartField`/`setChartStatesMap`: React
  // does not guarantee an updater runs exactly once per commit (e.g. its
  // eager-bailout optimization calls it once synchronously to check whether
  // the new state actually differs, then again for the real commit) — fine
  // for a pure computation like `[...prev, d]` since both calls produce the
  // same output, but for a side effect like "push a history entry" the
  // second call is a real, extra mutation, and one Undo would then need two
  // presses to fully undo one drawing (or leave a stray future entry). This
  // was confirmed to reproduce on plain Trend Line too, i.e. it's this
  // shared mechanism, not any one tool.
  //
  // The fix: read the pre-change value synchronously from `chartStatesMapRef`
  // (kept fresh outside of React's render/commit cycle — see its own
  // comment), compute `after` and call the history side effect exactly once
  // in this plain function body, then commit with a PLAIN value (not a
  // function) via `setChartField` — so there is no updater function left for
  // React to invoke more than once.
  //
  // `updateDrawing` also backs StudioChart's per-pointermove drag callback,
  // which would otherwise record one history entry per animation frame —
  // `dragCoalesceRef` collapses any burst of updates to the SAME drawing
  // within 400ms into the single history entry for "the whole drag/edit",
  // exactly like create/delete/setting-change each already are.
  const dragCoalesceRef = useRef<{ id: string; lastTs: number } | null>(null);
  // `chartId` defaults to whichever chart is active, so every existing call
  // site below that omits it (the active chart's own onAddDrawing/
  // onRemoveDrawing/onUpdateDrawing wiring) keeps behaving exactly as
  // before. `renderInactiveChartLeaf` passes its own pane's instanceId
  // explicitly instead, so a drawing mutation on a non-active pane records
  // history scoped to THAT pane, not whichever chart happens to be active —
  // see the doc comment on `renderInactiveChartLeaf` for why that pane's
  // callbacks must never bypass these shared, history-recording mutators.
  const addDrawing = useCallback(
    (d: Drawing, chartId: string = activeChartInstanceIdRef.current) => {
      const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
      const after = [...prev, d];
      recordDrawingChange(chartId, prev, after);
      setChartField(chartId, "drawings", after);
    },
    [setChartField],
  );
  // Phase 3D-14: deliberately does NOT call deleteChartImage() for a removed
  // Image drawing's `settings.imagePath`, even though src/lib/storage/
  // chartImages.ts exposes exactly that function. A `Duplicate`d Image
  // drawing shares the exact same path as its source, so deleting one
  // would silently break every other drawing (on this chart OR another)
  // still pointing at that object. Real cleanup needs reference counting
  // across every drawing on every chart instance — deliberately out of
  // scope for this phase; the storage object is simply left behind.
  const removeDrawing = useCallback((id: string, chartId: string = activeChartInstanceIdRef.current) => {
    const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
    const after = prev.filter((d) => d.id !== id);
    if (after.length !== prev.length) {
      recordDrawingChange(chartId, prev, after);
      setChartField(chartId, "drawings", after);
    }
    setSelectedDrawing((cur) => (cur === id ? null : cur));
    setDrawingSettingsFor((cur) => (cur === id ? null : cur));
  }, [setChartField]);
  const updateDrawing = useCallback(
    (next: Drawing, chartId: string = activeChartInstanceIdRef.current) => {
      const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
      const after = prev.map((d) => (d.id === next.id ? next : d));
      const now = Date.now();
      const active = dragCoalesceRef.current;
      if (!active || active.id !== next.id || now - active.lastTs > 400) {
        recordDrawingChange(chartId, prev, after);
      }
      dragCoalesceRef.current = { id: next.id, lastTs: now };
      setChartField(chartId, "drawings", after);
    },
    [setChartField],
  );
  const duplicateDrawing = useCallback((d: Drawing) => {
    const now = Date.now();
    const copy: Drawing = { ...d, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now, updatedAt: now };
    const chartId = activeChartInstanceIdRef.current;
    const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
    const after = [...prev, copy];
    recordDrawingChange(chartId, prev, after);
    setChartField(chartId, "drawings", after);
    setSelectedDrawing(copy.id);
  }, [setChartField]);

  // Global drawing controls (lock/hide/delete all, delete selected) — always
  // scoped to `activeChartInstanceIdRef.current` alone, never touching
  // indicators, chart data, or another chart instance's drawings.
  const setAllDrawingsField = useCallback(
    (field: "locked" | "hidden", value: boolean) => {
      const chartId = activeChartInstanceIdRef.current;
      const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
      const after = prev.map((d) => ({ ...d, [field]: value, updatedAt: Date.now() }));
      recordDrawingChange(chartId, prev, after);
      setChartField(chartId, "drawings", after);
    },
    [setChartField],
  );
  const deleteAllDrawings = useCallback(() => {
    const chartId = activeChartInstanceIdRef.current;
    const prev = chartStatesMapRef.current[chartId]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
    if (prev.length > 0) {
      recordDrawingChange(chartId, prev, []);
      setChartField(chartId, "drawings", []);
    }
    setSelectedDrawing(null);
    setDrawingSettingsFor(null);
  }, [setChartField]);
  const undoDrawingsForActive = useCallback(() => {
    const id = activeChartInstanceIdRef.current;
    const current = chartStatesMapRef.current[id]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
    const prevSnapshot = undoDrawings(id, current);
    if (prevSnapshot !== null) setChartField(id, "drawings", prevSnapshot);
  }, [setChartField]);
  const redoDrawingsForActive = useCallback(() => {
    const id = activeChartInstanceIdRef.current;
    const current = chartStatesMapRef.current[id]?.drawings ?? DEFAULT_CHART_RUNTIME_STATE.drawings;
    const nextSnapshot = redoDrawings(id, current);
    if (nextSnapshot !== null) setChartField(id, "drawings", nextSnapshot);
  }, [setChartField]);

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z: undo/redo the ACTIVE chart's drawings
  // only. Guarded against firing while typing anywhere else in Studio (the
  // code editor, a text input, a contenteditable) so it never fights those
  // surfaces' own undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redoDrawingsForActive();
      else undoDrawingsForActive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoDrawingsForActive, redoDrawingsForActive]);

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
      // Captured up front (not re-read after the awaits below) so a run
      // started against one chart always lands on that SAME chart even if
      // the user switches the active/target chart while this is in flight —
      // `runCode` itself is memoized once (stable deps below) so it can't
      // close over a fresh `setIndicators`; write through `setChartField` +
      // this ref instead, the same pattern `recompute` uses.
      const forInstanceId = activeChartInstanceIdRef.current;
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
        setChartField(forInstanceId, "indicators", (prev) => {
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
    [waitForBars, waitForRenderStats, setChartField],
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

  // UI-5d: the manual code-edit workflow (Edit code -> Validate -> Apply
  // changes -> Save Version) for an indicator ALREADY on the chart
  // (`editingKey` set). Distinct from `addToChart`/`runSource` above, which
  // still own the "brand-new or pasted script" path (including Pine
  // conversion) — this is specifically the dry-run/commit split the settings
  // pop-out and the redesigned Code panel need: a manual edit must be able to
  // fail loudly WITHOUT ever touching the chart's last-good indicator state.
  const currentEditingIndicator = indicators.find((i) => i.key === editingKey) ?? null;
  const isCodeDirty = currentEditingIndicator
    ? cleanPasted(code) !== currentEditingIndicator.code
    : false;

  /** Dry-run compile+execute check: never writes to `indicators`/the chart.
   * A failing script is reported here and NEVER treated as if it plotted. */
  const validateDraft = useCallback(async (): Promise<boolean> => {
    const src = cleanPasted(code);
    if (!src) {
      setValidation({ status: "invalid", error: "Nothing to validate — write or paste a script first." });
      checkedSourceRef.current = null;
      return false;
    }
    setValidation({ status: "checking", error: null });
    try {
      const data = await waitForBars();
      await runIndicator(src, data, settings);
      setValidation({ status: "valid", error: null });
      checkedSourceRef.current = src;
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Script failed";
      setValidation({ status: "invalid", error: msg });
      checkedSourceRef.current = null;
      return false;
    }
  }, [code, settings, waitForBars]);

  /** Commits the draft to the chart — but only once validation of THIS exact
   * source has succeeded (re-validates first if the draft changed since the
   * last check, so this can never commit code that hasn't actually passed).
   * Only updates the indicator this editor session is scoped to
   * (`editingKey`) — never any other instance, on this chart or any other. */
  const applyChanges = useCallback(async () => {
    const src = cleanPasted(code);
    if (src !== code) setCode(src);
    if (!editingKey) {
      // Nothing committed yet to apply "changes" to — same as a fresh script.
      addToChart();
      return;
    }
    const alreadyChecked = checkedSourceRef.current === src && validation.status === "valid";
    const ok = alreadyChecked || (await validateDraft());
    if (!ok) return;
    const err = await runCode(src, {
      settings,
      key: editingKey,
      silent: true,
      ...(currentEditingIndicator?.savedId ? { savedId: currentEditingIndicator.savedId } : {}),
    });
    if (err) {
      setValidation({ status: "invalid", error: err });
      track("apply_changes_failed", {});
    } else {
      setNotice(finalNotice("Indicator updated on the chart."));
      track("apply_changes_succeeded", {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, editingKey, settings, validation.status, validateDraft, currentEditingIndicator]);

  /** Discards the unsaved draft, returning the editor to the chart's actual
   * current (last-applied) code/settings for this indicator. */
  const revertCode = useCallback(() => {
    if (!currentEditingIndicator) return;
    setCode(currentEditingIndicator.code);
    setSettings(currentEditingIndicator.settings);
    setValidation({ status: "idle", error: null });
    checkedSourceRef.current = null;
    setNotice("Reverted to the last applied version.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEditingIndicator]);

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
    // Same stale-closure hazard as runCode: recompute is memoized once
    // ([] deps) so it can't close over a fresh setIndicators. Capture which
    // chart this run is FOR up front and write back through setChartField,
    // so a chart switch mid-recompute can't land these results on whatever
    // chart happens to be active when the async work finishes.
    const forInstanceId = activeChartInstanceIdRef.current;
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
      setChartField(forInstanceId, "indicators", (prev) =>
        prev.length === updated.length &&
        prev.every((p, i) => p.key === updated[i].key)
          ? updated
          : prev,
      );
      recomputedForRef.current = keyAtRun;
    } finally {
      recomputingRef.current = false;
    }
  }, [setChartField]);

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
    onSuccess: (row, variables) => {
      setCode(row.restored.code);
      // UI-5d fix: the restored version's OWN settings must load into the
      // editing session too — previously only `code` was restored here, so
      // a restore that changed input values (not just the script text) left
      // the settings panel showing whatever the PREVIOUS editing session
      // happened to have, not this version's actual settings.
      const restoredSettings = (row.restored.settings ?? {}) as Record<
        string,
        number | boolean | string
      >;
      setSettings(restoredSettings);
      setValidation({ status: "idle", error: null });
      checkedSourceRef.current = null;
      // If this saved indicator is already on the chart, point the editing
      // session at that exact instance so Apply changes updates it in
      // place; otherwise leave editingKey null (same as loading a saved
      // indicator that isn't on the chart yet) — either way Apply
      // changes/Add to Chart will carry the restored settings forward.
      const onChart = indicators.find((i) => i.savedId === variables.indicatorId);
      setEditingKey(onChart ? onChart.key : null);
      // The restored version becomes the AI Builder's active working
      // version too — same project identity, so its own conversation
      // history keeps showing (restoring never creates a new indicator).
      setProjectSpec(coerceSpec(row.restored.spec));
      setAiIndicatorId(variables.indicatorId);
      setDock("code");
      setNotice(
        onChart
          ? "Version restored with its saved settings — press Apply changes to plot it."
          : "Version restored with its saved settings — press Add to Chart to plot it.",
      );
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

  // UI-4f-1: the three leaf regions' rendering, unchanged from before
  // LayoutTree existed -- same DOM, same classNames, same handlers -- just
  // invoked from the recursive tree walk (see `renderLeaf` below) instead
  // of being positioned by static JSX. Resize/collapse/maximize mechanics
  // and everything about each widget's own content stay exactly as they
  // were; only the STRUCTURE connecting these three regions is now
  // genuinely tree-driven.
  /**
   * UI-4f-4: content for one of the 4 `isPortableForNewLeaf` widgets, for
   * rendering inside a brand-new, freely-created split leaf. Same
   * components/props as their existing copies in `renderRightSidebar`/
   * `renderBottomDock` — a third mount point, not a different one; none of
   * these components assume anything about which leaf they're hosted in.
   * Returns null for any other widget type (the 8 dock-only ones aren't
   * offered as edge-drop sources at all — see `isPortableForNewLeaf`), so
   * this only ever needs to cover the 4 it's actually called for.
   */
  const renderPortableWidgetContent = (widgetTypeId: WidgetTypeId): ReactNode => {
    if (widgetTypeId === "watchlist") {
      return (
        <WatchlistPanel
          chartInstances={chartInstanceOptions}
          activeChartInstanceId={activeChartInstanceId}
          config={watchlistTab?.watchlistConfig}
          onConfigChange={(next) =>
            watchlistTab && setLayout((prev) => updateWatchlistConfig(prev, watchlistTab.instanceId, next))
          }
          signedIn={!!user}
          onSelect={selectSymbolForInstance}
        />
      );
    }
    if (widgetTypeId === "trade") {
      return (
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
      );
    }
    if (widgetTypeId === "ai-builder") {
      return (
        <AiSidePanel
          seedPrompt={aiSeed}
          onSeedConsumed={() => setAiSeed(null)}
          code={code}
          symbol={symbol}
          interval={interval}
          signedIn={!!user}
          converting={translating}
          spec={projectSpec}
          indicatorId={aiIndicatorId}
          onIndicatorIdChange={setAiIndicatorId}
          onBuilt={(r, indicatorId) => {
            setProjectSpec(r.spec);
            setCode(r.sgscript);
            setDock("code");
            openDock();
            const key = builtKeyRef.current ?? `ai${Date.now()}`;
            builtKeyRef.current = key;
            void (async () => {
              const err = await runCode(r.sgscript, {
                settings: {},
                silent: true,
                key,
                ...(indicatorId ? { savedId: indicatorId } : {}),
              });
              if (err) {
                const err2 = await runSource(r.sgscript, { key });
                track(err2 ? "add_to_chart_failed" : "add_to_chart_succeeded", { repaired: true });
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
              .catch((e: unknown) => setRunError(e instanceof Error ? e.message : "Conversion failed"))
              .finally(() => setTranslating(false));
          }}
        />
      );
    }
    if (widgetTypeId === "alerts") {
      return (
        <AlertsSidePanel
          chartInstances={chartInstanceOptions}
          activeChartInstanceId={activeChartInstanceId}
          config={alertsTab?.alertsConfig}
          onConfigChange={(next) =>
            alertsTab && setLayout((prev) => updateAlertsConfig(prev, alertsTab.instanceId, next))
          }
          signedIn={!!user}
        />
      );
    }
    return null;
  };

  /**
   * UI-4f-4: a freshly edge-drop-created split leaf. Its own small tab strip
   * (close + drag to move back out — no "move to other region" affordance,
   * since it isn't one of the two capability-gated named regions) reads/
   * writes `activeInstanceId` straight off the tree node via
   * `setActiveTabInLeaf`/`removeWidget`, not the legacy `dock`/`rightTab`
   * state the two well-known regions still use.
   */
  const renderGenericLeaf = (node: LayoutNode & { kind: "tabs" }) => {
    const active = node.tabs.find((t) => t.instanceId === node.activeInstanceId) ?? node.tabs[0];
    return (
      <section className="relative flex h-full min-h-0 w-full flex-col border-l border-t border-border bg-panel">
        {renderDropOverlay(node.id)}
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {node.tabs.map((t, i) => {
              const def = getWidgetDef(t.widgetTypeId);
              const Icon = TAB_ICON[t.widgetTypeId] ?? Layers;
              return (
                <div
                  key={t.instanceId}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(i));
                    setDraggingTab({
                      fromNodeId: node.id,
                      instanceId: t.instanceId,
                      canCrossRegion: false,
                      widgetTypeId: t.widgetTypeId,
                    });
                  }}
                  onDragEnd={() => {
                    setDraggingTab(null);
                    setDragZone(null);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (!Number.isNaN(from)) reorderWidget(node.id, from, i);
                    setDraggingTab(null);
                  }}
                  className="group/tab flex shrink-0 items-center"
                >
                  <button
                    onClick={() => setActiveTabInLeaf(node.id, t.instanceId)}
                    className={`flex h-7 cursor-grab items-center gap-1 rounded-[6px] px-2 text-[13px] active:cursor-grabbing ${
                      t.instanceId === active?.instanceId
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.title ?? def.label}
                  </button>
                  {/* Unlike the sidebar/dock (protected — a "> 1 tabs" gate
                      keeps their last tab from being closed at all), a
                      generic leaf is never protected: removeWidgetFromNode
                      already allows and correctly collapses its last tab
                      away via collapseEmptyNodes, so the UI shouldn't
                      additionally block that here. */}
                  {!t.pinned && (
                    <button
                      title="Close"
                      onClick={() => removeWidget(node.id, t.instanceId)}
                      className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive group-hover/tab:flex"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {active ? renderPortableWidgetContent(active.widgetTypeId) : null}
        </div>
      </section>
    );
  };

  /**
   * UI-4f-4: the 5-zone edge-drop overlay for one leaf, `nodeId`. Renders
   * nothing unless a cross-leaf, edge-drop-eligible drag is actually in
   * flight over THIS leaf (`draggingTab.fromNodeId !== nodeId` and the
   * dragged widget is `isPortableForNewLeaf`) — so it never intercepts a
   * same-strip reorder (no overlay renders at all — the existing per-tab
   * UI-4f-3 handlers underneath stay fully reachable, untouched), and for
   * ordinary (non-drag) interaction it doesn't exist in the DOM at all.
   * Deliberately layered ON TOP of each leaf's existing content rather than
   * touching that content's own handlers: a full-coverage absolutely
   * positioned div, so it's the only thing under the pointer during an
   * eligible drag. Its own onDrop, for the CENTER zone, calls the exact
   * same `moveWidget` UI-4f-3's container-level drop already called for a
   * cross-strip move — identical resulting behaviour, just reached through
   * one more general path that also happens to supersede the narrower one
   * for this case (both still coexist; the narrower one still owns
   * same-strip reorder, which this overlay never renders during).
   */
  const renderDropOverlay = (nodeId: string) => {
    if (!draggingTab || draggingTab.fromNodeId === nodeId) return null;
    if (!isPortableForNewLeaf(draggingTab.widgetTypeId)) return null;
    const zone = dragZone?.nodeId === nodeId ? dragZone.zone : null;
    return (
      <div
        className="absolute inset-0 z-30"
        onDragOver={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const next = pickDropZone(rect, e.clientX, e.clientY);
          setDragZone((prev) => (prev?.nodeId === nodeId && prev.zone === next ? prev : { nodeId, zone: next }));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragZone((prev) => (prev?.nodeId === nodeId ? null : prev));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const zoneAtDrop = pickDropZone(rect, e.clientX, e.clientY);
          setDragZone(null);
          if (draggingTab) {
            if (zoneAtDrop === "center") {
              moveWidget(draggingTab.instanceId, draggingTab.fromNodeId, nodeId);
            } else {
              splitWidget(draggingTab.instanceId, draggingTab.fromNodeId, nodeId, zoneAtDrop);
            }
          }
          setDraggingTab(null);
        }}
      >
        <DockZone zone={zone} />
      </div>
    );
  };

  // UI-4g-1: the chart-area leaf's real instanceId from the tree, not a
  // hardcoded literal. UI-4g-2: this is now specifically "which chart is the
  // ACTIVE one" — the toolbar/backtest-overlay/Code-Editor machinery below
  // stays scoped to whichever chart the user last interacted with, exactly
  // matching the approved "active chart" concept, not necessarily the one
  // sitting in chart-area (a second chart can be active instead once one
  // exists). Falls back to `activeChartInstanceId`'s own default if the tree
  // doesn't (yet) contain it for some reason.
  const chartInstanceId = activeChartInstanceId;
  const chartInstancesInTreeCount = useMemo(
    () => collectWidgetTypeIds(layout.root).filter((id) => id === "chart").length,
    [layout],
  );

  // UI-4g-4: which chart's link-mode menu is open, if any — at most one at
  // a time, same lightweight-popover pattern as every other menu in this
  // file (a fixed backdrop closes it on outside click).
  const [linkMenuOpenFor, setLinkMenuOpenFor] = useState<string | null>(null);
  const LINK_MODE_LABEL: Record<ChartRuntimeState["linkMode"], string> = {
    independent: "Independent",
    symbol: "Link Symbol",
    timeframe: "Link Timeframe",
    both: "Link Symbol + Timeframe",
  };
  /**
   * UI-4g-4: compact per-chart link-mode control — only meaningful once
   * &ge;2 charts exist (nothing to link to otherwise), so the caller gates
   * on `chartInstancesInTreeCount > 1` the same way the close button
   * already does. Setting the mode itself is a plain `setChartField` (no
   * propagation) — only a subsequent symbol/interval CHANGE propagates.
   */
  const renderLinkModeControl = (instanceId: string, mode: ChartRuntimeState["linkMode"]) => {
    const open = linkMenuOpenFor === instanceId;
    return (
      <div className="absolute right-8 top-1 z-30">
        <button
          title={`Symbol/timeframe linking: ${LINK_MODE_LABEL[mode]}`}
          onClick={(e) => {
            e.stopPropagation();
            setLinkMenuOpenFor(open ? null : instanceId);
          }}
          className={`flex h-6 w-6 items-center justify-center rounded ${
            mode !== "independent"
              ? "text-brand hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setLinkMenuOpenFor(null)} />
            <div className="absolute right-0 z-40 mt-1 w-44 rounded-[8px] border border-border bg-popover p-1 text-[11px] shadow-xl">
              {(Object.keys(LINK_MODE_LABEL) as Array<ChartRuntimeState["linkMode"]>).map((m) => (
                <button
                  key={m}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChartField(instanceId, "linkMode", m);
                    setLinkMenuOpenFor(null);
                  }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-accent ${
                    m === mode ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span>{LINK_MODE_LABEL[m]}</span>
                  {m === mode && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  /**
   * UI-4g-2: renders ONE chart leaf, for ANY chart-hosting node in the tree
   * — not just chart-area. When `instanceId` is the active chart, this is
   * the full-featured path (backtest overlay markers, trade-line dragging,
   * right-click order planning, Code-Editor coupling — all the existing,
   * deeply page-level-state-entangled machinery already built for "the
   * chart" over UI-1 through UI-4f, now correctly scoped to whichever chart
   * is active via the `activeChartState`/`symbol`/`indicators`/etc. shims
   * defined above). A NON-active chart renders through the simpler
   * `renderInactiveChartLeaf` below instead — its own bars/indicators/
   * symbol/interval/drawings are still genuinely independent (read straight
   * from `chartStatesMap[instanceId]`), but it doesn't carry the
   * backtest-overlay/trade-planning wiring, since that's a single-active-
   * chart concept by design; clicking into it makes it active, at which
   * point it gains full access to everything below.
   */
  const renderChartLeaf = (instanceId: string, nodeId: string) => {
    if (instanceId !== activeChartInstanceId) {
      return renderInactiveChartLeaf(instanceId, nodeId);
    }
    const activeChartInstance = chartStatesMap[instanceId] ?? DEFAULT_CHART_RUNTIME_STATE;
    const settingsPopoutIndicator = settingsPopoutKey
      ? (indicators.find((i) => i.key === settingsPopoutKey) ?? null)
      : null;
    return (
    <div
      data-chart-leaf
      className={`relative min-h-0 overflow-hidden ${
        dockState === "maximized" ? "flex-none basis-14" : "flex-1"
      } ${chartInstancesInTreeCount > 1 ? "ring-1 ring-brand/60" : ""}`}
    >
      {renderDropOverlay(nodeId)}
      <ChartLegendStrip
        symbol={activeChartInstance.symbol}
        intervalLabel={timeframeLabel(activeChartInstance.interval)}
        crosshair={crosshair}
        latestBar={activeChartInstance.bars.length ? activeChartInstance.bars[activeChartInstance.bars.length - 1] : null}
        indicators={activeChartInstance.indicators.map((i) => ({
          key: i.key,
          name: i.name,
          visible: i.visible,
          inputs: i.result.inputs,
        }))}
        editingKey={editingKey}
        onSelectIndicator={(key) => {
          const ind = indicators.find((i) => i.key === key);
          if (!ind) return;
          setEditingKey(key);
          setCode(ind.code);
          setActiveInputs(ind.result.inputs);
          setSettings(ind.settings);
          setValidation({ status: "idle", error: null });
          checkedSourceRef.current = null;
          setDock("code");
        }}
        onToggleVisible={(key) =>
          setIndicators((prev) =>
            prev.map((p) => (p.key === key ? { ...p, visible: !p.visible } : p)),
          )
        }
        onRemoveIndicator={(key) => {
          setIndicators((prev) => prev.filter((p) => p.key !== key));
          if (settingsPopoutKey === key) setSettingsPopoutKey(null);
        }}
        onOpenSettings={(key, anchor) => {
          // UI-5d: settings now open as a floating pop-out over the chart —
          // this NEVER touches the bottom dock (no setDock/openDock here),
          // so the trader keeps their chart space. It still points the same
          // shared editing session (code/settings/activeInputs/editingKey)
          // at this indicator, exactly like the Code panel's "Edit" did, so
          // Apply/Validate/Save Version all keep working on it unchanged.
          const ind = indicators.find((i) => i.key === key);
          if (!ind) return;
          setEditingKey(key);
          setCode(ind.code);
          setActiveInputs(ind.result.inputs);
          setSettings(ind.settings);
          setValidation({ status: "idle", error: null });
          checkedSourceRef.current = null;
          setSettingsPopoutAnchor(anchor);
          setSettingsPopoutKey(key);
        }}
        onPickTemplate={(templateCode) => {
          setEditingKey(null);
          setCode(templateCode ?? DEFAULT_SCRIPT);
          setValidation({ status: "idle", error: null });
          checkedSourceRef.current = null;
          setDock("code");
          openDock();
          // Start a fresh AI build session too.
          resetAiBuildSession();
        }}
      />
      {settingsPopoutIndicator && (
        <IndicatorSettingsPopout
          name={settingsPopoutIndicator.name}
          visible={settingsPopoutIndicator.visible}
          inputs={settingsPopoutIndicator.result.inputs}
          settings={settings}
          chartLabel={
            chartInstancesInTreeCount > 1
              ? `${activeChartInstance.symbol} ${timeframeLabel(activeChartInstance.interval)}`
              : null
          }
          anchor={settingsPopoutAnchor}
          onChangeSetting={(name, value) => {
            const key = settingsPopoutIndicator.key;
            const next = { ...settings, [name]: value };
            setSettings(next);
            // Live-apply: a settings change is always re-running ALREADY
            // -valid code (it got onto the chart in the first place), so
            // this can reuse `runCode` directly instead of the manual-edit
            // Validate/Apply gate above, which exists for CODE TEXT edits.
            void runCode(settingsPopoutIndicator.code, {
              settings: next,
              key,
              silent: true,
              ...(settingsPopoutIndicator.savedId ? { savedId: settingsPopoutIndicator.savedId } : {}),
            });
          }}
          onToggleVisible={() =>
            setIndicators((prev) =>
              prev.map((p) =>
                p.key === settingsPopoutIndicator.key ? { ...p, visible: !p.visible } : p,
              ),
            )
          }
          onReset={() => {
            const key = settingsPopoutIndicator.key;
            const code0 = settingsPopoutIndicator.code;
            void (async () => {
              const data = await waitForBars();
              try {
                // Empty settings override => the script's own coded defaults
                // come back as `value` (see input() in sgscript/runtime.ts).
                const defaults = await runIndicator(code0, data, {});
                const defaultSettings = Object.fromEntries(
                  defaults.inputs.map((i) => [i.name, i.value]),
                );
                setSettings(defaultSettings);
                await runCode(code0, {
                  settings: defaultSettings,
                  key,
                  silent: true,
                  ...(settingsPopoutIndicator.savedId ? { savedId: settingsPopoutIndicator.savedId } : {}),
                });
                setNotice("Reset to default settings.");
              } catch (e) {
                setRunError(e instanceof Error ? e.message : "Could not reset to defaults");
              }
            })();
          }}
          onRemove={() => {
            setIndicators((prev) => prev.filter((p) => p.key !== settingsPopoutIndicator.key));
            setSettingsPopoutKey(null);
          }}
          onClose={() => setSettingsPopoutKey(null)}
        />
      )}
      {chartInstancesInTreeCount > 1 && renderLinkModeControl(instanceId, activeChartInstance.linkMode)}
      {chartInstancesInTreeCount > 1 && (
        <button
          title="Close chart"
          onClick={(e) => {
            e.stopPropagation();
            closeChartInstance(instanceId, nodeId);
          }}
          className="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {barsError ? (
        <div className="flex h-full items-center justify-center text-xs text-destructive">
          {barsError}
        </div>
      ) : (
        <ChartInstance
          instanceId={chartInstanceId}
          symbol={activeChartInstance.symbol}
          interval={activeChartInstance.interval}
          live={live}
          onLiveBar={onLiveBar}
          onStatusChange={setLiveStatus}
        >
          <StudioChart
            bars={activeChartInstance.bars}
            indicators={activeChartInstance.indicators}
            tool={tool}
            onCancelTool={handleCancelTool}
            drawings={activeChartInstance.drawings}
            onAddDrawing={addDrawing}
            onRemoveDrawing={removeDrawing}
            onUpdateDrawing={updateDrawing}
            userId={user?.id ?? null}
            selectedId={selectedDrawing}
            onSelectDrawing={setSelectedDrawing}
            onOpenDrawingSettings={(id, screen) => {
              setDrawingSettingsFor(id);
              setDrawingSettingsAnchor(screen);
            }}
            hasOscPane={hasOscPane}
            extraMarkers={backtestMarkers}
            tradeLines={tradeLines}
            trades={chartTrades}
            instrument={{
              tickSize: getInstrument(activeChartInstance.symbol).tickSize,
              valuePerPoint: pnlPerUnit(getInstrument(activeChartInstance.symbol), 1),
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
            chartType={activeChartInstance.chartType}
            settings={activeChartInstance.chartSettings}
            onCrosshair={setCrosshair}
            onReady={onChartReady}
            onRenderStats={handleRenderStats}
            chartInstanceId={chartInstanceId}
            magnet={magnet}
          />
        </ChartInstance>
      )}

      {objectsOpen && (
        <DrawingInspector
          drawings={activeChartInstance.drawings}
          selectedId={selectedDrawing}
          onSelect={setSelectedDrawing}
          onUpdate={updateDrawing}
          onRemove={removeDrawing}
          onDuplicate={duplicateDrawing}
          onOpenSettings={(d) => {
            setDrawingSettingsFor(d.id);
            setDrawingSettingsAnchor({ x: 320, y: 110 });
          }}
          onClose={() => setObjectsOpen(false)}
        />
      )}

      {drawingSettingsFor && activeChartInstance.drawings.find((d) => d.id === drawingSettingsFor) && (
        <DrawingSettingsPopover
          drawing={activeChartInstance.drawings.find((d) => d.id === drawingSettingsFor)!}
          label={TOOL_BY_ID[activeChartInstance.drawings.find((d) => d.id === drawingSettingsFor)!.tool]?.name ?? "Drawing"}
          anchor={drawingSettingsAnchor}
          onChange={updateDrawing}
          onDuplicate={() => {
            const d = activeChartInstance.drawings.find((x) => x.id === drawingSettingsFor);
            if (d) duplicateDrawing(d);
          }}
          onRemove={() => {
            if (drawingSettingsFor) removeDrawing(drawingSettingsFor);
          }}
          onClose={() => setDrawingSettingsFor(null)}
          userId={user?.id ?? null}
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
    );
  };

  /**
   * UI-4g-2: a chart that ISN'T currently active — a simpler, genuinely
   * independent view (own bars/indicators/symbol/interval/drawings, own
   * WebSocket subscription via <ChartInstance>) without the backtest-
   * overlay/trade-line/order-planning wiring the active chart carries
   * (those are single-active-chart concepts by design). Clicking anywhere
   * in the pane activates it; a corner close button (only shown once more
   * than one chart exists) removes it via the same protected mutators
   * every other widget close already goes through.
   */
  const renderInactiveChartLeaf = (instanceId: string, nodeId: string) => {
    const inst = chartStatesMap[instanceId] ?? DEFAULT_CHART_RUNTIME_STATE;
    return (
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onMouseDownCapture={() => setActiveChartInstanceId(instanceId)}
      >
        {renderDropOverlay(nodeId)}
        <ChartLegendStrip
          symbol={inst.symbol}
          intervalLabel={timeframeLabel(inst.interval)}
          crosshair={null}
          latestBar={inst.bars.length ? inst.bars[inst.bars.length - 1] : null}
          indicators={inst.indicators.map((i) => ({
            key: i.key,
            name: i.name,
            visible: i.visible,
            inputs: i.result.inputs,
          }))}
          editingKey={null}
          onSelectIndicator={() => setActiveChartInstanceId(instanceId)}
          onToggleVisible={(key) =>
            setChartField(instanceId, "indicators", (prev) =>
              prev.map((p) => (p.key === key ? { ...p, visible: !p.visible } : p)),
            )
          }
          onRemoveIndicator={(key) =>
            setChartField(instanceId, "indicators", (prev) => prev.filter((p) => p.key !== key))
          }
          onOpenSettings={() => setActiveChartInstanceId(instanceId)}
          onPickTemplate={() => setActiveChartInstanceId(instanceId)}
        />
        {chartInstancesInTreeCount > 1 && renderLinkModeControl(instanceId, inst.linkMode)}
        {chartInstancesInTreeCount > 1 && (
          <button
            title="Close chart"
            onClick={(e) => {
              e.stopPropagation();
              closeChartInstance(instanceId, nodeId);
            }}
            className="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {inst.barsError ? (
          <div className="flex h-full items-center justify-center text-xs text-destructive">
            {inst.barsError}
          </div>
        ) : (
          <ChartInstance
            instanceId={instanceId}
            symbol={inst.symbol}
            interval={inst.interval}
            live={live}
            onLiveBar={(bar) => {
              setChartField(instanceId, "bars", (prev) => mergeLiveBar(prev, bar));
            }}
            onStatusChange={() => {}}
          >
            <StudioChart
              bars={inst.bars}
              indicators={inst.indicators}
              tool="cursor"
              drawings={inst.drawings}
              // Routed through the SAME history-recording mutators the active
              // chart uses (see their doc comment above), explicitly scoped to
              // THIS pane's own instanceId — never bypassed via a raw
              // setChartField call, which would silently skip
              // recordDrawingChange and leave this pane with no undo/redo for
              // the mutation. In practice `tool="cursor"`/`selectedId={null}`/
              // `onSelectDrawing={() => {}}` just below mean StudioChart never
              // actually invokes these on an inactive pane today (creation,
              // drag, and delete-key removal all require a non-cursor tool or
              // a selection, neither of which this leaf ever has) — but wiring
              // them correctly here removes the footgun for whenever that
              // changes, and matches every other mutation path's contract.
              onAddDrawing={(d) => addDrawing(d, instanceId)}
              onRemoveDrawing={(id) => removeDrawing(id, instanceId)}
              onUpdateDrawing={(updated) => updateDrawing(updated, instanceId)}
              selectedId={null}
              onSelectDrawing={() => {}}
              hasOscPane={inst.indicators.some((i) => i.result.plots.some((p) => p.pane === "osc"))}
              instrument={{
                tickSize: getInstrument(inst.symbol).tickSize,
                valuePerPoint: pnlPerUnit(getInstrument(inst.symbol), 1),
              }}
              chartType={inst.chartType}
              settings={inst.chartSettings}
              onCrosshair={() => {}}
              chartInstanceId={instanceId}
              magnet={magnet}
            />
          </ChartInstance>
        )}
      </div>
    );
  };

  // UI-4h-2: every open chart instance, in the same "Chart N — SYMBOL tf"
  // labeling the existing target-chart selector above already uses — reused
  // as the Volume Profile widget's binding options rather than a second,
  // differently-worded list.
  const chartInstanceOptionsForVolumeProfile = useMemo(
    () =>
      Object.entries(chartStatesMap).map(([id, s], i) => ({
        instanceId: id,
        label: `Chart ${i + 1} — ${s.symbol} ${timeframeLabel(s.interval)}`,
        symbol: s.symbol,
        interval: s.interval,
        bars: s.bars,
      })),
    [chartStatesMap],
  );
  // The Volume Profile widget is dock-only and single-instance (like
  // Scanner) — this finds its one possible tree entry so its own persisted
  // `volumeProfileConfig` can be read/written by instanceId, the same way
  // every chart's `chartConfig` already is.
  const volumeProfileTab = useMemo(() => {
    const node = findNodeById(layout.root, WELL_KNOWN_NODE_IDS.bottomDock);
    if (!node || node.kind !== "tabs") return null;
    return node.tabs.find((t) => t.widgetTypeId === "volume-profile") ?? null;
  }, [layout]);
  // UI-4h-3: unlike Volume Profile, Watchlist is placeable in the sidebar AND
  // the dock (and a portable edge-drop leaf) — it isn't fixed to one region,
  // so its single instance is found by widgetTypeId anywhere in the tree
  // rather than assumed to live in bottomDock.
  const watchlistTab = useMemo(
    () => findWidgetInstance(layout.root, "watchlist"),
    [layout],
  );
  // UI-4h-4: same "placeable in sidebar AND dock, found anywhere in the
  // tree" rationale as watchlistTab above — Alerts isn't bottomDock-fixed
  // like Volume Profile.
  const alertsTab = useMemo(
    () => findWidgetInstance(layout.root, "alerts"),
    [layout],
  );
  // UI-4h-5: same "found anywhere in the tree" rationale as watchlistTab/
  // alertsTab above.
  const marketStatsTab = useMemo(
    () => findWidgetInstance(layout.root, "market-stats"),
    [layout],
  );
  // Reused by both the Volume Profile and Watchlist widgets — every open
  // chart instance's identity + bars, so either widget can bind to any of
  // them independently of which one currently has focus.
  const chartInstanceOptions = chartInstanceOptionsForVolumeProfile;
  // Targeted symbol select for a widget bound to a SPECIFIC chart instance
  // (not necessarily the active one) — routes through the exact same
  // propagation `setSymbol` already uses for the active chart, just
  // parameterized by instanceId instead of hardcoding
  // `activeChartInstanceId`, so linked charts still propagate correctly.
  const selectSymbolForInstance = useCallback(
    (ticker: string, targetInstanceId: string) => {
      propagateLinkedChartField("symbol", targetInstanceId, ticker);
    },
    [propagateLinkedChartField],
  );

  const renderBottomDock = () => (
    <section
      className={`relative flex shrink-0 flex-col border-t border-border bg-panel ${
        dockState === "maximized" ? "flex-1" : dockState === "normal" ? "h-full min-h-0" : ""
      }`}
    >
    {renderDropOverlay(WELL_KNOWN_NODE_IDS.bottomDock)}
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <button
        onClick={toggleDockCollapse}
        title={dockVisible ? "Collapse panel" : "Expand panel"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {dockState === "maximized" ? (
          <ChevronsDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUp className="h-3.5 w-3.5" />
        )}
      </button>
      <div
        className={`mx-0.5 flex h-8 items-center gap-1 rounded-[6px] ${
          dragOverNodeId === WELL_KNOWN_NODE_IDS.bottomDock ? "bg-brand/10 ring-1 ring-inset ring-brand/40" : ""
        }`}
        onDragOver={(e) => {
          if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.bottomDock && draggingTab.canCrossRegion) {
            e.preventDefault();
          }
        }}
        onDragEnter={(e) => {
          if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.bottomDock && draggingTab.canCrossRegion) {
            setDragOverNodeId(WELL_KNOWN_NODE_IDS.bottomDock);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverNodeId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverNodeId(null);
          if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.bottomDock) {
            moveWidget(draggingTab.instanceId, draggingTab.fromNodeId, WELL_KNOWN_NODE_IDS.bottomDock);
          }
          setDraggingTab(null);
        }}
      >
      {dockTabsList.map((d, i) => (
        <div
          key={d.instanceId}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", String(i));
            setDraggingTab({
              fromNodeId: WELL_KNOWN_NODE_IDS.bottomDock,
              instanceId: d.instanceId,
              canCrossRegion: d.canMoveToOtherRegion,
              widgetTypeId: d.widgetTypeId,
            });
          }}
          onDragEnd={() => {
            setDraggingTab(null);
            setDragOverNodeId(null);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverNodeId(null);
            if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.bottomDock) {
              moveWidget(draggingTab.instanceId, draggingTab.fromNodeId, WELL_KNOWN_NODE_IDS.bottomDock);
            } else {
              const from = Number(e.dataTransfer.getData("text/plain"));
              if (!Number.isNaN(from)) reorderWidget(WELL_KNOWN_NODE_IDS.bottomDock, from, i);
            }
            setDraggingTab(null);
          }}
          className="group/tab relative flex items-center"
        >
          <button
            onClick={() => {
              setDock(d.id);
              openDock();
            }}
            className={`flex h-7 cursor-grab items-center gap-1 rounded-[6px] px-2 text-[13px] active:cursor-grabbing ${
              dock === d.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
          <span className="hidden items-center group-hover/tab:flex">
            {d.canMoveToOtherRegion && (
              <button
                title={`Move to right sidebar`}
                onClick={() => {
                  moveWidget(d.instanceId, WELL_KNOWN_NODE_IDS.bottomDock, WELL_KNOWN_NODE_IDS.rightSidebar);
                  setSidebarState("expanded");
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <MoreHorizontal className="h-3 w-3" />
              </button>
            )}
            {!d.pinned && dockTabsList.length > 1 && (
              <button
                title="Close"
                onClick={() => removeWidget(WELL_KNOWN_NODE_IDS.bottomDock, d.instanceId)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
      ))}
      </div>
      <AddWidgetMenu
        region="dock"
        openWidgetTypeIds={dockWidgetTypeIds}
        onAdd={(widgetTypeId) => addWidget(WELL_KNOWN_NODE_IDS.bottomDock, widgetTypeId)}
      />
      {/* UI-5d: these actions only make sense for the code-development
       * surface — scoping them to `dock === "code"` keeps every other dock
       * tab (Saved, Docs, Tester, Journal, …) free of controls that don't
       * apply to it, instead of the same row showing regardless of which
       * tab is active. Directly the "reduce visual clutter" ask (part 4). */}
      {dock === "code" && (
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={pasteFromClipboard}
            disabled={running || translating}
            title="Paste code from clipboard and plot it"
            className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <ClipboardPaste className="h-3.5 w-3.5" /> Paste
          </button>
          <button
            onClick={copyCode}
            title="Copy this script"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-brand" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          {chartInstancesInTreeCount > 1 && (
            <select
              title="Which chart Add to Chart / indicator edits apply to"
              value={activeChartInstanceId}
              onChange={(e) => setActiveChartInstanceId(e.target.value)}
              className="h-7 rounded-[6px] border border-border bg-card px-1.5 text-[11px] outline-none focus:border-brand"
            >
              {Object.keys(chartStatesMap).map((id, i) => {
                const s = chartStatesMap[id];
                return (
                  <option key={id} value={id}>
                    {`Chart ${i + 1} — ${s.symbol} ${timeframeLabel(s.interval)}`}
                  </option>
                );
              })}
            </select>
          )}
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          {/* Unconditional, unchanged from before UI-5d — brand-new/pasted
           * scripts (and Pine translation) still go through this exact same
           * button/behavior regardless of whether an indicator is also
           * loaded for editing. Kept the one solid-brand action in this row
           * so "run this code" stays visually primary against the muted
           * validate/apply/revert/save cluster next to it. */}
          <button
            onClick={addToChart}
            disabled={running || translating || bars.length === 0}
            className="flex h-7 items-center gap-1 rounded-[6px] bg-brand px-2.5 text-[13px] font-medium text-brand-foreground disabled:opacity-50"
          >
            {running || translating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Add to Chart
          </button>
          {editingKey && (
            <>
              <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
              <button
                onClick={() => void validateDraft()}
                disabled={running || translating || validation.status === "checking"}
                title="Check the current code for errors without touching the chart"
                className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {validation.status === "checking" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Validate
              </button>
              <button
                onClick={() => void applyChanges()}
                disabled={running || translating || bars.length === 0}
                title="Validate and update this indicator on the chart"
                className="flex h-7 items-center gap-1 rounded-[6px] border border-brand/50 px-2.5 text-[11px] font-medium text-brand hover:bg-brand/10 disabled:opacity-50"
              >
                {running || translating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Apply changes
              </button>
              <button
                onClick={revertCode}
                disabled={!isCodeDirty}
                title="Discard edits and return to the last applied version"
                className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Revert
              </button>
            </>
          )}
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <button
            onClick={() => saveMut.mutate()}
            disabled={!user || saveMut.isPending || !editingKey}
            title={user ? "Save a new version of this indicator" : "Sign in to save"}
            className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> Save Version
          </button>
        </div>
      )}

    </div>

    {dockVisible && dock === "code" && (
      <div className="flex min-h-0 flex-1 flex-col">
        {editingKey && (
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-[10.5px]">
            {isCodeDirty ? (
              <span className="flex items-center gap-1 text-amber-500">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
              </span>
            ) : (
              <span className="text-muted-foreground">Up to date with the chart</span>
            )}
            {validation.status === "valid" && checkedSourceRef.current === cleanPasted(code) && (
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> Validated
              </span>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor value={code} onChange={setCode} />
        </div>

        {validation.status === "invalid" && validation.error && (
          <div className="flex shrink-0 items-start gap-1.5 border-t border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-relaxed">{validation.error}</span>
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
                    // UI-5d fix: load this project's OWN settings too, not
                    // whatever the previous editing session had — same gap
                    // restoreMut had.
                    setSettings((row.settings ?? {}) as Record<string, number | boolean | string>);
                    setValidation({ status: "idle", error: null });
                    checkedSourceRef.current = null;
                    // Point the AI Builder at THIS project too, so Modify /
                    // Explain / Fix Error act on it and its own conversation
                    // history loads instead of the previous session's.
                    setProjectSpec(coerceSpec(row.spec));
                    setAiIndicatorId(row.id);
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
                          // UI-5d fix: this version's OWN settings, and point
                          // the editing session at the matching on-chart
                          // instance (if any) — same fix as restoreMut, so a
                          // previewed-but-not-restored version's settings
                          // aren't left showing the last-edited instance's.
                          setSettings((v.settings ?? {}) as Record<string, number | boolean | string>);
                          setValidation({ status: "idle", error: null });
                          checkedSourceRef.current = null;
                          const onChartForVersion = indicators.find((i) => i.savedId === row.id);
                          setEditingKey(onChartForVersion ? onChartForVersion.key : null);
                          setProjectSpec(coerceSpec(v.spec));
                          setAiIndicatorId(row.id);
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

    {/* Sidebar-native widgets, rendered here too when moved into the
        dock (UI-4c "move between regions") — same components, just a
        second mount point, since none of them assume sidebar width. */}
    {dockVisible && dock === "watchlist" && watchlistTab && (
      <div className="min-h-0 flex-1 overflow-auto">
        <WatchlistPanel
          chartInstances={chartInstanceOptions}
          activeChartInstanceId={activeChartInstanceId}
          config={watchlistTab.watchlistConfig}
          onConfigChange={(next) =>
            setLayout((prev) => updateWatchlistConfig(prev, watchlistTab.instanceId, next))
          }
          signedIn={!!user}
          onSelect={selectSymbolForInstance}
        />
      </div>
    )}
    {dockVisible && dock === "trade" && (
      <div className="min-h-0 flex-1 overflow-auto">
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
      </div>
    )}
    {dockVisible && dock === "ai" && (
      <div className="min-h-0 flex-1 overflow-auto">
        <AiSidePanel
          seedPrompt={aiSeed}
          onSeedConsumed={() => setAiSeed(null)}
          code={code}
          symbol={symbol}
          interval={interval}
          signedIn={!!user}
          converting={translating}
          spec={projectSpec}
          indicatorId={aiIndicatorId}
          onIndicatorIdChange={setAiIndicatorId}
          onBuilt={(r, indicatorId) => {
            setProjectSpec(r.spec);
            setCode(r.sgscript);
            setDock("code");
            openDock();
            const key = builtKeyRef.current ?? `ai${Date.now()}`;
            builtKeyRef.current = key;
            void (async () => {
              const err = await runCode(r.sgscript, {
                settings: {},
                silent: true,
                key,
                ...(indicatorId ? { savedId: indicatorId } : {}),
              });
              if (err) {
                const err2 = await runSource(r.sgscript, { key });
                track(err2 ? "add_to_chart_failed" : "add_to_chart_succeeded", { repaired: true });
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
              .catch((e: unknown) => setRunError(e instanceof Error ? e.message : "Conversion failed"))
              .finally(() => setTranslating(false));
          }}
        />
      </div>
    )}
    {dockVisible && dock === "alerts" && (
      <div className="min-h-0 flex-1 overflow-auto">
        <AlertsSidePanel
          chartInstances={chartInstanceOptions}
          activeChartInstanceId={activeChartInstanceId}
          config={alertsTab?.alertsConfig}
          onConfigChange={(next) =>
            alertsTab && setLayout((prev) => updateAlertsConfig(prev, alertsTab.instanceId, next))
          }
          signedIn={!!user}
        />
      </div>
    )}
    {dockVisible && dock === "scanner" && (
      <div className="min-h-0 flex-1 overflow-auto">
        <ScannerPanel activeSymbol={symbol} onSelect={(t) => setSymbol(t)} />
      </div>
    )}
    {dockVisible && dock === "volprofile" && volumeProfileTab && (
      <div className="min-h-0 flex-1 overflow-auto">
        <VolumeProfilePanel
          chartInstances={chartInstanceOptionsForVolumeProfile}
          activeChartInstanceId={activeChartInstanceId}
          config={volumeProfileTab.volumeProfileConfig}
          onConfigChange={(next) =>
            setLayout((prev) => updateVolumeProfileConfig(prev, volumeProfileTab.instanceId, next))
          }
        />
      </div>
    )}
    {dockVisible && dock === "marketstats" && marketStatsTab && (
      <div className="min-h-0 flex-1 overflow-auto">
        <MarketStatsPanel
          chartInstances={chartInstanceOptions}
          activeChartInstanceId={activeChartInstanceId}
          config={marketStatsTab.marketStatsConfig}
          onConfigChange={(next) =>
            setLayout((prev) => updateMarketStatsConfig(prev, marketStatsTab.instanceId, next))
          }
        />
      </div>
    )}
    </section>
  );

  const renderRightSidebar = () => (
    <>
      {sidebarState === "collapsed" && (
        <aside className="hidden w-[42px] shrink-0 flex-col items-center gap-0.5 border-l border-border bg-panel py-1.5 lg:flex">
          {rightTabs.map((t) => (
            <button
              key={t.id}
              title={t.label}
              onClick={() => {
                setRightTab(t.id);
                setSidebarState("expanded");
              }}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${
                rightTab === t.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <t.icon className="h-[18px] w-[18px]" />
            </button>
          ))}
        </aside>
      )}

      {sidebarState === "expanded" && (
        <aside
          className="relative hidden h-full w-full flex-col overflow-y-auto border-l border-border bg-panel lg:flex"
        >
          {renderDropOverlay(WELL_KNOWN_NODE_IDS.rightSidebar)}
          <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
            {/* Tabs size to their own content and the strip scrolls
                horizontally if it ever overflows, instead of every tab
                being squeezed into an equal flex-1 share (which is what
                truncated "WATCHLIST" down to "WAT…" even at the default
                4-tab width). Capability gating below caps the sidebar at
                its 4 built-in widgets — a 5th can't reach it without new
                cross-region rendering — so this only ever needs to fit
                those, comfortably, even at the narrowest 240px width. */}
            <div
              className={`flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-[6px] ${
                dragOverNodeId === WELL_KNOWN_NODE_IDS.rightSidebar
                  ? "bg-brand/10 ring-1 ring-inset ring-brand/40"
                  : ""
              }`}
              onDragOver={(e) => {
                if (
                  draggingTab &&
                  draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.rightSidebar &&
                  draggingTab.canCrossRegion
                ) {
                  e.preventDefault();
                }
              }}
              onDragEnter={(e) => {
                if (
                  draggingTab &&
                  draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.rightSidebar &&
                  draggingTab.canCrossRegion
                ) {
                  setDragOverNodeId(WELL_KNOWN_NODE_IDS.rightSidebar);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverNodeId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverNodeId(null);
                if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.rightSidebar) {
                  moveWidget(draggingTab.instanceId, draggingTab.fromNodeId, WELL_KNOWN_NODE_IDS.rightSidebar);
                }
                setDraggingTab(null);
              }}
            >
              {rightTabs.map((t, i) => (
                <div
                  key={t.instanceId}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(i));
                    setDraggingTab({
                      fromNodeId: WELL_KNOWN_NODE_IDS.rightSidebar,
                      instanceId: t.instanceId,
                      canCrossRegion: t.canMoveToOtherRegion,
                      widgetTypeId: t.widgetTypeId,
                    });
                  }}
                  onDragEnd={() => {
                    setDraggingTab(null);
                    setDragOverNodeId(null);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverNodeId(null);
                    if (draggingTab && draggingTab.fromNodeId !== WELL_KNOWN_NODE_IDS.rightSidebar) {
                      moveWidget(draggingTab.instanceId, draggingTab.fromNodeId, WELL_KNOWN_NODE_IDS.rightSidebar);
                    } else {
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (!Number.isNaN(from)) reorderWidget(WELL_KNOWN_NODE_IDS.rightSidebar, from, i);
                    }
                    setDraggingTab(null);
                  }}
                  className="group/tab flex shrink-0 items-center"
                >
                  <button
                    onClick={() => setRightTab(t.id)}
                    className={`max-w-[110px] cursor-grab truncate rounded-[6px] px-1.5 py-1 text-left text-[11px] font-medium uppercase tracking-wide transition active:cursor-grabbing ${
                      rightTab === t.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                  {/* Zero width until hovered — flexbox reflow (grows the
                      strip, shifts later tabs over), not overlap, so it
                      never covers the label. */}
                  <span className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-all group-hover/tab:w-9 group-hover/tab:opacity-100">
                    {t.canMoveToOtherRegion && (
                      <button
                        title="Move to bottom panel"
                        onClick={() => moveWidget(t.instanceId, WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock)}
                        className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <MoreHorizontal className="h-2.5 w-2.5" />
                      </button>
                    )}
                    {!t.pinned && rightTabs.length > 1 && (
                      <button
                        title="Close"
                        onClick={() => removeWidget(WELL_KNOWN_NODE_IDS.rightSidebar, t.instanceId)}
                        className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <AddWidgetMenu
              region="sidebar"
              openWidgetTypeIds={rightWidgetTypeIds}
              onAdd={(widgetTypeId) => addWidget(WELL_KNOWN_NODE_IDS.rightSidebar, widgetTypeId)}
            />
            <button
              title="Collapse sidebar"
              onClick={() => setSidebarState("collapsed")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
              indicatorId={aiIndicatorId}
              onIndicatorIdChange={setAiIndicatorId}
              onBuilt={(r, indicatorId) => {
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
                    ...(indicatorId ? { savedId: indicatorId } : {}),
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
              chartInstances={chartInstanceOptions}
              activeChartInstanceId={activeChartInstanceId}
              config={alertsTab?.alertsConfig}
              onConfigChange={(next) =>
                alertsTab && setLayout((prev) => updateAlertsConfig(prev, alertsTab.instanceId, next))
              }
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

          ) : rightTab === "watchlist" && watchlistTab ? (
          <WatchlistPanel
            chartInstances={chartInstanceOptions}
            activeChartInstanceId={activeChartInstanceId}
            config={watchlistTab.watchlistConfig}
            onConfigChange={(next) =>
              setLayout((prev) => updateWatchlistConfig(prev, watchlistTab.instanceId, next))
            }
            signedIn={!!user}
            onSelect={selectSymbolForInstance}
          />
          ) : (
            // A dock-native widget (Code/Strategy tester/Positions/Orders/
            // History/Journal/Saved/Reference) moved into the sidebar via
            // UI-4c's "move between regions" action. Its content isn't
            // built to render in the sidebar's narrower layout yet — an
            // honest limitation, not a silent blank panel or fake content.
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-[11px] text-muted-foreground">
                This widget isn't available in the compact sidebar view yet.
              </p>
              <button
                onClick={() => {
                  const active = rightTabs.find((t) => t.id === rightTab);
                  if (active)
                    moveWidget(active.instanceId, WELL_KNOWN_NODE_IDS.rightSidebar, WELL_KNOWN_NODE_IDS.bottomDock);
                }}
                className="rounded-[6px] border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                Move to bottom panel
              </button>
            </div>
          )}
        </aside>
      )}
    </>
  );

  const renderLeaf = (node: LayoutNode & { kind: "tabs" }) => {
    // UI-4g-2: a chart-hosting leaf is recognized by CONTENT (does it hold a
    // "chart" tab), not just the well-known chart-area id -- a second chart
    // created via "Add Chart" lives in a freshly-generated "pane-<uuid>"
    // leaf, not chart-area, and still needs the real chart-rendering path,
    // not renderGenericLeaf (built only for the 4 simple portable widgets).
    const chartTab = node.tabs.find((t) => t.widgetTypeId === "chart");
    if (chartTab) return renderChartLeaf(chartTab.instanceId, node.id);
    if (node.id === WELL_KNOWN_NODE_IDS.bottomDock) return renderBottomDock();
    if (node.id === WELL_KNOWN_NODE_IDS.rightSidebar) return renderRightSidebar();
    // UI-4f-4: any other leaf is a real, user-created split pane (edge-drop)
    // -- orderflowPro's inert dom-panel never reaches here in practice since
    // that preset is locked and can't become the active layout, but a
    // genuinely new "pane-<uuid>" leaf now does.
    return renderGenericLeaf(node);
  };

  // UI-4f-2: a split renders as a plain (non-resizable) flex container,
  // not a react-resizable-panels Group, whenever its region is collapsed or
  // maximized -- those states are driven by the leaf's own CSS (flex-1/
  // basis-14 for a maximized dock, an icon-rail for a collapsed sidebar),
  // which needs to be free of a Panel's percentage-based sizing. Only the
  // plain "normal"/"expanded" states are actually drag-resizable.
  //
  // UI-4f-5: walks the REAL tree (via pathToLeaf) from each state's known
  // boundary (chart-column for the dock, workspace-root for the sidebar)
  // down to the actual leaf, rather than assuming that leaf is always a
  // DIRECT child of the boundary. That assumption held for every tree UI-4f-1
  // through UI-4f-3 could produce, but UI-4f-4's edge-drop can now wrap
  // bottom-dock or right-sidebar in a brand-new split with a generated id --
  // confirmed by reproducing it directly: edge-dropping a widget onto the
  // dock and then maximizing it left that new wrapping split as a rigid
  // 50/50 Panel pair, so the dock's own flex-1 intent was capped at half the
  // maximized area while the chart was crushed far past its intended basis-14
  // sliver. `emphasizedChildOf` is the other half of the fix: every ancestor
  // on the path also needs to know WHICH child continues toward the
  // maximized/collapsed leaf, so PlainSplit can hide the other one instead of
  // still splitting space with it -- see LayoutTree.tsx.
  const { nonResizableSplitIds, emphasizedChildOf, growChildOf } = useMemo(() => {
    const ids = new Set<string>();
    const emphasized = new Map<string, string>();
    const grow = new Map<string, string>();
    function applyPath(boundaryId: string, leafId: string) {
      const boundary = findNodeById(layout.root, boundaryId);
      if (!boundary) return;
      const path = pathToLeaf(boundary, leafId);
      if (!path) return;
      for (let i = 0; i < path.length - 1; i++) {
        ids.add(path[i]);
        emphasized.set(path[i], path[i + 1]);
      }
    }
    if (dockState !== "normal") {
      applyPath(WELL_KNOWN_NODE_IDS.chartColumn, WELL_KNOWN_NODE_IDS.bottomDock);
      // UI-5 close-out: chart-column's own two children (bottom-dock and
      // whatever holds the chart(s) beside it) must NOT split space 50/50
      // just because neither is hidden — see growChildOf's docstring in
      // LayoutTree.tsx. Maximized means the dock is the side that should
      // actually grow (chart-area/the chart row already shrinks itself to
      // its own basis-14 sliver); collapsed means the opposite — the dock
      // only wants its own natural ~header-row height, so the chart side
      // is the one that should grow instead.
      const chartColumnNode = findNodeById(layout.root, WELL_KNOWN_NODE_IDS.chartColumn);
      if (chartColumnNode && chartColumnNode.kind === "split") {
        if (dockState === "maximized") {
          grow.set(chartColumnNode.id, WELL_KNOWN_NODE_IDS.bottomDock);
        } else {
          const chartSide = chartColumnNode.children.find(
            (c) => c.id !== WELL_KNOWN_NODE_IDS.bottomDock,
          );
          if (chartSide) grow.set(chartColumnNode.id, chartSide.id);
        }
      }
    }
    if (sidebarState !== "expanded") applyPath(WELL_KNOWN_NODE_IDS.root, WELL_KNOWN_NODE_IDS.rightSidebar);
    return { nonResizableSplitIds: ids, emphasizedChildOf: emphasized, growChildOf: grow };
  }, [dockState, sidebarState, layout]);

  /**
   * UI-5 close-out (Chart/Split/Code, gap #1): union of the static
   * well-known ids and every id currently holding a chart tab anywhere in
   * its subtree (see `collectChartBearingNodeIds`'s docstring for the bug
   * this closes — a 2nd/3rd/4th chart's wrapping split had no protection
   * from the dock's maximize/collapse "hide the other sibling" logic, so
   * "Chart" mode with 2+ charts open hid every chart instead of maximizing
   * them). Recomputed only when the tree actually changes shape.
   */
  const neverSuppressChildIds = useMemo(
    () => new Set([...NEVER_SUPPRESS_CHILD_IDS, ...collectChartBearingNodeIds(layout.root)]),
    [layout],
  );

  // Same floors (and the sidebar's ceiling) the old hand-rolled pointer-drag
  // handles enforced (`Math.max(160, ...)` for the dock, `Math.max(240,
  // ...)`/`Math.min(..., 420)` for the sidebar) -- preserved exactly, just
  // expressed as Panel's own minSize/maxSize instead of manual clamping.
  // chart-area/chart-column get a modest new floor so an extreme drag can
  // never crush the chart pane to nothing -- there was no explicit floor
  // for it before since it was the sole `flex-1` sibling, not something a
  // handle could shrink past 0 into.
  const minSizeForChild = useCallback((childId: string): string | undefined => {
    if (childId === WELL_KNOWN_NODE_IDS.bottomDock) return "160px";
    if (childId === WELL_KNOWN_NODE_IDS.rightSidebar) return "240px";
    if (childId === WELL_KNOWN_NODE_IDS.chartArea) return "200px";
    if (childId === WELL_KNOWN_NODE_IDS.chartColumn) return "300px";
    // UI-4f-4: any other id is a freshly edge-drop-created pane -- a
    // universal floor so a new split can't be dragged down to an unusable
    // sliver either, same spirit as the well-known regions' own floors.
    return "180px";
  }, []);
  const maxSizeForChild = useCallback((childId: string): string | undefined => {
    if (childId === WELL_KNOWN_NODE_IDS.rightSidebar) return "420px";
    return undefined;
  }, []);

  // Commits a finished user drag's sizes into the tree -- the existing
  // UI-4d autosave effect (keyed on `layout`) then persists it like any
  // other layout change. Never called mid-drag (see LayoutTree's own
  // isUserInteraction gating), so a resize stays smooth without spamming
  // local/cloud writes on every frame.
  const onResizeCommit = useCallback((splitNodeId: string, sizes: number[]) => {
    setLayout((prev) => updateSplitSizes(prev, splitNodeId, sizes));
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* global app nav — same shell every authenticated route uses */}
      <AppNavRail
        onNewProject={handleNewAiProject}
        onOpenHistory={handleOpenAiHistory}
        onOpenAlerts={handleOpenAlerts}
      />
      <div ref={rootRef} className="studio-scrollbars flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-sidebar px-2">
        <span className="hidden shrink-0 text-[13px] font-medium tracking-tight text-muted-foreground md:inline">
          Chart Studio
        </span>
        <div className="h-4 w-px shrink-0 bg-border" />

        <button
          onClick={() => setSymbolOpen(true)}
          className="flex h-8 shrink-0 items-center gap-2 rounded-[6px] border border-border bg-card px-2.5 text-xs hover:border-brand"
          title="Search markets (symbol)"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono font-medium">{symbol}</span>
          <span className="hidden text-muted-foreground md:inline">
            {resolveSymbol(symbol).exchange}
          </span>
        </button>

        {/* timeframe */}
        <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-[6px] border border-border bg-card px-0.5">
          {favTfs.map((tf) => (
            <button
              key={tf}
              onClick={() => setIntervalStr(tf)}
              className={`rounded-[4px] px-2 py-1 text-[11px] ${
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
              className="flex items-center rounded-[4px] px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
            className="flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Sliders className="h-3.5 w-3.5" />
        </button>

        {/* chart settings */}
        <div className="relative">
          <button
            onClick={() => setMenu((m) => (m === "settings" ? null : "settings"))}
            title="Chart settings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
            className={`flex h-8 items-center gap-1 rounded-[6px] px-2 ${
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
            className="hidden h-8 rounded-[6px] px-1.5 hover:bg-accent hover:text-foreground disabled:opacity-40 lg:inline-flex lg:items-center lg:gap-1"
          >
            {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {bars.length} bars +
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          <button
            title="Fit chart"
            onClick={() => controlsRef.current?.fit()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            title="Jump to latest bar"
            onClick={() => controlsRef.current?.toLatest()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
          <button
            title="Replay (coming soon)"
            disabled
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground/40"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          {/* UI-5 close-out gap #1: Chart / Split / Code — reuses dock/
           * dockState exactly as every other dock control here already
           * does (see setViewMode above), so this is the one clear place
           * to switch working mode instead of two separate, less legible
           * controls (a collapse toggle here + a maximize toggle buried in
           * the dock's own tab strip). */}
          <div
            role="group"
            aria-label="Chart, Split, or Code working mode"
            className="flex h-8 shrink-0 items-center gap-0.5 rounded-[6px] border border-border bg-card px-0.5"
          >
            {(
              [
                ["chart", "Chart", "Maximize chart space — hide the code editor"],
                ["split", "Split", "Chart and code editor side by side"],
                ["code", "Code", "Maximize the code editor for manual editing"],
              ] as const
            ).map(([m, label, title]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                title={title}
                className={`rounded-[4px] px-2 py-1 text-[11px] font-medium ${
                  viewMode === m
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            title={sidebarState === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() =>
              setSidebarState((s) => (s === "expanded" ? "collapsed" : "expanded"))
            }
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground ${
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
            title={
              chartInstancesInTreeCount >= 4
                ? "Chart limit reached (4/4)"
                : "Add chart — a new independent chart pane"
            }
            disabled={chartInstancesInTreeCount >= 4}
            onClick={addChartInstance}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <LayoutMenu
            layouts={workspaceStore.layouts}
            activeLayoutId={workspaceStore.activeLayoutId}
            defaultLayoutId={workspaceStore.defaultLayoutId}
            onSwitch={switchToLayout}
            onSaveAsNew={saveAsNewLayout}
            onSaveActive={saveActiveNamedLayout}
            onRename={renameLayout}
            onDelete={deleteLayout}
            onSetDefault={setDefaultLayout}
            presets={presetOptions}
            onSwitchPreset={switchToPreset}
            signedIn={signedIn}
            syncError={cloudSyncError}
          />
          <button
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground"
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
        <DrawToolbar
          tool={tool}
          onSelectTool={setTool}
          magnet={magnet}
          onSetMagnet={setMagnet}
          objectsOpen={objectsOpen}
          onToggleObjects={() => setObjectsOpen((v) => !v)}
          hasDrawings={drawings.length > 0}
          hasSelection={Boolean(selectedDrawing)}
          allLocked={drawings.length > 0 && drawings.every((d) => d.locked)}
          allHidden={drawings.length > 0 && drawings.every((d) => d.hidden)}
          onLockAll={() => setAllDrawingsField("locked", true)}
          onUnlockAll={() => setAllDrawingsField("locked", false)}
          onHideAll={() => setAllDrawingsField("hidden", true)}
          onShowAll={() => setAllDrawingsField("hidden", false)}
          onDeleteSelected={() => selectedDrawing && removeDrawing(selectedDrawing)}
          onDeleteAll={deleteAllDrawings}
        />

        {/* chart + sidebar, generically rendered from the workspace tree
            (UI-4f-1) -- structure is tree-driven, leaf content/resize
            mechanics are unchanged, see renderLeaf/renderChartArea/
            renderBottomDock/renderRightSidebar above. `key={layoutKey}`
            forces a clean remount whenever `layout` is wholesale-replaced
            (see the layoutKey/bumpLayoutKey comment above) so
            react-resizable-panels' uncontrolled `defaultSize` prop picks
            up the new sizes instead of silently keeping whatever mounted
            first. */}
        <LayoutTree
          key={layoutKey}
          node={layout.root}
          renderLeaf={renderLeaf}
          nonResizableSplitIds={nonResizableSplitIds}
          emphasizedChildOf={emphasizedChildOf}
          growChildOf={growChildOf}
          neverSuppressChildIds={neverSuppressChildIds}
          minSizeForChild={minSizeForChild}
          maxSizeForChild={maxSizeForChild}
          onResizeCommit={onResizeCommit}
        />

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
    </div>
  );
}
