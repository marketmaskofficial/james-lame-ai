/**
 * Local persistence for the modular workspace layout tree (UI-4d).
 *
 * Deliberately a SEPARATE localStorage key from studio.tsx's pre-existing
 * `sg.studio.layout` blob (symbol/interval/chart-type/dock+sidebar pixel
 * dimensions) — that blob is flat and unversioned; a WorkspaceLayout tree
 * needs its own schema versioning and eventually a list of named layouts,
 * neither of which fits cleanly into the existing shape without either
 * destabilizing code that already works or cramming two unrelated concerns
 * into one JSON object. See the UI-4d architecture discussion for the full
 * reasoning.
 *
 * Everything here is resilience-first: a corrupted, hand-edited, or
 * old-schema value in localStorage must NEVER crash the app or produce a
 * blank workspace. Every unrecoverable case falls back to PRESETS.beginner
 * and logs one console.warn — the same "degrade visibly and safely, never
 * silently" principle already used for coming-soon widgets and rejected
 * mutations elsewhere in this system.
 */

import type { LayoutNode, WidgetInstance, WorkspaceLayout } from "./types";
import { WELL_KNOWN_NODE_IDS } from "./types";
import { PRESETS } from "./presets";
import { WIDGET_REGISTRY } from "./widgetRegistry";

export const WORKSPACE_STORAGE_KEY = "sg.studio.workspace-layout-v1";

/**
 * Tracks, per-browser, whether this browser's local named layouts have
 * already been imported into the cloud once for the signed-in user. A plain
 * flag (not a LocalWorkspaceStore field) so the one-time-import logic stays
 * decoupled from the store's own load/save/repair path — it only needs a
 * yes/no, never participates in schema migration or repair.
 */
const MIGRATED_FLAG_KEY = "sg.studio.workspace-migrated-v1";

export function hasMigratedToCloud(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(MIGRATED_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

export function markMigratedToCloud(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MIGRATED_FLAG_KEY, "true");
  } catch {
    /* storage unavailable */
  }
}

/**
 * Sentinel `activeLayoutId` meaning "use `currentLayout`, not a named entry
 * in `layouts[]`". This is the always-autosaving scratch slot — editing it
 * (UI-4c's add/remove/reorder/move) is what makes a customization survive a
 * reload without requiring the user to name/save anything first. Named
 * layouts, by contrast, only update when the user explicitly saves again.
 */
export const CURRENT_LAYOUT_ID = "__current__";

export type LocalWorkspaceStore = {
  version: 1;
  /** Named, user-saved layouts. */
  layouts: WorkspaceLayout[];
  /** The always-autosaving scratch slot — mirrors the live tree whenever `activeLayoutId === CURRENT_LAYOUT_ID`, and also just before switching away from it, so switching back never loses in-progress edits. */
  currentLayout: WorkspaceLayout;
  /** CURRENT_LAYOUT_ID, or a `layouts[]` entry's id. */
  activeLayoutId: string;
  /** Which named layout loads on a fresh visit instead of PRESETS.beginner. Null = use PRESETS.beginner/currentLayout. */
  defaultLayoutId: string | null;
};

export function defaultLocalStore(): LocalWorkspaceStore {
  return {
    version: 1,
    layouts: [],
    currentLayout: PRESETS.beginner,
    activeLayoutId: CURRENT_LAYOUT_ID,
    defaultLayoutId: null,
  };
}

/**
 * Version-chain hook. Only `version: 1` exists today, so this is a validated
 * passthrough — but it's called explicitly on every load so a real future
 * schema migration (e.g. a new LayoutNode kind) has a hook to extend instead
 * of needing new plumbing bolted on later.
 */
export function migrateWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return { ...layout, version: 1 };
}

function isValidWidgetTypeId(id: unknown): id is keyof typeof WIDGET_REGISTRY {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, id);
}

