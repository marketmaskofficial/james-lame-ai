// Coverage for UI-5c's persistence pieces that are testable without a live
// Supabase project: settings-snapshot defaults derived from a spec's own
// inputs, and the conversation-scoping filter that guards against one AI
// Builder project's chat turns leaking into another's.
//
// Usage: npx tsx test/workspace/aiBuilderPersistence.test.mjs

import { defaultSettingsFromSpec } from "../../src/lib/spec/inputDefaults.ts";
import { messagesForIndicator } from "../../src/lib/aiBuilder/conversationScope.ts";
import { coerceSpec, EMPTY_SPEC } from "../../src/lib/spec/types.ts";

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

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(`${name} (${a} === ${b})`, a === b);
}

// ---- defaultSettingsFromSpec -----------------------------------------------
{
  const spec = coerceSpec({
    name: "Test",
    inputs: [
      { name: "fastLen", type: "number", default: 21 },
      { name: "useAtr", type: "bool", default: true },
      { name: "label", type: "string", default: "hi" },
      { name: "lineColor", type: "color", default: "#22c55e" },
    ],
  });
  eq(
    "settings snapshot mirrors each input's own default",
    defaultSettingsFromSpec(spec),
    { fastLen: 21, useAtr: true, label: "hi", lineColor: "#22c55e" },
  );
}
{
  eq("empty inputs list produces empty settings", defaultSettingsFromSpec(EMPTY_SPEC), {});
}
{
  // Must read the CURRENT spec's defaults, not memoize/stick to a prior call.
  const a = coerceSpec({ inputs: [{ name: "len", type: "number", default: 10 }] });
  const b = coerceSpec({ inputs: [{ name: "len", type: "number", default: 99 }] });
  eq("first spec's default", defaultSettingsFromSpec(a), { len: 10 });
  eq("second spec's default is independent", defaultSettingsFromSpec(b), { len: 99 });
}

// ---- messagesForIndicator (no-leakage guard) -------------------------------
{
  const all = [
    { indicatorId: "proj-a", message: "a-turn-1" },
    { indicatorId: "proj-b", message: "b-turn-1" },
    { indicatorId: "proj-a", message: "a-turn-2" },
    { indicatorId: "proj-b", message: "b-turn-2" },
    { indicatorId: "proj-a", message: "a-turn-3" },
  ];

  eq(
    "project A sees only its own turns, in order",
    messagesForIndicator(all, "proj-a"),
    ["a-turn-1", "a-turn-2", "a-turn-3"],
  );
  eq(
    "project B sees only its own turns, in order",
    messagesForIndicator(all, "proj-b"),
    ["b-turn-1", "b-turn-2"],
  );
  eq("switching to a third, unseen project yields nothing", messagesForIndicator(all, "proj-c"), []);
  eq("null indicatorId (no active project) yields nothing", messagesForIndicator(all, null), []);
  ok(
    "project A's turns never include project B's content",
    !messagesForIndicator(all, "proj-a").some((m) => m.startsWith("b-")),
  );
  ok(
    "project B's turns never include project A's content",
    !messagesForIndicator(all, "proj-b").some((m) => m.startsWith("a-")),
  );
}

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
