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

// ---- Phase 3C-3: Trend-Based Fib Time / Pitchfan round-trip ----------------
// Both are 3-anchor tools (like Fib Extension/Channel/Wedge above) — the
// regression this guards against is the same one: the third anchor
// (`points[0]`) silently collapsing away, or the tool-specific level set
// getting dropped/coerced somewhere in the save/load path.

{
  fakeStorage.clear();

  const fibTimeTrend = {
    id: "ftt1",
    tool: "fib-time-trend",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 10 }, // A — start of the measured trend interval
    p2: { time: 1000, price: 20 }, // B — end of the measured trend interval
    points: [{ time: 5000, price: 30 }], // C — the projection anchor
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

  const pitchfan = {
    id: "pf1",
    tool: "pitchfan",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 }, // pivot
    p2: { time: 500, price: 150 }, // B
    points: [{ time: 500, price: 250 }], // C
    color: "#4da3ff",
    settings: {
      fibShowLabel: true,
      fibShowPrice: true,
      fibLevels: [{ value: 0.382, enabled: true }, { value: 0.618, enabled: true, color: "#ef4444" }, { value: 1.618, enabled: false }],
    },
  };

  saveDrawingsFor("chart-1", "BNBUSDT", "15m", [fibTimeTrend, pitchfan]);
  const loaded = loadDrawingsFor("chart-1", "BNBUSDT", "15m");

  ok("Phase 3C-3 round trip: both new Fib drawings come back", loaded.length === 2);

  const loadedTimeTrend = loaded.find((x) => x.id === "ftt1");
  ok("Trend-Based Fib Time: A/B trend anchors (p1/p2) survive intact", loadedTimeTrend.p1.time === 0 && loadedTimeTrend.p2.time === 1000);
  ok(
    "Trend-Based Fib Time: the THIRD anchor (C, the projection origin) survives in `points`, not collapsed away",
    Array.isArray(loadedTimeTrend.points) && loadedTimeTrend.points.length === 1 && loadedTimeTrend.points[0].time === 5000,
  );
  ok(
    "Trend-Based Fib Time: the Fibonacci-SEQUENCE level set survives intact",
    loadedTimeTrend.settings.fibLevels.length === 4 &&
      loadedTimeTrend.settings.fibLevels.find((l) => l.value === 1).color === "#22c55e" &&
      loadedTimeTrend.settings.fibLevels.find((l) => l.value === 3).enabled === false,
  );

  const loadedPitchfan = loaded.find((x) => x.id === "pf1");
  ok("Pitchfan: pivot (p1) survives intact", loadedPitchfan.p1.price === 100);
  ok("Pitchfan: B (p2) survives intact", loadedPitchfan.p2.price === 150);
  ok(
    "Pitchfan: C (3rd point) survives in `points`, not collapsed to a 2-anchor shape",
    Array.isArray(loadedPitchfan.points) && loadedPitchfan.points[0].price === 250,
  );
  ok(
    "Pitchfan: ratio level set survives intact",
    loadedPitchfan.settings.fibLevels.length === 3 && loadedPitchfan.settings.fibLevels.find((l) => l.value === 0.618).color === "#ef4444",
  );
}

// ---- Phase 3C-3: chartInstanceId isolation for the two new tools -----------

