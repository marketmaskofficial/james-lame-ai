// Coverage for the Phase 4E-1/4E-2 Trade Journal editor's pure
// draft/dirty-state logic: src/lib/dashboard/journalDraft.ts. Pure,
// synchronous, no I/O — matches the style of
// test/dashboard/tradeExplorer.test.mjs.
//
// Usage: npx tsx test/dashboard/journalDraft.test.mjs

import {
  isJournalDraftDirty,
  sameLabelSet,
  sessionToSelectValue,
  selectValueToSession,
  singleTermToSelectValue,
  selectValueToSingleTerm,
} from "../../src/lib/dashboard/journalDraft.ts";

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

/** A fully-populated JournalDraft with every Phase 4E-2 field defaulted —
 * every test overrides only the field(s) it cares about, so adding a new
 * field to the type in the future can't silently leave old test objects
 * "missing" a property the way plain inline literals would. */
function baseDraft(overrides = {}) {
  return {
    notes: "",
    session: null,
    grade: null,
    setup: null,
    strategy: null,
    emotion: null,
    mistakes: [],
    tags: [],
    ...overrides,
  };
}

// ==== isJournalDraftDirty — notes/session (Phase 4E-1 behavior preserved)
{
  ok(
    "same loaded/saved notes and session is clean",
    isJournalDraftDirty(baseDraft({ notes: "Good trade", session: "asia" }), baseDraft({ notes: "Good trade", session: "asia" })) === false,
  );
  ok(
    "changed notes is dirty",
    isJournalDraftDirty(baseDraft({ notes: "Good trade" }), baseDraft({ notes: "Good trade!" })) === true,
  );
  {
    // Mirrors the exact example from the Phase 4E-1 brief: edit away from
    // the saved value (dirty), then type it back to the exact saved value
    // (clean again) — dirty state is a value comparison, not a "has the
    // user touched this field" flag.
    const saved = baseDraft({ notes: "Good trade" });
    ok("editing away from the saved notes is dirty", isJournalDraftDirty(saved, baseDraft({ notes: "Good trade!" })) === true);
    ok("typing the exact saved notes back is clean again", isJournalDraftDirty(saved, baseDraft({ notes: "Good trade" })) === false);
  }
  ok(
    "changed session (notes unchanged) is dirty",
    isJournalDraftDirty(baseDraft({ notes: "same", session: "asia" }), baseDraft({ notes: "same", session: "london" })) === true,
  );
  ok(
    "changed session from null to a value is dirty",
    isJournalDraftDirty(baseDraft({ notes: "same" }), baseDraft({ notes: "same", session: "asia" })) === true,
  );
  ok("empty-string notes vs empty-string notes is clean", isJournalDraftDirty(baseDraft(), baseDraft()) === false);
  ok(
    "notes with line breaks compare exactly — no dirty flag on a no-op reload",
    isJournalDraftDirty(
      baseDraft({ notes: "line one\nline two\n\nline four", session: "newYork" }),
      baseDraft({ notes: "line one\nline two\n\nline four", session: "newYork" }),
    ) === false,
  );
  ok(
    "a real edit inside multi-line notes is still detected as dirty",
    isJournalDraftDirty(baseDraft({ notes: "line one\nline two" }), baseDraft({ notes: "line one\nline TWO" })) === true,
  );
}

// ==== isJournalDraftDirty — Grade
{
  ok("same grade is clean", isJournalDraftDirty(baseDraft({ grade: "A+" }), baseDraft({ grade: "A+" })) === false);
  ok("changed grade is dirty", isJournalDraftDirty(baseDraft({ grade: "A+" }), baseDraft({ grade: "F" })) === true);
  ok(
    "grading a losing trade A+ is just a normal value — dirty-check doesn't know or care about outcome",
    isJournalDraftDirty(baseDraft(), baseDraft({ grade: "A+" })) === true,
  );
  ok("clearing a grade back to null is clean once saved as null", isJournalDraftDirty(baseDraft({ grade: null }), baseDraft({ grade: null })) === false);
}

