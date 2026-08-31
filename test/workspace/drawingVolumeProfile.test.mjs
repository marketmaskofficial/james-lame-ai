// Coverage for Phase 3B's Volume Profile drawing-tool calculation:
// src/lib/drawing/volumeProfile.ts — the TIME -> bar-index resolution layer
// for Fixed Range / Anchored Volume Profile, sitting on top of the SAME two
// engines the existing Volume Profile widget already uses
// (stdlib.ts's `volumeProfile()` bucket math + volumeProfileMath.ts's
// `computeValueArea`). No React, no DOM, no lightweight-charts — pure
// functions, directly importable exactly like drawingCalc.test.mjs already
// does for src/lib/drawing/calc.ts.
//
// What this locks in: correct bars included/excluded by time range (order-
// independent, inclusive of boundary bars), an anchor's "to the most recent
// loaded bar" semantics, safe empty results (never fabricated) when no bar
// falls in range or bars haven't loaded yet, and that recalculation actually
// responds to rows/Value Area % rather than being cached/ignored.
//
// Usage: npx tsx test/workspace/drawingVolumeProfile.test.mjs

import { computeFixedRangeVolumeProfile, computeAnchoredVolumeProfile } from "../../src/lib/drawing/volumeProfile.ts";
import { volumeProfile } from "../../src/lib/sgscript/stdlib.ts";
import { computeValueArea } from "../../src/lib/workspace/volumeProfileMath.ts";

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

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// Five known bars, 100s apart — same shape VolumeProfilePanel itself feeds
// into stdlib's volumeProfile(): a real high/low/volume window, no fabricated
// fields.
function bar(time, high, low, volume) {
  return { time, open: (high + low) / 2, high, low, close: (high + low) / 2, volume };
}
const BARS = [
  bar(100, 10, 9, 100),
  bar(200, 11, 10, 100),
  bar(300, 12, 11, 500), // heaviest bar — should dominate the POC
  bar(400, 11, 10, 100),
  bar(500, 10, 9, 100),
];

// ---- Fixed Range: whole loaded range reproduces the raw stdlib composition ---

{
  const result = computeFixedRangeVolumeProfile(BARS, 100, 500, 4, 0.7);
  const high = BARS.map((b) => b.high);
  const low = BARS.map((b) => b.low);
  const volume = BARS.map((b) => b.volume);
  const expectedBins = volumeProfile(high, low, volume, 0, 4, 4);
  const expectedVA = computeValueArea(expectedBins, 0.7);
  check("Fixed Range over the FULL loaded range reproduces stdlib volumeProfile() bins exactly", result.bins, expectedBins);
  check("Fixed Range's Value Area matches computeValueArea() over those same bins", result.valueArea, expectedVA);
  check("Fixed Range over the full range includes every bar", [result.fromIdx, result.toIdx, result.barCount], [0, 4, 5]);
}

// ---- Fixed Range: a narrower range excludes bars outside it -----------------

{
  // Selecting bars at t=200..400 only (indices 1..3) must NEVER pull in bar 0
  // (t=100) or bar 4 (t=500) — this is the "bars outside the range excluded"
  // requirement, checked against the exact same stdlib call over indices 1..3.
  const result = computeFixedRangeVolumeProfile(BARS, 200, 400, 4, 0.7);
  const high = BARS.map((b) => b.high);
  const low = BARS.map((b) => b.low);
  const volume = BARS.map((b) => b.volume);
  const expectedBins = volumeProfile(high, low, volume, 1, 3, 4);
  check("Fixed Range over a narrower time window matches stdlib volumeProfile() over the matching bar-index window", result.bins, expectedBins);
  check("Fixed Range excludes bar 0 and bar 4 (correct fromIdx/toIdx/barCount)", [result.fromIdx, result.toIdx, result.barCount], [1, 3, 3]);
  ok("the heaviest bar (t=300, volume 500) still drives the POC in the narrower window", result.valueArea.pocIndex >= 0);
}

// ---- Fixed Range: anchors can be dragged past each other (order-independent) -

{
  const forward = computeFixedRangeVolumeProfile(BARS, 200, 400, 4, 0.7);
  const reversed = computeFixedRangeVolumeProfile(BARS, 400, 200, 4, 0.7);
  check("Fixed Range gives the identical result whether start/end anchors are forward or reversed", reversed.bins, forward.bins);
  check("fromIdx/toIdx are identical regardless of anchor order", [reversed.fromIdx, reversed.toIdx], [forward.fromIdx, forward.toIdx]);
}

// ---- Fixed Range: boundary bars are inclusive --------------------------------

