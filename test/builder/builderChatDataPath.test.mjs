// Regression guard for Phase 5A-2's Indicator Builder chat wiring — the
// ONLY two files in this whole feature allowed to touch the canonical
// generation/persistence chain: src/lib/builder/generationState.ts (pure,
// type-only references) and src/components/builder/useBuilderProject.ts
// (the real server-function calls). Same static source-inspection style as
// test/builder/builderShell.test.mjs and
// test/dashboard/journalAnalyticsDataPath.test.mjs.
//
// This test proves three things the Phase 5A-2 brief calls "critical":
//   1. Builder reuses buildProject/createIndicator/updateIndicator/
//      listIndicatorMessages/appendIndicatorMessage — an explicit
//      ALLOW-list, not just an absence-of-forbidden-things check.
//   2. Builder still forbids everything the Phase 5A audit's "one
//      canonical chain" rule protects: the SGScript runtime, validator
//      internals, the AI prompt/model-call internals, StudioChart,
//      lightweight-charts, the backtest engine, and any admin/service-role
//      client.
//   3. There is exactly ONE call site of buildProject in the entire
//      Builder feature (src/components/builder/**) — proving Builder has
//      not accidentally grown a second place that talks to the AI.
//
// Usage: npx tsx test/builder/builderChatDataPath.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

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

const generationStateSrc = read("src/lib/builder/generationState.ts");
const useBuilderProjectSrc = read("src/components/builder/useBuilderProject.ts");

// ---- 1. Explicit allow-list: the 5 canonical functions ARE reused --------
{
  ok("useBuilderProject.ts imports buildProject", /import\s*\{[^}]*\bbuildProject\b[^}]*\}\s*from\s*["']@\/lib\/project\.functions["']/.test(useBuilderProjectSrc));
  ok(
    "useBuilderProject.ts imports createIndicator and updateIndicator",
    /import\s*\{[^}]*\bcreateIndicator\b[^}]*\bupdateIndicator\b[^}]*\}\s*from\s*["']@\/lib\/indicators\.functions["']/.test(useBuilderProjectSrc) ||
      /import\s*\{[^}]*\bupdateIndicator\b[^}]*\bcreateIndicator\b[^}]*\}\s*from\s*["']@\/lib\/indicators\.functions["']/.test(useBuilderProjectSrc),
  );
  ok(
    "useBuilderProject.ts imports listIndicatorMessages and appendIndicatorMessage",
    /from\s*["']@\/lib\/indicatorMessages\.functions["']/.test(useBuilderProjectSrc) &&
      /listIndicatorMessages/.test(useBuilderProjectSrc) &&
      /appendIndicatorMessage/.test(useBuilderProjectSrc),
  );
  ok("useBuilderProject.ts reuses defaultSettingsFromSpec (not a second settings-derivation)", /defaultSettingsFromSpec/.test(useBuilderProjectSrc));
  ok(
    "useBuilderProject.ts reuses classifyBuildResult from the shared buildOutcome module (not a second classify())",
    /classifyBuildResult/.test(useBuilderProjectSrc) && /from\s*["']@\/lib\/spec\/buildOutcome["']/.test(useBuilderProjectSrc),
  );
  ok(
    "generationState.ts only type-imports BuildResult/IndicatorSpec from the canonical modules (never calls them)",
    /import\s+type\s*\{[^}]*BuildResult[^}]*\}\s*from\s*["']@\/lib\/project\.functions["']/.test(generationStateSrc),
  );
}

// ---- 2. Still-forbidden canonical internals -------------------------------
{
  const FORBIDDEN = [
    "sgscript/runtime",
    "sgscript/worker",
    "sgscript/client",
    "sgscript/stdlib",
    "validate/pine",
    "validate/sgscript",
    "ai/project-prompt",
    "components/studio/StudioChart",
    "lightweight-charts",
    "backtest/engine",
    "backtest.functions",
    "analyze.functions",
    "sgscript.functions",
    "generateText",
    "streamText",
    "supabaseAdmin",
    "service_role",
    "SUPABASE_SERVICE_ROLE",
    "trading.functions",
    "oms.server",
  ];
  for (const forbidden of FORBIDDEN) {
    ok(`generationState.ts never references "${forbidden}"`, !generationStateSrc.includes(forbidden));
    ok(`useBuilderProject.ts never references "${forbidden}"`, !useBuilderProjectSrc.includes(forbidden));
  }
}

// ---- 3. No new AI/server endpoint ------------------------------------------
{
  ok("generationState.ts never defines a createServerFn (it's pure, no I/O)", !generationStateSrc.includes("createServerFn"));
  ok(
    "useBuilderProject.ts never DEFINES a new createServerFn — it only CALLS useServerFn() on the existing exports",
    !/createServerFn\s*\(/.test(useBuilderProjectSrc),
  );
  ok("useBuilderProject.ts uses useServerFn (the standard client-side wrapper), consistent with every other server-fn caller", /useServerFn/.test(useBuilderProjectSrc));
}

// ---- 4. Exactly one call site of buildProject across the whole feature ----
{
  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  let callSites = 0;
  const callSiteFiles = [];
  for (const f of files) {
    const src = read(join("src", "components", "builder", f));
    if (/\bbuildProjectFn\s*\(/.test(src) || /\bbuildProject\s*\(\s*\{/.test(src)) {
      callSites++;
      callSiteFiles.push(f);
    }
  }
  ok(
    `exactly one file under src/components/builder/ actually calls buildProject (found: ${callSiteFiles.join(", ") || "none"})`,
    callSites === 1 && callSiteFiles[0] === "useBuilderProject.ts",
  );
}

// ---- 5. Chat state survives mobile tab switches (one hook call, shared) --
{
  const workspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
  const hookCallMatches = workspaceSrc.match(/useBuilderProject\s*\(/g) ?? [];
  ok(
    "BuilderWorkspace calls useBuilderProject exactly once (never once per ChatPanel instance, which would give desktop/mobile divergent state)",
    hookCallMatches.length === 1,
  );
  ok(
    "the SAME <ChatPanel> element is reused for both the desktop and mobile layouts (not two independently-constructed instances)",
    (workspaceSrc.match(/<ChatPanel\b/g) ?? []).length === 1,
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