// ==== isJournalDraftDirty — Setup / Strategy / Emotion (single-select terms)
{
  ok("same setup is clean", isJournalDraftDirty(baseDraft({ setup: "Order Block" }), baseDraft({ setup: "Order Block" })) === false);
  ok("changed setup is dirty", isJournalDraftDirty(baseDraft({ setup: "Order Block" }), baseDraft({ setup: "FVG" })) === true);
  ok("setting setup from null is dirty", isJournalDraftDirty(baseDraft(), baseDraft({ setup: "Breakout" })) === true);
  ok("same strategy is clean", isJournalDraftDirty(baseDraft({ strategy: "London Breakout" }), baseDraft({ strategy: "London Breakout" })) === false);
  ok("changed strategy is dirty", isJournalDraftDirty(baseDraft({ strategy: "London Breakout" }), baseDraft({ strategy: "NY Reversal" })) === true);
  ok("same emotion is clean", isJournalDraftDirty(baseDraft({ emotion: "Calm" }), baseDraft({ emotion: "Calm" })) === false);
  ok("changed emotion is dirty", isJournalDraftDirty(baseDraft({ emotion: "Calm" }), baseDraft({ emotion: "FOMO" })) === true);
  ok(
    "setup and strategy are independent fields — changing one never dirties the other's comparison",
    isJournalDraftDirty(baseDraft({ setup: "FVG", strategy: "A" }), baseDraft({ setup: "FVG", strategy: "A" })) === false,
  );
}

// ==== isJournalDraftDirty — Mistakes / Tags (multi-select, order-independent)
{
  ok(
    "same mistakes in the same order is clean",
    isJournalDraftDirty(baseDraft({ mistakes: ["Early Entry", "Moved Stop"] }), baseDraft({ mistakes: ["Early Entry", "Moved Stop"] })) === false,
  );
  ok(
    "same mistakes selected in a DIFFERENT order is still clean — order must not matter",
    isJournalDraftDirty(baseDraft({ mistakes: ["Early Entry", "Moved Stop"] }), baseDraft({ mistakes: ["Moved Stop", "Early Entry"] })) === false,
  );
  ok(
    "adding a mistake is dirty",
    isJournalDraftDirty(baseDraft({ mistakes: ["Early Entry"] }), baseDraft({ mistakes: ["Early Entry", "Moved Stop"] })) === true,
  );
  ok("removing a mistake is dirty", isJournalDraftDirty(baseDraft({ mistakes: ["Early Entry", "Moved Stop"] }), baseDraft({ mistakes: ["Early Entry"] })) === true);
  ok(
    "swapping one mistake for a different one (same count) is dirty",
    isJournalDraftDirty(baseDraft({ mistakes: ["Early Entry"] }), baseDraft({ mistakes: ["Late Entry"] })) === true,
  );
  ok("no mistakes vs no mistakes is clean", isJournalDraftDirty(baseDraft(), baseDraft()) === false);

  ok("same tags in the same order is clean", isJournalDraftDirty(baseDraft({ tags: ["London", "News"] }), baseDraft({ tags: ["London", "News"] })) === false);
  ok(
    "same tags in a different order is clean",
    isJournalDraftDirty(baseDraft({ tags: ["London", "News"] }), baseDraft({ tags: ["News", "London"] })) === false,
  );
  ok("adding a tag is dirty", isJournalDraftDirty(baseDraft({ tags: ["London"] }), baseDraft({ tags: ["London", "NY Open"] })) === true);
}

// ==== sameLabelSet (order-independent set-equality) directly
{
  ok("identical arrays are the same set", sameLabelSet(["a", "b"], ["a", "b"]) === true);
  ok("reordered arrays are the same set", sameLabelSet(["a", "b"], ["b", "a"]) === true);
  ok("different lengths are never the same set", sameLabelSet(["a"], ["a", "b"]) === false);
  ok("different contents (same length) are not the same set", sameLabelSet(["a", "b"], ["a", "c"]) === false);
  ok("two empty arrays are the same set", sameLabelSet([], []) === true);
  ok("case-sensitive: 'London' and 'london' are different labels here", sameLabelSet(["London"], ["london"]) === false);
}

// ==== session <-> select-value round trip
{
  ok("null session maps to the empty select value", sessionToSelectValue(null) === "");
  ok("a real session maps to itself as the select value", sessionToSelectValue("asia") === "asia");
  ok("empty select value normalizes back to null (No session)", selectValueToSession("") === null);
  ok("a real select value round-trips back to the same session", selectValueToSession("overlap") === "overlap");
  ok(
    "round trip is lossless for every real session",
    ["asia", "london", "overlap", "newYork", "offHours"].every((s) => selectValueToSession(sessionToSelectValue(s)) === s),
  );
}

// ==== single-term (grade/setup/strategy/emotion select) <-> select-value round trip
{
  ok("null single-term value maps to the empty select value", singleTermToSelectValue(null) === "");
  ok("a real value maps to itself as the select value", singleTermToSelectValue("A+") === "A+");
  ok("empty select value normalizes back to null", selectValueToSingleTerm("") === null);
  ok("a real select value round-trips back to the same value", selectValueToSingleTerm("Order Block") === "Order Block");
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