/**
 * UI-4f-1 topology fix: every layout created before this phase (all of
 * UI-4a-4e's presets and any already-persisted saved layout cloned from
 * them) has `root` = column[`main-row`, `bottom-dock`] with `main-row` =
 * row[`chart-area`, `right-sidebar`] — a shape that was never actually
 * wrong to have shipped, since nothing rendered "split" nodes before
 * `LayoutTree` existed. It just doesn't match what studio.tsx's DOM has
 * always really been (chart stacked above the dock, sidebar as a separate
 * full-height column beside both) now that something does. Rewritten here,
 * transparently, into `root` = row[`chart-column`, `right-sidebar`] with
 * `chart-column` = column[`chart-area`, `bottom-dock`] — the shape
 * `presets.ts` now declares — preserving every widget/tab/size exactly, so
 * an already-saved layout keeps rendering identically once repaired.
 * Returns the input unchanged if it isn't recognizably the old shape (already
 * new-shape data, or something `repairNode` should judge instead).
 */
function normalizeLegacyTopology(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const root = node as Record<string, unknown>;
  if (root.kind !== "split" || root.direction !== "column") return node;
  const children = root.children;
  if (!Array.isArray(children) || children.length !== 2) return node;
  const [mainRow, bottomDock] = children as Record<string, unknown>[];
  if (
    !mainRow ||
    typeof mainRow !== "object" ||
    mainRow.id !== WELL_KNOWN_NODE_IDS.mainRow ||
    mainRow.kind !== "split"
  ) {
    return node;
  }
  const mainRowChildren = mainRow.children;
  if (!Array.isArray(mainRowChildren) || mainRowChildren.length !== 2) return node;
  const [chartArea, rightSidebar] = mainRowChildren as Record<string, unknown>[];
  if (
    !chartArea ||
    !rightSidebar ||
    chartArea.id !== WELL_KNOWN_NODE_IDS.chartArea ||
    rightSidebar.id !== WELL_KNOWN_NODE_IDS.rightSidebar ||
    !bottomDock ||
    typeof bottomDock !== "object" ||
    bottomDock.id !== WELL_KNOWN_NODE_IDS.bottomDock
  ) {
    return node;
  }
  return {
    kind: "split",
    id: root.id,
    direction: "row",
    sizes: mainRow.sizes,
    children: [
      {
        kind: "split",
        id: WELL_KNOWN_NODE_IDS.chartColumn,
        direction: "column",
        sizes: root.sizes,
        children: [chartArea, bottomDock],
      },
      rightSidebar,
    ],
  };
}

/**
 * Repairs one node in place: strips widget instances referencing a
 * since-removed widget type, drops "tabs" nodes left with zero tabs after
 * stripping, collapses "split" nodes down to their one surviving child (or
 * drops them too if every child was dropped), and re-normalizes `sizes` if
 * the child count changed. Returns null when the node itself can't be
 * salvaged, so the caller can fall back further up the tree.
 */
function repairNode(node: unknown): LayoutNode | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (typeof n.id !== "string") return null;

  if (n.kind === "tabs") {
    if (!Array.isArray(n.tabs)) return null;
    const validTabs = (n.tabs as unknown[]).filter(
      (t): t is { instanceId: string; widgetTypeId: string; title?: string; pinned?: boolean } =>
        Boolean(
          t &&
            typeof t === "object" &&
            typeof (t as Record<string, unknown>).instanceId === "string" &&
            (t as Record<string, unknown>).instanceId !== "" &&
            isValidWidgetTypeId((t as Record<string, unknown>).widgetTypeId),
        ),
    );
    if (validTabs.length === 0) return null;
    const activeInstanceId =
      typeof n.activeInstanceId === "string" && validTabs.some((t) => t.instanceId === n.activeInstanceId)
        ? n.activeInstanceId
        : validTabs[0].instanceId;
    return {
      kind: "tabs",
      id: n.id,
      tabs: validTabs as WidgetInstance[],
      activeInstanceId,
    };
  }

  if (n.kind === "split") {
    if (!Array.isArray(n.children)) return null;
    const children = (n.children as unknown[]).map(repairNode).filter((c): c is LayoutNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]; // collapse a split down to its one surviving child
    const rawSizes = Array.isArray(n.sizes) ? (n.sizes as unknown[]) : [];
    const sizes =
      rawSizes.length === children.length && rawSizes.every((s) => typeof s === "number")
        ? (rawSizes as number[])
        : children.map(() => 1 / children.length);
    const direction = n.direction === "column" ? "column" : "row";
    return { kind: "split", id: n.id, direction, sizes, children };
  }

  return null; // unknown node kind
}

/**
 * The resilience gate every load path (local today, Supabase later) must go
 * through. Never throws; any unrecoverable input becomes PRESETS.beginner
 * with a single console.warn, never a broken or blank workspace.
 */
