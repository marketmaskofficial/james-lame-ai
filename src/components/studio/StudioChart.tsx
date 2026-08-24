import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Bar, MarkerOut, RunResult } from "@/lib/sgscript/types";
import { MARKER_PRESETS, DEFAULT_MAX_VISIBLE } from "@/lib/sgscript/style";
import {
  logicalToTime,
  timeToLogicalExtrapolated,
  nearestBarIndex,
  snapPoint,
  distToSegment,
  pixelDist,
} from "@/lib/drawing/geometry";
import {
  DEFAULT_FIB_LEVELS,
  computeFibLevels,
  anchoredVwap,
  computePositionMetrics,
  type FibLevel,
} from "@/lib/drawing/calc";

/** Magnet strength for drawing-anchor snapping (distinct from the chart's own
 * `crosshairMagnet` display setting, which only affects the crosshair, not
 * where a drawing's anchor is actually placed). "off" never alters a user's
 * chosen coordinate; "weak" only pulls in when already close to a candle's
 * O/H/L/C; "strong" always snaps to the nearest of the four. */
export type MagnetMode = "off" | "weak" | "strong";

/**
 * Single source of truth for the chart's canvas-rendered chrome colors.
 * Lightweight Charts takes literal color strings at option-set time (it
 * draws to canvas, not DOM), so these can't be CSS custom properties like
 * the rest of Chart Studio's surfaces — this object is the equivalent for
 * the values that *can't* reach `var(--panel)`/`var(--border)` etc.
 */
const CHART_COLORS = {
  gridLine: "rgba(255,255,255,0.035)",
  axisBorder: "rgba(255,255,255,0.10)",
  paneSeparator: "rgba(255,255,255,0.08)",
  paneSeparatorHover: "rgba(230,184,0,0.18)",
  crosshair: "rgba(230,184,0,0.35)",
  bullishVolume: "rgba(34,197,94,0.32)",
  bearishVolume: "rgba(239,68,68,0.32)",
} as const;

export type LoadedIndicator = {
  key: string;
  name: string;
  visible: boolean;
  result: RunResult;
};

export type DrawTool =
  // Cursor / Interaction
  | "cursor"
  | "select"
  // Trend / Line Tools
  | "trend"
  | "ray"
  | "extended"
  | "hline"
  | "vline"
  | "hray"
  | "channel"
  | "arrow"
  // Fibonacci / Advanced
  | "fib"
  | "fib-ext"
  | "fib-channel"
  | "fib-time"
  | "pitchfan"
  // Pattern Tools (menu/registry only — see registry.ts, deferred per spec)
  | "xabcd"
  | "cypher"
  | "head-shoulders"
  | "abcd"
  | "triangle-pattern"
  | "three-drives"
  | "elliott"
  // Position / Forecast
  | "long"
  | "short"
  | "forecast"
  // Volume-based
  | "vwap"
  | "vp-fixed"
  | "vp-anchored"
  // Brushes / Freehand
  | "brush"
  | "highlighter"
  // Shapes
  | "rect"
  | "circle"
  | "triangle"
  // Text / Notes
  | "text"
  | "marker"
  // Measurement
  | "price-range"
  | "date-range"
  | "measure"
  // legacy point-eraser tool, superseded by Delete/Backspace on a selection
  // but kept functional rather than ripped out mid-phase
  | "erase";

export type DrawStyle = "solid" | "dashed" | "dotted";

/** A single anchor in MARKET coordinates — bar time (unix seconds) + price.
 * Never a raw screen pixel: pixel position is re-derived from this every
 * render frame (see `logicalToPixel`/`timeToLogicalExtrapolated`), which is
 * what keeps a drawing's geometry correct across resize, layout changes, and
 * history backfill (which shifts every bar's logical INDEX but never its
 * time). See src/lib/drawing/geometry.ts's module doc for the full story. */
export type MarketPoint = { time: number; price: number };

/** Free-form bag for tool-specific configuration that doesn't need its own
 * typed field — Fib's level set, VWAP's cached series, position tick
 * metadata overrides, extend-line flags, fill color/opacity, font
 * size/weight, label visibility, etc. Kept loose (not a big discriminated
 * union per tool) so new tools can add settings without a schema change;
 * `DrawingSettingsPopover.tsx` and each tool's render/calc code are the only
 * things that need to agree on the keys they use for `d.tool`. */
export type DrawingSettings = Record<string, unknown>;

/**
 * One persisted drawing object. `tool` is this object's "type" (the spec's
 * external-facing schema calls it `type`; kept as `tool` here to match
 * every existing call site and avoid a purely-cosmetic rename across this
 * file's ~2000 lines) and `p1`/`p2`/`points` together are its "anchors" (a
 * uniform `anchors: MarketPoint[]` array wasn't worth the churn either, since
 * two-anchor tools are the overwhelming majority and read far more clearly
 * as named `p1`/`p2` in the hit-test/render code below — `anchorsOf()`
 * exposes the uniform view for serialization/tests/multi-anchor tools).
 */
export type Drawing = {
  id: string;
  tool: Exclude<DrawTool, "cursor" | "select" | "erase">;
  /** Owning chart instance — stamped on creation, authoritative for
   * multi-chart isolation (see `anchorsOf`/persistence). Optional only so a
   * pre-this-phase persisted drawing (which never had this field) still
   * parses; every current call site stamps it. */
  chartInstanceId?: string;
  p1: MarketPoint;
  p2: MarketPoint;
  /** Extra anchors beyond p1/p2: brush's freehand path (arbitrary length),
   * or a single third point for Parallel Channel (channel width) / Triangle
   * (third vertex). */
  points?: MarketPoint[];
  text?: string;
  /** Position tools carry a third anchor: the protective stop. */
  stop?: number;
  color?: string;
  opacity?: number;
  width?: number;
  style?: DrawStyle;
  locked?: boolean;
  hidden?: boolean;
  settings?: DrawingSettings;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
};

/** Uniform anchors view — every point this drawing is defined by, in one
 * array, for code (serialization, tests, "does this fit on screen at all")
 * that genuinely doesn't care about each tool's specific anchor roles. */
export function anchorsOf(d: Pick<Drawing, "p1" | "p2" | "points" | "tool">): MarketPoint[] {
  if (d.tool === "brush" || d.tool === "highlighter") return d.points?.length ? d.points : [d.p1, d.p2];
  return [d.p1, d.p2, ...(d.points ?? [])];
}

const DEFAULT_DRAW_COLOR = "#e6b800";

function dash(style: DrawStyle | undefined, width: number): number[] {
  if (style === "dashed") return [Math.max(4, width * 3), Math.max(3, width * 2)];
  if (style === "dotted") return [1, Math.max(3, width * 2)];
  return [];
}

/** Sign of the signed area of triangle (x1,y1)-(x2,y2)-(x3,y3) — the
 * standard barycentric same-side test used by `pointInTriangle`. */
function triSign(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
}

/** True if (px,py) lies inside (or on) the triangle — used so a Triangle
 * drawing's whole filled interior is a valid select/drag hit region, not
 * just its three edges. */
function pointInTriangle(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): boolean {
  const d1 = triSign(px, py, x1, y1, x2, y2);
  const d2 = triSign(px, py, x2, y2, x3, y3);
  const d3 = triSign(px, py, x3, y3, x1, y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function withAlpha(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${opacity})`;
}



/**
 * Normalizes any Pine/CSS colour form (hex3/6/8, rgb(), rgba(), named) into an
 * rgba string with an extra opacity multiplier applied. Keeps a "20% green
 * zone" a 20% green zone in the Studio renderer.
 */
function applyAlpha(color: string, mult = 1): string {
  const c = (color ?? "").trim();
  if (mult >= 1 && !/^#?[0-9a-f]{8}$/i.test(c)) return c;
  const hex = /^#?([0-9a-f]{3,8})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    const v = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a * mult})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const parts = rgb[1].split(",").map((x) => x.trim());
    const a = parts[3] === undefined ? 1 : Number(parts[3]);
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${(Number.isFinite(a) ? a : 1) * mult})`;
  }
  return c;
}

const LABEL_FONT_PX: Record<string, number> = {
  tiny: 9,
  small: 10,
  normal: 11,
  large: 13,
};

// ---- render telemetry ------------------------------------------------------
//
// Root cause this closes: lightweight-charts' logicalToCoordinate() returns
// null for any logical index outside the chart's CURRENT visible pan/zoom
// range — not just outside the loaded data range. The draw loops used to
// treat that null identically to "invalid data" and silently skip the
// object, so a box/line/label anchored to a bar that isn't currently
// scrolled into view (or one drawn during the first frame or two after the
// chart's geometry hasn't settled yet) never rendered — with no error, no
// distinction from a bad indicator, and no way to tell from the outside.
//
// Fix: only trust logicalToCoordinate() as authoritative once the chart has
// a real visible range (chartGeometryReady). Once it does, a null from the
// native API means "off-screen", not "invalid" — extrapolate a pixel
// position linearly from the known visible-range-to-pixel mapping instead of
// dropping the object. Downstream drawing already clamps to canvas bounds
// (`Math.min(x2raw, host.clientWidth)`), so an extrapolated coordinate off
// either edge is handled the same way a partially-visible object always was.

export type PrimitiveStats = {
  received: number;
  drawn: number;
  /** Valid coordinates, but the object's on-canvas footprint is zero (e.g. both edges clamp to the same side). */
  offscreen: number;
  /** Chart geometry wasn't ready yet this frame — expected to self-resolve on a later frame, not a failure. */
  waitingForGeometry: number;
  /** Threw while processing — isolated so it can't take down the rest of the batch. */
  failed: number;
};

export type RenderStats = {
  boxes: PrimitiveStats;
  lines: PrimitiveStats;
  labels: PrimitiveStats;
  plots: PrimitiveStats;
  markers: PrimitiveStats;
  fills: PrimitiveStats;
  hlines: PrimitiveStats;
  chartGeometryReady: boolean;
};

function emptyStats(): PrimitiveStats {
  return { received: 0, drawn: 0, offscreen: 0, waitingForGeometry: 0, failed: 0 };
}

export function emptyRenderStats(): RenderStats {
  return {
    boxes: emptyStats(),
    lines: emptyStats(),
    labels: emptyStats(),
    plots: emptyStats(),
    markers: emptyStats(),
    fills: emptyStats(),
    hlines: emptyStats(),
    chartGeometryReady: false,
  };
}

type MinimalTimeScale = {
  logicalToCoordinate: (logical: number) => number | null;
  getVisibleLogicalRange: () => { from: number; to: number } | null;
};

