/**
 * Tool registry for Chart Studio's drawing toolbar — the single place
 * describing EVERY drawing tool's identity, which family it belongs to, how
 * it's interacted with, what settings capabilities it exposes, its default
 * style, and whether it's actually wired into StudioChart's interaction/
 * render pipeline yet. The two-column toolbar (`DrawToolbar.tsx`) and the
 * universal settings popover (`DrawingSettingsPopover.tsx`) both derive
 * EVERYTHING they render from this file — neither hardcodes a per-tool list
 * of its own, so adding a tool, moving it between families, or changing what
 * settings it exposes is a one-line/one-object change in exactly one place.
 *
 * `implemented: false` tools are declared here (categories, icons, planned
 * capabilities) so the architecture is ready for a future phase to pick up,
 * but per this phase's brief they are NEVER rendered in the toolbar — a tool
 * that isn't real yet must never appear as a clickable dead button. This is
 * a deliberate change from Phase 1's flyout, which showed disabled "coming
 * soon" entries; the two-column grid has no flyout to bury them in, so
 * "hidden until real" is both the safer and the simpler rule.
 */

import { createElement, type ComponentType } from "react";
import {
  MousePointer2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  GitBranch,
  Ruler,
  Type as TypeIcon,
  MapPin,
  Square,
  Circle,
  Triangle,
  Pencil,
  Highlighter,
  LineChart,
  CandlestickChart,
  Waves,
  Hash,
  Compass,
  Fan,
  Activity,
  RotateCw,
  Rows,
  BarChart2,
  RectangleHorizontal,
  Spline,
  Hexagon,
  StickyNote,
  MessageSquare,
  Tag,
  Flag,
  Image,
  Smile,
  Table,
  Ghost,
  PenTool,
} from "lucide-react";
import type { DrawTool, DrawStyle } from "@/components/studio/StudioChart";

/**
 * Ellipse's own tile icon — a real oval, not a reused `Circle` glyph. Circle
 * and Ellipse render through the same underlying free-drag geometry (see
 * this file's `ellipse` entry below) and must stay distinct TOOL IDS per the
 * phase brief, but sharing the round `Circle` icon on top of that would make
 * the two tiles visually indistinguishable in the toolbar grid — a small,
 * self-contained inline SVG (matching lucide's own viewBox/stroke
 * conventions so it sits at identical size/weight next to every other tile)
 * is cheaper than pulling in a whole icon library just for one oval glyph.
 *
 * Built with `createElement` rather than JSX: this module is a plain `.ts`
 * file (not `.tsx`) — every existing call site (including the test suite's
 * explicit `"../../src/lib/drawing/registry.ts"` import path) depends on
 * that extension, so renaming it wasn't worth the churn for one glyph.
 */
function EllipseGlyph({ className }: { className?: string }) {
  return createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className,
    },
    createElement("ellipse", { cx: 12, cy: 12, rx: 9, ry: 6 }),
  );
}

export type ToolGroupId =
  | "lines"
  | "fib"
  | "gann"
  | "patterns"
  | "elliott"
  | "cycles"
  | "forecast"
  | "volume"
  | "brushes"
  | "arrows"
  | "shapes"
  | "text"
  | "measure"
  | "content";

/** Family display order for the two-column grid — matches the phase brief's
 * "TOOL FAMILIES" list exactly, so a reviewer can check off one against the
 * other line by line. Cursor/Select isn't in here: it gets two dedicated
 * slots at the top of the rail, not a grid tile (see `DrawToolbar.tsx`). */
export const TOOL_GROUPS: { id: ToolGroupId; label: string }[] = [
  { id: "lines", label: "Trend / Line Tools" },
  { id: "fib", label: "Fibonacci Tools" },
  { id: "gann", label: "Gann Tools" },
  { id: "patterns", label: "Pattern Tools" },
  { id: "elliott", label: "Elliott Waves" },
  { id: "cycles", label: "Cycles" },
  { id: "forecast", label: "Forecast / Measurement" },
  { id: "volume", label: "Volume-Based Tools" },
  { id: "brushes", label: "Brush / Freehand" },
  { id: "arrows", label: "Arrows" },
  { id: "shapes", label: "Shapes" },
  { id: "text", label: "Text / Notes" },
  { id: "measure", label: "Measurement" },
  { id: "content", label: "Content" },
];

