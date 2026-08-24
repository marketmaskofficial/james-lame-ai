import { Fragment, useState } from "react";
import {
  Star,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
  Layers,
  Magnet,
  MousePointer2,
} from "lucide-react";
import type { DrawTool } from "./StudioChart";
import type { MagnetMode } from "./StudioChart";
import { TOOL_GROUPS, IMPLEMENTED_TOOLS, TOOL_BY_ID } from "@/lib/drawing/registry";

const FAVORITES_KEY = "sg.studio.drawtools.favorites";

function loadIds(key: string): DrawTool[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as DrawTool[]) : [];
  } catch {
    return [];
  }
}
function saveIds(key: string, ids: DrawTool[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

const MAGNET_CYCLE: MagnetMode[] = ["off", "weak", "strong"];
const MAGNET_LABEL: Record<MagnetMode, string> = { off: "Magnet: off", weak: "Magnet: weak", strong: "Magnet: strong" };

/**
 * Compact TWO-COLUMN drawing toolbar — Phase 2 replacement for Phase 1's
 * single-column grouped-flyout rail. Every family with at least one
 * `implemented: true` tool gets a `[tool][tool]` tile grid (a family with
 * zero implemented tools yet — Gann, Patterns, Elliott, Cycles, Content —
 * renders NOTHING, not a disabled placeholder: an unimplemented tool must
 * never appear as a clickable dead button, and with no flyout to bury a
 * "coming soon" row in, "not shown at all" is the only option that isn't a
 * dead end).
 *
 * Reads its entire tool list from `src/lib/drawing/registry.ts` — this file
 * hardcodes no per-tool metadata, so adding/moving a tool is a registry-only
 * change (per the phase brief: "Render the toolbar from the existing
 * drawing-tool registry — do not manually wire dozens of unrelated toolbar
 * buttons one by one").
 *
 * Layout: Cursor/Select pinned at top (not part of the scrolling grid —
 * they're the two most-used actions and belong to no family), then a
 * scrolling region (favorites, then each family's tile grid with a subtle
 * `border-t` separator between them), then the global drawing controls
 * (magnet/objects/lock/hide/delete) pinned at the bottom so they're always
 * reachable regardless of how long the tool list gets.
 *
 * Favorites: right-click any tool tile to toggle it (a tiny star badge marks
 * a favorited tile) — with no room for a per-item star button in an 80px-
 * wide, icon-only grid, right-click is the standard "secondary action" on a
 * dense icon toolbar and needs no extra chrome. Favorited tools reference
 * the SAME `ToolDef` from the registry (just filtered into their own
 * section) — no duplicated tool state.
 */
export function DrawToolbar({
  tool,
  onSelectTool,
  magnet,
  onSetMagnet,
  objectsOpen,
  onToggleObjects,
  hasDrawings,
  hasSelection,
  allLocked,
  allHidden,
  onLockAll,
  onUnlockAll,
  onHideAll,
  onShowAll,
  onDeleteSelected,
  onDeleteAll,
}: {
  tool: DrawTool;
  onSelectTool: (t: DrawTool) => void;
  magnet: MagnetMode;
  onSetMagnet: (m: MagnetMode) => void;
  objectsOpen: boolean;
  onToggleObjects: () => void;
  hasDrawings: boolean;
  hasSelection: boolean;
  allLocked: boolean;
  allHidden: boolean;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
}) {
  const [favorites, setFavorites] = useState<DrawTool[]>(() => loadIds(FAVORITES_KEY));

  function pickTool(t: DrawTool) {
    const def = TOOL_BY_ID[t];
    if (!def?.implemented) return;
    onSelectTool(t);
  }

  function toggleFavorite(t: DrawTool, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      saveIds(FAVORITES_KEY, next);
      return next;
    });
  }

  const groupsWithTools = TOOL_GROUPS.map((g) => ({
    group: g,
    tools: IMPLEMENTED_TOOLS.filter((t) => t.category === g.id),
  })).filter((g) => g.tools.length > 0);

  const favoriteTools = favorites
    .map((t) => TOOL_BY_ID[t])
    .filter((def): def is NonNullable<typeof def> => Boolean(def?.implemented));

  const Tile = ({ t }: { t: (typeof IMPLEMENTED_TOOLS)[number] }) => {
    const isFav = favorites.includes(t.id);
    const isActive = tool === t.id;
    return (
      <button
        key={t.id}
        title={`${t.name}${isFav ? " · favorited (right-click to remove)" : " (right-click to favorite)"}`}
        onClick={() => pickTool(t.id)}
        onContextMenu={(e) => toggleFavorite(t.id, e)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-[6px] ${
          isActive ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <t.icon className="h-4 w-4" />
        {isFav && (
          <Star className="absolute -right-0.5 -top-0.5 h-2 w-2 fill-brand text-brand" />
        )}
      </button>
    );
  };

  return (
    <nav className="relative flex w-20 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Cursor / Select — pinned, not part of the scrolling family grid. */}
      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border px-1.5 py-1.5">
        <button
          title="Cursor — pan/zoom only, never selects a drawing"
          onClick={() => onSelectTool("cursor")}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            tool === "cursor" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-4 w-4" />
        </button>
        <button
          title="Select — click a drawing to select/move/resize it"
          onClick={() => onSelectTool("select")}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            tool === "select" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-3 w-3" />
        </button>
      </div>

      {/* Favorites + every family with at least one real tool — scrolls
          independently of the pinned header/footer, subtle scrollbar. */}
      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto py-1.5">
        {favoriteTools.length > 0 && (
          <>
            <p className="px-2 pb-1 text-[8.5px] font-medium uppercase tracking-wide text-muted-foreground/70">Favorites</p>
            <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
              {favoriteTools.map((t) => (
                <Tile key={`fav-${t.id}`} t={t} />
              ))}
            </div>
            <div className="mx-2 mb-1.5 border-t border-border" />
          </>
        )}
        {groupsWithTools.map(({ group, tools }, i) => (
          <Fragment key={group.id}>
            {i > 0 && <div className="mx-2 mb-1.5 border-t border-border" />}
            <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5" role="group" aria-label={group.label}>
              {tools.map((t) => (
                <Tile key={t.id} t={t} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>

      {/* Global drawing controls — pinned at the bottom, always reachable. */}
      <div className="grid shrink-0 grid-cols-2 gap-1 border-t border-border px-1.5 py-1.5">
        <button
          title={MAGNET_LABEL[magnet]}
          onClick={() => onSetMagnet(MAGNET_CYCLE[(MAGNET_CYCLE.indexOf(magnet) + 1) % MAGNET_CYCLE.length])}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            magnet !== "off" ? "bg-accent text-brand" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Magnet className="h-4 w-4" />
        </button>
        <button
          title="Objects & styles"
          onClick={onToggleObjects}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            objectsOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Layers className="h-4 w-4" />
        </button>
        <button
          title={allLocked ? "Unlock all drawings" : "Lock all drawings"}
          disabled={!hasDrawings}
          onClick={allLocked ? onUnlockAll : onLockAll}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          {allLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </button>
        <button
          title={allHidden ? "Show all drawings" : "Hide all drawings"}
          disabled={!hasDrawings}
          onClick={allHidden ? onShowAll : onHideAll}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          {allHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          title="Delete selected drawing"
          disabled={!hasSelection}
          onClick={onDeleteSelected}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          title="Delete all drawings on this chart"
          disabled={!hasDrawings}
          onClick={onDeleteAll}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[9px] font-medium text-muted-foreground hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        >
          all
        </button>
      </div>
    </nav>
  );
}
