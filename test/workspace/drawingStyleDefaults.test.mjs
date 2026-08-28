// Coverage for Phase 2's per-tool "last used style" memory:
// src/lib/drawing/styleDefaults.ts. No React, no real browser — a minimal
// in-memory localStorage shim, same pattern as
// test/workspace/drawingPersistence.test.mjs.
//
// The guarantee under test: restyling one tool (e.g. Trend Line -> yellow/
// 2px/dashed) is remembered for the NEXT drawing of that SAME tool, but
// never bleeds into an unrelated tool's remembered style (Rectangle's fill
// restyle must never affect Fib, Text, etc.) — scoped strictly per DrawTool
// id, which is finer-grained than "family" and therefore satisfies the
// no-bleed requirement trivially.
//
// Usage: npx tsx test/workspace/drawingStyleDefaults.test.mjs

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

const { getToolStyleDefaults, setToolStyleDefaults, clearAllToolStyleDefaults } = await import(
  "../../src/lib/drawing/styleDefaults.ts"
);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

// ---- basics -------------------------------------------------------------

{
  ok("a tool with no remembered style returns undefined", getToolStyleDefaults("trend") === undefined);

  setToolStyleDefaults("trend", { color: "#ffff00", width: 2, style: "dashed" });
  const trend = getToolStyleDefaults("trend");
  ok("remembers color", trend.color === "#ffff00");
  ok("remembers width", trend.width === 2);
  ok("remembers style", trend.style === "dashed");
}

// ---- no cross-tool bleed --------------------------------------------------

{
  clearAllToolStyleDefaults();
  setToolStyleDefaults("trend", { color: "#ffff00" });
  setToolStyleDefaults("rect", { color: "#00ff00" });
  ok("Trend Line's restyle doesn't affect Rectangle's", getToolStyleDefaults("rect").color === "#00ff00");
  ok("Rectangle's restyle doesn't affect Trend Line's", getToolStyleDefaults("trend").color === "#ffff00");
  ok("an unrelated tool (fib) has no remembered style at all", getToolStyleDefaults("fib") === undefined);
}

// ---- settings bag merges per-key, doesn't clobber siblings -----------------

{
  clearAllToolStyleDefaults();
  setToolStyleDefaults("fib", { settings: { fibShowLabel: false } });
  setToolStyleDefaults("fib", { settings: { fibShowPrice: false } });
  const fib = getToolStyleDefaults("fib");
  ok("first settings key is preserved after a second setSetting call", fib.settings.fibShowLabel === false);
  ok("second settings key is also present", fib.settings.fibShowPrice === false);
}

// ---- patch is a shallow merge onto the existing remembered style -----------

{
  clearAllToolStyleDefaults();
  setToolStyleDefaults("rect", { color: "#111111", width: 3 });
  setToolStyleDefaults("rect", { color: "#222222" }); // only restyles color
  const rect = getToolStyleDefaults("rect");
  ok("updating only color leaves width untouched", rect.width === 3);
  ok("color itself did update", rect.color === "#222222");
}

// ---- clearAllToolStyleDefaults (test-only escape hatch) --------------------

{
  setToolStyleDefaults("trend", { color: "#abcdef" });
  clearAllToolStyleDefaults();
  ok("clearAllToolStyleDefaults wipes every remembered style", getToolStyleDefaults("trend") === undefined);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
