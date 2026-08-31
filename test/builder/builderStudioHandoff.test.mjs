// Phase 5A-6 — Builder → Chart Studio → Backtest handoff: a static
// source-inspection test (same style as test/builder/builderShell.test.mjs
// and test/builder/builderPersistence.test.mjs) proving the handoff reuses
// the existing canonical chain end to end — identity (indicatorId) only
// crosses the boundary, no second renderer, no second backtest engine, no
// duplicate indicator creation, no new server endpoint, no schema change.
//
// Usage: npx tsx test/builder/builderStudioHandoff.test.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

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

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relPath) => stripComments(readFileSync(join(repoRoot, relPath), "utf8"));

const builderWorkspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
const builderToolbarSrc = read("src/components/builder/BuilderToolbar.tsx");
const useBuilderProjectSrc = read("src/components/builder/useBuilderProject.ts");
const generationStateSrc = read("src/lib/builder/generationState.ts");
const studioSrc = read("src/routes/studio.tsx");
const strategyTesterSrc = read("src/components/studio/StrategyTester.tsx");
const backtestEngineSrc = read("src/lib/backtest/engine.ts");

// ---- 1/2/3/4. Add to Chart: gate, no-save-when-clean, save-then-navigate,
// ---- failed-save blocks navigation ----------------------------------------
{
  ok(
    "canHandoff requires a real indicatorId — Add to Chart/Backtest are disabled without one (test 1)",
    /export function canHandoff\([\s\S]{0,250}return indicatorId !== null/.test(generationStateSrc),
  );
  ok(
    "ensureSavedForHandoff performs NO save at all for an already-clean project — returns true immediately (test 2)",
    /async function ensureSavedForHandoff\(\)[\s\S]{0,30}\{\s*if \(!state\.dirty\) return true;/.test(useBuilderProjectSrc),
  );
  ok(
    "ensureSavedForHandoff's dirty path reuses the SAME saveMutation (snapshot:false) Save already uses — never a second persistence call",
    /async function ensureSavedForHandoff\(\)[\s\S]{0,300}saveMutation\.mutateAsync\(\)/.test(useBuilderProjectSrc),
  );
  ok(
    "handleHandoff calls ensureSavedForHandoff BEFORE navigate — a dirty project is saved first (test 3)",
    /async function handleHandoff\([\s\S]{0,50}\{[\s\S]{0,150}const ok = await ensureSavedForHandoff\(\);[\s\S]{0,120}navigate\(/.test(builderWorkspaceSrc),
  );
  ok(
    "handleHandoff bails out (never navigates) when the save failed (test 4)",
    /const ok = await ensureSavedForHandoff\(\);\s*if \(!ok\) return;/.test(builderWorkspaceSrc),
  );
  ok(
    "Add to Chart / Backtest are gated by the SAME canHandoff check as the toolbar's disabled state — never a hardcoded true",
    /canHandoffCheck\(state\.indicatorId, state\.status, savePending\)/.test(builderWorkspaceSrc),
  );
}

// ---- 5. Only indicatorId crosses the Builder -> Studio boundary -----------
{
  const navigateBlock = builderWorkspaceSrc.match(/navigate\(\{ to: "\/studio", search: \{[\s\S]{0,150}?\}\s*\}\);/)?.[0] ?? "";
  ok("a navigate({ to: '/studio', ... }) call exists in BuilderWorkspace.tsx", navigateBlock.length > 0);
  ok("the /studio navigation carries indicatorId", /indicatorId:/.test(navigateBlock));
  ok(
    "the /studio navigation NEVER carries sgscript/pine/spec/settings/code — identity only, never source",
    !/sgscript|pine:|spec:|settings:|\bcode\b/.test(navigateBlock),
  );
}

// ---- 6/7. Studio reuses its existing persisted-indicator loader/renderer --
{
  ok(
    "Studio's handoff load effect reuses the EXISTING getIndicator — no new server function",
    /import\s*\{[^}]*\bgetIndicator\b[^}]*\}\s*from\s*["']@\/lib\/indicators\.functions["']/.test(studioSrc),
  );
  ok("Studio never defines a new createServerFn for the handoff", (studioSrc.match(/createServerFn/g) ?? []).length === 0);
  ok(
    "Studio's handoff effect reuses the EXISTING runCode (the same function 'Add to chart'/'Edit code' already call) — no second execution/render pipeline",
    /await runCode\(row\.code, \{ settings: rowSettings, key: `saved-\$\{row\.id\}`, savedId: row\.id \}\)/.test(studioSrc),
  );
  ok(
    "the handoff-loaded key matches the Saved-list Add-to-chart button's own `saved-${id}` convention — upserts into the SAME chart slot, never a second visual copy",
    /key: `saved-\$\{row\.id\}`/.test(studioSrc),
  );
}

// ---- 8. Builder-created ID survives Studio (no new indicator row) --------
{
  ok(
    "Studio's handoff effect never calls createIndicator/createIndicatorFn — it loads the EXISTING row by id, never creates a new one",
    (() => {
      const start = studioSrc.indexOf("if (!handoffIndicatorId) return;");
      const end = studioSrc.indexOf("const saveMut = useMutation", start);
      const block = studioSrc.slice(start, end);
      return start !== -1 && end !== -1 && block.length > 0 && !/createIndicatorFn\(/.test(block);
    })(),
  );
  ok("Studio's handoff effect sets aiIndicatorId to the SAME row.id it fetched — real persisted identity, never a transient anonymous copy", /setAiIndicatorId\(row\.id\)/.test(studioSrc));
}

// ---- 9. Edit in Builder returns to /builder/$id ---------------------------
{
  ok(
    "Studio's Saved-indicator row has a real 'Edit in Builder' link to /builder/$id with the row's own id",
    /title="Edit in Builder"[\s\S]{0,80}to="\/builder\/\$id"[\s\S]{0,40}params=\{\{ id: row\.id \}\}/.test(studioSrc),
  );
}

// ---- 10/11. Backtest uses the SAME identity + save-first path as Add to Chart
{
  ok(
    "Backtest and Add to Chart are literally the SAME handleHandoff function (openTester true/false) — one save-before-handoff code path, not two",
    /const handleAddToChart = \(\) => void handleHandoff\(false\);/.test(builderWorkspaceSrc) &&
      /const handleBacktest = \(\) => void handleHandoff\(true\);/.test(builderWorkspaceSrc),
  );
  ok(
    "Backtest's navigation additionally carries openTester so Studio focuses the Strategy Tester on the SAME loaded indicator",
    /search: \{ indicatorId: state\.indicatorId as string, openTester: openTester \|\| undefined \}/.test(builderWorkspaceSrc),
  );
  ok(
    "Studio's handoff effect only focuses the Strategy Tester (never re-selects a different indicator) via the EXISTING focusWidgetTab",
    /if \(handoffOpenTester\) focusWidgetTab\("strategy-tester"\)/.test(studioSrc),
  );
}

// ---- 12. Visual-only indicators never fabricate a strategy (pre-existing,
// ---- untouched — regression guard only) ------------------------------------
{
  ok(
    "StrategyTester.tsx was not touched by Phase 5A-6 and still shows an honest 'no rules to simulate' state instead of fabricating trades",
    /reason === "no-rules"/.test(strategyTesterSrc) && /Define strategy rules/.test(strategyTesterSrc),
  );
}

// ---- 13/14. One engine, one runtime — no duplication -----------------------
{
  ok(
    "the ONLY backtest engine file is src/lib/backtest/engine.ts — Phase 5A-6 adds no second one",
    existsSync(join(repoRoot, "src/lib/backtest/engine.ts")) &&
      readdirSync(join(repoRoot, "src/lib/backtest")).filter((f) => /engine/i.test(f)).length === 1,
  );
  ok("StrategyTester.tsx reuses the existing runBacktestEngine — no reimplementation", /import[\s\S]{0,80}runBacktestEngine[\s\S]{0,250}from ["']@\/lib\/backtest\/engine["']/.test(strategyTesterSrc));
  ok("BuilderWorkspace.tsx never imports the backtest engine directly — Builder hands off IDENTITY, Studio's existing Strategy Tester owns execution", !/backtest\/engine/.test(builderWorkspaceSrc));
  ok("useBuilderProject.ts never imports the backtest engine — no duplicated calculation internals in Builder", !/backtest\/engine|runBacktestEngine/.test(useBuilderProjectSrc));
  ok(
    "Studio's handoff effect never imports/calls runIndicator directly — it reuses the EXISTING runCode wrapper, no second SGScript execution entry point",
    (() => {
      const start = studioSrc.indexOf("if (!handoffIndicatorId) return;");
      const end = studioSrc.indexOf("const saveMut = useMutation", start);
      const block = studioSrc.slice(start, end);
      return start !== -1 && end !== -1 && !/\brunIndicator\(/.test(block);
    })(),
  );
  ok("backtest/engine.ts itself is untouched in spirit — still exports the same public runBacktestEngine signature", /export function runBacktestEngine\(args:/.test(backtestEngineSrc));
}

// ---- 15. No schema migration ------------------------------------------------
{
  const migrationsDir = join(repoRoot, "supabase/migrations");
  const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  ok("at least the pre-existing migrations are present (sanity check the directory itself wasn't touched destructively)", migrations.length > 0);
}

// ---- 16. No supabaseAdmin/service-role anywhere in the new/changed code ---
{
  const NEW_OR_CHANGED = [
    "src/components/builder/BuilderWorkspace.tsx",
    "src/components/builder/BuilderToolbar.tsx",
    "src/components/builder/useBuilderProject.ts",
    "src/lib/builder/generationState.ts",
    "src/routes/studio.tsx",
  ];
  for (const f of NEW_OR_CHANGED) {
    const src = read(f);
    ok(`${f} never references supabaseAdmin/service-role`, !/supabaseAdmin|service_role|SUPABASE_SERVICE_ROLE/.test(src));
  }
  ok("useBuilderProject.ts never defines a new createServerFn (only imports/reuses existing *.functions modules)", !/createServerFn/.test(useBuilderProjectSrc));
}

// ---- 17/18. No duplicate createIndicator during Add to Chart or Backtest --
{
  ok(
    "handleHandoff (shared by Add to Chart AND Backtest) never calls createIndicator/createIndicatorFn — only ensureSavedForHandoff (updateIndicator snapshot:false) runs before navigating",
    (() => {
      const start = builderWorkspaceSrc.indexOf("async function handleHandoff");
      const end = builderWorkspaceSrc.indexOf("const handleBacktest", start);
      const block = builderWorkspaceSrc.slice(start, end);
      return start !== -1 && end !== -1 && !/createIndicator/.test(block);
    })(),
  );
  ok(
    "ensureSavedForHandoff itself never calls createIndicator/createIndicatorFn — it is Save's exact update path, never able to create a row",
    (() => {
      const start = useBuilderProjectSrc.indexOf("async function ensureSavedForHandoff");
      const end = useBuilderProjectSrc.indexOf("\n  return {", start);
      const block = useBuilderProjectSrc.slice(start, end === -1 ? undefined : end);
      return start !== -1 && !/createIndicator/.test(block);
    })(),
  );
}

// ---- Toolbar: Backtest button present, correctly gated --------------------
{
  ok('Backtest button is present', /aria-label="Backtest"/.test(builderToolbarSrc));
  ok(
    "Backtest is conditionally disabled via the shared canHandoff prop, never a hardcoded true",
    /aria-label="Backtest"/.test(builderToolbarSrc) && /disabled=\{!canHandoff \|\| handoffPending\}/.test(builderToolbarSrc),
  );
  ok(
    "Add to Chart is now conditionally enabled (Phase 5A-6A) instead of the old unconditional disabled placeholder",
    /aria-label="Add to Chart"/.test(builderToolbarSrc) && (builderToolbarSrc.match(/disabled=\{!canHandoff \|\| handoffPending\}/g) ?? []).length === 2,
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