{
  fakeStorage.clear();
  const chartATimeTrend = {
    id: "a-ftt",
    tool: "fib-time-trend",
    chartInstanceId: "chart-A",
    p1: { time: 0, price: 1 },
    p2: { time: 100, price: 2 },
    points: [{ time: 500, price: 3 }],
  };
  const chartBPitchfan = {
    id: "b-pf",
    tool: "pitchfan",
    chartInstanceId: "chart-B",
    p1: { time: 0, price: 1 },
    p2: { time: 100, price: 2 },
    points: [{ time: 100, price: 2.5 }],
  };

  saveDrawingsFor("chart-A", "XRPUSDT", "1h", [chartATimeTrend]);
  saveDrawingsFor("chart-B", "XRPUSDT", "1h", [chartBPitchfan]);

  const a = loadDrawingsFor("chart-A", "XRPUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "XRPUSDT", "1h");
  ok("Trend-Based Fib Time/Pitchfan respect chartInstanceId isolation: chart A only sees its time projection", a.length === 1 && a[0].tool === "fib-time-trend");
  ok("chart B only sees its pitchfan, not chart A's time projection", b.length === 1 && b[0].tool === "pitchfan" && b[0].points[0].price === 2.5);
}

// ---- Phase 3C-4: Fib Circles / Fib Speed Resistance Arcs / Fib Spiral -----
// All three are plain 2-anchor drag tools (like Fib Time Zone/Speed Fan
// above) — the regression this guards against is the same: the per-level
// ring/arc style set (Circles/Arcs) or the bare 2-anchor shape (Spiral,
// which carries no `fibLevels` at all) getting dropped/coerced on save/load.

{
  fakeStorage.clear();

  const fibCircles = {
    id: "fc1",
    tool: "fib-circles",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 500, price: 150 },
    color: "#e6b800",
    settings: {
      fibShowLabel: true,
      fibLevels: [{ value: 0.382, enabled: true }, { value: 0.618, enabled: true, color: "#22c55e" }, { value: 1.618, enabled: false }],
    },
  };

  const fibSpeedArcs = {
    id: "fa1",
    tool: "fib-speed-arcs",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 500, price: 50 },
    color: "#4da3ff",
    settings: {
      fibShowPrice: true,
      fibLevels: [{ value: 0.5, enabled: true }, { value: 1, enabled: true, color: "#ef4444" }],
    },
  };

  const fibSpiral = {
    id: "fsp1",
    tool: "fib-spiral",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 200, price: 120 },
    color: "#a855f7",
  };

  saveDrawingsFor("chart-1", "ADAUSDT", "5m", [fibCircles, fibSpeedArcs, fibSpiral]);
  const loaded = loadDrawingsFor("chart-1", "ADAUSDT", "5m");

  ok("Phase 3C-4 round trip: all three new Fib drawings come back", loaded.length === 3);

  const loadedCircles = loaded.find((x) => x.id === "fc1");
  ok("Fib Circles: p1/p2 anchors survive intact", loadedCircles.p1.price === 100 && loadedCircles.p2.price === 150);
  ok(
    "Fib Circles: the ring level set (with per-level enable/color) survives intact",
    loadedCircles.settings.fibLevels.length === 3 &&
      loadedCircles.settings.fibLevels.find((l) => l.value === 0.618).color === "#22c55e" &&
      loadedCircles.settings.fibLevels.find((l) => l.value === 1.618).enabled === false,
  );

  const loadedArcs = loaded.find((x) => x.id === "fa1");
  ok("Fib Speed Resistance Arcs: p1/p2 anchors survive intact", loadedArcs.p1.price === 100 && loadedArcs.p2.price === 50);
  ok(
    "Fib Speed Resistance Arcs: the arc level set survives intact",
    loadedArcs.settings.fibLevels.length === 2 && loadedArcs.settings.fibLevels.find((l) => l.value === 1).color === "#ef4444",
  );

  const loadedSpiral = loaded.find((x) => x.id === "fsp1");
  ok("Fib Spiral: p1/p2 anchors survive intact (no levels to carry)", loadedSpiral.p1.time === 0 && loadedSpiral.p2.time === 200);
}

// ---- Phase 3C-4: chartInstanceId isolation for the three new tools --------

