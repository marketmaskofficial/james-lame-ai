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
// same list in Phase 3A. "xabcd" graduates out the same way in Phase 3D-1
// (see its own dedicated block further below) — "elliott-impulse" stays
// here since Elliott Waves are explicitly out of scope for this phase.

{
  const DEFERRED_SAMPLE = ["gann-box", "gann-fan", "elliott-impulse", "cyclic-lines", "rotated-rect", "ruler", "image"];
  const wronglyImplemented = DEFERRED_SAMPLE.filter((id) => TOOL_BY_ID[id]?.implemented);
  ok(`deferred tools stay implemented:false (wrongly true: ${wronglyImplemented.join(",") || "none"})`, wronglyImplemented.length === 0);
}

// ---- Fibonacci family audit: no member left deferred (Phase 3C-4) ---------
// Phase 3C-4 (Fib Circles / Fib Speed Resistance Arcs / Fib Spiral) was the
// last specialized Fib tool batch — the DEFERRED_FIB_FAMILY list every prior
// phase asserted against is now empty by design, so it's replaced by an
// explicit "no Fib tool is still implemented:false" audit instead.

{
  const stillDeferred = TOOL_DEFS.filter((t) => t.category === "fib" && !t.implemented).map((t) => t.id);
  ok(`no Fibonacci-family tool remains implemented:false (still deferred: ${stillDeferred.join(",") || "none"})`, stillDeferred.length === 0);
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

// ---- Phase 3C additions this phase claims as "fully implemented" ----------
// Trend-Based Fib Extension / Fib Channel / Fib Wedge ONLY — no other
// still-unimplemented Fibonacci (or any other family's) tool may be flipped
// on alongside them (checked above via DEFERRED_FIB_FAMILY/DEFERRED_SAMPLE).

{
  const PHASE3C_NEW_TOOLS = ["fib-ext", "fib-channel", "fib-wedge"];
  const missing = PHASE3C_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3C new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3C_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "fib" category`, TOOL_BY_ID[id]?.category === "fib");
    ok(`${id} declares levels capability (reuses the shared Fib level model)`, TOOL_BY_ID[id]?.capabilities.levels === true);
    ok(`${id} is a 3-anchor multi-click tool`, TOOL_BY_ID[id]?.interactionType === "multi-click" && TOOL_BY_ID[id]?.anchorCount === 3);
  }
  ok("Trend-Based Fib Extension declares extendRight capability", TOOL_BY_ID["fib-ext"]?.capabilities.extendRight === true);
  ok("Fib Channel declares fill capability (channel fill zone)", TOOL_BY_ID["fib-channel"]?.capabilities.fill === true);
  ok("Fib Wedge declares fill capability (wedge fill zone)", TOOL_BY_ID["fib-wedge"]?.capabilities.fill === true);
  ok(
    "Fib Wedge does NOT declare extendRight (its rays always extend — no separate toggle)",
    !TOOL_BY_ID["fib-wedge"]?.capabilities.extendRight,
  );
  ok(
    "Fib Channel does NOT declare extendRight (it extends both directions unconditionally)",
    !TOOL_BY_ID["fib-channel"]?.capabilities.extendRight,
  );
  ok(
    "Fib Wedge explicitly opts OUT of reverse-anchors (p1 is a shared pivot, not a symmetric endpoint)",
    TOOL_BY_ID["fib-wedge"]?.capabilities.reverseAnchors === false,
  );
  ok(
    "Trend-Based Fib Extension and Fib Channel do NOT opt out of reverse-anchors",
    TOOL_BY_ID["fib-ext"]?.capabilities.reverseAnchors !== false && TOOL_BY_ID["fib-channel"]?.capabilities.reverseAnchors !== false,
  );
  ok("fib-ext/fib-channel/fib-wedge are three distinct tool ids", new Set(PHASE3C_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 3);
}

// ---- Phase 3C-2 additions this phase claims as "fully implemented" --------
// Fib Time Zone / Fib Speed Resistance Fan ONLY — no other still-unimplemented
// Fibonacci (or any other family's) tool may be flipped on alongside them
// (checked above via DEFERRED_FIB_FAMILY/DEFERRED_SAMPLE).

{
  const PHASE3C2_NEW_TOOLS = ["fib-time", "fib-speed-fan"];
  const missing = PHASE3C2_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3C-2 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3C2_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "fib" category`, TOOL_BY_ID[id]?.category === "fib");
    ok(`${id} declares levels capability (reuses the shared Fib level model)`, TOOL_BY_ID[id]?.capabilities.levels === true);
    ok(`${id} is a 2-anchor drag tool`, TOOL_BY_ID[id]?.interactionType === "drag" && TOOL_BY_ID[id]?.anchorCount === 2);
    ok(
      `${id} explicitly opts OUT of reverse-anchors (p1 is a fixed origin, not a symmetric endpoint)`,
      TOOL_BY_ID[id]?.capabilities.reverseAnchors === false,
    );
  }
  ok(
    "Fib Time Zone declares levelValueKind 'sequence' (whole Fibonacci-sequence multiples, not ratios)",
    TOOL_BY_ID["fib-time"]?.capabilities.levelValueKind === "sequence",
  );
  ok(
    "Fib Speed Resistance Fan does NOT declare a sequence levelValueKind (its levels ARE ratios)",
    TOOL_BY_ID["fib-speed-fan"]?.capabilities.levelValueKind !== "sequence",
  );
  ok("Fib Time Zone and Fib Speed Resistance Fan are two distinct tool ids", new Set(PHASE3C2_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 2);
  ok("Fib Speed Resistance Fan is distinct from Fib Wedge (own id, not an alias)", TOOL_BY_ID["fib-speed-fan"]?.id !== TOOL_BY_ID["fib-wedge"]?.id);
}

