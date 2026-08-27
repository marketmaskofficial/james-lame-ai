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

// ---- Phase 3B: Fixed Range / Anchored Volume Profile serialization round-trip
// The regression this specifically guards against: unlike every other tool's
// geometry, a Volume Profile's calculation settings (rows/Value Area %) and
// visual settings live entirely in the same loose `settings` bag every other
// tool already uses — there's no dedicated schema for them. This locks in
// that nothing about that bag (or the start/end/anchor times themselves) gets
// dropped or collapsed on the way through this plain-JSON store, so a reload
// reconstructs and recalculates the identical profile rather than silently
// falling back to defaults.

{
  fakeStorage.clear();

  const vpFixed = {
    id: "vpf1",
    tool: "vp-fixed",
    chartInstanceId: "chart-1",
    p1: { time: 100, price: 9 },
    p2: { time: 500, price: 12 },
    color: "#4da3ff",
    settings: {
      vpRows: 32,
      vpValueAreaPct: 0.8,
      vpWidthPct: 70,
      vpPlacement: "left",
      vpShowHistogram: true,
      vpShowPoc: true,
      vpShowVah: false,
      vpShowVal: true,
      vpPocColor: "#ffcc00",
      vpVahColor: "#22c55e",
      vpValColor: "#ef4444",
      vpLevelLineStyle: "solid",
      fillOpacity: 0.6,
    },
  };

  const vpAnchored = {
    id: "vpa1",
    tool: "vp-anchored",
    chartInstanceId: "chart-1",
    p1: { time: 300, price: 11 },
    p2: { time: 300, price: 11 },
    color: "#4da3ff",
    settings: { vpRows: 48, vpValueAreaPct: 0.68 },
  };

  saveDrawingsFor("chart-1", "BTCUSDT", "5m", [vpFixed, vpAnchored]);
  const loaded = loadDrawingsFor("chart-1", "BTCUSDT", "5m");

  ok("Phase 3B round trip: both Volume Profile drawings come back", loaded.length === 2);

  const loadedFixed = loaded.find((x) => x.id === "vpf1");
  ok(
    "Fixed Range: start/end times (its actual range — never just screen coordinates) survive intact",
    loadedFixed.p1.time === 100 && loadedFixed.p2.time === 500,
  );
  ok(
    "Fixed Range: every calculation setting (rows/Value Area %) survives intact",
    loadedFixed.settings.vpRows === 32 && loadedFixed.settings.vpValueAreaPct === 0.8,
  );
  ok(
    "Fixed Range: every visual setting (placement/POC-VAH-VAL visibility+colors/line style/opacity) survives intact",
    loadedFixed.settings.vpPlacement === "left" &&
      loadedFixed.settings.vpShowVah === false &&
      loadedFixed.settings.vpPocColor === "#ffcc00" &&
      loadedFixed.settings.vpLevelLineStyle === "solid" &&
      loadedFixed.settings.fillOpacity === 0.6,
  );

  const loadedAnchored = loaded.find((x) => x.id === "vpa1");
  ok(
    "Anchored: the anchor time (p1) survives intact — the ONE thing this tool's range is derived from",
    loadedAnchored.p1.time === 300 && loadedAnchored.p2.time === 300,
  );
  ok(
    "Anchored: its own calculation settings survive intact and independently of Fixed Range's",
    loadedAnchored.settings.vpRows === 48 && loadedAnchored.settings.vpValueAreaPct === 0.68,
  );
}

// ---- Phase 3B: chartInstanceId isolation for the two new tools -------------
// Volume Profile depends on chart-specific BAR data, not just anchor
// coordinates, so a caching/isolation bug here would be a correctness bug
// (chart 2 silently computing off chart 1's data), not just a visual one —
// checked here at the persistence layer the same way every other tool's
// isolation already is.