export function safeParseWorkspaceLayout(raw: unknown): WorkspaceLayout {
  try {
    if (!raw || typeof raw !== "object") {
      console.warn("[workspace] Saved layout was missing or malformed — using the Beginner default.");
      return PRESETS.beginner;
    }
    const obj = raw as Record<string, unknown>;
    const migrated = migrateWorkspaceLayout(obj as unknown as WorkspaceLayout);
    const normalizedRoot = normalizeLegacyTopology(migrated.root);
    const repairedRoot = repairNode(normalizedRoot);
    if (!repairedRoot) {
      console.warn(
        "[workspace] Saved layout's tree couldn't be repaired (no valid widgets survived) — using the Beginner default.",
      );
      return PRESETS.beginner;
    }
    return {
      version: 1,
      id: typeof obj.id === "string" ? obj.id : undefined,
      name: typeof obj.name === "string" && obj.name ? obj.name : "Untitled",
      isPreset: false,
      root: repairedRoot,
      maximizedNodeId: typeof obj.maximizedNodeId === "string" ? (obj.maximizedNodeId as string) : null,
      collapsedNodeIds: Array.isArray(obj.collapsedNodeIds)
        ? (obj.collapsedNodeIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    console.warn("[workspace] Failed to parse a saved layout — using the Beginner default.");
    return PRESETS.beginner;
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Reads and validates the whole local store. Never throws; absent/corrupt data becomes a fresh default store. */
export function loadLocalStore(): LocalWorkspaceStore {
  if (!isBrowser()) return defaultLocalStore();
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return defaultLocalStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      console.warn("[workspace] Saved workspace store was malformed — resetting to defaults.");
      return defaultLocalStore();
    }
    const p = parsed as Record<string, unknown>;
    const layoutsRaw = Array.isArray(p.layouts) ? p.layouts : [];
    const layouts = layoutsRaw.map((l, i) => {
      const repaired = safeParseWorkspaceLayout(l);
      const rawEntry = l as Record<string, unknown>;
      return {
        ...repaired,
        id: typeof rawEntry?.id === "string" ? rawEntry.id : (repaired.id ?? `restored-${i}`),
        name: typeof rawEntry?.name === "string" && rawEntry.name ? rawEntry.name : repaired.name,
      };
    });
    const currentLayout = safeParseWorkspaceLayout(p.currentLayout);

    let activeLayoutId = typeof p.activeLayoutId === "string" ? p.activeLayoutId : CURRENT_LAYOUT_ID;
    if (activeLayoutId !== CURRENT_LAYOUT_ID && !layouts.some((l) => l.id === activeLayoutId)) {
      activeLayoutId = CURRENT_LAYOUT_ID; // dangling reference — fall back to the scratch slot
    }

    let defaultLayoutId = typeof p.defaultLayoutId === "string" ? p.defaultLayoutId : null;
    if (defaultLayoutId && !layouts.some((l) => l.id === defaultLayoutId)) defaultLayoutId = null;

    return { version: 1, layouts, currentLayout, activeLayoutId, defaultLayoutId };
  } catch {
    console.warn("[workspace] Failed to load the saved workspace store — resetting to defaults.");
    return defaultLocalStore();
  }
}

/** Try/catch write, same defensive posture as the existing `sg.studio.layout` persistence effect (quota exceeded, private-mode storage, SSR, etc. all fail silently rather than crash). */
export function saveLocalStore(store: LocalWorkspaceStore): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable */
  }
}

/** The tree that should currently be rendered, given the store's active pointer. */
export function resolveActiveLayout(store: LocalWorkspaceStore): WorkspaceLayout {
  if (store.activeLayoutId !== CURRENT_LAYOUT_ID) {
    const found = store.layouts.find((l) => l.id === store.activeLayoutId);
    if (found) return found;
  }
  return store.currentLayout;
}

/** What loads on a fresh visit: the marked default layout if one exists and is still present, else whatever the active pointer resolves to. */
export function initialWorkspaceLayout(store: LocalWorkspaceStore): WorkspaceLayout {
  if (store.defaultLayoutId) {
    const found = store.layouts.find((l) => l.id === store.defaultLayoutId);
    if (found) return found;
  }
  return resolveActiveLayout(store);
}