// ---- Phase 3C-3 additions this phase claims as "fully implemented" --------
// Trend-Based Fib Time / Pitchfan ONLY — no other still-unimplemented
// Fibonacci (or any other family's) tool may be flipped on alongside them
// (checked above via DEFERRED_FIB_FAMILY/DEFERRED_SAMPLE).

{
  const PHASE3C3_NEW_TOOLS = ["fib-time-trend", "pitchfan"];
  const missing = PHASE3C3_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3C-3 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3C3_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "fib" category`, TOOL_BY_ID[id]?.category === "fib");
    ok(`${id} declares levels capability (reuses the shared Fib level model)`, TOOL_BY_ID[id]?.capabilities.levels === true);
    ok(`${id} is a 3-anchor multi-click tool`, TOOL_BY_ID[id]?.interactionType === "multi-click" && TOOL_BY_ID[id]?.anchorCount === 3);
  }
  ok(
    "Trend-Based Fib Time declares levelValueKind 'sequence' (whole Fibonacci-sequence multiples, not ratios)",
    TOOL_BY_ID["fib-time-trend"]?.capabilities.levelValueKind === "sequence",
  );
  ok(
    "Pitchfan does NOT declare a sequence levelValueKind (its levels ARE ratios, like Fib Wedge)",
    TOOL_BY_ID["pitchfan"]?.capabilities.levelValueKind !== "sequence",
  );
  ok(
    "Pitchfan explicitly opts OUT of reverse-anchors (p1 is a shared pivot, not a symmetric endpoint) — same as Fib Wedge",
    TOOL_BY_ID["pitchfan"]?.capabilities.reverseAnchors === false,
  );
  ok(
    "Trend-Based Fib Time does NOT opt out of reverse-anchors (A/B measure a trend, not a fixed pivot)",
    TOOL_BY_ID["fib-time-trend"]?.capabilities.reverseAnchors !== false,
  );
  ok(
    "Pitchfan does NOT declare fill capability (unfilled fan lines, unlike Fib Wedge's closed fill zone)",
    !TOOL_BY_ID["pitchfan"]?.capabilities.fill,
  );
  ok("Fib Wedge and Pitchfan are distinct tool ids despite sharing render code", TOOL_BY_ID["fib-wedge"]?.id !== TOOL_BY_ID["pitchfan"]?.id);
  ok("Fib Time Zone and Trend-Based Fib Time are distinct tool ids despite sharing render code", TOOL_BY_ID["fib-time"]?.id !== TOOL_BY_ID["fib-time-trend"]?.id);
  ok("fib-time-trend/pitchfan are two distinct tool ids", new Set(PHASE3C3_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 2);
}

// ---- Phase 3C-4 additions this phase claims as "fully implemented" --------
// Fib Circles / Fib Speed Resistance Arcs / Fib Spiral — the final
// specialized Fibonacci tools before the family audit above.

{
  const PHASE3C4_NEW_TOOLS = ["fib-circles", "fib-speed-arcs", "fib-spiral"];
  const missing = PHASE3C4_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3C-4 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3C4_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "fib" category`, TOOL_BY_ID[id]?.category === "fib");
    ok(`${id} is a 2-anchor drag tool`, TOOL_BY_ID[id]?.interactionType === "drag" && TOOL_BY_ID[id]?.anchorCount === 2);
  }
  ok("Fib Circles declares levels capability (concentric Fibonacci-ratio rings)", TOOL_BY_ID["fib-circles"]?.capabilities.levels === true);
  ok("Fib Speed Resistance Arcs declares levels capability (concentric Fibonacci-ratio half-arcs)", TOOL_BY_ID["fib-speed-arcs"]?.capabilities.levels === true);
  ok("Fib Spiral does NOT declare levels capability (no discrete ratio levels on a continuous spiral)", !TOOL_BY_ID["fib-spiral"]?.capabilities.levels);
  ok("fib-circles/fib-speed-arcs/fib-spiral are three distinct tool ids", new Set(PHASE3C4_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 3);
}

