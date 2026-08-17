// Shared types for the Signal Goat Script (SGScript) runtime.
// These cross the worker boundary, so everything here must be plain JSON.

export type Bar = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type InputSpec = {
  name: string;
  type: "number" | "bool" | "string" | "color";
  value: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  label?: string;
};

export type PlotOut = {
  id: string;
  title: string;
  color: string;
  width: number;
  opacity?: number;
  style: "line" | "histogram" | "area" | "stepline";
  pane: "price" | "osc";
  values: Array<{ time: number; value: number } >;
};

export type HLineOut = {
  id: string;
  price: number;
  color: string;
  title?: string;
  pane: "price" | "osc";
  dashed?: boolean;
  width?: number;
};

/**
 * Canonical zone/box. Coordinates are always time + price (never screen
 * pixels), so a box stays anchored while zooming, panning and streaming.
 * `extend` lets a zone keep running to the right edge like Pine's
 * `box.new(..., extend = extend.right)`.
 */
export type BoxOut = {
  id: string;
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  /** Fill colour (may already carry alpha). */
  color: string;
  /** Extra fill opacity multiplier, 0..1. */
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  extend?: "none" | "right";
  text?: string;
  textColor?: string;
  textSize?: "tiny" | "small" | "normal" | "large";
  /** Lifecycle state; renderer dims/hides mitigated zones. */
  state?: "active" | "partial" | "mitigated";
  hidden?: boolean;
};

export type LineOut = {
  id: string;
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  color: string;
  width?: number;
  opacity?: number;
  dashed?: boolean;
  style?: "solid" | "dashed" | "dotted";
  extend?: "none" | "right";
  text?: string;
  textSize?: "tiny" | "small" | "normal" | "large";
  /** Which pane's price scale `price1`/`price2` are expressed in — defaults
   * to "price". Needed for things like RSI divergence lines, whose
   * coordinates are on the oscillator's 0-100 scale, not the symbol's price
   * scale; drawing them against the wrong scale sends them wildly off-screen
   * without any error, since the coordinate conversion itself succeeds. */
  pane?: "price" | "osc";
};

export type LabelOut = {
  id: string;
  time: number;
  price: number;
  /** May contain \n for multi-line Pine labels. */
  text: string;
  color: string;
  textColor?: string;
  borderColor?: string;
  size?: "tiny" | "small" | "normal" | "large";
  align?: "left" | "center" | "right";
  /** Vertical pixel nudge applied after price positioning. */
  offset?: number;
  position: "above" | "below";
  /** Which pane `price` is expressed in — see LineOut.pane. */
  pane?: "price" | "osc";
};

export type MarkerOut = {
  time: number;
  side: "buy" | "sell";
  text?: string;
  color?: string;
  shape?: "arrow" | "circle" | "square" | "triangle";
  size?: number;
  location?: "above" | "below";
};

export type FillOut = {
  id: string;
  plotA: string;
  plotB: string;
  color: string;
  opacity?: number;
};


/**
 * Strategy rules declared by the script itself. This is the ONLY bridge
 * between what the chart plots and what the backtester trades: both read the
 * same run output, so the two can never drift apart.
 */
export type StrategyEntryOut = {
  /** Bar the condition became true (signal bar, always a confirmed bar). */
  bar: number;
  side: "long" | "short";
  /** Absolute stop price declared for this signal, if any. */
  stop: number | null;
  /** Absolute target price declared for this signal, if any. */
  target: number | null;
  /** Target expressed as a multiple of the entry risk, if any. */
  targetR: number | null;
  /**
   * Full-length (bar-indexed) series of the desired protective stop level on
   * each bar while this position is open, if the script asked for a trailing
   * stop. The backtest engine ratchets `stop` to this every bar after entry —
   * only in the position's favour, never against it — instead of leaving
   * `stop` frozen at its entry-time value.
   */
  trail: number[] | null;
  /** Script-declared quantity override, if any. */
  qty: number | null;
  comment: string;
};

export type StrategyExitOut = {
  bar: number;
  /** Which side the exit applies to; null = flatten anything. */
  side: "long" | "short" | null;
  comment: string;
};

export type StrategyOut = {
  /** True only when the script actually called strategy.* */
  declared: boolean;
  entries: StrategyEntryOut[];
  exits: StrategyExitOut[];
  /** Rules the script declared but the runtime cannot honour. */
  notes: string[];
};

export type RunResult = {
  ok: true;
  meta: { name: string; overlay: boolean };
  strategy: StrategyOut;
  inputs: InputSpec[];
  plots: PlotOut[];
  hlines: HLineOut[];
  boxes: BoxOut[];
  lines: LineOut[];
  labels: LabelOut[];
  markers: MarkerOut[];
  fills: FillOut[];
  logs: string[];
  /** Parity warnings raised by the runtime itself (unsupported constructs). */
  warnings?: string[];
  /**
   * Universal object-density cap, set by the script via limitDrawings() and
   * already applied (boxes/lines/labels/markers trimmed to the most recent N)
   * before this result is returned — any indicator can opt in, not just
   * zone-heavy ones, so the renderer never has to special-case a category.
   */
  limits?: { boxes?: number; lines?: number; labels?: number; markers?: number };

  ms: number;
};

export type RunError = {
  ok: false;
  error: string;
  line?: number;
};

export type RunRequest = {
  id: string;
  code: string;
  bars: Bar[];
  settings: Record<string, number | boolean | string>;
};

export type RunResponse = (RunResult | RunError) & { id: string };

export const LIMITS = {
  timeoutMs: 3000,
  maxDrawings: 10_000,
  maxPlots: 24,
};