{
  fakeStorage.clear();
  const chartACircles = { id: "a-fc", tool: "fib-circles", chartInstanceId: "chart-A", p1: { time: 0, price: 1 }, p2: { time: 100, price: 2 } };
  const chartBSpiral = { id: "b-fsp", tool: "fib-spiral", chartInstanceId: "chart-B", p1: { time: 0, price: 1 }, p2: { time: 100, price: 2.5 } };

  saveDrawingsFor("chart-A", "SOLUSDT", "1h", [chartACircles]);
  saveDrawingsFor("chart-B", "SOLUSDT", "1h", [chartBSpiral]);

  const a = loadDrawingsFor("chart-A", "SOLUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "SOLUSDT", "1h");
  ok("Fib Circles/Spiral respect chartInstanceId isolation: chart A only sees its circles", a.length === 1 && a[0].tool === "fib-circles");
  ok("chart B only sees its spiral, not chart A's circles", b.length === 1 && b[0].tool === "fib-spiral" && b[0].p2.price === 2.5);
}

// ---- Phase 3D-1: chart-pattern tools' round trip --------------------------
// All six share ONE storage convention (full ordered anchor array in
// `points`, p1/p2 mirrored to first/last — Polyline/Path's own convention,
// see StudioChart.tsx's anchorsOf) — the regression this guards against is
// the same as every prior multi-anchor phase: an anchor silently dropped or
// reordered on save/load, or the `showAnchorLabel` setting getting coerced.

{
  fakeStorage.clear();

  const xabcd = {
    id: "xa1",
    tool: "xabcd",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 }, // X
    p2: { time: 400, price: 40 }, // D (mirror of points[last])
    points: [
      { time: 0, price: 100 }, // X
      { time: 100, price: 20 }, // A
      { time: 200, price: 60 }, // B
      { time: 300, price: 10 }, // C
      { time: 400, price: 40 }, // D
    ],
    color: "#e6b800",
    settings: { showAnchorLabel: true },
  };

  const headShoulders = {
    id: "hs1",
    tool: "head-shoulders",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 50 },
    p2: { time: 450, price: 45 },
    points: [
      { time: 0, price: 50 }, // LS
      { time: 100, price: 80 }, // H
      { time: 200, price: 55 }, // RS
      { time: 250, price: 40 }, // N1
      { time: 450, price: 45 }, // N2
    ],
    color: "#4da3ff",
    settings: { showAnchorLabel: false },
  };

  const abcd = {
    id: "ab1",
    tool: "abcd",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 10 },
    p2: { time: 300, price: 25 },
    points: [
      { time: 0, price: 10 },
      { time: 100, price: 30 },
      { time: 200, price: 15 },
      { time: 300, price: 25 },
    ],
    color: "#a855f7",
  };

  saveDrawingsFor("chart-1", "ETHUSDT", "1h", [xabcd, headShoulders, abcd]);
  const loaded = loadDrawingsFor("chart-1", "ETHUSDT", "1h");

  ok("Phase 3D-1 round trip: all three pattern drawings come back", loaded.length === 3);

  const loadedXabcd = loaded.find((x) => x.id === "xa1");
  ok(
    "XABCD: all FIVE anchors (X/A/B/C/D) survive intact, in order, none dropped",
    Array.isArray(loadedXabcd.points) &&
      loadedXabcd.points.length === 5 &&
      loadedXabcd.points[0].price === 100 &&
      loadedXabcd.points[2].price === 60 &&
      loadedXabcd.points[4].price === 40,
  );
  ok("XABCD: p1/p2 mirror the first/last anchor", loadedXabcd.p1.price === 100 && loadedXabcd.p2.price === 40);
  ok("XABCD: showAnchorLabel setting survives intact", loadedXabcd.settings.showAnchorLabel === true);

  const loadedHS = loaded.find((x) => x.id === "hs1");
  ok(
    "Head and Shoulders: all FIVE anchors (LS/H/RS/N1/N2) survive intact, in order",
    Array.isArray(loadedHS.points) &&
      loadedHS.points.length === 5 &&
      loadedHS.points[1].price === 80 &&
      loadedHS.points[3].price === 40 &&
      loadedHS.points[4].price === 45,
  );
  ok("Head and Shoulders: showAnchorLabel:false survives intact (not coerced to true)", loadedHS.settings.showAnchorLabel === false);

  const loadedAbcd = loaded.find((x) => x.id === "ab1");
  ok(
    "ABCD: all FOUR anchors survive intact, in order",
    Array.isArray(loadedAbcd.points) && loadedAbcd.points.length === 4 && loadedAbcd.points[1].price === 30 && loadedAbcd.points[3].price === 25,
  );
}

// ---- Phase 3D-1: chartInstanceId isolation for the pattern tools ----------