/** How a tool is placed on the chart — drives both the toolbar (future:
 * cursor affordance) and is documented per-tool for anyone extending the
 * engine later. */
export type ToolInteractionType =
  | "point" // one click places it (hline/vline/marker/text/vwap/arrow-up/...)
  | "drag" // click-drag-release, two anchors (trend/rect/circle/arrow/...)
  | "multi-click" // several plain clicks or drag-then-click (triangle/channel)
  | "freehand"; // continuous drag, unbounded points (brush/highlighter)

/** Capability flags a tool declares — the universal settings popover
 * (`DrawingSettingsPopover.tsx`) renders ONLY the controls a tool's flags
 * turn on, instead of a bespoke settings component per tool. */
export type ToolCapabilities = {
  /** Line color / width / solid-dashed-dotted / opacity. */
  stroke?: boolean;
  /** Independent fill color + opacity (rectangle/circle/triangle/channel/
   * fib zones/position zones). */
  fill?: boolean;
  /** Text content + font size/weight/style/alignment/background/border. */
  text?: boolean;
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Fibonacci-style editable level set (add/remove/color/enable per level). */
  levels?: boolean;
  /** Long/Short-style entry/stop/target + R:R display. */
  positionMetrics?: boolean;
  /** Anchor marker/label visibility toggle — originally Anchored VWAP's
   * single marker+label switch, reused as-is by Phase 3D-1's chart-pattern
   * tools to show/hide every X/A/B/C/D-style anchor label at once. */
  anchorLabel?: boolean;
  /** Volume Profile calculation + histogram settings (Phase 3B: Fixed Range /
   * Anchored Volume Profile) — rows, Value Area %, profile width/placement,
   * histogram/POC/VAH/VAL visibility + colors, level-line style, labels. */
  volumeProfile?: boolean;
  /** Whether the settings popover's "Reverse anchors" button (under
   * `levels`) applies to this tool. Defaults to true whenever `levels` is
   * set — swapping p1/p2 is meaningful for Retracement/Extension/Channel
   * (it flips which end the level set measures from). Explicitly false for
   * Fib Wedge: p1 there is the shared radial PIVOT, not a symmetric
   * endpoint — swapping it with p2 would relocate the pivot itself, not
   * "reverse" anything. Same reasoning for Fib Time Zone (p1 is the fixed
   * starting anchor the whole sequence projects forward from) and Fib Speed
   * Resistance Fan (p1 is the shared ray origin every fan line emanates
   * from) — see their entries below. */
  reverseAnchors?: boolean;
  /** How the settings popover's Levels list should DISPLAY each level's
   * `value` — "ratio" (default) formats it as a percentage (Retracement/
   * Extension/Channel/Wedge's 0..1-and-beyond ratios); "sequence" formats it
   * as a plain whole number and hides the (price-only) "Price" toggle, for
   * Fib Time Zone's actual-Fibonacci-sequence multiples (0, 1, 2, 3, 5, 8,
   * ...), which aren't ratios of anything and have no per-level PRICE at
   * all (each level is a TIME). */
  levelValueKind?: "ratio" | "sequence";
};

export type ToolDefaultStyle = {
  color?: string;
  width?: number;
  style?: DrawStyle;
  /** Independent fill opacity for tools with `capabilities.fill`. */
  fillOpacity?: number;
};

export type ToolDef = {
  id: DrawTool;
  name: string;
  category: ToolGroupId | "select";
  icon: ComponentType<{ className?: string }>;
  interactionType: ToolInteractionType;
  /** Number of anchors the tool is defined by, or "unlimited" for freehand. */
  anchorCount: number | "unlimited";
  capabilities: ToolCapabilities;
  defaultStyle: ToolDefaultStyle;
  /** Whether this tool is actually wired into StudioChart's create/render/
   * hit-test/settings pipeline. Toolbar + favorites both filter on this —
   * an unimplemented tool is never rendered, never favoritable. */
  implemented: boolean;
  /** Internal-only note on why a tool isn't implemented yet / what it would
   * need — never shown in the UI, purely for the next phase's author. */
  note?: string;
};

