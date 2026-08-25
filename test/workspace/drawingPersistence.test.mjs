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

// ---- Phase 3A: Ellipse/Polyline/Path serialization round-trip -------------
// The regression this specifically guards against: a Polyline/Path's full
// ordered vertex chain silently getting collapsed down to just its p1/p2
// mirror somewhere in the save/load path (this store is a plain JSON
// passthrough — see drawings.ts's module doc — so the real risk is a caller
// constructing the Drawing object wrong, not this store mangling it; these
// tests lock in that a realistic multi-vertex object survives untouched).

{
  fakeStorage.clear();

  const ellipse = {
    id: "e1",
    tool: "ellipse",
    chartInstanceId: "chart-1",
    p1: { time: 100, price: 10 },
    p2: { time: 200, price: 20 },
    color: "#ff00ff",
    width: 2,
    style: "dashed",
    settings: { fillOpacity: 0.3 },
  };

  // A 5-vertex Polyline — deliberately more than the old 2-anchor shape, so
  // a regression that collapses `points` down to [p1, p2] is caught.
  const polylinePoints = [
    { time: 100, price: 10 },
    { time: 110, price: 12 },
    { time: 120, price: 9 },
    { time: 130, price: 15 },
    { time: 140, price: 11 },
  ];
  const polyline = {
    id: "pl1",
    tool: "polyline",
    chartInstanceId: "chart-1",
    p1: polylinePoints[0],
    p2: polylinePoints[polylinePoints.length - 1],
    points: polylinePoints,
    color: "#00ffaa",
    width: 1.5,
  };

  const pathPoints = [
    { time: 300, price: 5 },
    { time: 310, price: 8 },
    { time: 320, price: 3 },
    { time: 330, price: 6 },
  ];
  const path = {
    id: "pa1",
    tool: "path",
    chartInstanceId: "chart-1",
    p1: pathPoints[0],
    p2: pathPoints[pathPoints.length - 1],
    points: pathPoints,
    color: "#ffaa00",
    settings: { fillOpacity: 0.14 },
  };

  saveDrawingsFor("chart-1", "BTCUSDT", "5m", [ellipse, polyline, path]);
  const loaded = loadDrawingsFor("chart-1", "BTCUSDT", "5m");

  ok("Phase 3A round trip: all three drawings come back", loaded.length === 3);

  const loadedEllipse = loaded.find((x) => x.id === "e1");
  ok("Ellipse: p1/p2 (its rx/ry-defining bounding box) survive intact", loadedEllipse.p1.time === 100 && loadedEllipse.p1.price === 10 && loadedEllipse.p2.time === 200 && loadedEllipse.p2.price === 20);
  ok("Ellipse: style/fill settings survive intact", loadedEllipse.style === "dashed" && loadedEllipse.settings.fillOpacity === 0.3);

  const loadedPolyline = loaded.find((x) => x.id === "pl1");
  ok(
    "Polyline: the FULL ordered vertex array survives — NOT collapsed to just p1/p2",
    Array.isArray(loadedPolyline.points) && loadedPolyline.points.length === 5,
  );
  ok(
    "Polyline: every vertex round-trips in the original order with exact time/price",
    loadedPolyline.points.every((p, i) => p.time === polylinePoints[i].time && p.price === polylinePoints[i].price),
  );
  ok("Polyline: p1/p2 stay mirrored to points[0]/points[last]", loadedPolyline.p1.time === polylinePoints[0].time && loadedPolyline.p2.time === polylinePoints[4].time);

  const loadedPath = loaded.find((x) => x.id === "pa1");
  ok(
    "Path: the FULL ordered vertex array survives — same data model as Polyline",
    Array.isArray(loadedPath.points) && loadedPath.points.length === 4,
  );
  ok(
    "Path: every vertex round-trips in the original order",
    loadedPath.points.every((p, i) => p.time === pathPoints[i].time && p.price === pathPoints[i].price),
  );
  ok("Path: fill settings survive intact (its one capability difference from Polyline)", loadedPath.settings.fillOpacity === 0.14);
}

// ---- Phase 3A: chartInstanceId isolation for the three new tools ----------

{
  fakeStorage.clear();
  const chartAPolyline = { id: "a-pl", tool: "polyline", chartInstanceId: "chart-A", p1: { time: 1, price: 1 }, p2: { time: 3, price: 3 }, points: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }] };
  const chartBPath = { id: "b-pa", tool: "path", chartInstanceId: "chart-B", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 }, points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] };

  saveDrawingsFor("chart-A", "SOLUSDT", "1h", [chartAPolyline]);
  saveDrawingsFor("chart-B", "SOLUSDT", "1h", [chartBPath]);

  const a = loadDrawingsFor("chart-A", "SOLUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "SOLUSDT", "1h");
  ok("Ellipse/Polyline/Path respect chartInstanceId isolation like every other tool: chart A only sees its polyline", a.length === 1 && a[0].tool === "polyline");
  ok("chart B only sees its path, not chart A's polyline", b.length === 1 && b[0].tool === "path" && b[0].points.length === 2);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