{
  fakeStorage.clear();
  const chartACypher = {
    id: "a-cy",
    tool: "cypher",
    chartInstanceId: "chart-A",
    p1: { time: 0, price: 1 },
    p2: { time: 400, price: 5 },
    points: [
      { time: 0, price: 1 },
      { time: 100, price: 4 },
      { time: 200, price: 2 },
      { time: 300, price: 6 },
      { time: 400, price: 5 },
    ],
  };
  const chartBThreeDrives = {
    id: "b-td",
    tool: "three-drives",
    chartInstanceId: "chart-B",
    p1: { time: 0, price: 1 },
    p2: { time: 500, price: 9 },
    points: [
      { time: 0, price: 1 },
      { time: 100, price: 8 },
      { time: 200, price: 2 },
      { time: 300, price: 9 },
      { time: 400, price: 3 },
      { time: 500, price: 9 },
    ],
  };

  saveDrawingsFor("chart-A", "LTCUSDT", "15m", [chartACypher]);
  saveDrawingsFor("chart-B", "LTCUSDT", "15m", [chartBThreeDrives]);

  const a = loadDrawingsFor("chart-A", "LTCUSDT", "15m");
  const b = loadDrawingsFor("chart-B", "LTCUSDT", "15m");
  ok("Cypher/Three Drives respect chartInstanceId isolation: chart A only sees its cypher", a.length === 1 && a[0].tool === "cypher");
  ok(
    "chart B only sees its three-drives (all 6 anchors intact), not chart A's cypher",
    b.length === 1 && b[0].tool === "three-drives" && b[0].points.length === 6 && b[0].points[3].price === 9,
  );
}

// ---- Phase 3D-2: Elliott Wave tools' round trip ---------------------------
// Same storage convention as every Phase 3D-1 pattern tool (full ordered
// anchor array in `points`) — the regression this specifically guards
// against is Triple Combo's repeated "X" wave: since anchor identity here
// is the ARRAY INDEX, not the label text, both "X" anchors (index 2 and 4)
// must survive save/load as two independent points at their own
// coordinates, never merged/deduped into one.

{
  fakeStorage.clear();

  const impulse = {
    id: "ei1",
    tool: "elliott-impulse",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 0 }, // wave 0
    p2: { time: 500, price: 80 }, // wave 5
    points: [
      { time: 0, price: 0 }, // 0
      { time: 100, price: 30 }, // 1
      { time: 150, price: 15 }, // 2
      { time: 300, price: 60 }, // 3
      { time: 350, price: 40 }, // 4
      { time: 500, price: 80 }, // 5
    ],
    color: "#e6b800",
  };

  const tripleCombo = {
    id: "tc1",
    tool: "elliott-triple-combo",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 0 }, // wave 0
    p2: { time: 500, price: 30 }, // wave Z
    points: [
      { time: 0, price: 0 }, // 0
      { time: 100, price: 40 }, // W
      { time: 200, price: 10 }, // X (first)
      { time: 300, price: 50 }, // Y
      { time: 400, price: 15 }, // X (second — SAME label, DIFFERENT coordinates)
      { time: 500, price: 30 }, // Z
    ],
    color: "#4da3ff",
    settings: { showAnchorLabel: true },
  };

  saveDrawingsFor("chart-1", "AVAXUSDT", "30m", [impulse, tripleCombo]);
  const loaded = loadDrawingsFor("chart-1", "AVAXUSDT", "30m");

  ok("Phase 3D-2 round trip: both Elliott drawings come back", loaded.length === 2);

  const loadedImpulse = loaded.find((x) => x.id === "ei1");
  ok(
    "Elliott Impulse: all SIX anchors (0/1/2/3/4/5) survive intact, in order",
    Array.isArray(loadedImpulse.points) &&
      loadedImpulse.points.length === 6 &&
      loadedImpulse.points[1].price === 30 &&
      loadedImpulse.points[3].price === 60 &&
      loadedImpulse.points[5].price === 80,
  );

  const loadedTriple = loaded.find((x) => x.id === "tc1");
  ok(
    "Elliott Triple Combo: all SIX anchors survive intact, in order, none merged",
    Array.isArray(loadedTriple.points) && loadedTriple.points.length === 6,
  );
  ok(
    "Elliott Triple Combo: the FIRST 'X' anchor (index 2) keeps its own coordinates",
    loadedTriple.points[2].time === 200 && loadedTriple.points[2].price === 10,
  );
  ok(
    "Elliott Triple Combo: the SECOND 'X' anchor (index 4) keeps its own, DIFFERENT coordinates — repeated label never collapses the two points into one",
    loadedTriple.points[4].time === 400 && loadedTriple.points[4].price === 15,
  );
  ok(
    "Elliott Triple Combo: the two 'X' anchors remain distinct after round-trip",
    loadedTriple.points[2].time !== loadedTriple.points[4].time && loadedTriple.points[2].price !== loadedTriple.points[4].price,
  );
}

// ---- Phase 3D-2: chartInstanceId isolation for the Elliott tools ----------