const LINE_DEFAULT: ToolDefaultStyle = { color: "#e6b800", width: 1.5, style: "solid" };

export const TOOL_DEFS: ToolDef[] = [
  // ---- Cursor / Interaction ------------------------------------------------
  // Cursor: pure chart pan/zoom, zero drawing interaction — this already IS
  // the phase brief's "Crosshair" concept (a mode that never accidentally
  // selects/moves a drawing while you navigate). A second, behaviorally
  // identical "crosshair" tool id would be a pure lookalike duplicate, which
  // the phase brief explicitly asks to avoid — see PHASE2 report for the
  // one-line justification.
  { id: "cursor", name: "Cursor", category: "select", icon: MousePointer2, interactionType: "point", anchorCount: 0, capabilities: {}, defaultStyle: {}, implemented: true },
  { id: "select", name: "Select / move", category: "select", icon: MousePointer2, interactionType: "point", anchorCount: 0, capabilities: {}, defaultStyle: {}, implemented: true },

  // ---- Trend / Line Tools ---------------------------------------------------
  { id: "trend", name: "Trend Line", category: "lines", icon: TrendingUp, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "ray", name: "Ray", category: "lines", icon: ArrowUpRight, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "extended", name: "Extended Line", category: "lines", icon: ArrowUpRight, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "hline", name: "Horizontal Line", category: "lines", icon: Minus, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "hray", name: "Horizontal Ray", category: "lines", icon: Minus, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "vline", name: "Vertical Line", category: "lines", icon: Minus, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "channel", name: "Parallel Channel", category: "lines", icon: GitBranch, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.08 }, implemented: true },

  // ---- Fibonacci Tools ------------------------------------------------------
  // One reusable Fib engine (src/lib/drawing/calc.ts's FibLevel/computeFibLevels)
  // backs every Fib tool — variants below differ only in anchor count/shape,
  // never in a second parallel level-math implementation.
  { id: "fib", name: "Fibonacci Retracement", category: "fib", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, levels: true, extendRight: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Trend-Based Fib Extension (Phase 3C): A->B measures the move, C is the
  // projection anchor — see src/lib/drawing/calc.ts's computeFibExtensionLevels.
  // 3 anchors via the same p1/p2/points[0] shape Channel/Triangle already use.
  { id: "fib-ext", name: "Trend-Based Fib Extension", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, levels: true, extendRight: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Channel (Phase 3C): the pre-existing Parallel Channel's exact
  // trend + width-anchor geometry, with Fibonacci-ratio-spaced parallel
  // rails instead of one single offset — see geometry.ts's fibChannelLevelOffset.
  { id: "fib-channel", name: "Fib Channel", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true, levels: true }, defaultStyle: { color: "#e6b800", width: 1, fillOpacity: 0.08 }, implemented: true },
  // Fib Time Zone (Phase 3C-2): first anchor is the fixed start (level 0),
  // second anchor establishes the base time interval (level 1 sits exactly
  // on it) — every other enabled level is a whole Fibonacci-sequence
  // multiple of that interval, rendered as a full-height vertical line (see
  // calc.ts's computeFibTimeZoneLevels / StudioChart.tsx's paintFibTimeZone).
  // `levelValueKind: "sequence"` and `reverseAnchors: false` per their doc
  // comments above — a time-zone level is a whole-number multiple, not a
  // ratio, and p1 is a fixed origin, not a symmetric endpoint.
  { id: "fib-time", name: "Fib Time Zone", category: "fib", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, levels: true, reverseAnchors: false, levelValueKind: "sequence" }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Speed Resistance Fan (Phase 3C-2): p1 is the shared ray origin (like
  // Fib Wedge's pivot), p2 measures the trend move — each enabled ratio's
  // ray passes through a fraction of that move's PRICE extent taken at p2's
  // own TIME (see calc.ts's computeFibSpeedFanTargets), not a free third
  // anchor the way Fib Wedge's B->C segment is. `reverseAnchors: false`
  // because p1 is that fixed ray origin, not a symmetric endpoint.
  { id: "fib-speed-fan", name: "Fib Speed Resistance Fan", category: "fib", icon: Fan, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, levels: true, reverseAnchors: false }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Trend-Based Fib Time (Phase 3C-3): A->B measures the base time interval
  // (exactly like Trend-Based Fib Extension's A->B price move), C is the
  // projection origin — see calc.ts's defaultFibLevelsForTool and
  // StudioChart.tsx's generalized paintFibTimeZone(startTime, interval, ...),
  // shared verbatim with Fib Time Zone. `levelValueKind: "sequence"` for the
  // same reason as Fib Time Zone: these levels are whole-number multiples,
  // never a ratio/percentage.
  { id: "fib-time-trend", name: "Trend-Based Fib Time", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, levels: true, levelValueKind: "sequence" }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Circles (Phase 3C-4): concentric Fibonacci-ratio ellipse rings
  // centered on p1, radii scaled by the p1->p2 pixel extent on each axis
  // independently (see StudioChart.tsx's paintFibCircles) — correct under
  // non-uniform time/price screen scaling since it derives rx/ry separately
  // rather than a single Euclidean radius. Hit-tests via geometry.ts's new
  // distToEllipseRing (ring edge, not filled interior). `levels: true`
  // reuses the exact same per-level enable/color/custom-value UI as every
  // other Fib tool with zero popover changes.
  { id: "fib-circles", name: "Fib Circles", category: "fib", icon: Circle, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, levels: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Spiral (Phase 3C-4): a genuine logarithmic (golden-ratio) spiral —
  // see geometry.ts's new fibSpiralPoints, a deterministic parametric point
  // sequence sampled at a fixed angular step, rendered as one continuous
  // stroked path (StudioChart.tsx's paintFibSpiral) and hit-tested as
  // per-segment distToSegment over that same point sequence. No `levels`
  // capability: unlike the ring/ray Fib tools, a spiral has no discrete
  // Fibonacci-ratio levels to toggle/color independently.
  { id: "fib-spiral", name: "Fib Spiral", category: "fib", icon: RotateCw, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Speed Resistance Arcs (Phase 3C-4): the same concentric-ring
  // geometry as Fib Circles just above, but each ring is drawn (and
  // hit-tested) as only the half-arc on the side of p1 that p2 sits on
  // (see paintFibSpeedArcs's upperHalf convention) — genuine arc geometry,
  // not full circles with a fake mask.
  { id: "fib-speed-arcs", name: "Fib Speed Resistance Arcs", category: "fib", icon: Compass, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, levels: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },
  // Fib Wedge (Phase 3C): a real radial ray fan from a shared pivot (A),
  // Pitchfan-style — each ray passes through a Fibonacci-ratio point along
  // the B->C segment (see calc.ts's lerpMarketPoint). NOT parallel horizontal
  // lines. `reverseAnchors: false` because p1 here is the pivot, not a
  // symmetric endpoint (see ToolCapabilities.reverseAnchors's doc comment).
  { id: "fib-wedge", name: "Fib Wedge", category: "fib", icon: Triangle, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true, levels: true, reverseAnchors: false }, defaultStyle: { color: "#e6b800", width: 1, fillOpacity: 0.08 }, implemented: true },
  // Pitchfan (Phase 3C-3): the exact same pivot-ray-fan geometry as Fib
  // Wedge just above (see paintFibWedge's own doc comment — it was already
  // named "Pitchfan-style" back in Phase 3C) — shared verbatim via a
  // nullable fillOpacity rather than a second ray-fan renderer. No `fill`
  // capability: a traditional pitchfork is unfilled lines, unlike Wedge's
  // closed fill zone. `reverseAnchors: false` for the same reason as
  // Wedge: p1 here is the pivot, not a symmetric endpoint.
  { id: "pitchfan", name: "Pitchfan", category: "fib", icon: Fan, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, levels: true, reverseAnchors: false }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: true },

  // ---- Gann Tools -------------------------------------------------------
  // Would share one geometry primitive (fixed-angle grid from an anchor) —
  // none built yet.
  { id: "gann-box", name: "Gann Box", category: "gann", icon: Hash, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-square-fixed", name: "Gann Square Fixed", category: "gann", icon: Hash, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-square", name: "Gann Square", category: "gann", icon: Hash, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-fan", name: "Gann Fan", category: "gann", icon: Fan, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Pattern Tools (Phase 3D-1) ------------------------------------------
  // Manual anchor-placement tools (NOT automatic detection) built on ONE
  // shared labeled multi-anchor primitive (see StudioChart.tsx's
  // MULTI_ANCHOR_PATTERN_TOOLS/PATTERN_ANCHOR_LABELS/patternSegments) rather
  // than six independent mini engines. `anchorLabel` (previously only
  // Anchored VWAP's single marker+label toggle) is reused here for the same
  // "Show anchor marker + label" setting, now driving every X/A/B/C/D-style
  // label at once — no new capability flag or settings-popover code needed.
  // `text` was dropped from these: that capability is a free-typed label
  // BODY (font/align/background) meant for the Text/Note tools, not the
  // fixed X/A/B/C/D-style labels these patterns actually need.
  { id: "xabcd", name: "XABCD", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  // Cypher: identical X->A->B->C->D geometry/zigzag to XABCD just above —
  // kept a fully distinct tool id (per spec) even though it shares every
  // byte of render/hit-test/creation code, the same way Fib Wedge/Pitchfan
  // already share code under two separate ids.
  { id: "cypher", name: "Cypher", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  // Head and Shoulders: 5 anchors — Left Shoulder -> Head -> Right Shoulder
  // (a 3-point zigzag) PLUS an independent 2-point neckline (N1/N2), not a
  // continuation of that zigzag — see patternSegments' head-shoulders
  // override in StudioChart.tsx.
  { id: "head-shoulders", name: "Head and Shoulders", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "abcd", name: "ABCD", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  // Triangle Pattern: 4 anchors forming two CONVERGING trendlines (0->2 and
  // 1->3 — see patternSegments' triangle-pattern override), not a 0-1-2-3
  // zigzag and not the unrelated 3-anchor geometric "Triangle" shape tool.
  { id: "triangle-pattern", name: "Triangle Pattern", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  // Three Drives: a plain 6-anchor zigzag (three drive legs + two
  // retracement legs) — the default patternSegments topology, same as
  // XABCD/Cypher/ABCD, just with a longer label set.
  { id: "three-drives", name: "Three Drives", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 6, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: LINE_DEFAULT, implemented: true },

  // ---- Elliott Waves ------------------------------------------------------
  // One configurable labeled multi-anchor primitive would back all five —
  // none built yet.
  { id: "elliott-impulse", name: "Impulse (1-2-3-4-5)", category: "elliott", icon: Activity, interactionType: "multi-click", anchorCount: 6, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false, note: "Needs the shared labeled multi-anchor primitive first." },
  { id: "elliott-correction", name: "Correction (A-B-C)", category: "elliott", icon: Activity, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "elliott-triangle", name: "Triangle (A-B-C-D-E)", category: "elliott", icon: Activity, interactionType: "multi-click", anchorCount: 6, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "elliott-double-combo", name: "Double Combo (W-X-Y)", category: "elliott", icon: Activity, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "elliott-triple-combo", name: "Triple Combo (W-X-Y-X-Z)", category: "elliott", icon: Activity, interactionType: "multi-click", anchorCount: 6, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Cycles -------------------------------------------------------------
  { id: "cyclic-lines", name: "Cyclic Lines", category: "cycles", icon: RotateCw, interactionType: "multi-click", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "time-cycles", name: "Time Cycles", category: "cycles", icon: RotateCw, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "sine-line", name: "Sine Line", category: "cycles", icon: Activity, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Forecast / Trading Measurement --------------------------------------
  // Chart planning/measurement only — never wired to broker execution.
  { id: "long", name: "Long Position", category: "forecast", icon: TrendingUp, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true, positionMetrics: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "short", name: "Short Position", category: "forecast", icon: TrendingDown, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true, positionMetrics: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "forecast", name: "Position Forecast", category: "forecast", icon: CandlestickChart, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "bars-pattern", name: "Bars Pattern", category: "forecast", icon: Rows, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "ghost-feed", name: "Ghost Feed", category: "forecast", icon: Ghost, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Volume-Based Tools ---------------------------------------------------
  // Real loaded OHLCV only — never fabricates volume (see calc.ts anchoredVwap).
  { id: "vwap", name: "Anchored VWAP", category: "volume", icon: Waves, interactionType: "point", anchorCount: 1, capabilities: { stroke: true, anchorLabel: true }, defaultStyle: { color: "#4da3ff", width: 1.5, style: "solid" }, implemented: true },
  // Fixed Range Volume Profile (Phase 3B): click-drag-release like every
  // other 2-anchor "drag" tool (Trend/Rect/Fib/...) — mousedown is the
  // "first click" (range start), the live drag IS the "with a live preview
  // while selecting" requirement (the in-progress draft renders through the
  // exact same histogram/POC/VAH/VAL code path as a committed one, so the
  // preview is a REAL live-updating profile, not a placeholder rubber-band
  // box), mouseup is the "second click" (range end). Reuses stdlib.ts's
  // `volumeProfile()` bucket math + volumeProfileMath.ts's `computeValueArea`
  // end to end (see src/lib/drawing/volumeProfile.ts) — the same engines the
  // existing Volume Profile widget already uses, not a second implementation.
  { id: "vp-fixed", name: "Fixed Range Volume Profile", category: "volume", icon: BarChart2, interactionType: "drag", anchorCount: 2, capabilities: { fill: true, volumeProfile: true }, defaultStyle: { color: "#4da3ff" }, implemented: true },
  // Anchored Volume Profile (Phase 3B): single click like Anchored VWAP —
  // profile runs from the anchor bar to the most recent/rightmost loaded
  // bar (the standard "anchored to now" convention), recomputed fresh as
  // more bars load without the anchor itself ever moving. Same calculation
  // engine as Fixed Range (src/lib/drawing/volumeProfile.ts), its own
  // distinct tool id/geometry per the phase brief — never an alias for it.
  { id: "vp-anchored", name: "Anchored Volume Profile", category: "volume", icon: BarChart2, interactionType: "point", anchorCount: 1, capabilities: { fill: true, volumeProfile: true }, defaultStyle: { color: "#4da3ff" }, implemented: true },

  // ---- Brush / Freehand -----------------------------------------------------
  { id: "brush", name: "Brush", category: "brushes", icon: Pencil, interactionType: "freehand", anchorCount: "unlimited", capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 2 }, implemented: true },
  { id: "highlighter", name: "Highlighter", category: "brushes", icon: Highlighter, interactionType: "freehand", anchorCount: "unlimited", capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 10 }, implemented: true },

  // ---- Arrows ---------------------------------------------------------------
  { id: "arrow", name: "Arrow", category: "arrows", icon: ArrowUpRight, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "arrow-up", name: "Arrow Up", category: "arrows", icon: ArrowUp, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: { color: "#22c55e", width: 1.5 }, implemented: true },
  { id: "arrow-down", name: "Arrow Down", category: "arrows", icon: ArrowDown, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: { color: "#ef4444", width: 1.5 }, implemented: true },
  { id: "arrow-marker", name: "Arrow Marker", category: "arrows", icon: ArrowUpRight, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false, note: "Redundant with the 2-anchor Arrow tool above — no distinct geometry to add." },

  // ---- Shapes ---------------------------------------------------------------
  { id: "rect", name: "Rectangle", category: "shapes", icon: Square, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: true },
  { id: "circle", name: "Circle", category: "shapes", icon: Circle, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: true },
  { id: "triangle", name: "Triangle", category: "shapes", icon: Triangle, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: true },
  { id: "rotated-rect", name: "Rotated Rectangle", category: "shapes", icon: RectangleHorizontal, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: false, note: "Needs a rotation handle beyond the existing 2/3-anchor hit-test model." },
  // Ellipse (Phase 3A): reuses Circle's existing free-drag renderer 1:1 —
  // both anchors define a bounding box, rx/ry come from that box's half-
  // width/half-height, so an ellipse was already reachable by dragging
  // Circle at an uneven aspect ratio. Kept as its OWN tool id (never merged
  // into "circle") per the phase brief, so favorites/Objects-panel labels/
  // settings-popover titles/persisted `tool` values stay honest about what
  // the user actually drew. Hit-testing is genuinely distinct from Circle's
  // (a real ellipse-interior test, not Circle's bounding-box shortcut) — see
  // StudioChart.tsx's hitTest and geometry.ts's `pointInEllipse`.
  { id: "ellipse", name: "Ellipse", category: "shapes", icon: EllipseGlyph, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: true },
  // Polyline (Phase 3A): open, stroke-only multi-click chain — no `fill`
  // capability, matching "Polyline is open/stroke-only" from the phase
  // brief. Anchors are the FULL ordered vertex list in `points` (not
  // collapsed to 2), each independently draggable — see anchorsOf() and
  // StudioChart.tsx's `point:${index}` anchor kind.
  { id: "polyline", name: "Polyline", category: "shapes", icon: Spline, interactionType: "multi-click", anchorCount: "unlimited", capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  // Path (Phase 3A): same multi-click/full-vertex-array data model as
  // Polyline (deliberately — see StudioChart.tsx's anchorsOf/render/hit-test,
  // which treat both as one family), but declares `fill` so the settings
  // popover's Fill section (and this tool's own closed/filled render path)
  // turns on — the one behavioral difference the phase brief asks for
  // between the two, expressed as a capability flag rather than a
  // hidden/duplicated tool.
  { id: "path", name: "Path", category: "shapes", icon: PenTool, interactionType: "multi-click", anchorCount: "unlimited", capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: true },
  { id: "arc", name: "Arc", category: "shapes", icon: Compass, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "curve", name: "Curve", category: "shapes", icon: Spline, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "double-curve", name: "Double Curve", category: "shapes", icon: Hexagon, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Text / Notes -----------------------------------------------------
  { id: "text", name: "Text", category: "text", icon: TypeIcon, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e8eaf0" }, implemented: true },
  { id: "marker", name: "Note", category: "text", icon: MapPin, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: true },
  { id: "price-note", name: "Price Note", category: "text", icon: StickyNote, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false },
  { id: "pin", name: "Pin", category: "text", icon: MapPin, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false, note: "Near-duplicate of Note's marker+label geometry — low distinct value without a custom pin glyph." },
  { id: "table", name: "Table", category: "text", icon: Table, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: {}, implemented: false },
  { id: "callout", name: "Callout", category: "text", icon: MessageSquare, interactionType: "drag", anchorCount: 2, capabilities: { text: true, stroke: true }, defaultStyle: { color: "#e6b800" }, implemented: false },
  { id: "comment", name: "Comment", category: "text", icon: MessageSquare, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false },
  { id: "price-label", name: "Price Label", category: "text", icon: Tag, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false },
  { id: "signpost", name: "Signpost", category: "text", icon: Tag, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false },
  { id: "flag-mark", name: "Flag Mark", category: "text", icon: Flag, interactionType: "point", anchorCount: 1, capabilities: { text: true }, defaultStyle: { color: "#e6b800" }, implemented: false },

  // ---- Measurement ------------------------------------------------------
  { id: "price-range", name: "Price Range", category: "measure", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "date-range", name: "Date Range", category: "measure", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "measure", name: "Date + Price Range", category: "measure", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: true },
  { id: "ruler", name: "Ruler / Measure", category: "measure", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false, note: "Same measurement as Date + Price Range above — no distinct geometry to add without duplicating it." },

  // ---- Content (architecture-ready only, lowest priority) -----------------
  { id: "image", name: "Image", category: "content", icon: Image, interactionType: "point", anchorCount: 1, capabilities: {}, defaultStyle: {}, implemented: false },
  { id: "content-icon", name: "Icon", category: "content", icon: Hash, interactionType: "point", anchorCount: 1, capabilities: {}, defaultStyle: {}, implemented: false },
  { id: "emoji", name: "Emoji", category: "content", icon: Smile, interactionType: "point", anchorCount: 1, capabilities: {}, defaultStyle: {}, implemented: false },
];

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

/** Tools legitimately clickable today — used to gate favorites/recents so an
 * unimplemented tool can never end up favorited/recent, and by the toolbar
 * to filter every family's tile list down to what's real. */
export const IMPLEMENTED_TOOLS = TOOL_DEFS.filter((t) => t.implemented && t.id !== "cursor" && t.id !== "select");
