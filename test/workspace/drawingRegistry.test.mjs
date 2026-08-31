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
// same list in Phase 3A. "xabcd" graduated out in Phase 3D-1,
// "elliott-impulse" in Phase 3D-2, "cyclic-lines" in Phase 3D-3,
// "gann-box"/"gann-fan" in Phase 3D-4, and "rotated-rect" in Phase 3D-6
// (see their own dedicated blocks further below).

{
  // "ruler" graduated to implemented:true in Phase 3D-13; "image" graduated
  // in Phase 3D-14 (see each phase's own dedicated block further below) —
  // as of Phase 3D-14, EVERY registered drawing tool is genuinely
  // implemented:true. This asserts that milestone directly rather than
  // checking a specific deferred-sample list that no longer has anything
  // left to name (Post/Idea are publishing/community actions with no
  // registry entry at all — never drawings — so they don't factor in here).
  const stillDeferred = TOOL_DEFS.filter((t) => !t.implemented).map((t) => t.id);
  ok(`no drawing tool remains implemented:false (still deferred: ${stillDeferred.join(",") || "none"})`, stillDeferred.length === 0);
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

// ---- Phase 3D-2 additions this phase claims as "fully implemented" --------
// Elliott Impulse / Correction / Triangle / Double Combo / Triple Combo —
// extending Phase 3D-1's shared labeled multi-anchor primitive, not a
// separate engine. Every anchor count is one more than its wave-letter name
// implies (an unlabeled "0" origin anchor before the named sequence).

{
  const PHASE3D2_NEW_TOOLS = ["elliott-impulse", "elliott-correction", "elliott-triangle", "elliott-double-combo", "elliott-triple-combo"];
  const EXPECTED_ANCHOR_COUNT = {
    "elliott-impulse": 6,
    "elliott-correction": 4,
    "elliott-triangle": 6,
    "elliott-double-combo": 4,
    "elliott-triple-combo": 6,
  };
  const missing = PHASE3D2_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-2 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D2_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "elliott" category`, TOOL_BY_ID[id]?.category === "elliott");
    ok(`${id} is a multi-click tool`, TOOL_BY_ID[id]?.interactionType === "multi-click");
    ok(`${id} declares its expected fixed anchor count (${EXPECTED_ANCHOR_COUNT[id]})`, TOOL_BY_ID[id]?.anchorCount === EXPECTED_ANCHOR_COUNT[id]);
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
    ok(`${id} declares anchorLabel capability (reused from Anchored VWAP/Phase 3D-1, no new capability flag)`, TOOL_BY_ID[id]?.capabilities.anchorLabel === true);
    ok(`${id} does NOT declare the unrelated free-text 'text' capability`, !TOOL_BY_ID[id]?.capabilities.text);
  }
  ok(
    "elliott-triangle is a DISTINCT tool id from both the generic 'triangle' shape and Phase 3D-1's 'triangle-pattern'",
    TOOL_BY_ID["elliott-triangle"]?.id !== TOOL_BY_ID["triangle"]?.id && TOOL_BY_ID["elliott-triangle"]?.id !== TOOL_BY_ID["triangle-pattern"]?.id,
  );
  ok(
    "every Phase 3D-2 tool is five distinct tool ids",
    new Set(PHASE3D2_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 5,
  );
}

// ---- Phase 3D-3 additions this phase claims as "fully implemented" --------
// Cyclic Lines / Time Cycles / Sine Line — plain p1/p2 tools (NOT the
// labeled multi-anchor primitive Chart Patterns/Elliott use above), so this
// block checks anchorCount/interactionType/category instead of the
// anchorLabel-capability checks those two families' blocks run.

{
  const PHASE3D3_NEW_TOOLS = ["cyclic-lines", "time-cycles", "sine-line"];
  const EXPECTED_INTERACTION = { "cyclic-lines": "multi-click", "time-cycles": "drag", "sine-line": "drag" };
  const missing = PHASE3D3_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-3 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D3_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "cycles" category`, TOOL_BY_ID[id]?.category === "cycles");
    ok(`${id} declares its expected 2-anchor count`, TOOL_BY_ID[id]?.anchorCount === 2);
    ok(`${id} declares its expected interaction type (${EXPECTED_INTERACTION[id]})`, TOOL_BY_ID[id]?.interactionType === EXPECTED_INTERACTION[id]);
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
  }
  ok(
    "Cyclic Lines is multi-click (two discrete clicks) while Time Cycles/Sine Line are drag — genuinely distinct creation gestures, not an alias",
    TOOL_BY_ID["cyclic-lines"]?.interactionType !== TOOL_BY_ID["time-cycles"]?.interactionType,
  );
  ok(
    "every Phase 3D-3 tool is three distinct tool ids",
    new Set(PHASE3D3_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 3,
  );
}