{
  // A range drawn exactly edge-to-edge on two candles (t=200 to t=400) must
  // include BOTH boundary bars, not just the bar strictly between them.
  const result = computeFixedRangeVolumeProfile(BARS, 200, 400, 4, 0.7);
  ok("boundary start bar (t=200) is included", result.fromIdx === 1);
  ok("boundary end bar (t=400) is included", result.toIdx === 3);
}

// ---- Fixed Range: safe empty result when no bar falls in range --------------

{
  const result = computeFixedRangeVolumeProfile(BARS, 1000, 2000, 24, 0.7);
  check("a range with no bars in it returns an empty profile, never a fabricated one", [result.bins.length, result.fromIdx, result.toIdx, result.barCount], [0, -1, -1, 0]);
  ok("empty profile's Value Area is the safe empty sentinel (pocIndex -1)", result.valueArea.pocIndex === -1);

  const noBars = computeFixedRangeVolumeProfile([], 100, 500, 24, 0.7);
  check("an empty bars array (data not loaded yet) never throws, returns an empty profile", [noBars.bins.length, noBars.fromIdx], [0, -1]);
}

// ---- Anchored: from the anchor bar to the most recent/rightmost loaded bar ---

{
  // Anchor exactly on a bar's own time (t=300, index 2) -> includes 2..4.
  const onBar = computeAnchoredVolumeProfile(BARS, 300, 4, 0.7);
  check("anchor exactly on a bar's time includes that bar through the last loaded bar", [onBar.fromIdx, onBar.toIdx, onBar.barCount], [2, 4, 3]);
  const high = BARS.map((b) => b.high);
  const low = BARS.map((b) => b.low);
  const volume = BARS.map((b) => b.volume);
  check("Anchored bins match the equivalent direct stdlib call over the same index window", onBar.bins, volumeProfile(high, low, volume, 2, 4, 4));

  // Anchor BETWEEN two bars (t=250, between index 1 @200 and index 2 @300)
  // picks the first bar at-or-after the anchor, i.e. index 2 — never the bar
  // just before it (that bar started trading before the anchor).
  const between = computeAnchoredVolumeProfile(BARS, 250, 4, 0.7);
  check("anchor between two bars snaps forward to the next loaded bar, not backward", [between.fromIdx, between.toIdx], [2, 4]);

  // Anchor before every loaded bar -> includes everything.
  const beforeAll = computeAnchoredVolumeProfile(BARS, 0, 4, 0.7);
  check("anchor before every loaded bar includes the entire loaded history", [beforeAll.fromIdx, beforeAll.toIdx], [0, 4]);

  // Anchor after every loaded bar -> nothing to include yet; never fabricated.
  const afterAll = computeAnchoredVolumeProfile(BARS, 600, 4, 0.7);
  check("anchor placed after every loaded bar returns an empty profile, never fabricated data", [afterAll.bins.length, afterAll.fromIdx], [0, -1]);

  const noBars = computeAnchoredVolumeProfile([], 300, 4, 0.7);
  check("Anchored with no bars loaded yet never throws, returns an empty profile", [noBars.bins.length, noBars.fromIdx], [0, -1]);
}

// ---- Anchored: recomputes to pick up newly-loaded bars without moving -------

{
  // Simulates a live bar arriving after the anchor was placed (studio.tsx's
  // mergeLiveBar/mtqhe real-time append) — same anchor time, longer bars
  // array, must extend to include the new bar without the anchor moving.
  const before = computeAnchoredVolumeProfile(BARS, 300, 4, 0.7);
  const extended = [...BARS, bar(600, 13, 12, 200)];
  const after = computeAnchoredVolumeProfile(extended, 300, 4, 0.7);
  ok("anchor index (fromIdx) stays put as new bars arrive", after.fromIdx === before.fromIdx);
  ok("toIdx (and therefore barCount) grows to include the newly-loaded bar", after.toIdx === before.toIdx + 1 && after.barCount === before.barCount + 1);
}

// ---- Recalculation actually responds to rows / Value Area % -----------------

{
  const coarse = computeFixedRangeVolumeProfile(BARS, 100, 500, 2, 0.7);
  const fine = computeFixedRangeVolumeProfile(BARS, 100, 500, 8, 0.7);
  ok("changing rows changes the number of bins produced (2 rows)", coarse.bins.length === 2);
  ok("changing rows changes the number of bins produced (8 rows)", fine.bins.length === 8);

  const wideVA = computeFixedRangeVolumeProfile(BARS, 100, 500, 4, 1.0);
  ok("Value Area % of 100% includes the entire volume (actualPct reaches 1)", Math.abs(wideVA.valueArea.actualPct - 1) < 1e-9);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