// ---- Phase 3D-1 additions this phase claims as "fully implemented" --------
// XABCD / Cypher / Head and Shoulders / ABCD / Triangle Pattern / Three
// Drives — the shared labeled multi-anchor primitive's first six tools.
// Elliott Wave ids (elliott-impulse etc.) stay out of IMPLEMENTED_TOOLS —
// checked above via DEFERRED_SAMPLE.

{
  const PHASE3D1_NEW_TOOLS = ["xabcd", "cypher", "head-shoulders", "abcd", "triangle-pattern", "three-drives"];
  const EXPECTED_ANCHOR_COUNT = { xabcd: 5, cypher: 5, "head-shoulders": 5, abcd: 4, "triangle-pattern": 4, "three-drives": 6 };
  const missing = PHASE3D1_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-1 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D1_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "patterns" category`, TOOL_BY_ID[id]?.category === "patterns");
    ok(`${id} is a multi-click tool`, TOOL_BY_ID[id]?.interactionType === "multi-click");
    ok(`${id} declares its expected fixed anchor count (${EXPECTED_ANCHOR_COUNT[id]})`, TOOL_BY_ID[id]?.anchorCount === EXPECTED_ANCHOR_COUNT[id]);
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
    ok(`${id} declares anchorLabel capability (shared X/A/B/C/D-style label toggle)`, TOOL_BY_ID[id]?.capabilities.anchorLabel === true);
    ok(`${id} does NOT declare the unrelated free-text 'text' capability`, !TOOL_BY_ID[id]?.capabilities.text);
  }
  ok("triangle-pattern is a DISTINCT tool id from the generic geometric 'triangle' shape", TOOL_BY_ID["triangle-pattern"]?.id !== TOOL_BY_ID["triangle"]?.id);
  ok("xabcd and cypher are distinct tool ids despite identical anchor geometry", TOOL_BY_ID["xabcd"]?.id !== TOOL_BY_ID["cypher"]?.id);
  ok(
    "every Phase 3D-1 tool is six distinct tool ids",
    new Set(PHASE3D1_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 6,
  );
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