/**
 * Chart geometry is "ready" once the time scale can report a real visible
 * range — false for a handful of frames right after chart creation, a data
 * reset, or a container resize, before layout has settled. Distinct from
 * "this particular object is off-screen", which is normal and not an error.
 */
function isChartGeometryReady(ts: MinimalTimeScale, canvasWidth: number, canvasHeight: number): boolean {
  if (canvasWidth <= 0 || canvasHeight <= 0) return false;
  const range = ts.getVisibleLogicalRange();
  return !!range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from;
}

/**
 * Pixel coordinate for a logical index. Once chartGeometryReady is true, this
 * NEVER returns null for a finite logical index — off-screen positions are
 * extrapolated linearly from the visible range's own pixel mapping rather
 * than dropped, so a persistent box/line that starts outside the current
 * viewport still gets a real (possibly off-canvas, correctly clamped later)
 * coordinate instead of silently disappearing.
 */
function logicalToPixel(ts: MinimalTimeScale, logical: number, canvasWidth: number): number | null {
  if (!Number.isFinite(logical)) return null;
  const direct = ts.logicalToCoordinate(logical);
  if (direct != null) return direct;
  const range = ts.getVisibleLogicalRange();
  if (!range) return null; // chart not ready — caller's readiness gate handles this
  const span = range.to - range.from;
  if (!(span > 0)) return null;
  return ((logical - range.from) / span) * canvasWidth;
}

/** Entry / stop / target / working-order levels drawn on the price scale. */
export type TradeLine = {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
};

/**
 * A live, chart-anchored trade level the user can drag.
 * Dragging only *proposes* a price — the OMS remains authoritative.
 */
export type ChartTrade = {
  id: string;
  kind: "entry" | "stop" | "target" | "order";
  price: number;
  label: string;
  color: string;
  draggable: boolean;
  /** Optional right-hand detail, e.g. open P&L. */
  detail?: string;
};

export type PositionPlan = {
  side: "buy" | "sell";
  entry: number;
  stop: number;
  target: number;
};


export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";

export type ChartSettings = {
  grid: boolean;
  crosshairMagnet: boolean;
  logScale: boolean;
  upColor: string;
  downColor: string;
  showVolume: boolean;
};

/** Recent-bar window shown on a fresh dataset load — see the setVisibleLogicalRange
 * call below for why this replaces fitContent() as the initial-view default. */
const DEFAULT_VISIBLE_BARS = 200;

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  grid: true,
  crosshairMagnet: true,
  logScale: false,
  upColor: "#22c55e",
  downColor: "#ef4444",
  showVolume: true,
};

/** Imperative navigation handles the toolbar drives. */
export type ChartControls = {
  fit: () => void;
  toLatest: () => void;
  autoScale: () => void;
  zoom: (factor: number) => void;
};

export type CrosshairInfo = {
  time: number;
  bar: Bar | null;
  values: Array<{ title: string; color: string; value: number }>;
};

type ChartApi = {
  remove: () => void;
  addSeries: (t: unknown, opts?: unknown, pane?: number) => SeriesApi;
  removeSeries: (s: SeriesApi) => void;
  applyOptions: (o: Record<string, unknown>) => void;
  timeScale: () => {
    fitContent: () => void;
    scrollToRealTime: () => void;
    logicalToCoordinate: (l: number) => number | null;
    coordinateToLogical: (x: number) => number | null;
    getVisibleLogicalRange: () => { from: number; to: number } | null;
    setVisibleLogicalRange: (r: { from: number; to: number }) => void;
    subscribeVisibleLogicalRangeChange: (cb: () => void) => void;
  };
  priceScale: (id: string) => { applyOptions: (o: Record<string, unknown>) => void };
  subscribeCrosshairMove: (cb: (p: CrosshairParam) => void) => void;
  panes: () => Array<{ setHeight: (h: number) => void; getHeight: () => number }>;
};

type CrosshairParam = {
  time?: number;
  point?: { x: number; y: number };
};

type SeriesApi = {
  setData: (d: unknown) => void;
  update: (d: unknown) => void;
  applyOptions: (o: Record<string, unknown>) => void;
  priceToCoordinate: (p: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
  createPriceLine: (o: Record<string, unknown>) => unknown;
  removePriceLine: (l: unknown) => void;
};


/** Heikin Ashi smoothing derived client-side from the same OHLC feed. */
function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let prevOpen = 0;
  let prevClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time: b.time,
      open,
      close,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      volume: b.volume,
    });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Humanizes a duration in seconds for the Date Range tool — "3d 4h", "2h 15m", "45s". */
