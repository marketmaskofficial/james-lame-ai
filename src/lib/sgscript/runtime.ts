// SGScript runtime: compiles and evaluates an indicator script against a bar
// set and returns a plain-JSON draw list. Runs inside a Web Worker with a
// frozen scope — no DOM, no network, no host globals.

import type {
  BoxOut,
  FillOut,
  HLineOut,
  InputSpec,
  LabelOut,
  LineOut,
  MarkerOut,
  PlotOut,
  RunRequest,
  RunResult,
  StrategyEntryOut,
  StrategyExitOut,
  StrategyOut,
} from "./types";
import { LIMITS } from "./types";
import * as std from "./stdlib";
import * as smc from "./smc";

type Series = number[];

const PALETTE = [
  "#e6b800",
  "#38bdf8",
  "#a78bfa",
  "#22c55e",
  "#ef4444",
  "#f97316",
  "#14b8a6",
  "#f472b6",
];

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "12h": 43200,
  "1d": 86400,
  "1w": 604800,
};

function parseMeta(code: string) {
  const name = /^\s*\/\/\s*@name\s+(.+)$/m.exec(code)?.[1]?.trim();
  const overlayRaw = /^\s*\/\/\s*@overlay\s+(true|false)$/m.exec(code)?.[1];
  return {
    name: name || "Untitled indicator",
    overlay: overlayRaw ? overlayRaw === "true" : true,
  };
}

