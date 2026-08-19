// Coverage for the local workspace-layout persistence layer (UI-4d):
// src/lib/workspace/persistence.ts. No React, no real browser — a minimal
// in-memory localStorage shim is installed on `globalThis.window` before
// importing the module under test, since it feature-detects `window` the
// same way the rest of Chart Studio's SSR-safe persistence code does.
//
// Usage: npx tsx test/workspace/persistence.test.mjs

class FakeLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const fakeStorage = new FakeLocalStorage();
globalThis.window = { localStorage: fakeStorage };

const {
  WORKSPACE_STORAGE_KEY,
  CURRENT_LAYOUT_ID,
  defaultLocalStore,
  migrateWorkspaceLayout,
  safeParseWorkspaceLayout,
  loadLocalStore,
  saveLocalStore,
  resolveActiveLayout,
  initialWorkspaceLayout,
} = await import("../../src/lib/workspace/persistence.ts");
const { PRESETS } = await import("../../src/lib/workspace/presets.ts");
const { findNodeById, WELL_KNOWN_NODE_IDS } = await import("../../src/lib/workspace/types.ts");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

// Suppress the module's own console.warn noise during expected-failure
// cases below, but capture whether one fired so we can assert on it.
let warned = false;
const realWarn = console.warn;
function withWarnCapture(fn) {
  warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    return fn();
  } finally {
    console.warn = realWarn;
  }
}

// ---- safeParseWorkspaceLayout ----------------------------------------------

{
  // safeParseWorkspaceLayout always normalizes isPreset:false (its output is
  // "repaired user data", never literally the code-defined preset object) —
  // so a valid round-trip is checked structurally (root/name/version), not
  // by full object identity including that field.
  const valid = PRESETS.beginner;
  const result = safeParseWorkspaceLayout(valid);
  check("safeParse: a valid layout's tree round-trips unchanged", result.root, valid.root);
  check("safeParse: a valid layout's name round-trips unchanged", result.name, valid.name);
  check("safeParse: a valid layout's version round-trips unchanged", result.version, valid.version);
  ok("safeParse: parsed output is never itself flagged as a preset", result.isPreset === false);
}

{
  let result;
  withWarnCapture(() => {
    result = safeParseWorkspaceLayout("not even an object");
  });
  check("safeParse: garbage input falls back to Beginner", result, PRESETS.beginner);
  ok("safeParse: garbage input logs a warning", warned);
}

{
  let result;
  withWarnCapture(() => {
    result = safeParseWorkspaceLayout(null);
  });
  check("safeParse: null falls back to Beginner without throwing", result, PRESETS.beginner);
}

{
  // A layout referencing a widget type that no longer exists gets that
  // instance stripped rather than crashing.
  const layout = {
    version: 1,
    name: "test",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "tabs",
      id: "right-sidebar",
      tabs: [
        { instanceId: "watchlist-1", widgetTypeId: "watchlist" },
        { instanceId: "ghost-1", widgetTypeId: "totally-removed-widget-type" },
      ],
      activeInstanceId: "watchlist-1",
    },
  };
  const result = safeParseWorkspaceLayout(layout);
  ok("safeParse: instance with a removed widget type is stripped", result.root.tabs.length === 1);
  ok("safeParse: the surviving instance is the valid one", result.root.tabs[0].instanceId === "watchlist-1");
}

{
  // Stripping every tab in a node empties it -> the whole layout falls back.
  const layout = {
    version: 1,
    name: "test",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "tabs",
      id: "right-sidebar",
      tabs: [{ instanceId: "ghost-1", widgetTypeId: "totally-removed-widget-type" }],
      activeInstanceId: "ghost-1",
    },
  };
  let result;
  withWarnCapture(() => {
    result = safeParseWorkspaceLayout(layout);
  });
  check("safeParse: a node emptied by stripping falls back to Beginner", result, PRESETS.beginner);
}

{
  // A dangling activeInstanceId self-heals to the first remaining tab.
  const layout = {
    version: 1,
    name: "test",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "tabs",
      id: "right-sidebar",
      tabs: [{ instanceId: "watchlist-1", widgetTypeId: "watchlist" }],
      activeInstanceId: "some-id-that-does-not-exist",
    },
  };
  const result = safeParseWorkspaceLayout(layout);
  check("safeParse: dangling activeInstanceId self-heals to the first tab", result.root.activeInstanceId, "watchlist-1");
}

{
  // A split whose child count changes after repair collapses/renormalizes
  // rather than producing a mismatched sizes array.
  const layout = {
    version: 1,
    name: "test",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "split",
      id: "root",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "tabs", id: "a", tabs: [{ instanceId: "x1", widgetTypeId: "ghost-type" }], activeInstanceId: "x1" },
        { kind: "tabs", id: "b", tabs: [{ instanceId: "watchlist-1", widgetTypeId: "watchlist" }], activeInstanceId: "watchlist-1" },
      ],
    },
  };
  const result = safeParseWorkspaceLayout(layout);
  ok("safeParse: a split collapses to its one surviving child", result.root.kind === "tabs" && result.root.id === "b");
}