{
  fakeStorage.clear();
  const chartACorrection = {
    id: "a-ec",
    tool: "elliott-correction",
    chartInstanceId: "chart-A",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 4 },
    points: [
      { time: 0, price: 1 },
      { time: 100, price: 5 },
      { time: 200, price: 2 },
      { time: 300, price: 4 },
    ],
  };
  const chartBDoubleCombo = {
    id: "b-edc",
    tool: "elliott-double-combo",
    chartInstanceId: "chart-B",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 6 },
    points: [
      { time: 0, price: 1 },
      { time: 100, price: 7 },
      { time: 200, price: 3 },
      { time: 300, price: 6 },
    ],
  };

  saveDrawingsFor("chart-A", "DOTUSDT", "1h", [chartACorrection]);
  saveDrawingsFor("chart-B", "DOTUSDT", "1h", [chartBDoubleCombo]);

  const a = loadDrawingsFor("chart-A", "DOTUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "DOTUSDT", "1h");
  ok("Elliott Correction/Double Combo respect chartInstanceId isolation: chart A only sees its correction", a.length === 1 && a[0].tool === "elliott-correction");
  ok(
    "chart B only sees its double combo (all 4 anchors intact), not chart A's correction",
    b.length === 1 && b[0].tool === "elliott-double-combo" && b[0].points.length === 4 && b[0].points[1].price === 7,
  );
}

// ---- Phase 3D-3: Cycles tools' round trip ----------------------------------
// All three are plain p1/p2 tools (no `points` array) — the regression this
// guards against: canonical state must stay the two DEFINING anchors only
// (never a persisted list of every generated repeat line/curve sample),
// since StudioChart.tsx regenerates every repeat/sample fresh from p1/p2 on
// every render (see cyclicLineTimes/timeCyclesTimes/sineLinePoints).

{
  fakeStorage.clear();

  const cyclicLines = {
    id: "cl1",
    tool: "cyclic-lines",
    chartInstanceId: "chart-1",
    p1: { time: 1000, price: 50 },
    p2: { time: 1200, price: 60 },
    color: "#e6b800",
  };

  const timeCycles = {
    id: "tcy1",
    tool: "time-cycles",
    chartInstanceId: "chart-1",
    p1: { time: 2000, price: 30 },
    p2: { time: 2300, price: 45 },
    color: "#4da3ff",
  };

  const sineLine = {
    id: "sl1",
    tool: "sine-line",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 500, price: 200 },
    color: "#a855f7",
  };

  saveDrawingsFor("chart-1", "MATICUSDT", "5m", [cyclicLines, timeCycles, sineLine]);
  const loaded = loadDrawingsFor("chart-1", "MATICUSDT", "5m");

  ok("Phase 3D-3 round trip: all three Cycles drawings come back", loaded.length === 3);

  const loadedCyclic = loaded.find((x) => x.id === "cl1");
  ok(
    "Cyclic Lines: p1/p2 (the only two defining anchors) survive intact — canonical state is the interval, not persisted repeat lines",
    loadedCyclic.p1.time === 1000 && loadedCyclic.p2.time === 1200,
  );
  ok("Cyclic Lines: no stray `points` array of generated repeats was persisted", loadedCyclic.points === undefined);

  const loadedTimeCycles = loaded.find((x) => x.id === "tcy1");
  ok("Time Cycles: p1/p2 survive intact", loadedTimeCycles.p1.time === 2000 && loadedTimeCycles.p2.time === 2300);
  ok("Time Cycles: no stray `points` array of generated repeats was persisted", loadedTimeCycles.points === undefined);

  const loadedSine = loaded.find((x) => x.id === "sl1");
  ok("Sine Line: p1 (trough)/p2 (peak) survive intact", loadedSine.p1.price === 100 && loadedSine.p2.price === 200);
  ok("Sine Line: no stray sampled-curve `points` array was persisted", loadedSine.points === undefined);
}

// ---- Phase 3D-3: chartInstanceId isolation for the Cycles tools -----------

