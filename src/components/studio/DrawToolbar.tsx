import { useEffect, useRef, useState } from "react";
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
import { TOOL_GROUPS, IMPLEMENTED_TOOLS, TOOL_BY_ID, type ToolGroupId } from "@/lib/drawing/registry";

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

type OpenPanel = ToolGroupId | "favorites" | null;

/**
 * Phase 3D-11: TradingView-style drawing toolbar — a compact, icon-only
 * narrow rail (one representative icon per SECTION, from
 * `src/lib/drawing/registry.ts`'s `TOOL_GROUPS`) that expands, on click,
 * into a flyout menu showing that section's visible uppercase name, every
 * tool's real icon + full name, a favorite star, and hover/selected states.
 * This replaces Phase 2's two-column icon-only grid — the same underlying
 * registry data (`TOOL_GROUPS`/`IMPLEMENTED_TOOLS`/`TOOL_BY_ID`) drives both,
 * so this is a rendering change only: no tool id, capability, or persisted
 * drawing was touched (see registry.ts's own Phase 3D-11 doc comments for
 * the one exception — three tool families' `category` field moved into two
 * new sections for clearer grouping, which is metadata only).
 *
 * An unimplemented tool is still never rendered here — a family with zero
 * `implemented: true` tools (Content/Image/Post/Idea) produces an empty
 * `tools` array below and is filtered out entirely, so it never appears in
 * the rail, exactly like Phase 2.
 *
 * Favorites: the star inside any flyout row toggles favorite status without
 * selecting the tool or closing the menu (its click handler stops
 * propagation before the row's own `onClick`). A dedicated "Favorites"
 * rail slot (only rendered once at least one tool is favorited) opens the
 * same row UI filtered to just those tools. Both read/write the exact same
 * `sg.studio.drawtools.favorites` localStorage key Phase 2 already used —
 * no second favorites system, no persistence format change.
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
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [panelAnchorTop, setPanelAnchorTop] = useState(0);
  const navRef = useRef<HTMLElement>(null);

  /** The flyout is rendered `fixed` (not `absolute` inside the scrolling
   * rail) because that scrolling section's `overflow-y-auto` implicitly
   * clips the x-axis too (per the CSS spec, an ancestor with only one axis
   * set to non-"visible" forces the other to "auto" as well) — an
   * `absolute left-full` panel nested inside it would be clipped off-screen
   * the moment it tried to render outside the 48px-wide rail. `fixed`
   * escapes that clipping entirely; the anchor Y coordinate is captured
   * from the clicked button's own bounding rect so the flyout still opens
   * aligned with whichever section/favorites button was clicked. */
  function togglePanel(id: OpenPanel, e: React.MouseEvent<HTMLButtonElement>) {
    setPanelAnchorTop(e.currentTarget.getBoundingClientRect().top);
    setOpenPanel((p) => (p === id ? null : id));
  }

  useEffect(() => {
    if (!openPanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenPanel(null);
    }
    function onPointerDown(e: PointerEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenPanel(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openPanel]);

  function pickTool(t: DrawTool) {
    const def = TOOL_BY_ID[t];
    if (!def?.implemented) return;
    onSelectTool(t);
    setOpenPanel(null);
  }

  function toggleFavorite(t: DrawTool, e: React.MouseEvent | React.PointerEvent) {
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

  const Row = ({ t }: { t: (typeof IMPLEMENTED_TOOLS)[number] }) => {
    const isFav = favorites.includes(t.id);
    const isActive = tool === t.id;
    return (
      <button
        key={t.id}
        onClick={() => pickTool(t.id)}
        className={`group flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] ${
          isActive ? "bg-brand text-brand-foreground" : "text-foreground/90 hover:bg-accent"
        }`}
      >
        <t.icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t.name}</span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => toggleFavorite(t.id, e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") toggleFavorite(t.id, e as unknown as React.MouseEvent);
          }}
          title={isFav ? "Remove from favorites" : "Add to favorites"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
            isFav ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
          } ${isActive ? "hover:bg-black/10" : "hover:bg-accent"}`}
        >
          <Star className={`h-3 w-3 ${isFav ? "fill-brand text-brand" : ""} ${isActive && !isFav ? "text-brand-foreground" : ""}`} />
        </span>
      </button>
    );
  };

  const openTools = openPanel === null ? null : openPanel === "favorites" ? favoriteTools : (groupsWithTools.find((g) => g.group.id === openPanel)?.tools ?? []);
  const openHeading = openPanel === null ? "" : openPanel === "favorites" ? "Favorites" : (groupsWithTools.find((g) => g.group.id === openPanel)?.group.label ?? "");

  return (
    <nav ref={navRef} className="relative flex w-12 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Cursor / Select — pinned, not part of the scrolling section list. */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-border px-1.5 py-1.5">
        <button
          title="Cursor — pan/zoom only, never selects a drawing"
          onClick={() => {
            onSelectTool("cursor");
            setOpenPanel(null);
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            tool === "cursor" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-4 w-4" />
        </button>
        <button
          title="Select — click a drawing to select/move/resize it"
          onClick={() => {
            onSelectTool("select");
            setOpenPanel(null);
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
            tool === "select" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-3 w-3" />
        </button>
      </div>

      {/* One representative icon per section — click opens that section's
          named flyout menu. Scrolls independently of the pinned header/
          footer, subtle scrollbar. */}
      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto py-1.5">
        {favoriteTools.length > 0 && (
          <div className="mb-1.5 px-1.5">
            <button
              title="Favorites"
              onClick={(e) => togglePanel("favorites", e)}
              className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
                openPanel === "favorites" ? "bg-accent text-brand" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Star className="h-4 w-4" />
            </button>
          </div>
        )}
        {groupsWithTools.map(({ group, tools }) => {
          const RepIcon = tools[0].icon;
          const isCurrentToolHere = tools.some((t) => t.id === tool);
          return (
            <div key={group.id} className="px-1.5 pb-1.5">
              <button
                title={group.label}
                onClick={(e) => togglePanel(group.id, e)}
                className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${
                  openPanel === group.id || isCurrentToolHere
                    ? "bg-accent text-brand"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <RepIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* The one open flyout, if any — `fixed`, not nested in the scrolling
          rail above (see `togglePanel`'s doc comment for why). */}
      {openPanel !== null && openTools !== null && (
        <div
          className="subtle-scrollbar fixed z-20 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl"
          style={{
            // Clamp using the panel's actual estimated content height (not
            // just a fixed margin) so a long section opened near the bottom
            // of the rail still fits entirely inside the viewport instead
            // of having its last few rows rendered off-screen and
            // unreachable — this app has no page-level scroll to fall back
            // on for a `position: fixed` element that overflows the
            // viewport.
            top: Math.max(8, Math.min(panelAnchorTop, window.innerHeight - Math.min(window.innerHeight * 0.7, 36 + openTools.length * 34) - 8)),
            left: (navRef.current?.getBoundingClientRect().right ?? 48) + 4,
          }}
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{openHeading}</p>
          {openTools.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      )}

      {/* Global drawing controls — pinned at the bottom, always reachable.
          Phase 3D-12: this was a `grid-cols-2` layout left over from Phase
          2's 80px-wide two-column rail. Phase 3D-11 narrowed the rail to
          48px (one icon per row everywhere else — Cursor/Select above, every
          section icon in the scrolling list) but never updated this block,
          so two 32px buttons + gap (68px) were forced into ~36px of content
          width, visually crowding/overlapping. Single column matches every
          other control in this toolbar (same fixed 32px slot, same
          spacing) and fits the rail's actual width with room to spare — no
          horizontal overflow, so no horizontal scrollbar risk. This section
          stays `shrink-0` (a fixed-height footer that never compresses),
          the section-icon list above it is the only thing that scrolls. */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-border px-1.5 py-1.5">
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
