// Coverage for the Phase 2 drawing-tool registry: src/lib/drawing/registry.ts.
// No React, no DOM — registry.ts's only import from the StudioChart component
// is `import type { ... }`, which is erased at compile time, so this module
// is safely importable standalone exactly like geometry.ts/calc.ts already are.
//
// What this locks in: every tool declares the full metadata schema the phase
// brief requires (id/name/category/icon/interactionType/anchorCount/
// capabilities/defaultStyle/implemented); an UNIMPLEMENTED tool is excluded
// from `IMPLEMENTED_TOOLS` (the toolbar's only tool source — see
// DrawToolbar.tsx), which is what keeps an unimplemented tool from ever
// rendering as a clickable dead button; every Phase 1 "fully-working" tool
// carries `implemented: true`; ids are unique; every tool's `category`
// (other than cursor/select) resolves to a real entry in `TOOL_GROUPS`.
//
// Usage: npx tsx test/workspace/drawingRegistry.test.mjs

import { TOOL_DEFS, TOOL_BY_ID, TOOL_GROUPS, IMPLEMENTED_TOOLS } from "../../src/lib/drawing/registry.ts";

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

// ---- schema completeness -------------------------------------------------

for (const t of TOOL_DEFS) {
  ok(`${t.id}: has a non-empty name`, typeof t.name === "string" && t.name.length > 0);
  ok(`${t.id}: has a category`, typeof t.category === "string" && t.category.length > 0);
  ok(`${t.id}: has an icon component`, typeof t.icon === "object" || typeof t.icon === "function");
  ok(`${t.id}: has an interactionType`, ["point", "drag", "multi-click", "freehand"].includes(t.interactionType));
  ok(`${t.id}: has an anchorCount (number or "unlimited")`, t.anchorCount === "unlimited" || typeof t.anchorCount === "number");
  ok(`${t.id}: has a capabilities object`, typeof t.capabilities === "object" && t.capabilities !== null);
  ok(`${t.id}: has a defaultStyle object`, typeof t.defaultStyle === "object" && t.defaultStyle !== null);
  ok(`${t.id}: has a boolean implemented flag`, typeof t.implemented === "boolean");
}

// ---- uniqueness -----------------------------------------------------------

{
  const ids = TOOL_DEFS.map((t) => t.id);
  const uniqueIds = new Set(ids);
  ok("every tool id is unique", ids.length === uniqueIds.size);
}

// ---- category resolves to a real TOOL_GROUPS entry (cursor/select excluded) --

{
  const groupIds = new Set(TOOL_GROUPS.map((g) => g.id));
  const badCategory = TOOL_DEFS.filter((t) => t.id !== "cursor" && t.id !== "select" && !groupIds.has(t.category));
  ok("every non-cursor/select tool's category exists in TOOL_GROUPS", badCategory.length === 0);
}

// ---- IMPLEMENTED_TOOLS is exactly the implemented, non-cursor/select subset --

{
  const expected = TOOL_DEFS.filter((t) => t.implemented && t.id !== "cursor" && t.id !== "select").map((t) => t.id).sort();
  const actual = IMPLEMENTED_TOOLS.map((t) => t.id).sort();
  ok("IMPLEMENTED_TOOLS matches TOOL_DEFS filtered by implemented=true (minus cursor/select)", JSON.stringify(expected) === JSON.stringify(actual));
  ok("IMPLEMENTED_TOOLS never includes cursor", !actual.includes("cursor"));
  ok("IMPLEMENTED_TOOLS never includes select", !actual.includes("select"));
  ok("every IMPLEMENTED_TOOLS entry has implemented === true", IMPLEMENTED_TOOLS.every((t) => t.implemented === true));
}

// ---- every Phase 1 "fully-working" tool is still implemented: true --------
// (locks in "preserve every functionality at 878d0eb" — a regression here
// would silently vanish one of Phase 1's shipped tools from the toolbar.)

{
  const PHASE1_TOOLS = [
    "trend", "ray", "hline", "hray", "vline", "channel", "rect", "circle", "triangle",
    "text", "marker", "brush", "highlighter", "long", "short", "vwap", "fib",
    "price-range", "date-range", "measure",
  ];
  const missing = PHASE1_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 1 tool is still implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
}

// ---- Phase 2 additions this phase claims as "fully implemented" -----------

{
  const PHASE2_NEW_TOOLS = ["extended", "arrow", "arrow-up", "arrow-down"];
  const missing = PHASE2_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 2 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
}

// ---- Phase 3A additions this phase claims as "fully implemented" ----------
// Only Ellipse/Polyline/Path — no other Phase 3 tool family may be flipped
// on alongside them (see the DEFERRED_SAMPLE check below, which asserts
// several still stay hidden).

