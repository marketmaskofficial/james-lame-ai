// Coverage for Chart Studio drawing persistence + multi-chart isolation:
// src/lib/workspace/drawings.ts. No React, no real browser — a minimal
// in-memory localStorage shim is installed on `globalThis.window` before
// importing the module under test, same pattern as
// test/workspace/persistence.test.mjs.
//
// The regression this specifically guards against: the pre-this-phase
// drawing store was keyed ONLY by "symbol:interval", so two chart instances
// open on the same symbol/timeframe would silently load/save into the SAME
// bucket — moving a drawing on chart 1 could overwrite chart 2's drawings on
// the next save. The fix keys by (chartInstanceId, symbol, interval).
//
// Usage: npx tsx test/workspace/drawingPersistence.test.mjs

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

const { loadDrawingsFor, saveDrawingsFor } = await import("../../src/lib/workspace/drawings.ts");

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

function d(id) {
  return { id, tool: "trend", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 } };
}

// ---- basic round trip -------------------------------------------------

{
  ok("loading with nothing saved yet returns []", loadDrawingsFor("chart-1", "BTCUSDT", "15m").length === 0);
  const mine = [d("a"), d("b")];
  saveDrawingsFor("chart-1", "BTCUSDT", "15m", mine);
  const loaded = loadDrawingsFor("chart-1", "BTCUSDT", "15m");
  ok("round trip: same ids come back", loaded.map((x) => x.id).join(",") === "a,b");
}

// ---- THE regression: two chart instances, same symbol/interval --------

{
  fakeStorage.clear();
  saveDrawingsFor("chart-A", "ETHUSDT", "1h", [d("chartA-drawing")]);
  saveDrawingsFor("chart-B", "ETHUSDT", "1h", [d("chartB-drawing-1"), d("chartB-drawing-2")]);

  const a = loadDrawingsFor("chart-A", "ETHUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "ETHUSDT", "1h");
  ok("same symbol+interval, different chart instances: chart A keeps only its own drawing", a.length === 1 && a[0].id === "chartA-drawing");
  ok("same symbol+interval, different chart instances: chart B keeps only its own drawings", b.length === 2);
  ok(
    "chart B's drawings never leaked into chart A's",
    !a.some((x) => x.id.startsWith("chartB")),
  );

  // Deleting/overwriting chart A's set must not touch chart B's.
  saveDrawingsFor("chart-A", "ETHUSDT", "1h", []);
  ok("clearing chart A leaves it empty", loadDrawingsFor("chart-A", "ETHUSDT", "1h").length === 0);
  ok("clearing chart A did not affect chart B", loadDrawingsFor("chart-B", "ETHUSDT", "1h").length === 2);
}

// ---- symbol/timeframe isolation on the SAME chart instance -------------

{
  fakeStorage.clear();
  saveDrawingsFor("chart-1", "BTCUSDT", "15m", [d("btc-15m")]);
  saveDrawingsFor("chart-1", "BTCUSDT", "1h", [d("btc-1h")]);
  saveDrawingsFor("chart-1", "ETHUSDT", "15m", [d("eth-15m")]);

  ok("BTC 15m drawings are separate from BTC 1h", loadDrawingsFor("chart-1", "BTCUSDT", "15m")[0].id === "btc-15m");
  ok("BTC 1h unaffected by BTC 15m", loadDrawingsFor("chart-1", "BTCUSDT", "1h")[0].id === "btc-1h");
  ok("ETH 15m unaffected by BTC 15m (no cross-symbol corruption)", loadDrawingsFor("chart-1", "ETHUSDT", "15m")[0].id === "eth-15m");
  ok("a symbol/timeframe never saved for this chart returns empty, not another combo's data", loadDrawingsFor("chart-1", "ETHUSDT", "4h").length === 0);
}

// ---- legacy pre-instance-id key is recovered once, non-destructively ---

{
  fakeStorage.clear();
  // Simulate a pre-this-phase save under the OLD "sg.studio.drawings" key,
  // shaped exactly like src/lib/studio-handoff.ts used to write it.
  fakeStorage.setItem("sg.studio.drawings", JSON.stringify({ "SOLUSDT:5m": [d("legacy-drawing")] }));

  const first = loadDrawingsFor("chart-1", "SOLUSDT", "5m");
  ok("legacy key is picked up as a one-time fallback", first.length === 1 && first[0].id === "legacy-drawing");

  // A SECOND chart instance asking for the same symbol/interval must NOT
  // also inherit the legacy set (that would just re-introduce the exact
  // symbol:interval-only collision this phase fixes).
  const second = loadDrawingsFor("chart-2", "SOLUSDT", "5m");
  ok("legacy fallback is claimed once, not shared across instances", second.length === 0);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