// ---- Phase 3D-4 additions this phase claims as "fully implemented" --------
// Gann Box / Gann Square Fixed / Gann Square / Gann Fan — Box/Square
// Fixed/Square share one grid primitive; Fan reuses the fan-tool `levels`
// capability every prior phase's fan tools already have.

{
  const GANN_GRID_TOOLS = ["gann-box", "gann-square-fixed", "gann-square"];
  const EXPECTED_INTERACTION = { "gann-box": "drag", "gann-square-fixed": "point", "gann-square": "drag" };
  const EXPECTED_ANCHOR_COUNT = { "gann-box": 2, "gann-square-fixed": 1, "gann-square": 2 };
  const missing = GANN_GRID_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Gann grid tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of GANN_GRID_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "gann" category`, TOOL_BY_ID[id]?.category === "gann");
    ok(`${id} declares its expected anchor count (${EXPECTED_ANCHOR_COUNT[id]})`, TOOL_BY_ID[id]?.anchorCount === EXPECTED_ANCHOR_COUNT[id]);
    ok(`${id} declares its expected interaction type (${EXPECTED_INTERACTION[id]})`, TOOL_BY_ID[id]?.interactionType === EXPECTED_INTERACTION[id]);
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
  }
  ok(
    "Gann Square Fixed is a single-click point tool while Gann Square is a drag — genuinely distinct creation gestures, not an alias",
    TOOL_BY_ID["gann-square-fixed"]?.interactionType !== TOOL_BY_ID["gann-square"]?.interactionType,
  );
  ok(
    "Gann Box is a distinct tool id from both Square tools despite sharing the same grid primitive",
    TOOL_BY_ID["gann-box"]?.id !== TOOL_BY_ID["gann-square"]?.id && TOOL_BY_ID["gann-box"]?.id !== TOOL_BY_ID["gann-square-fixed"]?.id,
  );

  ok("Gann Fan is in IMPLEMENTED_TOOLS", IMPLEMENTED_TOOLS.some((t) => t.id === "gann-fan"));
  ok("Gann Fan resolves to the \"gann\" category", TOOL_BY_ID["gann-fan"]?.category === "gann");
  ok("Gann Fan is a 2-anchor drag tool", TOOL_BY_ID["gann-fan"]?.interactionType === "drag" && TOOL_BY_ID["gann-fan"]?.anchorCount === 2);
  ok("Gann Fan declares levels capability (per-ray enable/color/custom-value)", TOOL_BY_ID["gann-fan"]?.capabilities.levels === true);
  ok(
    "Gann Fan explicitly opts OUT of reverse-anchors (p1 is the shared ray pivot, not a symmetric endpoint) — same as Fib Speed Resistance Fan",
    TOOL_BY_ID["gann-fan"]?.capabilities.reverseAnchors === false,
  );
  ok("Gann Fan is distinct from Fib Speed Resistance Fan (own id, not an alias)", TOOL_BY_ID["gann-fan"]?.id !== TOOL_BY_ID["fib-speed-fan"]?.id);

  ok(
    "all four Phase 3D-4 tools are four distinct tool ids",
    new Set([...GANN_GRID_TOOLS, "gann-fan"].map((id) => TOOL_BY_ID[id]?.id)).size === 4,
  );
}

// ---- Phase 3D-5: Lines/Channels/Pitchforks audit + completion --------------
// Info Line / Trend Angle / Crossline / Regression Trend / Flat Top-Bottom /
// Disjoint Channel / the four Pitchfork variants — the ten tools the audit
// found missing (Trend Line/Ray/Extended Line/Horizontal+Vertical Line/
// Horizontal Ray/Parallel Channel were already genuinely complete and are
// deliberately NOT touched or re-tested here).

{
  const PHASE3D5_NEW_TOOLS = [
    "info-line",
    "trend-angle",
    "crossline",
    "regression-trend",
    "flat-channel",
    "disjoint-channel",
    "pitchfork",
    "schiff-pitchfork",
    "modified-schiff-pitchfork",
    "inside-pitchfork",
  ];
  const missing = PHASE3D5_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-5 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  // Phase 3D-11 (toolbar redesign) split what was one "lines" category into
  // three distinct toolbar sections (Lines / Channels / Pitchforks) for
  // clearer discovery — tool ids, capabilities, and interaction gestures are
  // completely unchanged, only this metadata field moved.
  const EXPECTED_3D5_CATEGORY = {
    "info-line": "lines",
    "trend-angle": "lines",
    crossline: "lines",
    "regression-trend": "channels",
    "flat-channel": "channels",
    "disjoint-channel": "channels",
    pitchfork: "pitchforks",
    "schiff-pitchfork": "pitchforks",
    "modified-schiff-pitchfork": "pitchforks",
    "inside-pitchfork": "pitchforks",
  };
  for (const id of PHASE3D5_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "${EXPECTED_3D5_CATEGORY[id]}" category`, TOOL_BY_ID[id]?.category === EXPECTED_3D5_CATEGORY[id]);
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
  }
  ok(
    "all ten Phase 3D-5 tools are ten distinct tool ids",
    new Set(PHASE3D5_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 10,
  );

  ok("Info Line/Trend Angle are 2-anchor drag tools, same gesture as Trend Line", TOOL_BY_ID["info-line"]?.interactionType === "drag" && TOOL_BY_ID["info-line"]?.anchorCount === 2 && TOOL_BY_ID["trend-angle"]?.interactionType === "drag" && TOOL_BY_ID["trend-angle"]?.anchorCount === 2);
  ok("Crossline is a single-click point tool with one anchor", TOOL_BY_ID["crossline"]?.interactionType === "point" && TOOL_BY_ID["crossline"]?.anchorCount === 1);
  ok("Regression Trend is a 2-anchor drag tool (defines the fitted time RANGE)", TOOL_BY_ID["regression-trend"]?.interactionType === "drag" && TOOL_BY_ID["regression-trend"]?.anchorCount === 2);
  ok("Regression Trend declares fill capability (channel shading)", TOOL_BY_ID["regression-trend"]?.capabilities.fill === true);
  ok("Flat Top/Bottom is a 3-anchor multi-click tool, same gesture as Parallel Channel", TOOL_BY_ID["flat-channel"]?.interactionType === "multi-click" && TOOL_BY_ID["flat-channel"]?.anchorCount === 3);
  ok("Flat Top/Bottom is a DISTINCT tool id from Parallel Channel despite sharing the creation gesture", TOOL_BY_ID["flat-channel"]?.id !== TOOL_BY_ID["channel"]?.id);
  ok("Disjoint Channel is a 4-anchor multi-click tool (two independent 2-point rails)", TOOL_BY_ID["disjoint-channel"]?.interactionType === "multi-click" && TOOL_BY_ID["disjoint-channel"]?.anchorCount === 4);

  const PITCHFORK_IDS = ["pitchfork", "schiff-pitchfork", "modified-schiff-pitchfork", "inside-pitchfork"];
  for (const id of PITCHFORK_IDS) {
    ok(`${id} is a 3-anchor multi-click tool`, TOOL_BY_ID[id]?.interactionType === "multi-click" && TOOL_BY_ID[id]?.anchorCount === 3);
  }
  ok(
    "all four Pitchfork variants are four distinct tool ids — none aliased to one visual tool",
    new Set(PITCHFORK_IDS.map((id) => TOOL_BY_ID[id]?.id)).size === 4,
  );
}

