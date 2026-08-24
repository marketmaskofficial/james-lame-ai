import { Fragment, useEffect, useRef, useState } from "react";
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
import { TOOL_GROUPS, TOOL_DEFS, TOOL_BY_ID, type ToolGroupId } from "@/lib/drawing/registry";

const FAVORITES_KEY = "sg.studio.drawtools.favorites";
const RECENTS_KEY = "sg.studio.drawtools.recents";

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
 * Grouped flyout drawing toolbar — replaces the old flat icon list in
 * studio.tsx with the professional grouped-flyout structure the spec calls
 * for (group headings, hover/selected states, favorites, "coming soon" for
 * unimplemented tools, click-away/Escape close). Reads its tool list from
 * `src/lib/drawing/registry.ts` so the toolbar and any future menu never
 * fall out of sync about what exists.
 *
 * The button list scrolls independently of the open flyout: a short chart
 * pane (a 4-up grid, a collapsed dock) can genuinely be shorter than the
 * full button list, so the list itself needs `overflow-y-auto` — but CSS
 * has no way to make ONE axis of an element scroll while an
 * absolutely-positioned DESCENDANT ignores that same element's clipping on
 * the other axis (setting overflow-y:auto also promotes overflow-x away
 * from `visible`). A flyout rendered inside the scrolling list would get
 * silently clipped to the list's own 42px-wide box the moment it tried to
 * pop out to the right — invisible in the page despite being fully present,
 * correctly positioned, and interactive in the DOM. The fix: the flyout
 * renders as a SIBLING of the scrolling list, inside the outer (non-
 * clipping) `<nav>`, positioned with a measured pixel offset instead of
 * living naturally in list flow.
 *
 * Deliberately self-contained for favorites/recents (own localStorage keys)
 * — that's pure UI-chrome state, not workspace data, so it doesn't need to
 * flow through studio.tsx's much larger per-chart-instance state.
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
  const [openGroup, setOpenGroup] = useState<ToolGroupId | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const [favorites, setFavorites] = useState<DrawTool[]>(() => loadIds(FAVORITES_KEY));
  const [recents, setRecents] = useState<DrawTool[]>(() => loadIds(RECENTS_KEY));
  const railRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!railRef.current) return;
      if (!railRef.current.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleGroup(groupId: ToolGroupId, e: React.MouseEvent<HTMLButtonElement>) {
    if (openGroup === groupId) {
      setOpenGroup(null);
      return;
    }
    const railTop = railRef.current?.getBoundingClientRect().top ?? 0;
    const btnTop = e.currentTarget.getBoundingClientRect().top;
    setFlyoutTop(Math.max(0, btnTop - railTop));
    setOpenGroup(groupId);
  }

  function pickTool(t: DrawTool) {
    const def = TOOL_BY_ID[t];
    if (def?.status !== "ready") return;
    onSelectTool(t);
    setOpenGroup(null);
    setRecents((prev) => {
      const next = [t, ...prev.filter((x) => x !== t)].slice(0, 6);
      saveIds(RECENTS_KEY, next);
      return next;
    });
  }

  function toggleFavorite(t: DrawTool, e: React.MouseEvent) {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      saveIds(FAVORITES_KEY, next);
      return next;
    });
  }

  const groupsWithTools = TOOL_GROUPS.filter((g) => g.id !== "select").map((g) => ({
    group: g,
    tools: TOOL_DEFS.filter((t) => t.group === g.id),
  }));

  // Each group button shows the active tool's icon when the current tool
  // belongs to that group, otherwise the group's first ready tool.
  const iconForGroup = (groupId: ToolGroupId) => {
    const tools = TOOL_DEFS.filter((t) => t.group === groupId);
    const active = tools.find((t) => t.id === tool);
    return active ?? tools.find((t) => t.status === "ready") ?? tools[0];
  };

  const openGroupTools = openGroup ? groupsWithTools.find((g) => g.group.id === openGroup) : null;

  return (
    <nav
      ref={railRef}
      className="relative flex w-[42px] shrink-0 flex-col items-center border-r border-border bg-sidebar py-1.5"
    >
      <div ref={scrollRef} className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        <button
          title="Cursor"
          onClick={() => {
            onSelectTool("cursor");
            setOpenGroup(null);
          }}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${
            tool === "cursor" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-[18px] w-[18px]" />
        </button>
        <button
          title="Select / move drawings"
          onClick={() => {
            onSelectTool("select");
            setOpenGroup(null);
          }}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${
            tool === "select" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <MousePointer2 className="h-[14px] w-[14px]" />
        </button>
        <div className="my-1 h-px w-5 bg-border" />

        {groupsWithTools.map(({ group, tools }) => {
          const activeIconTool = iconForGroup(group.id);
          const isActiveGroup = tools.some((t) => t.id === tool);
          const Icon = activeIconTool.icon;
          return (
            <Fragment key={group.id}>
              <button
                title={group.label}
                onClick={(e) => toggleGroup(group.id, e)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] ${
                  isActiveGroup
                    ? "bg-brand text-brand-foreground"
                    : openGroup === group.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            </Fragment>
          );
        })}

        {favorites.length > 0 && (
          <>
            <div className="my-1 h-px w-5 bg-border" />
            {favorites.map((t) => {
              const def = TOOL_BY_ID[t];
              if (!def || def.status !== "ready") return null;
              return (
                <button
                  key={t}
                  title={`${def.label} (favorite)`}
                  onClick={() => pickTool(t)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${
                    tool === t ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <def.icon className="h-4 w-4" />
                </button>
              );
            })}
          </>
        )}

        {recents.filter((t) => !favorites.includes(t)).length > 0 && (
          <>
            <div className="my-1 h-px w-5 bg-border" />
            {recents
              .filter((t) => !favorites.includes(t))
              .slice(0, 3)
              .map((t) => {
                const def = TOOL_BY_ID[t];
                if (!def || def.status !== "ready") return null;
                return (
                  <button
                    key={t}
                    title={`${def.label} (recent)`}
                    onClick={() => pickTool(t)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] opacity-80 ${
                      tool === t ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <def.icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
          </>
        )}

        <div className="my-1 h-px w-5 bg-border" />

        <button
          title={MAGNET_LABEL[magnet]}
          onClick={() => onSetMagnet(MAGNET_CYCLE[(MAGNET_CYCLE.indexOf(magnet) + 1) % MAGNET_CYCLE.length])}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${
            magnet !== "off" ? "bg-accent text-brand" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Magnet className="h-4 w-4" />
        </button>
        <button
          title="Objects & styles"
          onClick={onToggleObjects}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${
            objectsOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Layers className="h-4 w-4" />
        </button>
        <button
          title={allLocked ? "Unlock all drawings" : "Lock all drawings"}
          disabled={!hasDrawings}
          onClick={allLocked ? onUnlockAll : onLockAll}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          {allLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </button>
        <button
          title={allHidden ? "Show all drawings" : "Hide all drawings"}
          disabled={!hasDrawings}
          onClick={allHidden ? onShowAll : onHideAll}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          {allHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          title="Delete selected drawing"
          disabled={!hasSelection}
          onClick={onDeleteSelected}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {hasDrawings && (
          <button
            title="Delete all drawings on this chart"
            onClick={onDeleteAll}
            className="flex h-7 w-9 shrink-0 items-center justify-center rounded-[6px] text-[9.5px] font-medium text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            clear
          </button>
        )}
      </div>

      {/* Rendered OUTSIDE the scrolling button list above — see this
          component's doc comment for why a flyout living inside that list
          would be silently clipped despite being fully present in the DOM. */}
      {openGroup && openGroupTools && (
        <div
          role="menu"
          aria-label={openGroupTools.group.label}
          className="absolute left-[46px] z-40 w-56 overflow-hidden rounded-[8px] border border-border bg-popover shadow-2xl"
          style={{ top: flyoutTop }}
        >
          <p className="border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {openGroupTools.group.label}
          </p>
          <div className="max-h-[70vh] overflow-y-auto p-1">
            {openGroupTools.tools.map((t) => {
              const soon = t.status === "soon";
              const isFav = favorites.includes(t.id);
              return (
                <div
                  key={t.id}
                  role="menuitem"
                  title={soon ? t.soonReason : t.label}
                  onClick={() => pickTool(t.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-[11.5px] ${
                    soon
                      ? "cursor-not-allowed text-muted-foreground/50"
                      : t.id === tool
                        ? "cursor-pointer bg-brand/15 text-foreground"
                        : "cursor-pointer text-foreground hover:bg-accent"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{t.label}</span>
                  {soon ? (
                    <span className="shrink-0 text-[9.5px] italic text-muted-foreground/60">soon</span>
                  ) : (
                    <button
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                      onClick={(e) => toggleFavorite(t.id, e)}
                      className="shrink-0 text-muted-foreground hover:text-brand"
                    >
                      <Star className={`h-3 w-3 ${isFav ? "fill-brand text-brand" : ""}`} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