{
  fakeStorage.clear();
  const chartAFixed = { id: "a-vpf", tool: "vp-fixed", chartInstanceId: "chart-A", p1: { time: 100, price: 9 }, p2: { time: 500, price: 12 } };
  const chartBAnchored = { id: "b-vpa", tool: "vp-anchored", chartInstanceId: "chart-B", p1: { time: 300, price: 11 }, p2: { time: 300, price: 11 } };

  saveDrawingsFor("chart-A", "SOLUSDT", "1h", [chartAFixed]);
  saveDrawingsFor("chart-B", "SOLUSDT", "1h", [chartBAnchored]);

  const a = loadDrawingsFor("chart-A", "SOLUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "SOLUSDT", "1h");
  ok("Fixed Range/Anchored Volume Profile respect chartInstanceId isolation: chart A only sees its Fixed Range profile", a.length === 1 && a[0].tool === "vp-fixed");
  ok("chart B only sees its Anchored profile, not chart A's Fixed Range profile", b.length === 1 && b[0].tool === "vp-anchored");
}

// ---- Phase 3C: Trend-Based Fib Extension / Channel / Wedge round-trip -----
// The regression this specifically guards against: a 3-anchor Fib tool's
// THIRD anchor (C for Extension, the width anchor for Channel, B/C for
// Wedge) silently getting dropped or collapsed into a generic 2-anchor
// p1/p2 shape somewhere in the save/load path — exactly the same class of
// regression Phase 3A's Polyline/Path tests guard against for `points`, and
// Phase 1/2's Channel/Triangle already rely on `points[0]` surviving intact.

{
  fakeStorage.clear();

  const fibExt = {
    id: "fx1",
    tool: "fib-ext",
    chartInstanceId: "chart-1",
    p1: { time: 100, price: 10 }, // A
    p2: { time: 200, price: 20 }, // B
    points: [{ time: 300, price: 15 }], // C
    color: "#e6b800",
    width: 1,
    settings: {
      extendRight: true,
      fibShowLabel: true,
      fibShowPrice: false,
      fibLevels: [
        { value: 0, enabled: true },
        { value: 1, enabled: true, color: "#22c55e" },
        { value: 1.618, enabled: false },
      ],
    },
  };

  const fibChannel = {
    id: "fc1",
    tool: "fib-channel",
    chartInstanceId: "chart-1",
    p1: { time: 100, price: 10 },
    p2: { time: 200, price: 20 },
    points: [{ time: 150, price: 25 }], // width anchor
    color: "#e6b800",
    settings: { fillOpacity: 0.12, fibLevels: [{ value: 0, enabled: true }, { value: 1.618, enabled: true }] },
  };

  const fibWedge = {
    id: "fw1",
    tool: "fib-wedge",
    chartInstanceId: "chart-1",
    p1: { time: 50, price: 5 }, // pivot
    p2: { time: 100, price: 10 }, // B
    points: [{ time: 150, price: 8 }], // C
    color: "#e6b800",
    settings: { fillOpacity: 0.1 },
  };

  saveDrawingsFor("chart-1", "BTCUSDT", "5m", [fibExt, fibChannel, fibWedge]);
  const loaded = loadDrawingsFor("chart-1", "BTCUSDT", "5m");

  ok("Phase 3C round trip: all three new Fib drawings come back", loaded.length === 3);

  const loadedExt = loaded.find((x) => x.id === "fx1");
  ok("Fib Extension: A/B (p1/p2) survive intact", loadedExt.p1.price === 10 && loadedExt.p2.price === 20);
  ok(
    "Fib Extension: the THIRD anchor (C) survives in `points`, not collapsed away",
    Array.isArray(loadedExt.points) && loadedExt.points.length === 1 && loadedExt.points[0].price === 15,
  );
  ok(
    "Fib Extension: level set (enable/disable/custom color) survives intact",
    loadedExt.settings.fibLevels.length === 3 &&
      loadedExt.settings.fibLevels.find((l) => l.value === 1).color === "#22c55e" &&
      loadedExt.settings.fibLevels.find((l) => l.value === 1.618).enabled === false,
  );
  ok("Fib Extension: extendRight/label/price settings survive intact", loadedExt.settings.extendRight === true && loadedExt.settings.fibShowPrice === false);

  const loadedChannel = loaded.find((x) => x.id === "fc1");
  ok("Fib Channel: trend anchors (p1/p2) survive intact", loadedChannel.p1.time === 100 && loadedChannel.p2.time === 200);
  ok(
    "Fib Channel: the width anchor (3rd point) survives in `points`, not collapsed away",
    Array.isArray(loadedChannel.points) && loadedChannel.points[0].price === 25,
  );
  ok("Fib Channel: fill opacity + level set survive intact", loadedChannel.settings.fillOpacity === 0.12 && loadedChannel.settings.fibLevels.length === 2);

  const loadedWedge = loaded.find((x) => x.id === "fw1");
  ok("Fib Wedge: pivot (p1) survives intact", loadedWedge.p1.price === 5);
  ok("Fib Wedge: B (p2) survives intact", loadedWedge.p2.price === 10);
  ok(
    "Fib Wedge: C (3rd point) survives in `points`, not collapsed to a 2-anchor shape",
    Array.isArray(loadedWedge.points) && loadedWedge.points[0].price === 8,
  );
}

// ---- Phase 3C: chartInstanceId isolation for the three new tools -----------

{
  fakeStorage.clear();
  const chartAExt = { id: "a-fx", tool: "fib-ext", chartInstanceId: "chart-A", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 }, points: [{ time: 3, price: 3 }] };
  const chartBWedge = { id: "b-fw", tool: "fib-wedge", chartInstanceId: "chart-B", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 }, points: [{ time: 3, price: 1.5 }] };

  saveDrawingsFor("chart-A", "SOLUSDT", "1h", [chartAExt]);
  saveDrawingsFor("chart-B", "SOLUSDT", "1h", [chartBWedge]);

  const a = loadDrawingsFor("chart-A", "SOLUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "SOLUSDT", "1h");
  ok("Fib Extension/Channel/Wedge respect chartInstanceId isolation: chart A only sees its extension", a.length === 1 && a[0].tool === "fib-ext");
  ok("chart B only sees its wedge, not chart A's extension", b.length === 1 && b[0].tool === "fib-wedge" && b[0].points[0].price === 1.5);
}