// ---- Phase 3D-6: Brushes/Arrows/Shapes audit + completion ------------------
// Brush, Highlighter, Arrow, Arrow Up/Down, Rectangle, Path, Circle,
// Ellipse, Polyline, Triangle were already genuinely complete and are
// deliberately NOT touched or re-tested here. Arrow Marker, Rotated
// Rectangle, Arc, Curve, and Double Curve were the five found missing.

{
  const PHASE3D6_NEW_TOOLS = ["arrow-marker", "rotated-rect", "arc", "curve", "double-curve"];
  const missing = PHASE3D6_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-6 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D6_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} declares stroke capability`, TOOL_BY_ID[id]?.capabilities.stroke === true);
  }
  ok(
    "all five Phase 3D-6 tools are five distinct tool ids",
    new Set(PHASE3D6_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 5,
  );

  ok("Arrow Marker is a single-click point tool with one anchor — genuinely distinct from the 2-anchor Arrow", TOOL_BY_ID["arrow-marker"]?.interactionType === "point" && TOOL_BY_ID["arrow-marker"]?.anchorCount === 1);
  ok("Arrow Marker is a distinct tool id from Arrow/Arrow Up/Arrow Down", TOOL_BY_ID["arrow-marker"]?.id !== TOOL_BY_ID["arrow"]?.id && TOOL_BY_ID["arrow-marker"]?.id !== TOOL_BY_ID["arrow-up"]?.id && TOOL_BY_ID["arrow-marker"]?.id !== TOOL_BY_ID["arrow-down"]?.id);

  ok("Rotated Rectangle is a 3-anchor multi-click tool, same gesture as Parallel Channel", TOOL_BY_ID["rotated-rect"]?.interactionType === "multi-click" && TOOL_BY_ID["rotated-rect"]?.anchorCount === 3);
  ok("Rotated Rectangle declares fill capability (closed 4-corner shape)", TOOL_BY_ID["rotated-rect"]?.capabilities.fill === true);
  ok("Rotated Rectangle is a DISTINCT tool id from the axis-aligned Rectangle", TOOL_BY_ID["rotated-rect"]?.id !== TOOL_BY_ID["rect"]?.id);

  ok("Arc is a 2-anchor drag tool", TOOL_BY_ID["arc"]?.interactionType === "drag" && TOOL_BY_ID["arc"]?.anchorCount === 2);
  ok("Curve is a 3-anchor multi-click tool (start/control/end)", TOOL_BY_ID["curve"]?.interactionType === "multi-click" && TOOL_BY_ID["curve"]?.anchorCount === 3);
  ok("Double Curve is a 4-anchor multi-click tool (start/control1/control2/end)", TOOL_BY_ID["double-curve"]?.interactionType === "multi-click" && TOOL_BY_ID["double-curve"]?.anchorCount === 4);
  ok(
    "Double Curve is a DISTINCT tool id from Curve — not the same tool under a second id",
    TOOL_BY_ID["double-curve"]?.id !== TOOL_BY_ID["curve"]?.id && TOOL_BY_ID["double-curve"]?.anchorCount !== TOOL_BY_ID["curve"]?.anchorCount,
  );

  ok("Brush/Highlighter/Arrow/Arrow Up/Arrow Down/Rectangle/Path/Circle/Ellipse/Polyline/Triangle were already complete and remain implemented:true (untouched)", [
    "brush",
    "highlighter",
    "arrow",
    "arrow-up",
    "arrow-down",
    "rect",
    "path",
    "circle",
    "ellipse",
    "polyline",
    "triangle",
  ].every((id) => TOOL_BY_ID[id]?.implemented === true));
}

// ---- Phase 3D-7: Text/Notes/Content audit + completion ---------------------
// Text and Note (marker) were already genuinely complete and are
// deliberately NOT touched or re-tested here. Price Note, Pin, Table,
// Callout, Comment, Price Label, Signpost, and Flag Mark were the eight
// found missing. Image stays implemented:false (no durable asset-storage
// infrastructure exists in this codebase — see registry.ts's own comment).
// Post/Idea are publishing/community actions, not chart drawings — they
// have no registry entry at all and are not expected to.

{
  const PHASE3D7_NEW_TOOLS = ["price-note", "pin", "table", "callout", "comment", "price-label", "signpost", "flag-mark"];
  const missing = PHASE3D7_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-7 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D7_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "text" category`, TOOL_BY_ID[id]?.category === "text");
  }
  ok(
    "all eight Phase 3D-7 tools are eight distinct tool ids",
    new Set(PHASE3D7_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 8,
  );

  const SINGLE_ANCHOR_TEXT_TOOLS = ["price-note", "pin", "comment", "price-label", "signpost", "flag-mark"];
  for (const id of SINGLE_ANCHOR_TEXT_TOOLS) {
    ok(`${id} is a single-click point tool`, TOOL_BY_ID[id]?.interactionType === "point" && TOOL_BY_ID[id]?.anchorCount === 1);
    ok(`${id} declares text capability (optional label, same shared drawTextLabel every annotation uses)`, TOOL_BY_ID[id]?.capabilities.text === true);
  }
  ok(
    "Pin/Comment/Signpost/Flag Mark/Price Note are five distinct tool ids despite sharing one glyph renderer",
    new Set(["pin", "comment", "signpost", "flag-mark", "price-note"].map((id) => TOOL_BY_ID[id]?.id)).size === 5,
  );

  ok("Table declares the new table capability (structured rows/cells), not plain text", TOOL_BY_ID["table"]?.capabilities.table === true && !TOOL_BY_ID["table"]?.capabilities.text);
  ok("Table is a single-click point tool", TOOL_BY_ID["table"]?.interactionType === "point" && TOOL_BY_ID["table"]?.anchorCount === 1);

  ok("Callout is a real 2-anchor tool (pointed-to location + text box position)", TOOL_BY_ID["callout"]?.interactionType === "drag" && TOOL_BY_ID["callout"]?.anchorCount === 2);
  ok("Callout declares text capability", TOOL_BY_ID["callout"]?.capabilities.text === true);

  // Image graduated to implemented:true in Phase 3D-14 — see that phase's
  // own dedicated block further below for its full coverage.
  ok("Post/Idea have no registry entry — publishing/community actions, not chart drawings", TOOL_BY_ID["post"] === undefined && TOOL_BY_ID["idea"] === undefined);

  ok("Text and Note (marker) were already complete and remain implemented:true (untouched)", TOOL_BY_ID["text"]?.implemented === true && TOOL_BY_ID["marker"]?.implemented === true);
}

