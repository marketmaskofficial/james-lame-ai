/**
 * Tool registry for Chart Studio's drawing toolbar — one place describing
 * every drawing tool's identity (id/label/icon), which flyout group it lives
 * in, and whether it's actually implemented yet. The left rail
 * (`DrawToolbar.tsx`) and the tool list previously inlined in studio.tsx both
 * read from this instead of each hardcoding their own copy, so adding a tool
 * or moving it between groups is a one-line change in one place.
 *
 * `status: "ready"` tools are fully wired into StudioChart's interaction/
 * render pipeline. `status: "soon"` tools are visible (so the menu structure
 * matches the final product) but disabled with the same "Coming soon"
 * treatment `LayoutMenu.tsx` already uses for locked presets — never a
 * clickable dead end that looks functional but silently does nothing.
 */

import type { ComponentType } from "react";
import {
  MousePointer2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
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
} from "lucide-react";
import type { DrawTool } from "@/components/studio/StudioChart";

export type ToolGroupId =
  | "select"
  | "lines"
  | "fib"
  | "patterns"
  | "position"
  | "volume"
  | "brushes"
  | "shapes"
  | "text"
  | "measure";

export const TOOL_GROUPS: { id: ToolGroupId; label: string }[] = [
  { id: "select", label: "Cursor" },
  { id: "lines", label: "Trend / Line Tools" },
  { id: "fib", label: "Fibonacci / Advanced" },
  { id: "patterns", label: "Pattern Tools" },
  { id: "position", label: "Position / Forecast" },
  { id: "volume", label: "Volume-Based" },
  { id: "brushes", label: "Brushes / Freehand" },
  { id: "shapes", label: "Shapes" },
  { id: "text", label: "Text / Notes" },
  { id: "measure", label: "Measurement" },
];

export type ToolStatus = "ready" | "soon";

export type ToolDef = {
  id: DrawTool;
  label: string;
  icon: ComponentType<{ className?: string }>;
  group: ToolGroupId;
  status: ToolStatus;
  /** Why a "soon" tool isn't real yet — shown the same way LayoutMenu's
   * locked-preset tooltip explains itself. */
  soonReason?: string;
};

const SOON = "Coming soon — architecture is ready, geometry isn't built yet.";

export const TOOL_DEFS: ToolDef[] = [
  // Cursor / Interaction
  { id: "cursor", label: "Cursor", icon: MousePointer2, group: "select", status: "ready" },
  { id: "select", label: "Select / move", icon: MousePointer2, group: "select", status: "ready" },

  // Trend / Line Tools
  { id: "trend", label: "Trend Line", icon: TrendingUp, group: "lines", status: "ready" },
  { id: "ray", label: "Ray", icon: ArrowUpRight, group: "lines", status: "ready" },
  { id: "extended", label: "Extended Line", icon: ArrowUpRight, group: "lines", status: "soon", soonReason: SOON },
  { id: "hline", label: "Horizontal Line", icon: Minus, group: "lines", status: "ready" },
  { id: "vline", label: "Vertical Line", icon: Minus, group: "lines", status: "ready" },
  { id: "hray", label: "Horizontal Ray", icon: Minus, group: "lines", status: "ready" },
  { id: "channel", label: "Parallel Channel", icon: GitBranch, group: "lines", status: "ready" },

  // Fibonacci / Advanced
  { id: "fib", label: "Fibonacci Retracement", icon: Ruler, group: "fib", status: "ready" },
  { id: "fib-ext", label: "Fib Extension", icon: Ruler, group: "fib", status: "soon", soonReason: SOON },
  { id: "fib-channel", label: "Fib Channel", icon: Ruler, group: "fib", status: "soon", soonReason: SOON },
  { id: "fib-time", label: "Fib Time Zone", icon: Ruler, group: "fib", status: "soon", soonReason: SOON },
  { id: "pitchfan", label: "Pitchfan", icon: Waves, group: "fib", status: "soon", soonReason: SOON },

  // Pattern Tools (menu structure only — deferred per spec §20)
  { id: "xabcd", label: "XABCD", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "cypher", label: "Cypher", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "head-shoulders", label: "Head & Shoulders", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "abcd", label: "ABCD", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "triangle-pattern", label: "Triangle Pattern", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "three-drives", label: "Three Drives", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },
  { id: "elliott", label: "Elliott Wave", icon: LineChart, group: "patterns", status: "soon", soonReason: SOON },

  // Position / Forecast
  { id: "long", label: "Long Position", icon: TrendingUp, group: "position", status: "ready" },
  { id: "short", label: "Short Position", icon: TrendingDown, group: "position", status: "ready" },
  { id: "forecast", label: "Position Forecast", icon: CandlestickChart, group: "position", status: "soon", soonReason: SOON },

  // Volume-Based
  { id: "vwap", label: "Anchored VWAP", icon: Waves, group: "volume", status: "ready" },
  { id: "vp-fixed", label: "Fixed Range Volume Profile", icon: Waves, group: "volume", status: "soon", soonReason: SOON },
  { id: "vp-anchored", label: "Anchored Volume Profile", icon: Waves, group: "volume", status: "soon", soonReason: SOON },

  // Brushes / Freehand
  { id: "brush", label: "Brush", icon: Pencil, group: "brushes", status: "ready" },
  { id: "highlighter", label: "Highlighter", icon: Highlighter, group: "brushes", status: "ready" },

  // Shapes
  { id: "rect", label: "Rectangle", icon: Square, group: "shapes", status: "ready" },
  { id: "circle", label: "Circle", icon: Circle, group: "shapes", status: "ready" },
  { id: "triangle", label: "Triangle", icon: Triangle, group: "shapes", status: "ready" },

  // Text / Notes
  { id: "text", label: "Text", icon: TypeIcon, group: "text", status: "ready" },
  { id: "marker", label: "Note", icon: MapPin, group: "text", status: "ready" },

  // Measurement
  { id: "price-range", label: "Price Range", icon: Ruler, group: "measure", status: "ready" },
  { id: "date-range", label: "Date Range", icon: Ruler, group: "measure", status: "ready" },
  { id: "measure", label: "Date + Price Range", icon: Ruler, group: "measure", status: "ready" },
];

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

/** Tools legitimately clickable today — used to gate "favorites" and
 * recently-used so a "soon" tool can never end up favorited/recent. */
export const READY_TOOLS = TOOL_DEFS.filter((t) => t.status === "ready" && t.id !== "cursor" && t.id !== "select");