{
  fakeStorage.clear();
  const chartATimeCycles = {
    id: "a-tcy",
    tool: "time-cycles",
    chartInstanceId: "chart-A",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 2 },
  };
  const chartBSine = {
    id: "b-sl",
    tool: "sine-line",
    chartInstanceId: "chart-B",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 5 },
  };

  saveDrawingsFor("chart-A", "LINKUSDT", "1h", [chartATimeCycles]);
  saveDrawingsFor("chart-B", "LINKUSDT", "1h", [chartBSine]);

  const a = loadDrawingsFor("chart-A", "LINKUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "LINKUSDT", "1h");
  ok("Time Cycles/Sine Line respect chartInstanceId isolation: chart A only sees its time cycles", a.length === 1 && a[0].tool === "time-cycles");
  ok("chart B only sees its sine line, not chart A's time cycles", b.length === 1 && b[0].tool === "sine-line" && b[0].p2.price === 5);
}

// ---- Phase 3D-4: Gann tools' round trip ------------------------------------
// All four are plain p1/p2 tools (Box/Square Fixed/Square share a grid
// generated fresh from p1/p2; Fan carries an additional `fibLevels` set
// like every other fan tool) — canonical state is only ever the two
// anchors (+ level set for Fan), never a persisted grid/ray list.

{
  fakeStorage.clear();

  const gannBox = {
    id: "gb1",
    tool: "gann-box",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 500, price: 150 },
    color: "#e6b800",
  };

  const gannSquareFixed = {
    id: "gsf1",
    tool: "gann-square-fixed",
    chartInstanceId: "chart-1",
    p1: { time: 1000, price: 50 },
    p2: { time: 1300, price: 65 },
    color: "#4da3ff",
  };

  const gannFan = {
    id: "gf1",
    tool: "gann-fan",
    chartInstanceId: "chart-1",
    p1: { time: 0, price: 100 },
    p2: { time: 500, price: 200 },
    color: "#a855f7",
    settings: {
      fibShowLabel: true,
      fibLevels: [{ value: 1, enabled: true }, { value: 2, enabled: true, color: "#22c55e" }, { value: 0.125, enabled: false }],
    },
  };

  saveDrawingsFor("chart-1", "BCHUSDT", "1h", [gannBox, gannSquareFixed, gannFan]);
  const loaded = loadDrawingsFor("chart-1", "BCHUSDT", "1h");

  ok("Phase 3D-4 round trip: all three Gann drawings come back", loaded.length === 3);

  const loadedBox = loaded.find((x) => x.id === "gb1");
  ok("Gann Box: p1/p2 survive intact — canonical state is the two anchors, not a persisted grid", loadedBox.p1.price === 100 && loadedBox.p2.price === 150);
  ok("Gann Box: no stray grid-line `points` array was persisted", loadedBox.points === undefined);

  const loadedSquareFixed = loaded.find((x) => x.id === "gsf1");
  ok("Gann Square Fixed: p1/p2 (anchor + computed corner) survive intact", loadedSquareFixed.p1.time === 1000 && loadedSquareFixed.p2.time === 1300);

  const loadedFan = loaded.find((x) => x.id === "gf1");
  ok("Gann Fan: p1/p2 survive intact", loadedFan.p1.price === 100 && loadedFan.p2.price === 200);
  ok(
    "Gann Fan: the per-ray level set (enable/color/custom-value) survives intact",
    loadedFan.settings.fibLevels.length === 3 &&
      loadedFan.settings.fibLevels.find((l) => l.value === 2).color === "#22c55e" &&
      loadedFan.settings.fibLevels.find((l) => l.value === 0.125).enabled === false,
  );
}

// ---- Phase 3D-4: chartInstanceId isolation for the Gann tools -------------

{
  fakeStorage.clear();
  const chartAGannSquare = {
    id: "a-gs",
    tool: "gann-square",
    chartInstanceId: "chart-A",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 2 },
  };
  const chartBGannFan = {
    id: "b-gf",
    tool: "gann-fan",
    chartInstanceId: "chart-B",
    p1: { time: 0, price: 1 },
    p2: { time: 300, price: 6 },
  };

  saveDrawingsFor("chart-A", "ATOMUSDT", "1h", [chartAGannSquare]);
  saveDrawingsFor("chart-B", "ATOMUSDT", "1h", [chartBGannFan]);

  const a = loadDrawingsFor("chart-A", "ATOMUSDT", "1h");
  const b = loadDrawingsFor("chart-B", "ATOMUSDT", "1h");
  ok("Gann Square/Gann Fan respect chartInstanceId isolation: chart A only sees its square", a.length === 1 && a[0].tool === "gann-square");
  ok("chart B only sees its fan, not chart A's square", b.length === 1 && b[0].tool === "gann-fan" && b[0].p2.price === 6);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