// ---- Phase 3D-8: Forecasting audit + completion ----------------------------
// Long Position and Short Position were already genuinely complete (real
// entry/stop/target + positionMetrics risk/reward math, correctly mirrored
// via one shared formula) and are deliberately NOT touched or re-tested
// here. Position Forecast, Bars Pattern, Ghost Feed, and Sector were the
// four found missing/registry-hidden.

{
  const PHASE3D8_NEW_TOOLS = ["forecast", "bars-pattern", "ghost-feed", "sector"];
  const missing = PHASE3D8_NEW_TOOLS.filter((id) => !TOOL_BY_ID[id]?.implemented);
  ok(`every Phase 3D-8 new tool is implemented:true (missing: ${missing.join(",") || "none"})`, missing.length === 0);
  for (const id of PHASE3D8_NEW_TOOLS) {
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "forecast" category`, TOOL_BY_ID[id]?.category === "forecast");
  }
  ok(
    "all four Phase 3D-8 tools are four distinct tool ids",
    new Set(PHASE3D8_NEW_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 4,
  );

  ok("Position Forecast is a 3-anchor multi-click tool, DISTINCT from Long/Short's 2-anchor drag risk box", TOOL_BY_ID["forecast"]?.interactionType === "multi-click" && TOOL_BY_ID["forecast"]?.anchorCount === 3);
  ok("Position Forecast does NOT declare positionMetrics (it's a projection sketch, not a risk/reward tool)", !TOOL_BY_ID["forecast"]?.capabilities.positionMetrics);

  // Bars Pattern (Phase 3D-8 closeout): upgraded from a 2-anchor drag to a
  // genuine 3-stage multi-click gesture — drag the source range (p1/p2),
  // then one more independent click for the destination anchor
  // (points[0]).
  ok("Bars Pattern is a 3-anchor multi-click tool (source range + independent destination)", TOOL_BY_ID["bars-pattern"]?.interactionType === "multi-click" && TOOL_BY_ID["bars-pattern"]?.anchorCount === 3);
  ok("Ghost Feed is a 2-anchor drag tool", TOOL_BY_ID["ghost-feed"]?.interactionType === "drag" && TOOL_BY_ID["ghost-feed"]?.anchorCount === 2);
  ok("Bars Pattern and Ghost Feed are distinct tool ids despite Ghost Feed also being a simple 2-anchor projection", TOOL_BY_ID["bars-pattern"]?.id !== TOOL_BY_ID["ghost-feed"]?.id);

  ok("Sector is a 3-anchor multi-click tool (origin + two radial boundary points)", TOOL_BY_ID["sector"]?.interactionType === "multi-click" && TOOL_BY_ID["sector"]?.anchorCount === 3);
  ok("Sector declares fill capability (a real filled pie-slice)", TOOL_BY_ID["sector"]?.capabilities.fill === true);

  ok("Long/Short Position were already complete and remain implemented:true (untouched)", TOOL_BY_ID["long"]?.implemented === true && TOOL_BY_ID["short"]?.implemented === true);
  ok("Long/Short Position both declare positionMetrics — the real shared risk/reward model", TOOL_BY_ID["long"]?.capabilities.positionMetrics === true && TOOL_BY_ID["short"]?.capabilities.positionMetrics === true);
}

// ---- Phase 3D-10: Measurers audit -------------------------------------------
// Price Range, Date Range, and Date + Price Range ("measure") were already
// genuinely implemented (Phase 1) and are confirmed here as still correctly
// registered; the render-label math was upgraded to shared calc.ts
// functions (computePriceRange/computeDateRange, tested in
// drawingCalc.test.mjs) but the registry entries themselves needed no
// changes. "ruler" graduated to implemented:true in Phase 3D-13 (see that
// phase's own dedicated block further below) — it deliberately reuses this
// exact render/hit-test code rather than a second copy.

{
  const MEASURER_TOOLS = ["price-range", "date-range", "measure"];
  for (const id of MEASURER_TOOLS) {
    ok(`${id} is implemented:true`, TOOL_BY_ID[id]?.implemented === true);
    ok(`${id} is in IMPLEMENTED_TOOLS`, IMPLEMENTED_TOOLS.some((t) => t.id === id));
    ok(`${id} resolves to the "measure" category`, TOOL_BY_ID[id]?.category === "measure");
    ok(`${id} is a 2-anchor drag tool`, TOOL_BY_ID[id]?.interactionType === "drag" && TOOL_BY_ID[id]?.anchorCount === 2);
  }
  ok(
    "Price Range/Date Range/Date+Price Range are three distinct tool ids",
    new Set(MEASURER_TOOLS.map((id) => TOOL_BY_ID[id]?.id)).size === 3,
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

// ---- Phase 3D-11: Toolbar Redesign and Organization ------------------------
// DrawToolbar.tsx has no logic of its own beyond rendering this registry's
// data (a rail button per TOOL_GROUPS entry, a flyout row per
// IMPLEMENTED_TOOLS filtered by category — see its own doc comment), so
// "every completed category appears", "every completed tool is reachable",
// and "section headings are correct" are all registry-level facts, tested
// here exactly like every prior phase's registry coverage. What genuinely
// can't be exercised without a browser (a real click actually selecting a
// tool, hover/hydration, scrolling) is covered by this phase's Chromium
// pass instead — see the phase completion report.

{
  // The 16 sections, in order, with their exact visible names (uppercased
  // via CSS in the flyout header, not in this label string itself).
  // Phase 3D-15 moved "forecast" and "volume" to sit directly under
  // "lines", in that order (an order-only change — each keeps its own
  // category on every tool below, never merged into "lines" or into each
  // other); "arrows" stays at its original phase-brief position (between
  // "brushes" and "shapes") — an earlier pass in this phase mistakenly
  // moved "arrows" under "lines" instead; that was reverted. "text" moved
  // down to sit directly above "content" (which holds the Image tool), and
  // "measure" moved up to sit directly under "pitchforks" — both also
  // order-only, each still its own section. Every other section keeps its
  // original relative order ("shapes" and "text" are now adjacent, having
  // had "measure" extracted from between them).
  const EXPECTED_GROUPS = [
    ["lines", "Lines"],
    ["forecast", "Forecasting"],
    ["volume", "Volume-Based"],
    ["channels", "Channels"],
    ["pitchforks", "Pitchforks"],
    ["measure", "Measurers"],
    ["fib", "Fibonacci"],
    ["gann", "Gann"],
    ["patterns", "Chart Patterns"],
    ["elliott", "Elliott Waves"],
    ["cycles", "Cycles"],
    ["brushes", "Brushes"],
    ["arrows", "Arrows"],
    ["shapes", "Shapes"],
    ["text", "Text and Notes"],
    ["content", "Content"],
  ];
  ok(
    "TOOL_GROUPS has exactly the 16 expected sections, in order (Forecasting and Volume-Based moved directly under Lines, Text and Notes moved directly above Content, and Measurers moved directly under Pitchforks, in Phase 3D-15), with the phase brief's exact section names",
    JSON.stringify(TOOL_GROUPS.map((g) => [g.id, g.label])) === JSON.stringify(EXPECTED_GROUPS),
  );

  // Every implemented tool the phase brief's SECTION ORGANIZATION lists,
  // mapped to the section it must resolve to — a complete map, not a
  // sample, so a tool silently left in the wrong section (or missing
  // entirely) is caught.
  const EXPECTED_SECTION = {
    trend: "lines", ray: "lines", extended: "lines", "info-line": "lines", "trend-angle": "lines",
    hline: "lines", hray: "lines", vline: "lines", crossline: "lines",
    channel: "channels", "regression-trend": "channels", "flat-channel": "channels", "disjoint-channel": "channels",
    pitchfork: "pitchforks", "schiff-pitchfork": "pitchforks", "modified-schiff-pitchfork": "pitchforks", "inside-pitchfork": "pitchforks",
    fib: "fib", "fib-ext": "fib", "fib-channel": "fib", "fib-time": "fib", "fib-speed-fan": "fib",
    "fib-time-trend": "fib", "fib-circles": "fib", "fib-spiral": "fib", "fib-speed-arcs": "fib", "fib-wedge": "fib", pitchfan: "fib",
    "gann-box": "gann", "gann-square-fixed": "gann", "gann-square": "gann", "gann-fan": "gann",
    xabcd: "patterns", cypher: "patterns", "head-shoulders": "patterns", abcd: "patterns", "triangle-pattern": "patterns", "three-drives": "patterns",
    "elliott-impulse": "elliott", "elliott-correction": "elliott", "elliott-triangle": "elliott", "elliott-double-combo": "elliott", "elliott-triple-combo": "elliott",
    "cyclic-lines": "cycles", "time-cycles": "cycles", "sine-line": "cycles",
    brush: "brushes", highlighter: "brushes",
    arrow: "arrows", "arrow-up": "arrows", "arrow-down": "arrows", "arrow-marker": "arrows",
    rect: "shapes", circle: "shapes", triangle: "shapes", "rotated-rect": "shapes", ellipse: "shapes",
    polyline: "shapes", path: "shapes", arc: "shapes", curve: "shapes", "double-curve": "shapes",
    text: "text", marker: "text", "price-note": "text", pin: "text", table: "text",
    callout: "text", comment: "text", "price-label": "text", signpost: "text", "flag-mark": "text",
    long: "forecast", short: "forecast", forecast: "forecast", "bars-pattern": "forecast", "ghost-feed": "forecast", sector: "forecast",
    vwap: "volume", "vp-fixed": "volume", "vp-anchored": "volume",
    "price-range": "measure", "date-range": "measure", measure: "measure", ruler: "measure",
  };
  const ids = Object.keys(EXPECTED_SECTION);
  ok(`the phase brief's SECTION ORGANIZATION lists exactly ${ids.length} implemented tools, matching IMPLEMENTED_TOOLS' count of tools outside the deferred "content" family`, ids.length === IMPLEMENTED_TOOLS.filter((t) => t.category !== "content").length);
  const wrongSection = ids.filter((id) => TOOL_BY_ID[id]?.category !== EXPECTED_SECTION[id]);
  ok(`every tool resolves to its exact SECTION ORGANIZATION section (wrong: ${wrongSection.join(",") || "none"})`, wrongSection.length === 0);
  const notReachable = ids.filter((id) => !IMPLEMENTED_TOOLS.some((t) => t.id === id));
  ok(`every one of those tools is reachable via IMPLEMENTED_TOOLS (missing: ${notReachable.join(",") || "none"})`, notReachable.length === 0);

  // Image/Post/Idea must never leak into the toolbar as fake working
  // drawings. As of Phase 3D-11 this asserted the whole "content" family
  // contributed zero implemented tools; Phase 3D-13 graduated Content Icon
  // and Emoji; Phase 3D-14 graduated Image too (see each phase's own
  // dedicated block further below) — the family now contributes all three
  // of its entries as genuinely implemented, real (not faked) tools.
  ok(
    "the Content family contributes all three of Content Icon + Emoji + Image as implemented",
    IMPLEMENTED_TOOLS.filter((t) => t.category === "content").length === 3 &&
      ["content-icon", "emoji", "image"].every((id) => IMPLEMENTED_TOOLS.some((t) => t.id === id)),
  );

  // Spot-check icon distinctness for the specific collisions this phase's
  // redesign was required to resolve (not an exhaustive uniqueness
  // requirement — some sharing between genuinely near-identical tools, e.g.
  // the four Pitchfork variants or the Elliott family, is intentional).
  ok("Trend Line no longer shares an icon with Long Position", TOOL_BY_ID["trend"]?.icon !== TOOL_BY_ID["long"]?.icon);
  ok("Note no longer shares an icon with Pin", TOOL_BY_ID["marker"]?.icon !== TOOL_BY_ID["pin"]?.icon);
  ok("Comment no longer shares an icon with Callout", TOOL_BY_ID["comment"]?.icon !== TOOL_BY_ID["callout"]?.icon);
  ok("Price Note, Price Label, and Signpost are three distinct icons", new Set([TOOL_BY_ID["price-note"]?.icon, TOOL_BY_ID["price-label"]?.icon, TOOL_BY_ID["signpost"]?.icon]).size === 3);
  ok("Rotated Rectangle no longer shares an icon with Flat Top/Bottom", TOOL_BY_ID["rotated-rect"]?.icon !== TOOL_BY_ID["flat-channel"]?.icon);
  ok("Arc, Fib Speed Resistance Arcs, and Sector are three distinct icons (previously all shared Compass)", new Set([TOOL_BY_ID["arc"]?.icon, TOOL_BY_ID["fib-speed-arcs"]?.icon, TOOL_BY_ID["sector"]?.icon]).size === 3);
  ok("Curve no longer shares an icon with Polyline", TOOL_BY_ID["curve"]?.icon !== TOOL_BY_ID["polyline"]?.icon);
  ok("Double Curve no longer shares an icon with Curve", TOOL_BY_ID["double-curve"]?.icon !== TOOL_BY_ID["curve"]?.icon);
  ok("Vertical Line no longer shares an icon with Horizontal Line", TOOL_BY_ID["vline"]?.icon !== TOOL_BY_ID["hline"]?.icon);
  ok("Crossline no longer shares an icon with the Gann grid tools", TOOL_BY_ID["crossline"]?.icon !== TOOL_BY_ID["gann-box"]?.icon);
  ok("Price Range, Date Range, and Date + Price Range are three distinct icons (previously all shared Ruler)", new Set([TOOL_BY_ID["price-range"]?.icon, TOOL_BY_ID["date-range"]?.icon, TOOL_BY_ID["measure"]?.icon]).size === 3);
  ok("Arrow Marker no longer shares an icon with Arrow", TOOL_BY_ID["arrow-marker"]?.icon !== TOOL_BY_ID["arrow"]?.icon);
}

// ---- Phase 3D-13: Ruler graduates to implemented:true ----------------------
// Ruler is a deliberate duplicate-by-design of Date + Price Range — same
// p1/p2 shape, same interactionType/anchorCount, same render/hit-test code
// path (see StudioChart.tsx, which now lists "ruler" alongside "measure" in
// all three of its measure-tool branches instead of a second copy).

{
  ok("ruler is now implemented:true", TOOL_BY_ID["ruler"]?.implemented === true);
  ok("ruler is in IMPLEMENTED_TOOLS", IMPLEMENTED_TOOLS.some((t) => t.id === "ruler"));
  ok("ruler resolves to the \"measure\" section, alongside Price Range/Date Range/Date + Price Range", TOOL_BY_ID["ruler"]?.category === "measure");
  ok(
    "ruler shares the exact same interactionType/anchorCount/capabilities shape as Date + Price Range (genuinely the same tool, not a lookalike with drifted metadata)",
    TOOL_BY_ID["ruler"]?.interactionType === TOOL_BY_ID["measure"]?.interactionType &&
      TOOL_BY_ID["ruler"]?.anchorCount === TOOL_BY_ID["measure"]?.anchorCount &&
      JSON.stringify(TOOL_BY_ID["ruler"]?.capabilities) === JSON.stringify(TOOL_BY_ID["measure"]?.capabilities),
  );
  ok("ruler is still its own distinct tool id, not an alias of measure", TOOL_BY_ID["ruler"]?.id !== TOOL_BY_ID["measure"]?.id);
}

// ---- Phase 3D-13: Content Icon / Emoji graduate to implemented:true -------
// Both reuse existing architecture rather than new infrastructure: Content
// Icon draws a small curated set of REAL lucide-react icon geometries (see
// StudioChart.tsx's ICON_GLYPH_PATHS) via the new `iconPicker` capability;
// Emoji is plain unicode text rendered larger via the existing `text`
// capability. Image (real file uploads, needing durable storage this
// codebase doesn't have) is deliberately NOT included here — see the block
// above confirming it stays implemented:false.

{
  ok("content-icon is now implemented:true", TOOL_BY_ID["content-icon"]?.implemented === true);
  ok("emoji is now implemented:true", TOOL_BY_ID["emoji"]?.implemented === true);
  ok("both are in IMPLEMENTED_TOOLS", IMPLEMENTED_TOOLS.some((t) => t.id === "content-icon") && IMPLEMENTED_TOOLS.some((t) => t.id === "emoji"));
  ok("both resolve to the \"content\" section", TOOL_BY_ID["content-icon"]?.category === "content" && TOOL_BY_ID["emoji"]?.category === "content");
  ok("both are single-anchor point tools (placed with one click, like Note/Pin/Comment)", TOOL_BY_ID["content-icon"]?.interactionType === "point" && TOOL_BY_ID["content-icon"]?.anchorCount === 1 && TOOL_BY_ID["emoji"]?.interactionType === "point" && TOOL_BY_ID["emoji"]?.anchorCount === 1);
  ok("Content Icon declares the new iconPicker capability", TOOL_BY_ID["content-icon"]?.capabilities.iconPicker === true);
  ok("Content Icon also declares text (optional caption + reused font-size-as-icon-size control)", TOOL_BY_ID["content-icon"]?.capabilities.text === true);
  ok("Emoji declares text (the emoji character itself) but NOT iconPicker (it has no curated catalog — any unicode emoji works)", TOOL_BY_ID["emoji"]?.capabilities.text === true && !TOOL_BY_ID["emoji"]?.capabilities.iconPicker);
  ok("Content Icon and Emoji are two distinct tool ids", TOOL_BY_ID["content-icon"]?.id !== TOOL_BY_ID["emoji"]?.id);
}

// ---- Phase 3D-14: Image graduates to implemented:true ----------------------
// Backed by a real, durable Supabase Storage bucket (private "chart-images",
// see supabase/migrations/20260827120000_chart_images_bucket.sql) and
// src/lib/storage/chartImages.ts — not base64/localStorage. Deliberately a
// 2-anchor DRAG box (p1/p2 are its two opposite corners), matching
// Rectangle's own geometry exactly, so it reuses Rectangle's existing body/
// corner hit-test and resize/move code in StudioChart.tsx with zero new
// geometry math (see that file's "image" render/hit-test branches). This
// is the last of the four Phase 3D-12-audit deferred entries (ruler,
// content-icon, emoji, image) to graduate — see the "no drawing tool
// remains implemented:false" assertion near the top of this file.

{
  ok("image is now implemented:true", TOOL_BY_ID["image"]?.implemented === true);
  ok("image is in IMPLEMENTED_TOOLS", IMPLEMENTED_TOOLS.some((t) => t.id === "image"));
  ok("image resolves to the \"content\" section, alongside Content Icon/Emoji", TOOL_BY_ID["image"]?.category === "content");
  ok(
    "image is a 2-anchor DRAG tool (a resizable box, like Rectangle) — NOT the single-click point tool it used to be declared as",
    TOOL_BY_ID["image"]?.interactionType === "drag" && TOOL_BY_ID["image"]?.anchorCount === 2,
  );
  ok(
    "image shares the exact same interactionType/anchorCount shape as Rectangle (the geometry it deliberately reuses)",
    TOOL_BY_ID["image"]?.interactionType === TOOL_BY_ID["rect"]?.interactionType && TOOL_BY_ID["image"]?.anchorCount === TOOL_BY_ID["rect"]?.anchorCount,
  );
  ok("image declares the new imageReplace capability (the settings popover's \"Replace Image\" action)", TOOL_BY_ID["image"]?.capabilities.imageReplace === true);
  ok("image does NOT declare stroke/fill/text — its content IS the picture, not a styleable shape", !TOOL_BY_ID["image"]?.capabilities.stroke && !TOOL_BY_ID["image"]?.capabilities.fill && !TOOL_BY_ID["image"]?.capabilities.text);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