{
  // The exact resilience gate applied to local data is reused verbatim for a
  // Supabase `workspace_layouts.layout` jsonb column value (UI-4d cloud
  // sync) -- simulate a DB round-trip (JSON.parse(JSON.stringify(...)), same
  // as the JSON-store round-trip test above) of a layout referencing a
  // since-removed widget type, as if the app shipped a newer registry than
  // when the row was saved.
  const cloudRow = {
    version: 1,
    name: "Cloud Layout",
    maximizedNodeId: null,
    collapsedNodeIds: [],
    root: {
      kind: "tabs",
      id: "bottom-dock",
      tabs: [
        { instanceId: "gone-1", widgetTypeId: "retired-widget-type" },
        { instanceId: "journal-1", widgetTypeId: "journal" },
      ],
      activeInstanceId: "gone-1",
    },
  };
  const result = safeParseWorkspaceLayout(JSON.parse(JSON.stringify(cloudRow)));
  ok(
    "safeParse: a cloud row's layout column repairs a removed widget type identically to local data",
    result.root.kind === "tabs" && result.root.tabs.length === 1 && result.root.tabs[0].widgetTypeId === "journal",
  );
}

// ---- migrateWorkspaceLayout -------------------------------------------------

{
  const layout = { ...PRESETS.beginner };
  const migrated = migrateWorkspaceLayout(layout);
  check("migrate: version:1 passthrough leaves the layout equivalent", migrated.root, layout.root);
  check("migrate: version is normalized to 1", migrated.version, 1);
}

// ---- loadLocalStore / saveLocalStore round-trip -----------------------------

{
  fakeStorage.clear();
  const store = defaultLocalStore();
  store.layouts.push({ ...PRESETS.beginner, id: "layout-a", name: "My Layout", isPreset: false });
  store.activeLayoutId = "layout-a";
  store.defaultLayoutId = "layout-a";
  saveLocalStore(store);
  const loaded = loadLocalStore();
  check("store round-trip: layouts survive", loaded.layouts.map((l) => l.id), ["layout-a"]);
  check("store round-trip: activeLayoutId survives", loaded.activeLayoutId, "layout-a");
  check("store round-trip: defaultLayoutId survives", loaded.defaultLayoutId, "layout-a");
}

{
  fakeStorage.clear();
  const loaded = loadLocalStore();
  check("store round-trip: absent key returns a fresh default store", loaded.activeLayoutId, CURRENT_LAYOUT_ID);
  check("store round-trip: absent key has no saved layouts", loaded.layouts, []);
}

{
  fakeStorage.clear();
  fakeStorage.setItem(WORKSPACE_STORAGE_KEY, "{not valid json");
  let loaded;
  withWarnCapture(() => {
    loaded = loadLocalStore();
  });
  check("store round-trip: corrupted JSON falls back to a fresh default store", loaded, defaultLocalStore());
  ok("store round-trip: corrupted JSON logs a warning", warned);
}

{
  // A dangling activeLayoutId (references a layout that no longer exists in
  // layouts[]) falls back to the CURRENT_LAYOUT_ID sentinel rather than
  // pointing at nothing.
  fakeStorage.clear();
  fakeStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      layouts: [],
      currentLayout: PRESETS.beginner,
      activeLayoutId: "some-deleted-layout-id",
      defaultLayoutId: "some-deleted-layout-id",
    }),
  );
  const loaded = loadLocalStore();
  check("store round-trip: dangling activeLayoutId falls back to the current slot", loaded.activeLayoutId, CURRENT_LAYOUT_ID);
  check("store round-trip: dangling defaultLayoutId is nulled out", loaded.defaultLayoutId, null);
}

// ---- resolveActiveLayout / initialWorkspaceLayout ---------------------------

{
  const store = defaultLocalStore();
  store.layouts.push({ ...PRESETS.beginner, id: "layout-a", name: "A" });
  store.activeLayoutId = "layout-a";
  check("resolve: a named active layout resolves to that entry", resolveActiveLayout(store).id, "layout-a");
}

{
  const store = defaultLocalStore();
  check("resolve: the current-layout sentinel resolves to currentLayout", resolveActiveLayout(store), store.currentLayout);
}

{
  const store = defaultLocalStore();
  store.layouts.push({ ...PRESETS.beginner, id: "layout-a", name: "A" });
  store.defaultLayoutId = "layout-a";
  store.activeLayoutId = CURRENT_LAYOUT_ID; // active pointer differs from default
  check("initial: a set default layout wins over the active pointer on fresh load", initialWorkspaceLayout(store).id, "layout-a");
}

{
  const store = defaultLocalStore();
  check("initial: with no default set, falls back to resolveActiveLayout", initialWorkspaceLayout(store), resolveActiveLayout(store));
}

// Sanity: the fixtures above actually reference the same shape studio.tsx
// reads (findNodeById against the well-known sidebar node id still works
// after a safeParse round-trip of the real Beginner preset).
{
  const roundTripped = safeParseWorkspaceLayout(JSON.parse(JSON.stringify(PRESETS.beginner)));
  const node = findNodeById(roundTripped.root, WELL_KNOWN_NODE_IDS.rightSidebar);
  ok("sanity: the real Beginner preset survives a JSON + safeParse round-trip intact", node && node.tabs.length === 4);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
