// Coverage for the Volume Profile Value Area math (UI-4h-2):
// src/lib/workspace/volumeProfileMath.ts. No React, no DOM.
//
// Usage: npx tsx test/workspace/volumeProfileMath.test.mjs

import { computeValueArea } from "../../src/lib/workspace/volumeProfileMath.ts";
import { volumeProfile } from "../../src/lib/sgscript/stdlib.ts";

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

function close(name, actual, expected, eps = 1e-9) {
  ok(`${name} (${actual} ~= ${expected})`, Math.abs(actual - expected) <= eps);
}

{
  // Empty input never throws and reports zero volume.
  const va = computeValueArea([], 0.7);
  check("empty bins: pocIndex -1", va.pocIndex, -1);
  check("empty bins: totalVolume 0", va.totalVolume, 0);
}

{
  // All-zero-volume bins (e.g. a flat/no-trade window) is the same
  // degenerate case as empty — never divide by zero.
  const bins = [
    { bottom: 0, top: 1, volume: 0 },
    { bottom: 1, top: 2, volume: 0 },
  ];
  const va = computeValueArea(bins, 0.7);
  check("all-zero bins: pocIndex -1", va.pocIndex, -1);
}

{
  // Five equal-width bins, a clear single-peak POC in the middle. Value area
  // should expand symmetrically outward from it.
  const bins = [
    { bottom: 0, top: 1, volume: 10 },
    { bottom: 1, top: 2, volume: 20 },
    { bottom: 2, top: 3, volume: 50 },
    { bottom: 3, top: 4, volume: 20 },
    { bottom: 4, top: 5, volume: 10 },
  ];
  const va = computeValueArea(bins, 0.7);
  check("symmetric peak: POC is the middle bin", va.pocIndex, 2);
  close("symmetric peak: POC price", va.poc, 2.5);
  check("symmetric peak: totalVolume", va.totalVolume, 110);
  // POC(50) + next two highest (20+20) = 90/110 ≈ 0.818, both included
  // symmetrically since they tie — VAH/VAL should be bins 1..3 at minimum.
  ok("symmetric peak: VAH at or above bin 3's top", va.vah >= 4);
  ok("symmetric peak: VAL at or below bin 1's bottom", va.val <= 1);
  ok("symmetric peak: actualPct reaches the 70% target", va.actualPct >= 0.7);
}

{
  // Skewed volume: value area should expand toward the heavier side first,
  // not just symmetrically.
  const bins = [
    { bottom: 0, top: 1, volume: 5 },
    { bottom: 1, top: 2, volume: 60 }, // POC
    { bottom: 2, top: 3, volume: 30 },
    { bottom: 3, top: 4, volume: 5 },
  ];
  const va = computeValueArea(bins, 0.7);
  check("skewed: POC is bin 1", va.pocIndex, 1);
  // total = 100, target = 70. POC(60) + bin2(30) = 90 >= 70, expands toward
  // the heavier neighbor (30 > 5) before ever touching bin 0.
  check("skewed: VAH reaches bin 2's top", va.vah, 3);
  check("skewed: VAL stays at bin 1's bottom", va.val, 1);
}

{
  // Reusing the actual stdlib volumeProfile() engine end-to-end, the same
  // way VolumeProfilePanel does, confirms the two modules compose correctly.
  const high = [10, 11, 12, 11, 10];
  const low = [9, 10, 11, 10, 9];
  const volume = [100, 100, 500, 100, 100];
  const bins = volumeProfile(high, low, volume, 0, 4, 4);
  ok("stdlib composition: produces bins", bins.length === 4);
  const va = computeValueArea(bins, 0.7);
  ok("stdlib composition: POC is the highest-volume bin", bins[va.pocIndex].volume === Math.max(...bins.map((b) => b.volume)));
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