// ---- Phase 3C-2: Fib Time Zone / Fib Speed Resistance Fan round-trip ------
// Both are plain 2-anchor tools (no third `points` anchor) — the regression
// this guards against is their tool-specific `settings.fibLevels` (a real
// Fibonacci-sequence set for Time Zone, a ratio set for Speed Fan) silently
// getting dropped or coerced into the wrong shape somewhere in the save/load
// path.

{
  fakeStorage.clear();

  const fibTime = {
    id: "ft1",
    tool: "fib-time",
    chartInstanceId: "chart-1",
    p1: { time: 100, price: 10 }, // start
    p2: { time: 200, price: 20 }, // establishes the base interval
    color: "#e6b800",
    settings: {
      fibShowLabel: true,
      fibLevels: [
        { value: 0, enabled: true },
        { value: 1, enabled: true, color: "#22c55e" },
        { value: 3, enabled: false },
        { value: 5, enabled: true },
      ],
    },
  };

  const fibSpeedFan = {
    id: "fs1",
    tool: "fib-speed-fan",
    chartInstanceId: "chart-1",
    p1: { time: 50, price: 5 }, // ray origin
    p2: { time: 150, price: 15 }, // measured move
    color: "#4da3ff",
    settings: {
      fibShowLabel: true,
      fibShowPrice: true,
      fibLevels: [{ value: 0.382, enabled: true }, { value: 0.618, enabled: true, color: "#ef4444" }, { value: 1, enabled: false }],
    },
  };

  saveDrawingsFor("chart-1", "ETHUSDT", "15m", [fibTime, fibSpeedFan]);
  const loaded = loadDrawingsFor("chart-1", "ETHUSDT", "15m");

  ok("Phase 3C-2 round trip: both new Fib drawings come back", loaded.length === 2);

  const loadedTime = loaded.find((x) => x.id === "ft1");
  ok("Fib Time Zone: start/interval anchors (p1/p2) survive intact", loadedTime.p1.time === 100 && loadedTime.p2.time === 200);
  ok(
    "Fib Time Zone: the Fibonacci-SEQUENCE level set (enable/disable/custom color) survives intact",
    loadedTime.settings.fibLevels.length === 4 &&
      loadedTime.settings.fibLevels.find((l) => l.value === 1).color === "#22c55e" &&
      loadedTime.settings.fibLevels.find((l) => l.value === 3).enabled === false &&
      loadedTime.settings.fibLevels.some((l) => l.value === 5),
  );

  const loadedFan = loaded.find((x) => x.id === "fs1");
  ok("Fib Speed Resistance Fan: origin/move anchors (p1/p2) survive intact", loadedFan.p1.price === 5 && loadedFan.p2.price === 15);
  ok(
    "Fib Speed Resistance Fan: ratio level set survives intact",
    loadedFan.settings.fibLevels.length === 3 &&
      loadedFan.settings.fibLevels.find((l) => l.value === 0.618).color === "#ef4444" &&
      loadedFan.settings.fibLevels.find((l) => l.value === 1).enabled === false,
  );
}

// ---- Phase 3C-2: chartInstanceId isolation for the two new tools ----------

{
  fakeStorage.clear();
  const chartATime = { id: "a-ft", tool: "fib-time", chartInstanceId: "chart-A", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 } };
  const chartBFan = { id: "b-fs", tool: "fib-speed-fan", chartInstanceId: "chart-B", p1: { time: 1, price: 1 }, p2: { time: 2, price: 2.5 } };

  saveDrawingsFor("chart-A", "DOGEUSDT", "1h", [chartATime]);
  saveDrawingsFor("chart-B", "DOGEUSDT", "1h", [chartBFan]);

  const a = loadDrawingsFor("chart-A", "DOGEUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "DOGEUSDT", "1h");
  ok("Fib Time Zone/Speed Fan respect chartInstanceId isolation: chart A only sees its time zone", a.length === 1 && a[0].tool === "fib-time");
  ok("chart B only sees its speed fan, not chart A's time zone", b.length === 1 && b[0].tool === "fib-speed-fan" && b[0].p2.price === 2.5);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
