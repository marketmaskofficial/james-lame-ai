// Coverage for the Phase 4E-1 Trade Journal editor's pure draft/dirty-state
// logic: src/lib/dashboard/journalDraft.ts. Pure, synchronous, no I/O —
// matches the style of test/dashboard/tradeExplorer.test.mjs.
//
// Usage: npx tsx test/dashboard/journalDraft.test.mjs

import { isJournalDraftDirty, sessionToSelectValue, selectValueToSession } from "../../src/lib/dashboard/journalDraft.ts";

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

// ==== isJournalDraftDirty
{
  ok(
    "same loaded/saved notes and session is clean",
    isJournalDraftDirty({ notes: "Good trade", session: "asia" }, { notes: "Good trade", session: "asia" }) === false,
  );
  ok(
    "changed notes is dirty",
    isJournalDraftDirty({ notes: "Good trade", session: null }, { notes: "Good trade!", session: null }) === true,
  );
  {
    // Mirrors the exact example from the Phase 4E-1 brief: edit away from
    // the saved value (dirty), then type it back to the exact saved value
    // (clean again) — dirty state is a value comparison, not a "has the
    // user touched this field" flag.
    const saved = { notes: "Good trade", session: null };
    ok("editing away from the saved notes is dirty", isJournalDraftDirty(saved, { notes: "Good trade!", session: null }) === true);
    ok("typing the exact saved notes back is clean again", isJournalDraftDirty(saved, { notes: "Good trade", session: null }) === false);
  }
  ok(
    "changed session (notes unchanged) is dirty",
    isJournalDraftDirty({ notes: "same", session: "asia" }, { notes: "same", session: "london" }) === true,
  );
  ok(
    "changed session from null to a value is dirty",
    isJournalDraftDirty({ notes: "same", session: null }, { notes: "same", session: "asia" }) === true,
  );
  ok(
    "empty-string notes vs empty-string notes is clean",
    isJournalDraftDirty({ notes: "", session: null }, { notes: "", session: null }) === false,
  );
  ok(
    "notes with line breaks compare exactly — no dirty flag on a no-op reload",
    isJournalDraftDirty({ notes: "line one\nline two\n\nline four", session: "newYork" }, { notes: "line one\nline two\n\nline four", session: "newYork" }) ===
      false,
  );
  ok(
    "a real edit inside multi-line notes is still detected as dirty",
    isJournalDraftDirty({ notes: "line one\nline two", session: null }, { notes: "line one\nline TWO", session: null }) === true,
  );
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

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
