import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Bar, MarkerOut, RunResult } from "@/lib/sgscript/types";

export type LoadedIndicator = {
  key: string;
  name: string;
  visible: boolean;
  result: RunResult;
};

export type DrawTool =
  | "cursor"
  | "select"
  | "trend"
  | "hline"
  | "vline"
  | "ray"
  | "rect"
  | "fib"
  | "text"
  | "arrow"
  | "marker"
  | "measure"
  | "long"
  | "short"
  | "erase";

export type DrawStyle = "solid" | "dashed" | "dotted";

export type Drawing = {
  id: string;
  tool: Exclude<DrawTool, "cursor" | "select" | "erase">;
  p1: { logical: number; price: number };
  p2: { logical: number; price: number };
  text?: string;
  /** Position tools carry a third anchor: the protective stop. */
  stop?: number;
  color?: string;
  opacity?: number;
  width?: number;
  style?: DrawStyle;
  locked?: boolean;
  hidden?: boolean;
};

const DEFAULT_DRAW_COLOR = "#e6b800";

function dash(style: DrawStyle | undefined, width: number): number[] {
  if (style === "dashed") return [Math.max(4, width * 3), Math.max(3, width * 2)];
  if (style === "dotted") return [1, Math.max(3, width * 2)];
  return [];
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
  panes: () => Array<{ setHeight: (h: number) => void }>;
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

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
}) {

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const stateRef = useRef({ indicators, drawings, tool, bars, instrument, selectedId });
  stateRef.current = { indicators, drawings, tool, bars, instrument, selectedId };

  const draftRef = useRef<Drawing | null>(null);
  const editRef = useRef<{
    drawing: Drawing;
    anchor: "p1" | "p2" | "body";
    start: { logical: number; price: number };
  } | null>(null);

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
    return (t: number) => {
      let lo = 0;
      let hi = times.length - 1;
      if (hi < 0) return 0;
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
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.045)", style: 0 },
          horzLines: { color: "rgba(255,255,255,0.045)", style: 0 },
        },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,0.10)",
          borderVisible: true,
          entireTextOnly: true,
          ticksVisible: true,
          // headroom above and below so candles never touch the frame
          scaleMargins: { top: 0.1, bottom: 0.2 },
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.10)",
          timeVisible: true,
          secondsVisible: false,
          ticksVisible: true,
          rightOffset: 12,
          barSpacing: 9,
          minBarSpacing: 0.6,
          fixLeftEdge: false,
          lockVisibleTimeRangeOnResize: true,
          rightBarStaysOnScroll: true,
        },
        crosshair: {
          mode: 0,
          vertLine: {
            color: "rgba(230,184,0,0.55)",
            width: 1,
            style: 3,
            labelBackgroundColor: "#e6b800",
          },
          horzLine: {
            color: "rgba(230,184,0,0.55)",
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
        drawOverlay();
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
      priceLineVisible: true,
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
        priceLineColor: "#e6b800",
        priceLineStyle: 2,
      },
      line: {
        color: "#e6b800",
        lineWidth: 2,
        priceLineColor: "#e6b800",
        priceLineStyle: 2,
      },
      area: {
        lineColor: "#e6b800",
        topColor: "rgba(230,184,0,0.28)",
        bottomColor: "rgba(230,184,0,0.01)",
        lineWidth: 2,
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
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0.02 } });
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
    const line = settings.grid ? "rgba(255,255,255,0.04)" : "transparent";
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

    if (sameSet) s.update(point(last));
    else {
      s.setData(displayBars.map(point));
      chartRef.current?.timeScale().fitContent();
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
          b.close >= b.open ? "rgba(34,197,94,0.42)" : "rgba(239,68,68,0.42)",

      });
      if (rev === volumeRevRef.current || volumeRevRef.current.startsWith(`${bars[0]?.time}:`))
        vol.update(bar(lastRaw));
      else vol.setData(bars.map(bar));
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
      .flatMap((i) => i.result.markers)
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
        color: m.color ?? (m.side === "buy" ? "#22c55e" : "#ef4444"),
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
    const chart = chartRef.current;
    const price = priceSeriesRef.current;
    const host = hostRef.current;
    if (!canvas || !chart || !price || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== host.clientWidth * dpr) {
      canvas.width = host.clientWidth * dpr;
      canvas.height = host.clientHeight * dpr;
      canvas.style.width = `${host.clientWidth}px`;
      canvas.style.height = `${host.clientHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);

    const ts = chart.timeScale();
    const x = (logical: number) => ts.logicalToCoordinate(logical);
    const y = (p: number) => price.priceToCoordinate(p);

    const { indicators: inds, drawings: draws } = stateRef.current;
    const planBoxes: Array<{ id: string; x: number; y: number }> = [];

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

      for (const b of r.boxes) {
        if (b.hidden) continue;
        const x1 = x(timeToLogical(b.time1));
        const x2raw =
          b.extend === "right" ? host.clientWidth : x(timeToLogical(b.time2));
        const y1 = y(b.price1);
        const y2 = y(b.price2);
        if (x1 == null || x2raw == null || y1 == null || y2 == null) continue;
        const x2 = Math.min(x2raw, host.clientWidth);
        const mit = b.state === "mitigated";
        const alpha = (b.opacity ?? 1) * (mit ? 0.45 : 1);
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const w = Math.max(1, Math.abs(x2 - x1));
        const h = Math.max(1, Math.abs(y2 - y1));
        ctx.save();
        ctx.fillStyle = applyAlpha(b.color, alpha);
        ctx.fillRect(left, top, w, h);
        if (b.borderColor && (b.borderWidth ?? 1) > 0) {
          ctx.strokeStyle = applyAlpha(b.borderColor, alpha);
          ctx.lineWidth = b.borderWidth ?? 1;
          ctx.setLineDash(
            b.borderStyle === "dashed"
              ? [5, 4]
              : b.borderStyle === "dotted"
                ? [1, 3]
                : [],
          );
          ctx.strokeRect(left, top, w, h);
        }
        if (b.text) {
          ctx.setLineDash([]);
          ctx.fillStyle = applyAlpha(b.textColor ?? "rgba(232,234,240,0.9)", alpha);
          ctx.font = `${LABEL_FONT_PX[b.textSize ?? "small"] ?? 10}px ui-sans-serif, system-ui`;
          ctx.fillText(b.text, left + 4, top + 12);
        }
        ctx.restore();
      }

      for (const l of r.lines) {
        const x1 = x(timeToLogical(l.time1));
        const x2raw =
          l.extend === "right" ? host.clientWidth : x(timeToLogical(l.time2));
        const y1 = y(l.price1);
        const y2 = y(l.price2);
        if (x1 == null || x2raw == null || y1 == null || y2 == null) continue;
        // Extended lines keep their slope, so project the price out to the edge.
        const x2 = x2raw;
        const yEnd =
          l.extend === "right" && x2 !== x1
            ? y1 + ((y2 - y1) * (x2 - x1)) / Math.max(1e-6, (x(timeToLogical(l.time2)) ?? x2) - x1)
            : y2;
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
          ctx.fillStyle = applyAlpha(l.color, l.opacity ?? 1);
          ctx.font = "10px ui-sans-serif, system-ui";
          ctx.fillText(l.text, Math.min(x2, host.clientWidth - 60) + 4, yEnd - 3);
        }
        ctx.restore();
      }

      // Labels keep the script's exact (multi-line) text, size and styling.
      for (const lb of r.labels) {
        const cx = x(timeToLogical(lb.time));
        const cy = y(lb.price);
        if (cx == null || cy == null) continue;
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
      }
    }

    const all = draftRef.current ? [...draws, draftRef.current] : draws;
    const selected = stateRef.current.selectedId;
    const handles: Array<{ x: number; y: number }> = [];
    for (const d of all) {
      if (d.hidden) continue;
      const x1 = x(d.p1.logical);
      const x2 = x(d.p2.logical);
      const y1 = y(d.p1.price);
      const y2 = y(d.p2.price);
      if (x1 == null || y1 == null) continue;
      const col = d.color ?? DEFAULT_DRAW_COLOR;
      const alpha = d.opacity ?? 1;
      const lw = d.width ?? 1.5;
      ctx.save();
      ctx.strokeStyle = withAlpha(col, alpha);
      ctx.fillStyle = withAlpha(col, alpha * 0.14);
      ctx.lineWidth = lw;
      ctx.setLineDash(dash(d.style, lw));
      ctx.font = "11px ui-sans-serif, system-ui";

      if (d.id === selected) {
        handles.push({ x: x1, y: y1 });
        if (x2 != null && y2 != null && d.tool !== "hline" && d.tool !== "vline")
          handles.push({ x: x2, y: y2 });
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



      if (d.tool === "hline") {
        ctx.beginPath();
        ctx.moveTo(0, y1);
        ctx.lineTo(host.clientWidth, y1);
        ctx.stroke();
        ctx.fillStyle = withAlpha(col, alpha);

        ctx.fillText(fmt(d.p1.price), 6, y1 - 4);
      } else if (x2 != null && y2 != null) {
        if (d.tool === "trend" || d.tool === "ray" || d.tool === "measure") {
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
          if (d.tool === "measure") {
            const diff = d.p2.price - d.p1.price;
            const pct = (diff / d.p1.price) * 100;
            const barsSpan = Math.round(d.p2.logical - d.p1.logical);
            ctx.fillStyle = diff >= 0 ? "#22c55e" : "#ef4444";
            ctx.fillText(
              `${fmt(diff)} (${pct.toFixed(2)}%) · ${barsSpan} bars`,
              x2 + 6,
              y2 - 6,
            );
          }
        } else if (d.tool === "rect") {
          ctx.fillRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1),
          );
          ctx.strokeRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1),
          );
        } else if (d.tool === "fib") {
          const range = d.p2.price - d.p1.price;
          for (const lvl of FIB_LEVELS) {
            const p = d.p1.price + range * lvl;
            const py = y(p);
            if (py == null) continue;
            ctx.strokeStyle = "rgba(230,184,0,0.5)";
            ctx.beginPath();
            ctx.moveTo(Math.min(x1, x2), py);
            ctx.lineTo(Math.max(x1, x2), py);
            ctx.stroke();
            ctx.fillStyle = "rgba(230,184,0,0.9)";
            ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${fmt(p)}`, Math.max(x1, x2) + 4, py - 2);
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
          const riskPts = Math.abs(entry - stop);
          const rewardPts = Math.abs(target - entry);
          const rr = riskPts > 0 ? rewardPts / riskPts : 0;

          const row = (py: number, color: string, text: string) => {
            ctx.strokeStyle = color;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left, py);
            ctx.lineTo(right, py);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = "10px ui-sans-serif, system-ui";
            ctx.fillText(text, left + 6, py - 4);
          };
          row(yTarget, "#22c55e", `TARGET ${fmt(target)} · +${Math.round(rewardPts / tick)} ticks · ${money(rewardPts * vpp)}`);
          row(yEntry, "#e6b800", `${d.tool === "long" ? "LONG" : "SHORT"} ENTRY ${fmt(entry)}`);
          row(yStop, "#ef4444", `STOP ${fmt(stop)} · ${Math.round(riskPts / tick)} ticks · ${money(riskPts * vpp)}`);

          ctx.fillStyle = "rgba(232,234,240,0.9)";
          ctx.font = "11px ui-sans-serif, system-ui";
          ctx.fillText(`R:R ${rr.toFixed(2)}`, right + 8, yEntry - 4);
          planBoxes.push({ id: d.id, x: right + 8, y: yEntry + 6 });
        } else if (d.tool === "text") {
          ctx.fillStyle = "#e6b800";
          ctx.fillText(d.text ?? "", x1, y1);
        }

      } else if (d.tool === "text") {
        ctx.fillStyle = withAlpha(col, alpha);
        ctx.fillText(d.text ?? "", x1, y1);
      }
      ctx.restore();
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


  // ---- pointer interaction for drawing tools ------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (tool === "cursor") return;

    const toPoint = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const chart = chartRef.current;
      const price = priceSeriesRef.current;
      if (!chart || !price) return null;
      const logical = chart
        .timeScale()
        .coordinateToLogical(e.clientX - rect.left);
      const p = price.coordinateToPrice(e.clientY - rect.top);
      if (logical == null || p == null) return null;
      return { logical, price: p };
    };

    // Closest drawing to a screen point (used by select + erase).
    const hitTest = (mx: number, my: number) => {
      const chart = chartRef.current;
      const price = priceSeriesRef.current;
      if (!chart || !price) return null;
      let hit: { d: Drawing; anchor: "p1" | "p2" | "body" } | null = null;
      let best = 14;
      for (const d of stateRef.current.drawings) {
        if (d.hidden) continue;
        const x1 = chart.timeScale().logicalToCoordinate(d.p1.logical);
        const y1 = price.priceToCoordinate(d.p1.price);
        const x2 = chart.timeScale().logicalToCoordinate(d.p2.logical);
        const y2 = price.priceToCoordinate(d.p2.price);
        if (x1 != null && y1 != null) {
          const dist = Math.hypot(x1 - mx, y1 - my);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "p1" };
          }
        }
        if (x2 != null && y2 != null) {
          const dist = Math.hypot(x2 - mx, y2 - my);
          if (dist < best) {
            best = dist;
            hit = { d, anchor: "p2" };
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
        if (
          (d.tool === "rect" || d.tool === "long" || d.tool === "short") &&
          x1 != null &&
          x2 != null &&
          y1 != null &&
          y2 != null &&
          mx >= Math.min(x1, x2) &&
          mx <= Math.max(x1, x2) &&
          my >= Math.min(y1, y2) &&
          my <= Math.max(y1, y2) &&
          !hit
        ) {
          hit = { d, anchor: "body" };
        }
      }
      return hit;
    };

    const onDown = (e: PointerEvent) => {
      const pt = toPoint(e);
      if (!pt) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

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

      canvas.setPointerCapture(e.pointerId);
      const id = `d${Date.now()}${Math.round(Math.random() * 1e4)}`;
      if (tool === "hline" || tool === "vline") {
        onAddDrawing({ id, tool, p1: pt, p2: pt });
        return;
      }
      if (tool === "text" || tool === "marker") {
        const text = window.prompt(
          tool === "text" ? "Label text" : "Marker note (optional)",
        );
        if (tool === "text" && !text) return;
        onAddDrawing({ id, tool, p1: pt, p2: pt, ...(text ? { text } : {}) });
        return;
      }
      draftRef.current = { id, tool, p1: pt, p2: pt };
    };

    const onMove = (e: PointerEvent) => {
      const edit = editRef.current;
      if (edit && onUpdateDrawing) {
        const pt = toPoint(e);
        if (!pt) return;
        if (edit.anchor === "body") {
          const dl = pt.logical - edit.start.logical;
          const dp = pt.price - edit.start.price;
          onUpdateDrawing({
            ...edit.drawing,
            p1: {
              logical: edit.drawing.p1.logical + dl,
              price: edit.drawing.p1.price + dp,
            },
            p2: {
              logical: edit.drawing.p2.logical + dl,
              price: edit.drawing.p2.price + dp,
            },
            ...(edit.drawing.stop != null ? { stop: edit.drawing.stop + dp } : {}),
          });
        } else {
          onUpdateDrawing({ ...edit.drawing, [edit.anchor]: pt } as Drawing);
        }
        return;
      }
      if (!draftRef.current) return;
      const pt = toPoint(e);
      if (!pt) return;
      draftRef.current = { ...draftRef.current, p2: pt };
    };

    const onUp = () => {
      editRef.current = null;
      const draft = draftRef.current;
      draftRef.current = null;
      if (!draft) return;
      if (
        Math.abs(draft.p2.logical - draft.p1.logical) < 0.5 &&
        draft.p1.price === draft.p2.price
      )
        return;
      if (draft.tool === "long" || draft.tool === "short") {
        // Default plan: 2R — stop at half the drawn reward distance.
        const entry = draft.p1.price;
        const target = draft.p2.price;
        onAddDrawing({ ...draft, stop: entry - (target - entry) * 0.5 });
        return;
      }
      onAddDrawing(draft);
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
    <div ref={hostRef} className="relative h-full w-full">
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

