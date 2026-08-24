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

import type { ComponentType } from "react";
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
} from "lucide-react";
import type { DrawTool, DrawStyle } from "@/components/studio/StudioChart";

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
  /** Anchor marker/label visibility toggle (Anchored VWAP). */
  anchorLabel?: boolean;
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
  { id: "fib-ext", name: "Trend-Based Fib Extension", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, levels: true, extendRight: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false, note: "3-anchor extension math (A-B-C projection) not yet built on the shared Fib engine." },
  { id: "fib-channel", name: "Fib Channel", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true, levels: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false, note: "Channel geometry + fib level math combo not yet built." },
  { id: "fib-time", name: "Fib Time Zone", category: "fib", icon: Ruler, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false, note: "Vertical time-interval fan not yet built." },
  { id: "fib-speed-fan", name: "Fib Speed Resistance Fan", category: "fib", icon: Fan, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "fib-time-trend", name: "Trend-Based Fib Time", category: "fib", icon: Ruler, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "fib-circles", name: "Fib Circles", category: "fib", icon: Circle, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "fib-spiral", name: "Fib Spiral", category: "fib", icon: RotateCw, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "fib-speed-arcs", name: "Fib Speed Resistance Arcs", category: "fib", icon: Compass, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "fib-wedge", name: "Fib Wedge", category: "fib", icon: Triangle, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true, fill: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },
  { id: "pitchfan", name: "Pitchfan", category: "fib", icon: Fan, interactionType: "multi-click", anchorCount: 3, capabilities: { stroke: true }, defaultStyle: { color: "#e6b800", width: 1 }, implemented: false },

  // ---- Gann Tools -------------------------------------------------------
  // Would share one geometry primitive (fixed-angle grid from an anchor) —
  // none built yet.
  { id: "gann-box", name: "Gann Box", category: "gann", icon: Hash, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-square-fixed", name: "Gann Square Fixed", category: "gann", icon: Hash, interactionType: "point", anchorCount: 1, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-square", name: "Gann Square", category: "gann", icon: Hash, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "gann-fan", name: "Gann Fan", category: "gann", icon: Fan, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },

  // ---- Pattern Tools ------------------------------------------------------
  // Manual anchor-placement tools (per spec: NOT automatic detection). None
  // implemented yet — declared for toolbar/settings architecture readiness.
  { id: "xabcd", name: "XABCD", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "cypher", name: "Cypher", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "head-shoulders", name: "Head and Shoulders", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 5, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "abcd", name: "ABCD", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "triangle-pattern", name: "Triangle Pattern", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 4, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "three-drives", name: "Three Drives", category: "patterns", icon: LineChart, interactionType: "multi-click", anchorCount: 6, capabilities: { stroke: true, text: true }, defaultStyle: LINE_DEFAULT, implemented: false },

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
  { id: "vp-fixed", name: "Fixed Range Volume Profile", category: "volume", icon: BarChart2, interactionType: "drag", anchorCount: 2, capabilities: { fill: true }, defaultStyle: { color: "#4da3ff" }, implemented: false, note: "Reuses volumeProfileMath.ts's bucket math — not yet wired to a drawing object." },
  { id: "vp-anchored", name: "Anchored Volume Profile", category: "volume", icon: BarChart2, interactionType: "point", anchorCount: 1, capabilities: { fill: true }, defaultStyle: { color: "#4da3ff" }, implemented: false },

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
  { id: "ellipse", name: "Ellipse", category: "shapes", icon: Circle, interactionType: "drag", anchorCount: 2, capabilities: { stroke: true, fill: true }, defaultStyle: { ...LINE_DEFAULT, fillOpacity: 0.14 }, implemented: false, note: "Circle's existing free-drag geometry already draws a general ellipse (independent rx/ry) — a separate tool id would be a same-pixel-output duplicate, not a new capability." },
  { id: "polyline", name: "Polyline", category: "shapes", icon: Spline, interactionType: "multi-click", anchorCount: "unlimited", capabilities: { stroke: true }, defaultStyle: LINE_DEFAULT, implemented: false },
  { id: "path", name: "Path", category: "shapes", icon: Spline, interactionType: "multi-click", anchorCount: "unlimited", capabilities: { stroke: true, fill: true }, defaultStyle: LINE_DEFAULT, implemented: false },
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