export function runScript(req: RunRequest): RunResult {
  const started = Date.now();
  const bars = req.bars;
  const len = bars.length;
  if (len === 0) throw new Error("No market data loaded");

  const time: Series = bars.map((b) => b.time);
  const open: Series = bars.map((b) => b.open);
  const high: Series = bars.map((b) => b.high);
  const low: Series = bars.map((b) => b.low);
  const close: Series = bars.map((b) => b.close);
  const volume: Series = bars.map((b) => b.volume);
  const hl2 = std.div(std.add(high, low), 2);
  const hlc3 = std.div(std.add(std.add(high, low), close), 3);
  const ohlc4 = std.div(std.add(std.add(open, high), std.add(low, close)), 4);

  const meta = parseMeta(req.code);
  const inputs: InputSpec[] = [];
  const inputValues: Record<string, number | boolean | string> = {};
  const plots: PlotOut[] = [];
  const hlines: HLineOut[] = [];
  const boxes: BoxOut[] = [];
  const lines: LineOut[] = [];
  const labels: LabelOut[] = [];
  const markers: MarkerOut[] = [];
  const fills: FillOut[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m) && warnings.length < 20) warnings.push(m);
  };
  const strategyOut: StrategyOut = {
    declared: false,
    entries: [],
    exits: [],
    notes: [],
  };
  let drawCount = 0;
  let uid = 0;
  const nextId = () => `o${uid++}`;

  const budget = () => {
    if (Date.now() - started > LIMITS.timeoutMs)
      throw new Error("Script timed out (over 3s)");
    if (++drawCount > LIMITS.maxDrawings)
      throw new Error(`Too many drawing objects (max ${LIMITS.maxDrawings})`);
  };

  const barTime = (i: number) => {
    const idx = Math.max(0, Math.min(len - 1, Math.round(i)));
    return time[idx];
  };

  // ---- inputs -------------------------------------------------------------
  function input(
    name: string,
    def: number | boolean | string,
    opts: Partial<InputSpec> = {},
  ) {
    const type: InputSpec["type"] =
      (opts.type as InputSpec["type"]) ??
      (typeof def === "number" ? "number" : typeof def === "boolean" ? "bool" : "string");
    const override = req.settings?.[name];
    const value = override === undefined ? def : override;
    inputs.push({ ...opts, name, type, value, label: opts.label ?? name });
    inputValues[name] = value;
    return value as never;
  }
  input.int = (n: string, d: number, o?: Partial<InputSpec>) =>
    Math.round(input(n, d, { ...o, type: "number" }) as unknown as number);
  input.float = (n: string, d: number, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "number" }) as unknown as number;
  input.bool = (n: string, d: boolean, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "bool" }) as unknown as boolean;
  input.color = (n: string, d: string, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "color" }) as unknown as string;
  input.string = (n: string, d: string, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "string" }) as unknown as string;
  input.timeframe = (n: string, d: string, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "string" }) as unknown as string;
  input.session = (n: string, d: string, o?: Partial<InputSpec>) =>
    input(n, d, { ...o, type: "string" }) as unknown as string;
  /**
   * Pine-style price-source input. The default may be passed either as a
   * series (close, hlc3, ...) or as its name; the selection is stored as a
   * string setting and resolved back to the matching series.
   */
  const SOURCES: Record<string, Series> = {
    open,
    high,
    low,
    close,
    hl2,
    hlc3,
    ohlc4,
  };
  input.source = (
    n: string,
    d: Series | string = close,
    o?: Partial<InputSpec>,
  ): Series => {
    const defName =
      typeof d === "string"
        ? d
        : (Object.keys(SOURCES).find((k) => SOURCES[k] === d) ?? "close");
    const picked = input(n, defName, {
      ...o,
      type: "string",
      options: Object.keys(SOURCES),
    }) as unknown as string;
    return SOURCES[picked] ?? SOURCES[defName] ?? close;
  };


  // ---- outputs ------------------------------------------------------------
  function toPoints(s: Series) {
    const pts: Array<{ time: number; value: number }> = [];
    for (let i = 0; i < len; i++) {
      const v = s[i];
      if (Number.isFinite(v)) pts.push({ time: time[i], value: v });
    }
    return pts;
  }

  function addPlot(
    series: Series | number,
    opts: Partial<PlotOut> & { pane: "price" | "osc" },
  ) {
    budget();
    if (plots.length >= LIMITS.maxPlots)
      throw new Error(`Too many plots (max ${LIMITS.maxPlots})`);
    const s = typeof series === "number" ? new Array(len).fill(series) : series;
    if (!Array.isArray(s)) throw new Error("plot() expects a series or number");
    const id = opts.id ?? nextId();
    plots.push({
      id,
      title: opts.title ?? `plot ${plots.length + 1}`,
      color: opts.color ?? PALETTE[plots.length % PALETTE.length],
      width: opts.width ?? 2,
      opacity: opts.opacity ?? 1,
      style: opts.style ?? "line",
      pane: opts.pane,
      values: toPoints(s),
    });
    return id;
  }

  const plot = (s: Series | number, o: Partial<PlotOut> = {}) =>
    addPlot(s, { ...o, pane: o.pane ?? (meta.overlay ? "price" : "osc") });
  const plotOsc = (s: Series | number, o: Partial<PlotOut> = {}) =>
    addPlot(s, { ...o, pane: "osc" });
  const hist = (s: Series | number, o: Partial<PlotOut> = {}) =>
    addPlot(s, { ...o, style: "histogram", pane: o.pane ?? "osc" });

  function hline(price: number, o: Partial<HLineOut> = {}) {
    budget();
    if (!Number.isFinite(price)) return;
    hlines.push({
      id: nextId(),
      price,
      color: o.color ?? "rgba(255,255,255,0.28)",
      pane: o.pane ?? (meta.overlay ? "price" : "osc"),
      dashed: o.dashed ?? true,
      ...(o.width ? { width: o.width } : {}),
      ...(o.title ? { title: o.title } : {}),
    });
  }

  /**
   * Zone/box primitive with a live handle, mirroring Pine's box.new(...) plus
   * box.set_* / box.delete. Coordinates are bar indexes + prices; the renderer
   * converts them to screen space every frame, so zones stay anchored while
   * zooming, panning and as new candles stream in.
   */
  type BoxHandle = {
    readonly rec: BoxOut;
    setTop: (p: number) => BoxHandle;
    setBottom: (p: number) => BoxHandle;
    setLeft: (i: number) => BoxHandle;
    setRight: (i: number) => BoxHandle;
    extendRight: (on?: boolean) => BoxHandle;
    stopExtend: (i?: number) => BoxHandle;
    setState: (s: "active" | "partial" | "mitigated") => BoxHandle;
    setColor: (c: string, border?: string) => BoxHandle;
    setText: (t: string) => BoxHandle;
    hide: (on?: boolean) => BoxHandle;
    remove: () => void;
  };

  function box(
    price1: number,
    price2: number,
    index1: number,
    index2: number,
    o: Partial<BoxOut> = {},
  ): BoxHandle | undefined {
    budget();
    if (!Number.isFinite(price1) || !Number.isFinite(price2)) return undefined;
    const rec: BoxOut = {
      id: nextId(),
      price1,
      price2,
      time1: barTime(index1),
      time2: barTime(index2),
      color: o.color ?? "rgba(56,189,248,0.16)",
      opacity: o.opacity ?? 1,
      borderColor: o.borderColor ?? "rgba(56,189,248,0.55)",
      borderWidth: o.borderWidth ?? 1,
      borderStyle: o.borderStyle ?? "solid",
      extend: o.extend ?? "none",
      state: o.state ?? "active",
      ...(o.text ? { text: o.text } : {}),
      ...(o.textColor ? { textColor: o.textColor } : {}),
      ...(o.textSize ? { textSize: o.textSize } : {}),
      ...(o.hidden ? { hidden: true } : {}),
    };
    boxes.push(rec);
    const h: BoxHandle = {
      rec,
      setTop: (p) => ((rec.price1 = p), h),
      setBottom: (p) => ((rec.price2 = p), h),
      setLeft: (i) => ((rec.time1 = barTime(i)), h),
      setRight: (i) => ((rec.time2 = barTime(i)), h),
      extendRight: (on = true) => ((rec.extend = on ? "right" : "none"), h),
      stopExtend: (i) => {
        rec.extend = "none";
        if (i !== undefined) rec.time2 = barTime(i);
        return h;
      },
      setState: (s) => ((rec.state = s), h),
      setColor: (c, border) => {
        rec.color = c;
        if (border) rec.borderColor = border;
        return h;
      },
      setText: (t) => ((rec.text = String(t)), h),
      hide: (on = true) => ((rec.hidden = on), h),
      remove: () => {
        const idx = boxes.indexOf(rec);
        if (idx >= 0) boxes.splice(idx, 1);
      },
    };
    return h;
  }

  function line(
    price1: number,
    index1: number,
    price2: number,
    index2: number,
    o: Partial<LineOut> = {},
  ) {
    budget();
    if (!Number.isFinite(price1) || !Number.isFinite(price2)) return;
    const style = o.style ?? (o.dashed ? "dashed" : "solid");
    lines.push({
      id: nextId(),
      price1,
      price2,
      time1: barTime(index1),
      time2: barTime(index2),
      color: o.color ?? "#e6b800",
      width: o.width ?? 1,
      opacity: o.opacity ?? 1,
      dashed: style !== "solid",
      style,
      extend: o.extend ?? "none",
      ...(o.text ? { text: o.text } : {}),
    });
  }

  function label(
    index: number,
    price: number,
    text: string,
    o: Partial<LabelOut> = {},
  ) {
    budget();
    if (!Number.isFinite(price)) return;
    labels.push({
      id: nextId(),
      time: barTime(index),
      price,
      // Multi-line Pine labels are preserved verbatim.
      text: String(text),
      color: o.color ?? "rgba(20,24,34,0.92)",
      textColor: o.textColor ?? "#e8eaf0",
      size: o.size ?? "normal",
      align: o.align ?? "center",
      offset: o.offset ?? 0,
      position: o.position ?? "above",
      ...(o.borderColor ? { borderColor: o.borderColor } : {}),
    });
  }

  function signal(
    cond: boolean[] | boolean,
    side: "buy" | "sell",
    text?: string | string[],
    o: Partial<MarkerOut> = {},
  ) {
    const arr = Array.isArray(cond) ? cond : new Array(len).fill(cond);
    for (let i = 0; i < len; i++) {
      if (!arr[i]) continue;
      budget();
      const t = Array.isArray(text) ? text[i] : text;
      markers.push({
        time: time[i],
        side,
        ...(t ? { text: String(t) } : {}),
        ...(o.color ? { color: o.color } : {}),
        ...(o.shape ? { shape: o.shape } : {}),
        ...(o.size ? { size: o.size } : {}),
        ...(o.location ? { location: o.location } : {}),
      });
    }
  }


  // ---- strategy rules -----------------------------------------------------
  // Declared here, executed by the deterministic backtest engine. The runtime
  // never simulates fills itself — it only records what the script asked for.
  type LevelArg = number | Series | undefined | null;
  const levelAt = (v: LevelArg, i: number): number | null => {
    if (v === undefined || v === null) return null;
    const n = typeof v === "number" ? v : v[i];
    return Number.isFinite(n) ? (n as number) : null;
  };
  const condAt = (cond: boolean[] | boolean, i: number): boolean =>
    Array.isArray(cond) ? cond[i] === true : cond === true;

  type EntryOpts = {
    stop?: LevelArg;
    target?: LevelArg;
    /** Distance in price from entry; converted to a level at fill time. */
    stopPoints?: number;
    targetPoints?: number;
    /** Target as a multiple of the entry risk (needs a stop). */
    targetR?: number;
    qty?: number;
    comment?: string;
  };

  function entry(side: "long" | "short", cond: boolean[] | boolean, o: EntryOpts = {}) {
    strategyOut.declared = true;
    for (let i = 0; i < len; i++) {
      if (!condAt(cond, i)) continue;
      budget();
      let stop = levelAt(o.stop, i);
      if (stop === null && Number.isFinite(o.stopPoints ?? NaN)) {
        const d = Math.abs(o.stopPoints as number);
        stop = side === "long" ? close[i] - d : close[i] + d;
      }
      let target = levelAt(o.target, i);
      if (target === null && Number.isFinite(o.targetPoints ?? NaN)) {
        const d = Math.abs(o.targetPoints as number);
        target = side === "long" ? close[i] + d : close[i] - d;
      }
      const rec: StrategyEntryOut = {
        bar: i,
        side,
        stop,
        target,
        targetR:
          target === null && Number.isFinite(o.targetR ?? NaN)
            ? (o.targetR as number)
            : null,
        qty: Number.isFinite(o.qty ?? NaN) ? (o.qty as number) : null,
        comment: o.comment ?? (side === "long" ? "Long" : "Short"),
      };
      strategyOut.entries.push(rec);
    }
  }

  const strategy = {
    long: (cond: boolean[] | boolean, o?: EntryOpts) => entry("long", cond, o),
    short: (cond: boolean[] | boolean, o?: EntryOpts) => entry("short", cond, o),
    close: (
      cond: boolean[] | boolean,
      o: { side?: "long" | "short"; comment?: string } = {},
    ) => {
      strategyOut.declared = true;
      for (let i = 0; i < len; i++) {
        if (!condAt(cond, i)) continue;
        budget();
        const rec: StrategyExitOut = {
          bar: i,
          side: o.side ?? null,
          comment: o.comment ?? "Strategy Exit",
        };
        strategyOut.exits.push(rec);
      }
    },
    note: (text: string) => {
      if (strategyOut.notes.length < 20) strategyOut.notes.push(String(text));
    },
  };

  function fill(plotA: string, plotB: string, color: string, opacity = 1) {
    budget();
    fills.push({ id: nextId(), plotA, plotB, color, opacity });
  }

  function htf(tf: string) {
    const secs = TF_SECONDS[tf];
    if (!secs) throw new Error(`Unknown timeframe "${tf}"`);
    const r = std.resample(time, open, high, low, close, volume, secs);
    return { ...r, hl2: std.div(std.add(r.high, r.low), 2) };
  }

  const scope = {
    // data
    time,
    open,
    high,
    low,
    close,
    volume,
    hl2,
    hlc3,
    ohlc4,
    barCount: len,
    lastIndex: len - 1,
    // math helpers
    ...std,
    atr: (l: number) => std.atr(high, low, close, l),
    tr: () => std.trueRange(high, low, close),
    vwap: (anchor?: number) => std.vwap(hlc3, volume, time, anchor),
    volumeProfile: (from: number, to: number, bins?: number) =>
      std.volumeProfile(high, low, volume, from, to, bins),
    pivotHigh: (l: number, r: number) => std.pivotHigh(high, l, r),
    pivotLow: (l: number, r: number) => std.pivotLow(low, l, r),
    vwma: (s: Series, l: number) => std.vwma(s, volume, l),
    stoch: (kLen: number, kS?: number, dS?: number) =>
      std.stoch(high, low, close, kLen, kS, dS),
    correlation: std.correlation,
    htf,
    // trading primitives (sessions, structure, liquidity)
    ...smc,
    // Scripts write session('07:00','10:00'), session('0700-1000') and even
    // session(time,'07:00','10:00'); accept all three.
    session: (...args: unknown[]) => {
      const parts = args.filter((a) => typeof a === "string") as string[];
      return smc.session(time, parts[0] ?? "", parts[1]);
    },

    minuteOfDay: () => smc.minuteOfDay(time),
    dayIndex: () => smc.dayIndex(time),
    sessionRange: (mask: boolean[]) => smc.sessionRange(mask, high, low),
    previousDay: () => smc.previousPeriod(time, high, low, close, "day"),
    previousWeek: () => smc.previousPeriod(time, high, low, close, "week"),
    previousMonth: () => smc.previousPeriod(time, high, low, close, "month"),
    htfClosed: (tf: string) => {
      const secs = TF_SECONDS[tf];
      if (!secs) throw new Error(`Unknown timeframe "${tf}"`);
      return smc.htfClosed(time, open, high, low, close, secs);
    },
    swings: (l?: number, r?: number) => smc.swings(high, low, l, r),
    marketStructure: (l?: number, r?: number) =>
      smc.marketStructure(high, low, close, l, r),
    fvg: (extend?: number) => smc.fvg(high, low, extend),
    inverseFvg: () => smc.inverseFvg(high, low, close),
    sweep: (level: Series, direction: "above" | "below") =>
      smc.sweep(high, low, close, level, direction),
    displacement: (mult?: number) =>
      smc.displacement(open, close, std.atr(high, low, close, 14), mult),
    orderBlocks: (disp: boolean[]) => smc.orderBlocks(open, high, low, close, disp),
    premiumDiscount: (rangeHigh: Series, rangeLow: Series) =>
      smc.premiumDiscount(close, rangeHigh, rangeLow),
    // outputs
    input,
    plot,
    plotOsc,
    hist,
    hline,
    box,
    line,
    label,
    signal,
    strategy,
    fill,
    // Zone lifecycle helper: turns detector output (fvg, orderBlocks, ...)
    // into live boxes that extend right, shrink on partial mitigation and
    // change state when fully mitigated — exactly the Pine object lifecycle.
    zones: (
      list: Array<{
        from: number;
        to: number;
        top: number;
        bottom: number;
        side: "bull" | "bear";
      }>,
      o: {
        bullColor?: string;
        bearColor?: string;
        borderColor?: string;
        opacity?: number;
        extend?: boolean;
        shrink?: boolean;
        hideFilled?: boolean;
        mitigatedColor?: string;
        text?: (z: { side: "bull" | "bear"; top: number; bottom: number }) => string;
      } = {},
    ) => {
      const out: unknown[] = [];
      for (const z of list) {
        const bull = z.side === "bull";
        let top = z.top;
        let bottom = z.bottom;
        let state: "active" | "partial" | "mitigated" = "active";
        let right = o.extend === false ? z.to : len - 1;
        // Walk forward from the gap to reproduce the object's life.
        for (let i = z.from + 2; i < len; i++) {
          const filled = bull ? low[i] <= bottom : high[i] >= top;
          if (filled) {
            state = "mitigated";
            right = i;
            break;
          }
          const touched = bull ? low[i] < top : high[i] > bottom;
          if (touched) {
            state = "partial";
            if (o.shrink !== false) {
              if (bull) top = Math.min(top, low[i]);
              else bottom = Math.max(bottom, high[i]);
            }
          }
        }
        if (state === "mitigated" && o.hideFilled) continue;
        const base = bull
          ? (o.bullColor ?? "rgba(34,197,94,0.18)")
          : (o.bearColor ?? "rgba(239,68,68,0.18)");
        const h = box(top, bottom, z.from, right, {
          color: state === "mitigated" ? (o.mitigatedColor ?? base) : base,
          opacity: o.opacity ?? 1,
          borderColor: o.borderColor ?? (bull ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"),
          extend: state === "mitigated" || o.extend === false ? "none" : "right",
          state,
          ...(o.text ? { text: o.text({ side: z.side, top, bottom }) } : {}),
        });
        if (h) out.push(h);
      }
      return out;
    },
    // Constructs the runtime cannot reproduce are reported, never faked.
    table: () => warn("table() is not supported by the Signal Goat renderer yet"),
    bgcolor: () => warn("bgcolor() is not supported by the Signal Goat renderer yet"),
    // Alerts have no delivery mechanism in this preview/backtest runtime, but
    // a translation may still emit a literal alertcondition()/alert() call
    // (Pine encourages both heavily) — unlike table()/bgcolor() these had NO
    // stub at all until now, so any script that kept the call verbatim threw
    // a ReferenceError and the whole script died instead of just dropping
    // the alert. Accept any arg shape, never throw.
    alertcondition: () => warn("alertcondition() has no effect in this preview — alerts are not supported yet"),
    alert: () => warn("alert() has no effect in this preview — alerts are not supported yet"),
    unsupported: (what: string) => warn(String(what)),
    log: (...args: unknown[]) => {
      if (logs.length < 100) logs.push(args.map((a) => String(a)).join(" "));
    },
    Math,
    Number,
    Array,
    String,
    JSON,
    isFinite: Number.isFinite,
    NaN,
    Infinity,
  } as Record<string, unknown>;

  // Shadow every risky host global so scripts can't reach the environment.
  const blocked = [
    "self",
    "globalThis",
    "postMessage",
    "importScripts",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "Worker",
    "indexedDB",
    "caches",
    "localStorage",
    "location",
    "navigator",
    "setTimeout",
    "setInterval",
    "require",
    "process",
    "window",
    "document",
  ];

  // `eval` and `Function` cannot be shadowed as strict-mode parameters, so they
  // are rejected statically instead.
  const banned = /(^|[^.\w])(eval|Function|constructor)\s*(\(|\[)/;
  if (banned.test(req.code)) {
    throw new Error("eval, Function and constructor access are not allowed");
  }

  const names = [...Object.keys(scope), ...blocked];
  const values = [
    ...Object.keys(scope).map((k) => scope[k]),
    ...blocked.map(() => undefined),
  ];

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  // The script body runs inside its own block so a user `const ema = ...`
  // legally shadows the built-in of the same name instead of throwing
  // "Cannot declare a variable twice" against the injected parameters.
  const factory = new Function(
    ...names,
    `"use strict";\n{\n${req.code}\n}\n//# sourceURL=sgscript.js`,
  );
  factory(...values);


  return {
    ok: true,
    meta,
    strategy: strategyOut,
    inputs,
    plots,
    hlines,
    boxes,
    lines,
    labels,
    markers,
    fills,
    logs,
    warnings,
    ms: Date.now() - started,
  };
}
