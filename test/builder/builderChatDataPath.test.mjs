// Regression guard for Phase 5A-2/5A-3's Indicator Builder chat + code
// editor wiring — the ONLY two files in this whole feature allowed to touch
// the canonical generation/persistence/validation chain:
// src/lib/builder/generationState.ts (pure, type-only references) and
// src/components/builder/useBuilderProject.ts (the real server-function
// calls). Same static source-inspection style as
// test/builder/builderShell.test.mjs and
// test/dashboard/journalAnalyticsDataPath.test.mjs.
//
// This test proves four things the Phase 5A-2/5A-3 briefs call "critical":
//   1. Builder reuses buildProject/validateProject/createIndicator/
//      updateIndicator/listIndicatorMessages/appendIndicatorMessage — an
//      explicit ALLOW-list, not just an absence-of-forbidden-things check.
//      (validateProject added in Phase 5A-3, alongside buildProject in the
//      same already-canonical src/lib/project.functions.ts — not a new
//      server function.)
//   2. Builder still forbids everything the Phase 5A audit's "one
//      canonical chain" rule protects: the SGScript runtime, validator
//      internals, the AI prompt/model-call internals, StudioChart,
//      lightweight-charts, the backtest engine, and any admin/service-role
//      client — validatePine/validateSgScript stay forbidden as DIRECT
//      Builder imports even though validateProject wraps them internally,
//      exactly like buildProject already does.
//   3. There is exactly ONE call site of buildProject AND exactly ONE call
//      site of validateProject in the entire Builder feature
//      (src/components/builder/**) — proving Builder has not accidentally
//      grown a second place that talks to the AI or a second place that
//      talks to static validation.
//   4. An ordinary manual-editor keystroke (src/lib/builder/generationState.ts's
//      setManualSgscript) never reaches any server-function call — it's a
//      documented, verified pure local state transform.
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
const workspaceSrcTop = read("src/components/builder/BuilderWorkspace.tsx");
const resizableSrc = read("src/components/ui/resizable.tsx");

// ---- 1. Explicit allow-list: the 6 canonical functions ARE reused --------
{
  ok(
    "useBuilderProject.ts imports buildProject and validateProject",
    /import\s*\{[^}]*\bbuildProject\b[^}]*\bvalidateProject\b[^}]*\}\s*from\s*["']@\/lib\/project\.functions["']/.test(useBuilderProjectSrc) ||
      /import\s*\{[^}]*\bvalidateProject\b[^}]*\bbuildProject\b[^}]*\}\s*from\s*["']@\/lib\/project\.functions["']/.test(useBuilderProjectSrc),
  );
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
    ok(
      `BuilderWorkspace.tsx never references "${forbidden}" (Phase 5A-4a is layout/state architecture only — no runtime, renderer, AI, or market-data import)`,
      !workspaceSrcTop.includes(forbidden),
    );
  }
  ok("resizable.tsx never references any canonical/forbidden module (it only touches react-resizable-panels)", FORBIDDEN.every((f) => !resizableSrc.includes(f)));
}