function fmtDuration(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${s}s`;
}

function fmt(n: number) {

  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 1 : abs >= 1 ? 2 : 6);
}

export function StudioChart({
  bars,
  indicators,
  tool,
  drawings,
  onAddDrawing,
  onRemoveDrawing,
  onUpdateDrawing,
  hasOscPane,
  extraMarkers = [],
  tradeLines = [],
  trades = [],
  onTradeDrag,
  onPlanOrder,
  onChartPrice,
  instrument,
  chartType = "candles",
  settings = DEFAULT_CHART_SETTINGS,
  onCrosshair,
  onReady,
  selectedId = null,
  onSelectDrawing,
  /**
   * Fired every drawOverlay() frame with what actually happened to every
   * indicator-drawn primitive this frame — received/drawn/offscreen/
   * waitingForGeometry/failed per type. The only trustworthy source for an
   * "did this indicator actually render" notice; runtime execution success
   * says nothing about whether anything ended up on screen.
   */
  onRenderStats,
  /** Owning chart instance, stamped onto every new Drawing this canvas
   * creates — the multi-chart-isolation source of truth. */
  chartInstanceId,
  /** Drawing-anchor snap strength — see `MagnetMode`'s doc comment. */
  magnet = "off",

}: {
  bars: Bar[];
  indicators: LoadedIndicator[];
  tool: DrawTool;
  drawings: Drawing[];
  onAddDrawing: (d: Drawing) => void;
  onRemoveDrawing: (id: string) => void;
  onUpdateDrawing?: (d: Drawing) => void;
  hasOscPane: boolean;
  /** Extra chart markers not produced by an indicator (e.g. backtest fills). */
  extraMarkers?: MarkerOut[];
  tradeLines?: TradeLine[];
  trades?: ChartTrade[];
  /** Fired on drag release with the proposed price — parent must confirm via OMS. */
  onTradeDrag?: (t: ChartTrade, price: number) => void;
  /** "Create order" from a position tool: should only populate the ticket. */
  onPlanOrder?: (plan: PositionPlan) => void;
  /** Right-click on the chart: gives the price under the cursor. */
  onChartPrice?: (price: number, screen: { x: number; y: number }) => void;
  /** Tick maths for the position tool. */
  instrument?: { tickSize: number; valuePerPoint: number };
  chartType?: ChartType;
  settings?: ChartSettings;
  onCrosshair?: (info: CrosshairInfo | null) => void;
  onReady?: (controls: ChartControls) => void;
  /** Currently selected drawing (select tool). */
  selectedId?: string | null;
  onSelectDrawing?: (id: string | null) => void;
  onRenderStats?: (statsByIndicatorKey: Record<string, RenderStats>) => void;
  chartInstanceId?: string;
  magnet?: MagnetMode;
}) {

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Zones/fills paint here instead of the foreground overlay canvas, so
   * candles (drawn by Lightweight Charts' own canvas, a sibling with no
   * explicit z-index) visually sit on top of them. Lines/labels/markers/
   * drawings stay on the foreground canvas, which keeps its positive
   * z-index and paints above candles as before.
   */
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const priceSeriesRef = useRef<SeriesApi | null>(null);
  const oscSeriesRef = useRef<SeriesApi | null>(null);
  const indicatorSeriesRef = useRef<SeriesApi[]>([]);
  const priceLinesRef = useRef<Array<{ series: SeriesApi; line: unknown }>>([]);
  const markersRef = useRef<{ setMarkers: (m: unknown[]) => void } | null>(null);
  const libRef = useRef<Record<string, unknown> | null>(null);
  const volumeSeriesRef = useRef<SeriesApi | null>(null);
  const tradeLinesRef = useRef<unknown[]>([]);
  const crosshairRef = useRef(onCrosshair);
  crosshairRef.current = onCrosshair;
  const chartTypeRef = useRef(chartType);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Live refs for the overlay renderer (avoids stale closures in rAF).
  const stateRef = useRef({ indicators, drawings, tool, bars, instrument, selectedId, magnet, chartInstanceId });
  stateRef.current = { indicators, drawings, tool, bars, instrument, selectedId, magnet, chartInstanceId };

  // Render telemetry, recomputed every drawOverlay() frame and pushed to the
  // parent so it can drive an honest success/failure notice instead of a
  // blind "updated" message — see emptyRenderStats()'s doc comment.
  const lastRenderStatsRef = useRef<Record<string, RenderStats>>({});
  const onRenderStatsRef = useRef(onRenderStats);
  // drawOverlay is a plain function redefined on every render (it closes
  // over bars/timeToLogical/etc., all of which need to be current), but the
  // rAF loop that drives it is started once, in the "create chart once"
  // mount effect. Calling drawOverlay() directly from that loop would freeze
  // it on whatever bars/timeToLogical looked like at mount (typically
  // bars = [] before the first candle fetch resolves) for the component's
  // entire lifetime — every box/line/label/fill would silently fail
  // coordinate conversion forever, while native-series primitives (plots,
  // markers) kept working because they're drawn from a separate,
  // properly-dependent effect. Routing every frame through this ref, updated
  // on every render below, keeps the loop calling the current closure.
  const drawOverlayRef = useRef<() => void>(() => {});
  onRenderStatsRef.current = onRenderStats;

  const draftRef = useRef<Drawing | null>(null);
  type AnchorKind = "p1" | "p2" | "p3" | "stop" | "body";
  const editRef = useRef<{
    drawing: Drawing;
    anchor: AnchorKind;
    start: MarketPoint;
  } | null>(null);
  /** In-progress anchors for multi-click tools (Triangle: 3 plain clicks;
   * Parallel Channel: a drag for p1/p2 followed by one more click for the
   * width point). Cleared on commit, Escape, or a tool change. */
  const pendingRef = useRef<{ tool: DrawTool; anchors: MarketPoint[] } | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const [ready, setReady] = useState(0);

  // ---- draggable trade levels (HTML overlay so chart panning still works) --
  const rowsRef = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<{ id: string; price: number } | null>(null);
  const [dragPrice, setDragPrice] = useState<{ id: string; price: number } | null>(
    null,
  );
  const planButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const tradesRef = useRef(trades);

  tradesRef.current = trades;


  const timeToLogical = useMemo(() => {
    const times = bars.map((b) => b.time);
    // A meaningful margin past either edge (not an exact bound) — indicator
    // results that briefly lag a symbol/timeframe change by a render or two
    // can legitimately have a handful of timestamps just past the loaded
    // range without being genuinely stale. Anything beyond that margin is
    // treated as belonging to a different bar set entirely (e.g. a stale
    // result not yet recomputed after a symbol switch) and returns null so
    // callers skip drawing it — a wrong-looking box at the chart's edge is
    // worse than a briefly missing one.
    const barSpan = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    const margin = times.length > 1 ? barSpan / times.length : Infinity;
    return (t: number): number | null => {
      let lo = 0;
      let hi = times.length - 1;
      if (hi < 0) return null;
      if (t < times[0] - margin || t > times[hi] + margin) return null;
      if (t <= times[0]) return 0;
      if (t >= times[hi]) return hi;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] === t) return mid;
        if (times[mid] < t) lo = mid + 1;
        else hi = mid - 1;
      }
      return Math.max(0, hi);
    };
  }, [bars]);

  // Heikin Ashi is a rendering mode: indicators still run on the raw feed.
  const displayBars = useMemo(
    () => (chartType === "heikin" ? heikinAshi(bars) : bars),
    [bars, chartType],
  );

  // ---- create chart once --------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let raf = 0;

    (async () => {
      const el = hostRef.current;
      if (!el) return;
      const lib = await import("lightweight-charts");
      if (disposed) return;
      libRef.current = lib as unknown as Record<string, unknown>;
      const chart = lib.createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight,
        autoSize: false,
        localization: { locale: "en-US" },

        layout: {
          background: { color: "transparent" },
          textColor: "#9aa3b8",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          fontSize: 11,
          attributionLogo: false,
          // Subtle by default, only standing out on hover — same principle as
          // every other quiet-until-interacted chrome element in this UI.
          panes: {
            separatorColor: CHART_COLORS.paneSeparator,
            separatorHoverColor: CHART_COLORS.paneSeparatorHover,
            enableResize: true,
          },
        },
        grid: {
          vertLines: { color: CHART_COLORS.gridLine, style: 0 },
          horzLines: { color: CHART_COLORS.gridLine, style: 0 },
        },
        rightPriceScale: {
          borderColor: CHART_COLORS.axisBorder,
          borderVisible: true,
          entireTextOnly: true,
          ticksVisible: true,
          // headroom above and below so candles never touch the frame
          scaleMargins: { top: 0.08, bottom: 0.2 },
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.10)",
          timeVisible: true,
          secondsVisible: false,
          ticksVisible: true,
          rightOffset: 12,
          barSpacing: 12,
          minBarSpacing: 0.6,
          fixLeftEdge: false,
          lockVisibleTimeRangeOnResize: true,
          rightBarStaysOnScroll: true,
        },
        crosshair: {
          mode: 0,
          vertLine: {
            color: CHART_COLORS.crosshair,
            width: 1,
            style: 3,
            labelBackgroundColor: "#e6b800",
          },
          horzLine: {
            color: CHART_COLORS.crosshair,
            width: 1,
            style: 3,
            labelBackgroundColor: "#e6b800",
          },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: true,
        },
        kineticScroll: { mouse: false, touch: true },
      }) as unknown as ChartApi;


      chartRef.current = chart;

      chart.subscribeCrosshairMove((param) => {
        const cb = crosshairRef.current;
        if (!cb) return;
        if (!param.time || !param.point) {
          cb(null);
          return;
        }
        const t = param.time;
        const bar =
          stateRef.current.bars.find((b) => b.time === t) ?? null;
        const values: CrosshairInfo["values"] = [];
        for (const ind of stateRef.current.indicators) {
          if (!ind.visible) continue;
          for (const plot of ind.result.plots) {
            const hit = plot.values.find((v) => v.time === t);
            if (hit) values.push({ title: plot.title, color: plot.color, value: hit.value });
          }
        }
        cb({ time: t, bar, values });
      });

      onReady?.({
        fit: () => chart.timeScale().fitContent(),
        toLatest: () => chart.timeScale().scrollToRealTime(),
        autoScale: () =>
          chart.priceScale("right").applyOptions({ autoScale: true }),
        zoom: (factor: number) => {
          const ts = chart.timeScale();
          const r = ts.getVisibleLogicalRange();
          if (!r) return;
          const mid = (r.from + r.to) / 2;
          const half = ((r.to - r.from) / 2) * factor;
          ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
        },
      });

      setReady((n) => n + 1);


      ro = new ResizeObserver(() => {
        const c = canvasRef.current;
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        if (c) {
          const dpr = window.devicePixelRatio || 1;
          c.width = el.clientWidth * dpr;
          c.height = el.clientHeight * dpr;
          c.style.width = `${el.clientWidth}px`;
          c.style.height = `${el.clientHeight}px`;
        }
      });
      ro.observe(el);

      const loop = () => {
        drawOverlayRef.current();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      oscSeriesRef.current = null;
      indicatorSeriesRef.current = [];
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- price series (recreated only when the chart type changes) ----------
  useEffect(() => {
    const chart = chartRef.current;
    const lib = libRef.current as Record<string, unknown> | null;
    if (!chart || !lib) return;

    // Crisp desktop-terminal candles: solid bodies, borders in the same hue,
    // and brighter wicks so exhaustion tails stay readable when zoomed out.
    const candle = {
      upColor: settings.upColor,
      downColor: settings.downColor,
      borderVisible: true,
      borderUpColor: settings.upColor,
      borderDownColor: settings.downColor,
      wickUpColor: settings.upColor,
      wickDownColor: settings.downColor,
      // The current-price marker is the axis's own last-value label, not a
      // line drawn across the whole pane — a full-width dashed line reads as
      // clutter, not the axis-hugging convention real terminals use.
      priceLineVisible: false,
      priceLineWidth: 1,
      priceLineStyle: 2,
      priceLineColor: "#e6b800",
      lastValueVisible: true,
    };
    const opts = {
      candles: candle,
      heikin: candle,
      bars: {
        upColor: settings.upColor,
        downColor: settings.downColor,
        thinBars: false,
        priceLineVisible: false,
        priceLineColor: "#e6b800",
        priceLineStyle: 2,
      },
      line: {
        color: "#e6b800",
        lineWidth: 2,
        priceLineVisible: false,
        priceLineColor: "#e6b800",
        priceLineStyle: 2,
      },
      area: {
        lineColor: "#e6b800",
        topColor: "rgba(230,184,0,0.28)",
        bottomColor: "rgba(230,184,0,0.01)",
        lineWidth: 2,
        priceLineVisible: false,
        priceLineColor: "#e6b800",
        priceLineStyle: 2,
      },
    } as const;


    const ctor =
      chartType === "bars"
        ? lib.BarSeries
        : chartType === "line"
          ? lib.LineSeries
          : chartType === "area"
            ? lib.AreaSeries
            : lib.CandlestickSeries;

    const prev = priceSeriesRef.current;
    if (prev) {
      try {
        chart.removeSeries(prev);
      } catch {
        /* already gone */
      }
    }
    const series = chart.addSeries(ctor, opts[chartType], 0);
    priceSeriesRef.current = series;
    chartTypeRef.current = chartType;
    markersRef.current = (
      lib.createSeriesMarkers as (s: unknown, m: unknown[]) => unknown
    )(series, []) as { setMarkers: (m: unknown[]) => void };
    datasetRef.current = { first: 0, length: 0 };
    setSeriesRevision((n) => n + 1);
  }, [ready, chartType, settings.upColor, settings.downColor]);

  // ---- volume histogram ----------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    const lib = libRef.current as Record<string, unknown> | null;
    if (!chart || !lib) return;
    if (!settings.showVolume) {
      if (volumeSeriesRef.current) {
        try {
          chart.removeSeries(volumeSeriesRef.current);
        } catch {
          /* ignore */
        }
        volumeSeriesRef.current = null;
      }
      return;
    }
    if (volumeSeriesRef.current) return;
    const v = chart.addSeries(
      lib.HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceScaleId: "sg-volume",
        color: "rgba(139,147,167,0.35)",
        lastValueVisible: false,
        priceLineVisible: false,
      },
      0,
    );
    chart
      .priceScale("sg-volume")
      .applyOptions({ scaleMargins: { top: 0.86, bottom: 0.02 } });
    volumeSeriesRef.current = v;
    volumeRevRef.current = "";
    setSeriesRevision((n) => n + 1);
  }, [ready, settings.showVolume]);

  // ---- trade levels (entries, stops, targets, working orders) --------------
  useEffect(() => {
    const price = priceSeriesRef.current;
    if (!price) return;
    for (const line of tradeLinesRef.current) {
      try {
        price.removePriceLine(line);
      } catch {
        /* series replaced */
      }
    }
    tradeLinesRef.current = [];
    for (const l of tradeLines) {
      try {
        tradeLinesRef.current.push(
          price.createPriceLine({
            price: l.price,
            color: l.color,
            lineWidth: 1,
            lineStyle: l.dashed ? 2 : 0,
            axisLabelVisible: true,
            title: l.title,
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }, [tradeLines, ready, chartType, settings.upColor, settings.downColor]);

  // ---- chart option changes (no chart rebuild) -----------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const line = settings.grid ? CHART_COLORS.gridLine : "transparent";
    chart.applyOptions({
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      crosshair: { mode: settings.crosshairMagnet ? 1 : 0 },
    });
    chart.priceScale("right").applyOptions({
      mode: settings.logScale ? 1 : 0,
    });
  }, [ready, settings.grid, settings.crosshairMagnet, settings.logScale]);

  // ---- candles ------------------------------------------------------------
  // Live ticks only mutate the last bar, so patch it with update() instead of
  // reloading the whole dataset (which would reset zoom/scroll every second).
  const datasetRef = useRef({ first: 0, length: 0 });
  const volumeRevRef = useRef("");
  const [seriesRevision, setSeriesRevision] = useState(0);
  useEffect(() => {
    const s = priceSeriesRef.current;
    if (!s || displayBars.length === 0) return;
    const valueOnly = chartType === "line" || chartType === "area";
    const point = (b: Bar) =>
      valueOnly
        ? { time: b.time as never, value: b.close }
        : {
            time: b.time as never,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          };

    const last = displayBars[displayBars.length - 1];
    const prev = datasetRef.current;
    const sameSet =
      prev.length > 0 &&
      prev.first === displayBars[0].time &&
      (displayBars.length === prev.length || displayBars.length === prev.length + 1);

    if (sameSet) {
      // The `sameSet` heuristic can be fooled by coincidence (a different
      // symbol/timeframe's first-bar time landing on the same value as the
      // prior dataset's, most reachable via UI-4g-4's multi-chart symbol
      // propagation resetting more than one chart's bars in the same tick) —
      // lightweight-charts' own update() throws in that case ("Cannot update
      // oldest data") since it requires the new point to be at/after the
      // series' last known time. Recover with a full setData() instead of
      // crashing the whole page's error boundary over a redraw heuristic.
      try {
        s.update(point(last));
      } catch {
        s.setData(displayBars.map(point));
      }
    } else {
      s.setData(displayBars.map(point));
      // A fresh dataset (initial load or symbol switch) gets a deterministic
      // "recent window" view instead of fitContent(), which crams every
      // loaded bar (up to 500) into the pane at whatever spacing that takes —
      // squeezing the deliberate barSpacing/rightOffset defaults and reading
      // as a huge unused gap once the timeScale's own rightOffset padding is
      // added on top of an already-cramped fit. Anchoring to the most recent
      // DEFAULT_VISIBLE_BARS at the configured bar spacing keeps candles
      // filling the pane naturally, with blank space landing on the right
      // (for analysis/drawings) rather than the left.
      const ts = chartRef.current?.timeScale();
      const n = displayBars.length;
      if (ts && n > 0) {
        const window = Math.min(DEFAULT_VISIBLE_BARS, n);
        ts.setVisibleLogicalRange({ from: n - window, to: n - 1 });
      }
    }
    datasetRef.current = { first: displayBars[0].time, length: displayBars.length };

    const vol = volumeSeriesRef.current;
    if (vol) {
      const rev = `${bars[0]?.time}:${bars.length}`;
      const lastRaw = bars[bars.length - 1];
      const bar = (b: Bar) => ({
        time: b.time as never,
        value: b.volume,
        color:
          b.close >= b.open ? CHART_COLORS.bullishVolume : CHART_COLORS.bearishVolume,

      });
      if (rev === volumeRevRef.current || volumeRevRef.current.startsWith(`${bars[0]?.time}:`)) {
        try {
          vol.update(bar(lastRaw));
        } catch {
          vol.setData(bars.map(bar));
        }
      } else vol.setData(bars.map(bar));
      volumeRevRef.current = rev;
    }
  }, [displayBars, bars, chartType, seriesRevision]);

  // ---- indicator series (plots / oscillator pane / markers / price lines) --
  const plotSigRef = useRef("");
  useEffect(() => {
    const chart = chartRef.current;
    const lib = libRef.current;
    const price = priceSeriesRef.current;
    if (!chart || !lib || !price) return;

    const visibleNow = indicators.filter((i) => i.visible);
    const sig = visibleNow
      .map(
        (i) =>
          `${i.key}:${i.result.plots
            .map((p) => `${p.id}|${p.style}|${p.pane}|${p.color}|${p.width}`)
            .join(",")}`,
      )
      .join(";");
    const reuse =
      sig === plotSigRef.current &&
      indicatorSeriesRef.current.length ===
        visibleNow.reduce((n, i) => n + i.result.plots.length, 0);

    if (reuse) {
      // Same plot topology (a live re-run) — refresh data in place.
      let k = 0;
      for (const ind of visibleNow) {
        for (const p of ind.result.plots) {
          indicatorSeriesRef.current[k++]?.setData(
            p.values.map((v) => ({ time: v.time as never, value: v.value })),
          );
        }
      }
    } else {
      for (const s of indicatorSeriesRef.current) {
        try {
          chart.removeSeries(s);
        } catch {
          /* already gone */
        }
      }
      indicatorSeriesRef.current = [];
      oscSeriesRef.current = null;
    }
    plotSigRef.current = sig;

    for (const { series, line } of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* ignore */
      }
    }
    priceLinesRef.current = [];

    const LineSeries = lib.LineSeries;
    const HistogramSeries = lib.HistogramSeries;
    const AreaSeries = lib.AreaSeries;
    const visible = visibleNow;


    const oscNeeded = visible.some(
      (i) =>
        i.result.plots.some((p) => p.pane === "osc") ||
        i.result.hlines.some((h) => h.pane === "osc"),
    );

    for (const ind of visible) {
      if (!reuse)
      for (const p of ind.result.plots) {
        const pane = p.pane === "osc" ? 1 : 0;
        const type =
          p.style === "histogram"
            ? HistogramSeries
            : p.style === "area"
              ? AreaSeries
              : LineSeries;
        const series = chart.addSeries(
          type,
          p.style === "histogram"
            ? {
                color: applyAlpha(p.color, p.opacity ?? 1),
                priceLineVisible: false,
                lastValueVisible: false,
              }
            : {
                color: applyAlpha(p.color, p.opacity ?? 1),
                lineWidth: p.width,
                priceLineVisible: false,
                lastValueVisible: false,
                lineStyle: 0,
                ...(p.style === "stepline" ? { lineType: 1 } : {}),
              },
          pane,
        );
        series.setData(
          p.values.map((v) => ({ time: v.time as never, value: v.value })),
        );
        indicatorSeriesRef.current.push(series);
        if (pane === 1) oscSeriesRef.current = series;
      }


      for (const h of ind.result.hlines) {
        const target =
          h.pane === "osc" ? (oscSeriesRef.current ?? price) : price;
        const line = target.createPriceLine({
          price: h.price,
          color: h.color,
          lineWidth: 1,
          lineStyle: h.dashed ? 2 : 0,
          axisLabelVisible: true,
          title: h.title ?? "",
        });
        priceLinesRef.current.push({ series: target, line });
      }
    }

    const markers = visible
      .flatMap((i) => {
        const cap = i.result.limits?.markers ?? DEFAULT_MAX_VISIBLE.markers;
        return i.result.markers.length > cap ? i.result.markers.slice(-cap) : i.result.markers;
      })
      .concat(extraMarkers)
      .sort((a, b) => a.time - b.time)
      .slice(0, 2000)
      .map((m) => ({
        time: m.time as never,
        position:
          m.location === "above"
            ? "aboveBar"
            : m.location === "below"
              ? "belowBar"
              : m.side === "buy"
                ? "belowBar"
                : "aboveBar",
        shape:
          m.shape === "circle"
            ? "circle"
            : m.shape === "square"
              ? "square"
              : m.side === "buy"
                ? "arrowUp"
                : "arrowDown",
        color: m.color ?? MARKER_PRESETS[m.side === "buy" ? "signal.buy" : "signal.sell"].color,
        text: m.text ?? "",
      }));
    markersRef.current?.setMarkers(markers);

    if (oscNeeded) {
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(Math.round((hostRef.current?.clientHeight ?? 500) * 0.28));
    }
  }, [indicators, hasOscPane, seriesRevision, extraMarkers]);

  // ---- overlay canvas: boxes, lines, labels, drawings ---------------------
  function drawOverlay() {
    const canvas = canvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const chart = chartRef.current;
    const price = priceSeriesRef.current;
    const host = hostRef.current;
    if (!canvas || !bgCanvas || !chart || !price || !host) return;
    const ctx = canvas.getContext("2d");
    const bgCtx = bgCanvas.getContext("2d");
    if (!ctx || !bgCtx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== host.clientWidth * dpr) {
      canvas.width = host.clientWidth * dpr;
      canvas.height = host.clientHeight * dpr;
      canvas.style.width = `${host.clientWidth}px`;
      canvas.style.height = `${host.clientHeight}px`;
    }
    if (bgCanvas.width !== host.clientWidth * dpr) {
      bgCanvas.width = host.clientWidth * dpr;
      bgCanvas.height = host.clientHeight * dpr;
      bgCanvas.style.width = `${host.clientWidth}px`;
      bgCanvas.style.height = `${host.clientHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.clearRect(0, 0, host.clientWidth, host.clientHeight);

    const ts = chart.timeScale();
    const geometryReady = isChartGeometryReady(ts, host.clientWidth, host.clientHeight);
    const x = (logical: number | null) =>
      logical == null ? null : geometryReady ? logicalToPixel(ts, logical, host.clientWidth) : null;
    const y = (p: number) => price.priceToCoordinate(p);
    // Oscillator-pane counterpart to y() — a value on an oscillator's own
    // scale (e.g. an RSI reading) must convert through that pane's series,
    // never the main price series: converting a 0-100-scale RSI value
    // through a ~60,000-scale price series succeeds arithmetically but
    // lands the result far off-canvas, with no error to signal why.
    //
    // priceToCoordinate() on an oscillator-pane series returns a coordinate
    // relative to that pane's OWN local canvas (0 at the oscillator pane's
    // own top edge), not the single full-height canvas this overlay draws
    // on — so it has to be shifted down by every earlier pane's height, or
    // an "osc" value lands near the top of the chart instead of inside the
    // oscillator pane.
    const osc = oscSeriesRef.current;
    let oscPaneTop = 0;
    if (osc) {
      try {
        const panes = chart.panes();
        for (let i = 0; i < panes.length - 1; i++) oscPaneTop += panes[i].getHeight();
      } catch {
        oscPaneTop = 0;
      }
    }
    const yFor = (p: number, pane?: "price" | "osc") => {
      if (pane !== "osc") return y(p);
      if (!osc) return null;
      const local = osc.priceToCoordinate(p);
      return local == null ? null : local + oscPaneTop;
    };

    const { indicators: inds, drawings: draws } = stateRef.current;
    const planBoxes: Array<{ id: string; x: number; y: number }> = [];

    // Telemetry for this frame, per indicator (not a global aggregate — with
    // several indicators on the chart, "did indicator X actually render"
    // needs X's own counts, not the whole chart's). See emptyRenderStats()'s
    // doc comment for why "off-screen" and "waiting for geometry" are
    // tracked separately from "failed": neither is an error, and conflating
    // them with a genuine failure is what let boxes vanish with zero signal
    // before.
    const statsByKey: Record<string, RenderStats> = {};
    const footprint = (left: number, top: number, w: number, h: number) => {
      const onCanvasX = left + w > 0 && left < host.clientWidth;
      const onCanvasY = top + h > 0 && top < host.clientHeight;
      return onCanvasX && onCanvasY;
    };

    // Universal label collision suppression, chart-wide (not per-indicator —
    // two different indicators' labels piling on the same spot is exactly
    // the clutter this exists to prevent). A label() call that would land
    // on top of an already-drawn one this frame is skipped rather than
    // stacked; first-come-first-served by draw order is enough to stop the
    // "labels pile on top of each other" failure mode without needing a
    // full layout/repositioning pass.
    const drawnLabelRects: Array<{ left: number; top: number; w: number; h: number }> = [];
    const collidesWithDrawnLabel = (left: number, top: number, w: number, h: number) =>
      drawnLabelRects.some(
        (r) => left < r.left + r.w && left + w > r.left && top < r.top + r.h && top + h > r.top,
      );

    // Keep the HTML trade-level rows glued to their price as the chart moves.
    for (const t of tradesRef.current) {
      const el = rowsRef.current.get(t.id);
      if (!el) continue;
      const drag = dragRef.current;
      const p = drag && drag.id === t.id ? drag.price : t.price;
      const py = y(p);
      if (py == null || py < 0 || py > host.clientHeight) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translateY(${Math.round(py) - 9}px)`;
    }


    for (const ind of inds) {
      if (!ind.visible) continue;
      const r = ind.result;
      const stats = emptyRenderStats();
      stats.chartGeometryReady = geometryReady;
      statsByKey[ind.key] = stats;

      // Automatic density cap: applies whether or not the script ever
      // called limitDrawings() — an indicator that never thought about
      // "don't spam the chart with hundreds of old objects" still gets
      // capped, keeping the newest (most relevant) objects. A script that
      // did call limitDrawings() already trimmed r.boxes/etc at the source,
      // so this is a no-op there (min(length, cap) === length).
      const boxCap = ind.result.limits?.boxes ?? DEFAULT_MAX_VISIBLE.boxes;
      const lineCap = ind.result.limits?.lines ?? DEFAULT_MAX_VISIBLE.lines;
      const labelCap = ind.result.limits?.labels ?? DEFAULT_MAX_VISIBLE.labels;
      const markerCap = ind.result.limits?.markers ?? DEFAULT_MAX_VISIBLE.markers;
      const visBoxes = r.boxes.length > boxCap ? r.boxes.slice(-boxCap) : r.boxes;
      const visLines = r.lines.length > lineCap ? r.lines.slice(-lineCap) : r.lines;
      const visLabels = r.labels.length > labelCap ? r.labels.slice(-labelCap) : r.labels;
      const visMarkers = r.markers.length > markerCap ? r.markers.slice(-markerCap) : r.markers;

      stats.boxes.received += visBoxes.length;
      for (const b of visBoxes) {
        if (b.hidden) continue;
        try {
          if (!geometryReady) {
            stats.boxes.waitingForGeometry++;
            continue;
          }
          const x1 = x(timeToLogical(b.time1));
          const x2raw =
            b.extend === "right" ? host.clientWidth : x(timeToLogical(b.time2));
          const y1 = y(b.price1);
          const y2 = y(b.price2);
          if (x1 == null || x2raw == null || y1 == null || y2 == null) {
            // geometryReady is true, so a null here means genuinely invalid
            // input (e.g. a NaN price) rather than off-screen — off-screen
            // positions are always extrapolated to a real number above.
            stats.boxes.failed++;
            continue;
          }
          const x2 = Math.min(x2raw, host.clientWidth);
          const alpha = b.opacity ?? 1;
          const left = Math.min(x1, x2);
          const top = Math.min(y1, y2);
          const w = Math.max(1, Math.abs(x2 - x1));
          const h = Math.max(1, Math.abs(y2 - y1));
          if (!footprint(left, top, w, h)) {
            stats.boxes.offscreen++;
            continue;
          }
          // Zones paint on the background canvas (behind candles) — see
          // bgCanvasRef's doc comment. Everything else in this function
          // keeps using the foreground `ctx`.
          bgCtx.save();
          bgCtx.fillStyle = applyAlpha(b.color, alpha);
          bgCtx.fillRect(left, top, w, h);
          if (b.borderColor && (b.borderWidth ?? 1) > 0) {
            bgCtx.strokeStyle = applyAlpha(b.borderColor, alpha);
            bgCtx.lineWidth = b.borderWidth ?? 1;
            bgCtx.setLineDash(
              b.borderStyle === "dashed"
                ? [5, 4]
                : b.borderStyle === "dotted"
                  ? [1, 3]
                  : [],
            );
            bgCtx.strokeRect(left, top, w, h);
          }
          if (b.text && w > 28) {
            // One small label near the zone's trailing (right) edge, not
            // repeated across its width — the reader's eye is at the active
            // edge, and a left-anchored label sits over the oldest candles.
            bgCtx.setLineDash([]);
            bgCtx.fillStyle = applyAlpha(b.textColor ?? "rgba(232,234,240,0.9)", alpha);
            const fontPx = LABEL_FONT_PX[b.textSize ?? "small"] ?? 10;
            bgCtx.font = `${fontPx}px ui-sans-serif, system-ui`;
            const textW = bgCtx.measureText(b.text).width;
            const tx = Math.max(left + 4, left + w - textW - 6);
            bgCtx.fillText(b.text, tx, top + fontPx + 2);
          }
          bgCtx.restore();
          stats.boxes.drawn++;
        } catch {
          // One bad box must never take the rest of the batch down with it.
          stats.boxes.failed++;
        }
      }

      stats.lines.received += visLines.length;
      for (const l of visLines) {
        try {
          if (!geometryReady) {
            stats.lines.waitingForGeometry++;
            continue;
          }
          const x1 = x(timeToLogical(l.time1));
          const x2raw =
            l.extend === "right" ? host.clientWidth : x(timeToLogical(l.time2));
          const y1 = yFor(l.price1, l.pane);
          const y2 = yFor(l.price2, l.pane);
          if (x1 == null || x2raw == null || y1 == null || y2 == null) {
            stats.lines.failed++;
            continue;
          }
          // Extended lines keep their slope, so project the price out to the edge.
          const x2 = x2raw;
          const yEnd =
            l.extend === "right" && x2 !== x1
              ? y1 + ((y2 - y1) * (x2 - x1)) / Math.max(1e-6, (x(timeToLogical(l.time2)) ?? x2) - x1)
              : y2;
          if (!footprint(Math.min(x1, x2), Math.min(y1, yEnd), Math.abs(x2 - x1) || 1, Math.abs(yEnd - y1) || 1)) {
            stats.lines.offscreen++;
            continue;
          }
          ctx.save();
          ctx.strokeStyle = applyAlpha(l.color, l.opacity ?? 1);
          ctx.lineWidth = l.width ?? 1;
          ctx.setLineDash(
            l.style === "dotted" ? [1, 3] : l.style === "dashed" || l.dashed ? [4, 4] : [],
          );
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, yEnd);
          ctx.stroke();
          ctx.setLineDash([]);
          if (l.text) {
            const fontPx = LABEL_FONT_PX[l.textSize ?? "small"] ?? 10;
            ctx.font = `${fontPx}px ui-sans-serif, system-ui`;
            const tx = Math.min(x2, host.clientWidth - 60) + 4;
            const ty = yEnd - 3;
            const tw = ctx.measureText(l.text).width;
            // Same foreground-layer collision system as label() — a line's
            // trailing-edge text shouldn't stack on another line's or a
            // label()'s text either.
            if (!collidesWithDrawnLabel(tx, ty - fontPx, tw, fontPx + 3)) {
              ctx.fillStyle = applyAlpha(l.color, l.opacity ?? 1);
              ctx.fillText(l.text, tx, ty);
              drawnLabelRects.push({ left: tx, top: ty - fontPx, w: tw, h: fontPx + 3 });
            }
          }
          ctx.restore();
          stats.lines.drawn++;
        } catch {
          stats.lines.failed++;
        }
      }

      // Labels keep the script's exact (multi-line) text, size and styling.
      stats.labels.received += visLabels.length;
      for (const lb of visLabels) {
        try {
          if (!geometryReady) {
            stats.labels.waitingForGeometry++;
            continue;
          }
          const cx = x(timeToLogical(lb.time));
          const cy = yFor(lb.price, lb.pane);
          if (cx == null || cy == null) {
            stats.labels.failed++;
            continue;
          }
          const fs = LABEL_FONT_PX[lb.size ?? "normal"] ?? 11;
          ctx.save();
          ctx.font = `${fs}px ui-sans-serif, system-ui`;
          const rows = String(lb.text).split("\n");
          const w = Math.max(...rows.map((t) => ctx.measureText(t).width)) + 12;
          const lh = fs + 3;
          const h = rows.length * lh + 7;
          const top =
            (lb.position === "above" ? cy - h - 6 : cy + 6) + (lb.offset ?? 0);
          const left =
            lb.align === "left" ? cx : lb.align === "right" ? cx - w : cx - w / 2;
          if (!footprint(left, top, w, h)) {
            ctx.restore();
            stats.labels.offscreen++;
            continue;
          }
          if (collidesWithDrawnLabel(left, top, w, h)) {
            // Not an error and not off-screen — a valid label that would
            // have stacked on top of another one, same bucket semantics as
            // "chose not to paint for a benign reason".
            ctx.restore();
            stats.labels.offscreen++;
            continue;
          }
          ctx.fillStyle = lb.color;
          ctx.beginPath();
          ctx.roundRect(left, top, w, h, 4);
          ctx.fill();
          if (lb.borderColor) {
            ctx.strokeStyle = lb.borderColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.fillStyle = lb.textColor ?? "#e8eaf0";
          ctx.textAlign = "left";
          rows.forEach((t, i) => {
            ctx.fillText(t, left + 6, top + 5 + lh * (i + 1) - 3);
          });
          ctx.restore();
          drawnLabelRects.push({ left, top, w, h });
          stats.labels.drawn++;
        } catch {
          stats.labels.failed++;
        }
      }

      // fill() between two plots: computed correctly by the runtime but
      // never actually drawn anywhere — plots render via native
      // lightweight-charts series, which have no "fill the area between
      // these two series" primitive of their own, so this was silently
      // dropped between "runtime produced a FillOut" and "pixels on
      // screen". Draw it on this same canvas overlay using the two
      // referenced plots' own (time, value) points.
      stats.fills.received += r.fills.length;
      for (const f of r.fills) {
        try {
          if (!geometryReady) {
            stats.fills.waitingForGeometry++;
            continue;
          }
          const plotA = r.plots.find((p) => p.id === f.plotA);
          const plotB = r.plots.find((p) => p.id === f.plotB);
          if (!plotA || !plotB) {
            stats.fills.failed++;
            continue;
          }
          const bValueAt = new Map(plotB.values.map((v) => [v.time, v.value]));
          const topPts: Array<[number, number]> = [];
          const botPts: Array<[number, number]> = [];
          for (const va of plotA.values) {
            const vb = bValueAt.get(va.time);
            if (vb === undefined || !Number.isFinite(va.value) || !Number.isFinite(vb)) continue;
            const px = x(timeToLogical(va.time));
            const pyA = y(va.value);
            const pyB = y(vb);
            if (px == null || pyA == null || pyB == null) continue;
            topPts.push([px, pyA]);
            botPts.push([px, pyB]);
          }
          if (topPts.length < 2) {
            stats.fills.offscreen++; // not enough overlapping, in-range points to draw a shape
            continue;
          }
          const xs = topPts.map((p) => p[0]).concat(botPts.map((p) => p[0]));
          const ys = topPts.map((p) => p[1]).concat(botPts.map((p) => p[1]));
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          if (!footprint(left, top, Math.max(...xs) - left, Math.max(...ys) - top)) {
            stats.fills.offscreen++;
            continue;
          }
          // Fills paint on the background canvas alongside zones — see
          // bgCanvasRef's doc comment.
          bgCtx.save();
          bgCtx.beginPath();
          bgCtx.moveTo(topPts[0][0], topPts[0][1]);
          for (const [px, py] of topPts.slice(1)) bgCtx.lineTo(px, py);
          for (const [px, py] of [...botPts].reverse()) bgCtx.lineTo(px, py);
          bgCtx.closePath();
          bgCtx.fillStyle = applyAlpha(f.color, f.opacity ?? 1);
          bgCtx.fill();
          bgCtx.restore();
          stats.fills.drawn++;
        } catch {
          stats.fills.failed++;
        }
      }

      // Native lightweight-charts series (plots) and setMarkers (markers)
      // handle their own coordinate conversion, clipping and redraw
      // lifecycle internally — they can't silently lose data to this bug
      // class, so telemetry here is a straight received/drawn count, not a
      // per-object loop.
      stats.plots.received += r.plots.length;
      stats.plots.drawn += r.plots.length;
      stats.markers.received += visMarkers.length;
      stats.markers.drawn += visMarkers.length;
      stats.hlines.received += r.hlines.length;
      stats.hlines.drawn += r.hlines.length;
    }

    lastRenderStatsRef.current = statsByKey;
    onRenderStatsRef.current?.(statsByKey);

    // Time -> pixel for user drawings (as opposed to indicator primitives,
    // which use the stricter geometryReady-gated `x()` above): a drawing's
    // anchor time can legitimately sit outside the loaded range (a ray drawn
    // toward the future, a channel's baseline extending past the last bar),
    // and — unlike an indicator result — there's no "stale computation"
    // reading to guard against, so extrapolation is always safe here.
    const toLogicalD = (t: number) => timeToLogicalExtrapolated(stateRef.current.bars, t);
    const px = (p: MarketPoint) => (geometryReady ? logicalToPixel(ts, toLogicalD(p.time), host.clientWidth) : null);
    const py = (p: MarketPoint) => y(p.price);

    const all = draftRef.current ? [...draws, draftRef.current] : draws;
    const pending = pendingRef.current;
    const selected = stateRef.current.selectedId;
    const handles: Array<{ x: number; y: number }> = [];

    for (const d of all) {
      if (d.hidden) continue;
      const x1 = px(d.p1);
      const x2 = px(d.p2);
      const y1 = py(d.p1);
      const y2 = py(d.p2);
      if (x1 == null || y1 == null) continue;
      const col = d.color ?? DEFAULT_DRAW_COLOR;
      const alpha = d.opacity ?? 1;
      const lw = d.width ?? (d.tool === "highlighter" ? 10 : 1.5);
      ctx.save();
      ctx.strokeStyle = withAlpha(col, alpha);
      const fillOpacity = (d.settings?.fillOpacity as number | undefined) ?? 0.14;
      ctx.fillStyle = withAlpha(col, d.tool === "highlighter" ? Math.min(alpha, 0.35) : alpha * fillOpacity);
      ctx.lineWidth = lw;
      ctx.lineCap = d.tool === "brush" || d.tool === "highlighter" ? "round" : "butt";
      ctx.lineJoin = "round";
      ctx.setLineDash(dash(d.style, lw));
      ctx.font = "11px ui-sans-serif, system-ui";

      if (d.id === selected) {
        handles.push({ x: x1, y: y1 });
        if (x2 != null && y2 != null && d.tool !== "hline" && d.tool !== "vline" && d.tool !== "hray")
          handles.push({ x: x2, y: y2 });
        const p3 = d.points?.[0];
        if (p3 && (d.tool === "channel" || d.tool === "triangle")) {
          const hx = px(p3);
          const hy = py(p3);
          if (hx != null && hy != null) handles.push({ x: hx, y: hy });
        }
      }

      if (d.tool === "vline") {
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, host.clientHeight);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (d.tool === "arrow" && x2 != null && y2 != null) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = 9 + lw * 2;
        ctx.setLineDash([]);
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (d.tool === "marker") {
        ctx.setLineDash([]);
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.beginPath();
        ctx.arc(x1, y1, 5 + lw, 0, Math.PI * 2);
        ctx.fill();
        if (d.text) ctx.fillText(d.text, x1 + 9, y1 + 4);
        ctx.restore();
        continue;
      }
      if (d.tool === "vwap") {
        const inst = stateRef.current.instrument;
        void inst;
        const series = anchoredVwap(stateRef.current.bars, d.p1.time);
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        for (const pt of series) {
          const sx = geometryReady ? logicalToPixel(ts, toLogicalD(pt.time), host.clientWidth) : null;
          const sy = y(pt.value);
          if (sx == null || sy == null) continue;
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else ctx.lineTo(sx, sy);
        }
        if (started) ctx.stroke();
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.beginPath();
        ctx.arc(x1, y1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText("VWAP anchor", x1 + 8, y1 - 6);
        ctx.restore();
        continue;
      }
      if (d.tool === "brush" || d.tool === "highlighter") {
        const pts = d.points && d.points.length > 0 ? d.points : [d.p1, d.p2];
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        for (const pt of pts) {
          const sx = px(pt);
          const sy = py(pt);
          if (sx == null || sy == null) continue;
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else ctx.lineTo(sx, sy);
        }
        if (started) ctx.stroke();
        ctx.restore();
        continue;
      }

      if (d.tool === "hline" || d.tool === "hray") {
        const fromX = d.tool === "hray" ? x1 : 0;
        ctx.beginPath();
        ctx.moveTo(fromX, y1);
        ctx.lineTo(host.clientWidth, y1);
        ctx.stroke();
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.fillText(fmt(d.p1.price), Math.max(6, fromX + 4), y1 - 4);
      } else if (x2 != null && y2 != null) {
        if (d.tool === "trend" || d.tool === "ray" || d.tool === "measure" || d.tool === "price-range" || d.tool === "date-range") {
          let ex = x2;
          let ey = y2;
          if (d.tool === "ray") {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const scale = dx === 0 ? 1 : (host.clientWidth - x1) / dx;
            if (scale > 1) {
              ex = x1 + dx * scale;
              ey = y1 + dy * scale;
            }
          }
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          if (d.tool === "measure" || d.tool === "price-range" || d.tool === "date-range") {
            const diff = d.p2.price - d.p1.price;
            const pct = d.p1.price !== 0 ? (diff / d.p1.price) * 100 : 0;
            const barsSpan = Math.round(toLogicalD(d.p2.time) - toLogicalD(d.p1.time));
            const label =
              d.tool === "price-range"
                ? `${fmt(diff)} (${pct.toFixed(2)}%)`
                : d.tool === "date-range"
                  ? `${Math.abs(barsSpan)} bars · ${fmtDuration(Math.abs(d.p2.time - d.p1.time))}`
                  : `${fmt(diff)} (${pct.toFixed(2)}%) · ${Math.abs(barsSpan)} bars`;
            ctx.fillStyle = diff >= 0 ? "#22c55e" : "#ef4444";
            ctx.fillText(label, x2 + 6, y2 - 6);
          }
        } else if (d.tool === "rect") {
          ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (d.tool === "circle") {
          const cx = (x1 + x2) / 2;
          const cy = (y1 + y2) / 2;
          const rx = Math.abs(x2 - x1) / 2;
          const ry = Math.abs(y2 - y1) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (d.tool === "triangle") {
          const p3 = d.points?.[0];
          const x3 = p3 ? px(p3) : null;
          const y3 = p3 ? py(p3) : null;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          if (x3 != null && y3 != null) ctx.lineTo(x3, y3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (d.tool === "channel") {
          const p3 = d.points?.[0];
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (p3) {
            const x3 = px(p3);
            const y3 = py(p3);
            if (x3 != null && y3 != null) {
              const dx = x2 - x1;
              const dy = y2 - y1;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;
              const offset = (x3 - x1) * nx + (y3 - y1) * ny;
              const ox = nx * offset;
              const oy = ny * offset;
              ctx.beginPath();
              ctx.moveTo(x1 + ox, y1 + oy);
              ctx.lineTo(x2 + ox, y2 + oy);
              ctx.stroke();
              // subtle fill between the two rails
              ctx.save();
              ctx.globalAlpha = 0.08;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.lineTo(x2 + ox, y2 + oy);
              ctx.lineTo(x1 + ox, y1 + oy);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          }
        } else if (d.tool === "fib") {
          const levels = (d.settings?.fibLevels as FibLevel[] | undefined) ?? DEFAULT_FIB_LEVELS;
          const computed = computeFibLevels(d.p1.price, d.p2.price, levels.filter((l) => l.enabled !== false));
          const extendRight = Boolean(d.settings?.extendRight);
          const leftX = Math.min(x1, x2);
          const rightX = extendRight ? host.clientWidth : Math.max(x1, x2);
          for (const lvl of computed) {
            const levelY = y(lvl.price);
            if (levelY == null) continue;
            ctx.strokeStyle = withAlpha(lvl.color ?? col, 0.5);
            ctx.beginPath();
            ctx.moveTo(leftX, levelY);
            ctx.lineTo(rightX, levelY);
            ctx.stroke();
            ctx.fillStyle = withAlpha(lvl.color ?? col, 0.9);
            ctx.fillText(`${(lvl.value * 100).toFixed(1)}%  ${fmt(lvl.price)}`, rightX + 4, levelY - 2);
          }
        } else if (d.tool === "long" || d.tool === "short") {
          const entry = d.p1.price;
          const target = d.p2.price;
          const stop = d.stop ?? entry - (target - entry) * 0.5;
          const yEntry = y(entry);
          const yTarget = y(target);
          const yStop = y(stop);
          if (yEntry == null || yTarget == null || yStop == null) {
            ctx.restore();
            continue;
          }
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2, left + 140);
          const w = right - left;
          // reward zone
          ctx.fillStyle = "rgba(34,197,94,0.13)";
          ctx.fillRect(left, Math.min(yEntry, yTarget), w, Math.abs(yTarget - yEntry));
          // risk zone
          ctx.fillStyle = "rgba(239,68,68,0.13)";
          ctx.fillRect(left, Math.min(yEntry, yStop), w, Math.abs(yStop - yEntry));

          const inst = stateRef.current.instrument;
          const tick = inst?.tickSize && inst.tickSize > 0 ? inst.tickSize : 0.01;
          const vpp = inst?.valuePerPoint ?? 1;
          const metrics = computePositionMetrics(entry, stop, target, tick, vpp);

          const row = (rowY: number, color: string, text: string) => {
            ctx.strokeStyle = color;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left, rowY);
            ctx.lineTo(right, rowY);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = "10px ui-sans-serif, system-ui";
            ctx.fillText(text, left + 6, rowY - 4);
          };
          row(yTarget, "#22c55e", `TARGET ${fmt(target)} · +${metrics.rewardTicks} ticks · ${money(metrics.rewardValue)}`);
          row(yEntry, "#e6b800", `${d.tool === "long" ? "LONG" : "SHORT"} ENTRY ${fmt(entry)}`);
          row(yStop, "#ef4444", `STOP ${fmt(stop)} · ${metrics.riskTicks} ticks · ${money(metrics.riskValue)}`);

          ctx.fillStyle = "rgba(232,234,240,0.9)";
          ctx.font = "11px ui-sans-serif, system-ui";
          ctx.fillText(`R:R ${metrics.riskRewardRatio.toFixed(2)}`, right + 8, yEntry - 4);
          planBoxes.push({ id: d.id, x: right + 8, y: yEntry + 6 });

          if (d.id === selected) handles.push({ x: (left + right) / 2, y: yStop });
        } else if (d.tool === "text") {
          ctx.font = `${LABEL_FONT_PX[(d.settings?.fontSize as string) ?? "normal"] ?? 11}px ui-sans-serif, system-ui`;
          ctx.fillStyle = withAlpha(col, alpha);
          ctx.fillText(d.text ?? "", x1, y1);
        }

      } else if (d.tool === "text") {
        ctx.font = `${LABEL_FONT_PX[(d.settings?.fontSize as string) ?? "normal"] ?? 11}px ui-sans-serif, system-ui`;
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.fillText(d.text ?? "", x1, y1);
      }
      ctx.restore();
    }

    // Live preview for a multi-click tool in progress (Triangle: 3 plain
    // clicks; Parallel Channel: drag then one more click) — Escape cancels
    // this without ever touching the committed `drawings` array.
    if (pending && pending.anchors.length > 0) {
      const pts = pending.anchors.map((p) => ({ x: px(p), y: py(p) })).filter((p): p is { x: number; y: number } => p.x != null && p.y != null);
      if (pts.length > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(230,184,0,0.7)";
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        for (const p of pts) {
          ctx.fillStyle = "#e6b800";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Selection handles for the selected drawing.
    if (handles.length > 0) {
      ctx.save();
      ctx.setLineDash([]);
      for (const h of handles) {
        ctx.fillStyle = "#0b0d12";
        ctx.strokeStyle = "#e6b800";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(h.x - 4, h.y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }


    // Position-tool "create order" buttons follow their drawing.
    for (const [id, el] of planButtonsRef.current) {
      const box = planBoxes.find((b) => b.id === id);
      if (!box) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
    }
  }
  drawOverlayRef.current = drawOverlay;


  // Multi-click anchor tracking (Triangle: 3 plain clicks; Parallel Channel:
  // a drag for the baseline followed by one more click for channel width).
  // Read by drawOverlay() to render the in-progress preview.
  const previewPointRef = useRef<MarketPoint | null>(null);

  const NO_ANCHOR_2_TOOLS = new Set<DrawTool>(["hline", "vline", "hray", "text", "marker", "vwap"]);

  // ---- pointer interaction for drawing tools ------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (tool === "cursor") return;
    // Switching tools mid-flight abandons any unfinished multi-click drawing
    // — same as Escape (see the keyboard effect below).
    pendingRef.current = null;
    previewPointRef.current = null;

    const rawPoint = (e: PointerEvent): MarketPoint | null => {
      const rect = canvas.getBoundingClientRect();
      const chart = chartRef.current;
      const price = priceSeriesRef.current;
      if (!chart || !price) return null;
      const logical = chart.timeScale().coordinateToLogical(e.clientX - rect.left);
      const p = price.coordinateToPrice(e.clientY - rect.top);
      if (logical == null || p == null) return null;
      return { time: logicalToTime(stateRef.current.bars, logical), price: p };
    };
    const toPoint = (e: PointerEvent): MarketPoint | null => {
      const raw = rawPoint(e);
      if (!raw) return null;
      return snapPoint(stateRef.current.bars, raw, stateRef.current.magnet);
    };

    const newId = () => `d${Date.now()}${Math.round(Math.random() * 1e4)}`;
    // Always mints a FRESH id here, regardless of whatever placeholder the
    // caller's draft object was carrying (draftRef entries use the constant
    // "__draft__" while a shape is still being dragged/multi-clicked, purely
    // so the in-progress object has some id shape — see draftRef assignments
    // below). Committing every drawing's real id in exactly one place is
    // what guarantees two drawings can never collide on id, which id-keyed
    // selection/update/delete/persistence all depend on.
    const stampNew = (d: Omit<Drawing, "id" | "chartInstanceId" | "createdAt" | "updatedAt"> & { id?: string }): Drawing => {
      const now = Date.now();
      return {
        ...d,
        id: newId(),
        chartInstanceId: stateRef.current.chartInstanceId,
        locked: false,
        hidden: false,
        createdAt: now,
        updatedAt: now,
      };
    };

    // Closest drawing to a screen point (used by select + erase). Every tool
    // shape gets a real hit region (an anchor handle, or a body/line/area
    // test) so selecting never requires an exact pixel click.
    const hitTest = (mx: number, my: number) => {
      const chart = chartRef.current;
      const price = priceSeriesRef.current;
      if (!chart || !price) return null;
      const bars = stateRef.current.bars;
      const toPx = (p: MarketPoint) => chart.timeScale().logicalToCoordinate(timeToLogicalExtrapolated(bars, p.time));
      const toPy = (p: MarketPoint) => price.priceToCoordinate(p.price);
      let hit: { d: Drawing; anchor: AnchorKind } | null = null;
      let best = 14;
      for (const d of stateRef.current.drawings) {
        if (d.hidden) continue;
        const x1 = toPx(d.p1);
        const y1 = toPy(d.p1);
        const x2 = toPx(d.p2);
        const y2 = toPy(d.p2);
        const p3 = d.points?.[0];
        const x3 = p3 ? toPx(p3) : null;
        const y3 = p3 ? toPy(p3) : null;

        if (x1 != null && y1 != null) {
          const dist = pixelDist(x1, y1, mx, my);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "p1" };
          }
        }
        if (x2 != null && y2 != null && !NO_ANCHOR_2_TOOLS.has(d.tool)) {
          const dist = pixelDist(x2, y2, mx, my);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "p2" };
          }
        }
        if (x3 != null && y3 != null && (d.tool === "channel" || d.tool === "triangle")) {
          const dist = pixelDist(x3, y3, mx, my);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "p3" };
          }
        }
        if ((d.tool === "long" || d.tool === "short") && d.stop != null && x1 != null && x2 != null) {
          const stopY = price.priceToCoordinate(d.stop);
          if (stopY != null) {
            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2, left + 140);
            const dist = pixelDist((left + right) / 2, stopY, mx, my);
            if (dist < best) {
              best = dist;
              hit = { d, anchor: "stop" };
            }
          }
        }
        if (d.tool === "hline" && y1 != null && Math.abs(y1 - my) < best) {
          best = Math.abs(y1 - my);
          hit = { d, anchor: "body" };
        }
        if (d.tool === "vline" && x1 != null && Math.abs(x1 - mx) < best) {
          best = Math.abs(x1 - mx);
          hit = { d, anchor: "body" };
        }
        if (d.tool === "hray" && x1 != null && y1 != null && mx >= x1 - 4 && Math.abs(y1 - my) < best) {
          best = Math.abs(y1 - my);
          hit = { d, anchor: "body" };
        }
        if (
          (d.tool === "trend" || d.tool === "ray" || d.tool === "arrow" || d.tool === "measure" || d.tool === "price-range" || d.tool === "date-range") &&
          x1 != null && y1 != null && x2 != null && y2 != null
        ) {
          const dist = distToSegment(mx, my, x1, y1, x2, y2);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "body" };
          }
        }
        if (d.tool === "channel" && x1 != null && y1 != null && x2 != null && y2 != null) {
          const dist = distToSegment(mx, my, x1, y1, x2, y2);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "body" };
          }
        }
        if ((d.tool === "brush" || d.tool === "highlighter") && d.points && d.points.length > 1) {
          const pxPts = d.points.map((p) => [toPx(p), toPy(p)] as const);
          for (let i = 0; i < pxPts.length - 1; i++) {
            const [ax, ay] = pxPts[i];
            const [bx, by] = pxPts[i + 1];
            if (ax == null || ay == null || bx == null || by == null) continue;
            const dist = distToSegment(mx, my, ax, ay, bx, by);
            if (dist < best) {
              best = dist;
              hit = { d, anchor: "body" };
            }
          }
        }
        if (d.tool === "vwap") {
          const series = anchoredVwap(bars, d.p1.time);
          for (let i = 0; i < series.length - 1; i += 3) {
            const ax = chart.timeScale().logicalToCoordinate(timeToLogicalExtrapolated(bars, series[i].time));
            const ay = price.priceToCoordinate(series[i].value);
            const j = Math.min(i + 3, series.length - 1);
            const bx = chart.timeScale().logicalToCoordinate(timeToLogicalExtrapolated(bars, series[j].time));
            const by = price.priceToCoordinate(series[j].value);
            if (ax == null || ay == null || bx == null || by == null) continue;
            const dist = distToSegment(mx, my, ax, ay, bx, by);
            if (dist < best) {
              best = dist;
              hit = { d, anchor: "body" };
            }
          }
        }
        if (
          (d.tool === "rect" || d.tool === "circle" || d.tool === "long" || d.tool === "short") &&
          x1 != null && x2 != null && y1 != null && y2 != null &&
          mx >= Math.min(x1, x2) && mx <= Math.max(x1, x2) &&
          my >= Math.min(y1, y2) && my <= Math.max(y1, y2) &&
          !hit
        ) {
          hit = { d, anchor: "body" };
        }
        if (
          d.tool === "triangle" && x1 != null && y1 != null && x2 != null && y2 != null && x3 != null && y3 != null &&
          pointInTriangle(mx, my, x1, y1, x2, y2, x3, y3) && !hit
        ) {
          hit = { d, anchor: "body" };
        }
      }
      return hit;
    };

    const onDown = (e: PointerEvent) => {
      const raw = rawPoint(e);
      if (!raw) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const pt = snapPoint(stateRef.current.bars, raw, stateRef.current.magnet);

      if (tool === "erase") {
        const hit = hitTest(mx, my);
        if (hit && !hit.d.locked) onRemoveDrawing(hit.d.id);
        return;
      }

      if (tool === "select") {
        const hit = hitTest(mx, my);
        onSelectDrawing?.(hit ? hit.d.id : null);
        if (!hit || hit.d.locked || !onUpdateDrawing) return;
        canvas.setPointerCapture(e.pointerId);
        editRef.current = { drawing: hit.d, anchor: hit.anchor, start: pt };
        return;
      }

      if (tool === "triangle") {
        const pend = pendingRef.current;
        if (!pend || pend.tool !== "triangle") {
          pendingRef.current = { tool: "triangle", anchors: [pt] };
        } else {
          const anchors = [...pend.anchors, pt];
          if (anchors.length >= 3) {
            onAddDrawing(stampNew({ tool: "triangle", p1: anchors[0], p2: anchors[1], points: [anchors[2]] }));
            pendingRef.current = null;
            previewPointRef.current = null;
            onSelectDrawing?.(null);
          } else {
            pendingRef.current = { tool: "triangle", anchors };
          }
        }
        return;
      }

      if (tool === "channel") {
        const pend = pendingRef.current;
        if (pend && pend.tool === "channel" && pend.anchors.length === 2) {
          onAddDrawing(stampNew({ tool: "channel", p1: pend.anchors[0], p2: pend.anchors[1], points: [pt] }));
          pendingRef.current = null;
          previewPointRef.current = null;
          return;
        }
        canvas.setPointerCapture(e.pointerId);
        draftRef.current = { id: "__draft__", tool: "channel", p1: pt, p2: pt };
        return;
      }

      if (tool === "hline" || tool === "vline" || tool === "hray") {
        onAddDrawing(stampNew({ tool, p1: pt, p2: pt }));
        return;
      }
      if (tool === "text" || tool === "marker") {
        const text = window.prompt(tool === "text" ? "Label text" : "Note text (optional)");
        if (tool === "text" && !text) return;
        onAddDrawing(stampNew({ tool, p1: pt, p2: pt, ...(text ? { text } : {}) }));
        return;
      }
      if (tool === "vwap") {
        onAddDrawing(stampNew({ tool: "vwap", p1: pt, p2: pt }));
        return;
      }

      canvas.setPointerCapture(e.pointerId);
      if (tool === "brush" || tool === "highlighter") {
        draftRef.current = { id: "__draft__", tool, p1: pt, p2: pt, points: [pt] };
        return;
      }
      draftRef.current = { id: "__draft__", tool, p1: pt, p2: pt };
    };

    const onMove = (e: PointerEvent) => {
      const edit = editRef.current;
      if (edit && onUpdateDrawing) {
        const raw = rawPoint(e);
        if (!raw) return;
        const pt = snapPoint(stateRef.current.bars, raw, stateRef.current.magnet);
        if (edit.anchor === "body") {
          const dt = pt.time - edit.start.time;
          const dp = pt.price - edit.start.price;
          onUpdateDrawing({
            ...edit.drawing,
            p1: { time: edit.drawing.p1.time + dt, price: edit.drawing.p1.price + dp },
            p2: { time: edit.drawing.p2.time + dt, price: edit.drawing.p2.price + dp },
            points: edit.drawing.points?.map((p) => ({ time: p.time + dt, price: p.price + dp })),
            ...(edit.drawing.stop != null ? { stop: edit.drawing.stop + dp } : {}),
            updatedAt: Date.now(),
          });
        } else if (edit.anchor === "stop") {
          onUpdateDrawing({ ...edit.drawing, stop: pt.price, updatedAt: Date.now() });
        } else if (edit.anchor === "p3") {
          onUpdateDrawing({ ...edit.drawing, points: [pt], updatedAt: Date.now() });
        } else {
          onUpdateDrawing({ ...edit.drawing, [edit.anchor]: pt, updatedAt: Date.now() } as Drawing);
        }
        return;
      }

      if (pendingRef.current) {
        const raw = rawPoint(e);
        if (raw) previewPointRef.current = snapPoint(stateRef.current.bars, raw, stateRef.current.magnet);
        return;
      }

      if (!draftRef.current) return;
      const raw = rawPoint(e);
      if (!raw) return;
      const pt = snapPoint(stateRef.current.bars, raw, stateRef.current.magnet);
      if (draftRef.current.tool === "brush" || draftRef.current.tool === "highlighter") {
        const pts = draftRef.current.points ?? [];
        draftRef.current = { ...draftRef.current, p2: pt, points: [...pts, pt].slice(-4000) };
        return;
      }
      draftRef.current = { ...draftRef.current, p2: pt };
    };

    const onUp = () => {
      editRef.current = null;
      const draft = draftRef.current;
      draftRef.current = null;
      if (!draft) return;

      const bars = stateRef.current.bars;
      const dl = Math.abs(timeToLogicalExtrapolated(bars, draft.p2.time) - timeToLogicalExtrapolated(bars, draft.p1.time));
      const negligible = dl < 0.5 && draft.p1.price === draft.p2.price;

      if (draft.tool === "channel") {
        if (negligible) return;
        pendingRef.current = { tool: "channel", anchors: [draft.p1, draft.p2] };
        return;
      }
      if (draft.tool === "brush" || draft.tool === "highlighter") {
        if (!draft.points || draft.points.length < 2) return;
        onAddDrawing(stampNew(draft));
        return;
      }
      if (negligible) return;
      if (draft.tool === "long" || draft.tool === "short") {
        // Default plan: 2R — stop at half the drawn reward distance.
        const entry = draft.p1.price;
        const target = draft.p2.price;
        onAddDrawing(stampNew({ ...draft, stop: entry - (target - entry) * 0.5 }));
        return;
      }
      onAddDrawing(stampNew(draft));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tool, onAddDrawing, onRemoveDrawing, onUpdateDrawing, onSelectDrawing]);

  // ---- keyboard: Escape cancels an unfinished drawing / clears selection,
  // Delete/Backspace removes the selected drawing (unless locked). Not
  // gated by `tool` — a selection persists across tool switches, and Escape
  // must be able to cancel a channel/triangle in progress no matter which
  // element currently has focus, as long as it isn't a text input. ---------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;

      if (e.key === "Escape") {
        if (pendingRef.current || draftRef.current) {
          pendingRef.current = null;
          draftRef.current = null;
          previewPointRef.current = null;
          e.preventDefault();
        } else if (selectedIdRef.current) {
          onSelectDrawing?.(null);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const id = selectedIdRef.current;
        if (!id) return;
        const d = stateRef.current.drawings.find((x) => x.id === id);
        if (!d || d.locked) return;
        e.preventDefault();
        onRemoveDrawing(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRemoveDrawing, onSelectDrawing]);


  // ---- right-click anywhere on the chart -> price under the cursor ---------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onChartPrice) return;
    const onContext = (e: MouseEvent) => {
      const price = priceSeriesRef.current;
      if (!price) return;
      const rect = host.getBoundingClientRect();
      const p = price.coordinateToPrice(e.clientY - rect.top);
      if (p == null) return;
      e.preventDefault();
      onChartPrice(p, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    host.addEventListener("contextmenu", onContext);
    return () => host.removeEventListener("contextmenu", onContext);
  }, [onChartPrice]);

  // ---- drag a live order / stop / target ----------------------------------
  function beginDrag(t: ChartTrade, e: ReactPointerEvent<HTMLDivElement>) {
    if (!t.draggable || !onTradeDrag) return;
    const host = hostRef.current;
    const series = priceSeriesRef.current;
    if (!host || !series) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = host.getBoundingClientRect();

    const move = (ev: PointerEvent) => {
      const p = series.coordinateToPrice(ev.clientY - rect.top);
      if (p == null || p <= 0) return;
      dragRef.current = { id: t.id, price: p };
      setDragPrice({ id: t.id, price: p });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragPrice(null);
      // Only a *proposal* — the parent validates through the OMS and the level
      // snaps back until the OMS confirms the new price.
      if (drag && Math.abs(drag.price - t.price) > 1e-9) onTradeDrag(t, drag.price);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const planDrawings = drawings.filter(
    (d) => d.tool === "long" || d.tool === "short",
  );

  return (
    <div ref={hostRef} className="relative isolate h-full w-full">
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0"
        style={{ zIndex: -1, pointerEvents: "none" }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{ pointerEvents: tool === "cursor" ? "none" : "auto", cursor: tool === "erase" ? "not-allowed" : tool === "cursor" ? "default" : tool === "select" ? "pointer" : "crosshair" }}
      />

      {/* Draggable trade levels. Only the thin row captures the pointer, so
          panning and zooming the chart keeps working everywhere else. */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {trades.map((t) => {
          const shown =
            dragPrice && dragPrice.id === t.id ? dragPrice.price : t.price;
          return (
            <div
              key={t.id}
              ref={(el) => {
                if (el) rowsRef.current.set(t.id, el);
                else rowsRef.current.delete(t.id);
              }}
              className="absolute left-0 right-0 flex h-[18px] items-center"
              style={{ visibility: "hidden" }}
            >
              <div
                className="h-px flex-1"
                style={{
                  background: t.color,
                  opacity: t.kind === "entry" ? 0.95 : 0.7,
                }}
              />
              <div
                onPointerDown={(e) => beginDrag(t, e)}
                className={`pointer-events-auto mr-1 flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] backdrop-blur ${
                  t.draggable ? "cursor-ns-resize" : "cursor-default"
                }`}
                style={{
                  borderColor: t.color,
                  color: t.color,
                  background: "rgba(10,12,18,0.82)",
                }}
                title={t.draggable ? "Drag to modify — confirmed by the OMS" : undefined}
              >
                <span>{t.label}</span>
                <span className="opacity-90">{fmt(shown)}</span>
                {t.detail && <span className="opacity-70">{t.detail}</span>}
              </div>
            </div>
          );
        })}

        {planDrawings.map((d) => (
          <button
            key={d.id}
            ref={(el) => {
              if (el) planButtonsRef.current.set(d.id, el);
              else planButtonsRef.current.delete(d.id);
            }}
            onClick={() =>
              onPlanOrder?.({
                side: d.tool === "long" ? "buy" : "sell",
                entry: d.p1.price,
                target: d.p2.price,
                stop: d.stop ?? d.p1.price - (d.p2.price - d.p1.price) * 0.5,
              })
            }
            className="pointer-events-auto absolute left-0 top-0 rounded border border-[#e6b800] bg-[#e6b800]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#e6b800] hover:bg-[#e6b800]/25"
            style={{ visibility: "hidden" }}
          >
            CREATE ORDER
          </button>
        ))}
      </div>
    </div>
  );
}