{
  const PHASE3A_NEW_TOOLS = ["ellipse", "polyline", "path"];
  const missing = PHASE3A_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3A new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3A_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "shapes" category`, TOOL_BY_ID[id]?.category === "shapes");
  }
}

// ---- Ellipse stays a DISTINCT tool id from Circle, never merged ------------
// (the phase brief explicitly forbids collapsing them into one id even
// though they share the same render geometry).

{
  ok("ellipse and circle are different tool ids", TOOL_BY_ID["ellipse"]?.id !== TOOL_BY_ID["circle"]?.id);
  ok("ellipse has its own icon component, distinct from Circle's (visually distinguishable tiles)", TOOL_BY_ID["ellipse"]?.icon !== TOOL_BY_ID["circle"]?.icon);
  ok("ellipse declares stroke capability", TOOL_BY_ID["ellipse"]?.capabilities.stroke === true);
  ok("ellipse declares fill capability", TOOL_BY_ID["ellipse"]?.capabilities.fill === true);
  ok("ellipse is a 2-anchor drag tool (bounding box, like Circle)", TOOL_BY_ID["ellipse"]?.interactionType === "drag" && TOOL_BY_ID["ellipse"]?.anchorCount === 2);
}

// ---- Polyline: open/stroke-only, unlimited multi-click chain ---------------

{
  ok("polyline declares stroke capability", TOOL_BY_ID["polyline"]?.capabilities.stroke === true);
  ok("polyline has NO fill capability (open/unfilled per the phase brief)", !TOOL_BY_ID["polyline"]?.capabilities.fill);
  ok("polyline is a multi-click tool with unlimited anchors", TOOL_BY_ID["polyline"]?.interactionType === "multi-click" && TOOL_BY_ID["polyline"]?.anchorCount === "unlimited");
}

// ---- Path: same multi-click data model as Polyline, but fill turns on -----

{
  ok("path declares stroke capability", TOOL_BY_ID["path"]?.capabilities.stroke === true);
  ok("path declares fill capability (its one behavioral difference from Polyline)", TOOL_BY_ID["path"]?.capabilities.fill === true);
  ok("path is a multi-click tool with unlimited anchors, same data model as Polyline", TOOL_BY_ID["path"]?.interactionType === "multi-click" && TOOL_BY_ID["path"]?.anchorCount === "unlimited");
  ok("path has its own icon, distinct from Polyline's", TOOL_BY_ID["path"]?.icon !== TOOL_BY_ID["polyline"]?.icon);
}

// ---- deferred families stay hidden (implemented:false) — never a fake tool ---
// vp-fixed/vp-anchored were the DEFERRED_SAMPLE entries here through Phase
// 3A — Phase 3B is the phase that implements exactly those two (and ONLY
// those two — no other still-unimplemented tool may be flipped on alongside
// them), so they move out of this list and into their own dedicated block
// below, mirroring exactly how Ellipse/Polyline/Path graduated out of this
// same list in Phase 3A.

{
  const DEFERRED_SAMPLE = ["gann-box", "gann-fan", "xabcd", "elliott-impulse", "cyclic-lines", "rotated-rect", "ruler", "image"];
  const wronglyImplemented = DEFERRED_SAMPLE.filter((id) => TOOL_BY_ID[id]?.implemented);
  ok(`deferred tools stay implemented:false (wrongly true: ${wronglyImplemented.join(",") || "none"})`, wronglyImplemented.length === 0);
}

// ---- Phase 3B additions this phase claims as "fully implemented" ----------
// Fixed Range Volume Profile / Anchored Volume Profile ONLY — no other
// Volume-Based (or any other family's) still-unimplemented tool may be
// flipped on alongside them (checked above via DEFERRED_SAMPLE).

{
  const PHASE3B_NEW_TOOLS = ["vp-fixed", "vp-anchored"];
  const missing = PHASE3B_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3B new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3B_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "volume" category`, TOOL_BY_ID[id]?.category === "volume");
    ok(`${id} declares fill capability (histogram opacity)`, TOOL_BY_ID[id]?.capabilities.fill === true);
    ok(`${id} declares volumeProfile capability (rows/Value Area %/POC-VAH-VAL/etc)`, TOOL_BY_ID[id]?.capabilities.volumeProfile === true);
  }
  ok("Fixed Range Volume Profile is a 2-anchor drag tool", TOOL_BY_ID["vp-fixed"]?.interactionType === "drag" && TOOL_BY_ID["vp-fixed"]?.anchorCount === 2);
  ok("Anchored Volume Profile is a single-click point tool (anchor -> most recent bar)", TOOL_BY_ID["vp-anchored"]?.interactionType === "point" && TOOL_BY_ID["vp-anchored"]?.anchorCount === 1);
  ok("Fixed Range and Anchored Volume Profile are distinct tool ids", TOOL_BY_ID["vp-fixed"]?.id !== TOOL_BY_ID["vp-anchored"]?.id);
}

// ---- capability-gated settings sections have a real reason to exist -------

{
  ok("Fibonacci Retracement declares levels capability", TOOL_BY_ID["fib"]?.capabilities.levels === true);
  ok("Long Position declares positionMetrics capability", TOOL_BY_ID["long"]?.capabilities.positionMetrics === true);
  ok("Short Position declares positionMetrics capability", TOOL_BY_ID["short"]?.capabilities.positionMetrics === true);
  ok("Anchored VWAP declares anchorLabel capability", TOOL_BY_ID["vwap"]?.capabilities.anchorLabel === true);
  ok("Text declares text capability", TOOL_BY_ID["text"]?.capabilities.text === true);
  ok("Rectangle declares fill capability", TOOL_BY_ID["rect"]?.capabilities.fill === true);
  ok("Horizontal Line has no fill/text/levels capability (stroke-only)", !TOOL_BY_ID["hline"]?.capabilities.fill && !TOOL_BY_ID["hline"]?.capabilities.text && !TOOL_BY_ID["hline"]?.capabilities.levels);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