// ---- 3. No new AI/server endpoint ------------------------------------------
{
  ok("generationState.ts never defines a createServerFn (it's pure, no I/O)", !generationStateSrc.includes("createServerFn"));
  ok(
    "useBuilderProject.ts never DEFINES a new createServerFn — it only CALLS useServerFn() on the existing exports",
    !/createServerFn\s*\(/.test(useBuilderProjectSrc),
  );
  ok("useBuilderProject.ts uses useServerFn (the standard client-side wrapper), consistent with every other server-fn caller", /useServerFn/.test(useBuilderProjectSrc));
  ok(
    "Phase 5A-4a: BuilderWorkspace.tsx introduces ZERO server-function machinery (no createServerFn, no useServerFn, no *.functions import) — the layout change is pure JSX/CSS restructuring",
    !workspaceSrcTop.includes("createServerFn") && !workspaceSrcTop.includes("useServerFn") && !/from\s+["'][^"']*\.functions["']/.test(workspaceSrcTop),
  );
}

// ---- 3b. Phase 5A-4a: the resizable-handle orientation fix is real -------
{
  ok(
    "resizable.tsx no longer relies on the nonexistent data-panel-group-direction attribute (verified against the installed react-resizable-panels: it never sets that attribute)",
    !resizableSrc.includes("data-panel-group-direction") && !resizableSrc.includes("data-[panel-group-direction"),
  );
  ok(
    'ResizableHandle now keys its vertical-split styling off the real aria-orientation="horizontal" attribute the library actually renders on the separator',
    /aria-\[orientation=horizontal\]/.test(resizableSrc),
  );
  ok(
    "the fix is purely additive to the existing base classes (w-px/bg-border/etc. untouched) — a selector swap, not a rewrite",
    /relative flex w-px items-center justify-center bg-border/.test(resizableSrc),
  );
}

// ---- 4. Exactly one call site each of buildProject and validateProject ---
{
  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  let buildCallSites = 0;
  let validateCallSites = 0;
  const buildCallSiteFiles = [];
  const validateCallSiteFiles = [];
  for (const f of files) {
    const src = read(join("src", "components", "builder", f));
    if (/\bbuildProjectFn\s*\(/.test(src) || /\bbuildProject\s*\(\s*\{/.test(src)) {
      buildCallSites++;
      buildCallSiteFiles.push(f);
    }
    if (/\bvalidateProjectFn\s*\(/.test(src) || /\bvalidateProject\s*\(\s*\{/.test(src)) {
      validateCallSites++;
      validateCallSiteFiles.push(f);
    }
  }
  ok(
    `exactly one file under src/components/builder/ actually calls buildProject (found: ${buildCallSiteFiles.join(", ") || "none"})`,
    buildCallSites === 1 && buildCallSiteFiles[0] === "useBuilderProject.ts",
  );
  ok(
    `exactly one file under src/components/builder/ actually calls validateProject (found: ${validateCallSiteFiles.join(", ") || "none"})`,
    validateCallSites === 1 && validateCallSiteFiles[0] === "useBuilderProject.ts",
  );
}

// ---- 5. Chat/Code state survives mobile tab switches (one hook call, shared) --
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
  ok(
    "the SAME <CodeEditorPanel> element is reused for both the desktop and mobile layouts (Phase 5A-3: the real CodeMirror instance must never remount on a tab/breakpoint switch)",
    (workspaceSrc.match(/<CodeEditorPanel\b/g) ?? []).length === 1,
  );
  ok(
    "Phase 5A-4a: PreviewPanel is constructed exactly once (`const preview = <PreviewPanel />`), the SAME single-instance guarantee as ChatPanel/CodeEditorPanel — not a stateless exception built twice",
    (workspaceSrc.match(/<PreviewPanel\b/g) ?? []).length === 1,
  );
}

// ---- 5b. Phase 5A-4a: approved nested desktop layout (Chat | Preview/Code) --
{
  const workspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
  const orientationMatches = [...workspaceSrc.matchAll(/orientation="(horizontal|vertical)"/g)].map((m) => m[1]);
  ok(
    "exactly one outer horizontal ResizablePanelGroup and one inner vertical ResizablePanelGroup exist (the approved Chat | Preview-over-Code split — never a third group, never Studio's WorkspaceLayout/LayoutNode)",
    orientationMatches.filter((o) => o === "horizontal").length === 1 && orientationMatches.filter((o) => o === "vertical").length === 1,
  );
  ok(
    "Chat is the FIRST panel in the outer horizontal group (the left column) — never moved",
    /orientation="horizontal"[\s\S]*?<ResizablePanel[^>]*>\s*\{chat\}/.test(workspaceSrc),
  );
  ok(
    "the inner vertical group's FIRST panel is Preview and its SECOND is Code (Live Preview above Code Editor, never the other way round)",
    /orientation="vertical"[^>]*>[\s\S]*?\{preview\}[\s\S]*?<ResizableHandle[\s\S]*?\{code\}/.test(workspaceSrc),
  );
  ok(
    "the nested vertical group lives INSIDE the outer horizontal group's second panel (Right Workspace), not as a third sibling of Chat",
    /\{chat\}[\s\S]*?<ResizablePanel[^>]*>\s*<ResizablePanelGroup orientation="vertical"/.test(workspaceSrc),
  );
  ok(
    "BuilderWorkspace never imports Chart Studio's WorkspaceLayout/LayoutNode dockable-widget system for this layout",
    !/WorkspaceLayout|LayoutNode|lib\/workspace\/types/.test(workspaceSrc),
  );
}

// ---- 5c. Phase 5A-4a: mobile tab order is Chat / Preview / Code / Settings --
{
  const workspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
  const tabOrderMatch = workspaceSrc.match(/const MOBILE_TABS[\s\S]*?\];/);
  const tabIds = tabOrderMatch ? [...tabOrderMatch[0].matchAll(/id:\s*"(\w+)"/g)].map((m) => m[1]) : [];
  ok(
    `MOBILE_TABS is ordered Chat / Preview / Code / Settings (found: ${tabIds.join(", ") || "none"})`,
    JSON.stringify(tabIds) === JSON.stringify(["chat", "preview", "code", "settings"]),
  );
}

// ---- 6. Manual editing is purely local — no server call reachable --------
{
  const useBuilderProjectFnBody = useBuilderProjectSrc.slice(useBuilderProjectSrc.indexOf("function updateSgscript"));
  const updateSgscriptFnSrc = useBuilderProjectFnBody.slice(0, useBuilderProjectFnBody.indexOf("\n  }") + 4);
  ok("useBuilderProject.ts defines updateSgscript", /function updateSgscript/.test(useBuilderProjectSrc));
  ok(
    "updateSgscript's body calls ONLY setState/setManualSgscript — no buildProjectFn/validateProjectFn/createIndicatorFn/updateIndicatorFn/appendIndicatorMessageFn",
    /setManualSgscript/.test(updateSgscriptFnSrc) &&
      !/buildProjectFn|validateProjectFn|createIndicatorFn|updateIndicatorFn|appendIndicatorMessageFn/.test(updateSgscriptFnSrc),
  );
  ok(
    "generationState.ts's setManualSgscript is a pure (state, sgscript) => state transform (no I/O, no fetch, no createServerFn)",
    /export function setManualSgscript/.test(generationStateSrc) && !/fetch\(|createServerFn/.test(generationStateSrc),
  );
}

// ---- 6b. Explicit Validate reaches ONLY validateProject — never persists --
{
  const submitValidateFnBody = useBuilderProjectSrc.slice(useBuilderProjectSrc.indexOf("function submitValidate"));
  const submitValidateFnSrc = submitValidateFnBody.slice(0, submitValidateFnBody.indexOf("\n  }") + 4);
  ok("useBuilderProject.ts defines submitValidate", /function submitValidate/.test(useBuilderProjectSrc));
  ok(
    "submitValidate calls validateMutation (backed by validateProjectFn) and nothing else network-shaped — no createIndicatorFn/updateIndicatorFn/appendIndicatorMessageFn/buildProjectFn/buildMutation",
    /validateMutation\.mutate/.test(submitValidateFnSrc) &&
      !/createIndicatorFn|updateIndicatorFn|appendIndicatorMessageFn|buildProjectFn|buildMutation\.mutate/.test(submitValidateFnSrc),
  );
  ok(
    "the validate request sends the CURRENT canonical pine and sgscript (state.pine / state.sgscript), not a copy or a stale draft",
    /validateMutation\.mutate\(\{\s*pine:\s*state\.pine,\s*sgscript:\s*state\.sgscript\s*\}\)/.test(submitValidateFnSrc),
  );
  const validateMutationBody = useBuilderProjectSrc.slice(useBuilderProjectSrc.indexOf("const validateMutation"), useBuilderProjectSrc.indexOf("function submitValidate"));
  ok(
    "validateMutation's onSuccess ONLY calls applyValidationResult — never touches indicatorId, never invalidates the indicators query, never appends a message",
    /applyValidationResult/.test(validateMutationBody) && !/withIndicatorId|invalidateQueries|appendIndicatorMessageFn|persistIndicator/.test(validateMutationBody),
  );
}

// ---- 7. Editor read-only wiring during an in-flight AI build (race guard) --
{
  const workspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
  const codeEditorPanelSrc = read("src/components/builder/CodeEditorPanel.tsx");
  ok(
    'BuilderWorkspace wires CodeEditorPanel\'s readOnly to status === "generating" (the ONE race Phase 5A-3 must prevent: editing a snapshot that a just-submitted buildProject request already captured)',
    /readOnly=\{state\.status === ["']generating["']\}/.test(workspaceSrc),
  );
  ok(
    "CodeEditorPanel forwards readOnly straight into the real CodeEditor (no local override, no second read-only mechanism)",
    /readOnly:\s*boolean/.test(codeEditorPanelSrc) && /<CodeEditor[^>]*readOnly=\{readOnly\}/.test(codeEditorPanelSrc),
  );
  ok(
    "CodeEditorPanel is controlled directly from the canonical sgscript value — onChange is forwarded, not wrapped in a local draft state",
    !/useState/.test(codeEditorPanelSrc) && /onChange=\{onChange\}/.test(codeEditorPanelSrc),
  );
}

// ---- 8. Exactly one Builder file imports the real editor, reusing it -----
{
  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const importers = [];
  for (const f of files) {
    const src = read(join("src", "components", "builder", f));
    if (/from\s*["']@\/components\/studio\/CodeEditor["']/.test(src)) importers.push(f);
  }
  ok(
    `exactly one file under src/components/builder/ imports the real editor (found: ${importers.join(", ") || "none"}) — reusing Studio's leaf component, never a second editor implementation`,
    importers.length === 1 && importers[0] === "CodeEditorPanel.tsx",
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
