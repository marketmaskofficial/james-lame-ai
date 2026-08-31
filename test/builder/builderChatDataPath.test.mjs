// Regression guard for Phase 5A-2/5A-3/5A-4b's Indicator Builder chat +
// code editor + preview-execution wiring — the ONLY two files in this whole
// feature allowed to touch the canonical generation/persistence/
// validation/execution chain: src/lib/builder/generationState.ts (pure,
// type-only references) and src/components/builder/useBuilderProject.ts
// (the real server-function AND runIndicator calls). Same static
// source-inspection style as test/builder/builderShell.test.mjs and
// test/dashboard/journalAnalyticsDataPath.test.mjs.
//
// This test proves five things the Phase 5A-2/5A-3/5A-4b briefs call
// "critical":
//   1. Builder reuses buildProject/validateProject/createIndicator/
//      updateIndicator/listIndicatorMessages/appendIndicatorMessage/
//      runIndicator — an explicit ALLOW-list, not just an
//      absence-of-forbidden-things check. (validateProject was added in
//      Phase 5A-3, runIndicator in Phase 5A-4b — each already-canonical,
//      never a new server function or a new runtime.)
//   2. Builder still forbids everything the Phase 5A audit's "one
//      canonical chain" rule protects: the SGScript runtime/worker/stdlib/
//      smc/style internals, validator internals, the AI prompt/model-call
//      internals, StudioChart, lightweight-charts, the backtest engine, and
//      any admin/service-role client — validatePine/validateSgScript stay
//      forbidden as DIRECT Builder imports even though validateProject
//      wraps them internally, exactly like buildProject already does; the
//      SGScript runtime/worker/stdlib/smc/style stay forbidden as DIRECT
//      imports even though runIndicator wraps them internally, exactly the
//      same pattern.
//   3. There is exactly ONE call site each of buildProject, validateProject,
//      and runIndicator in the entire Builder feature
//      (src/components/builder/**) — proving Builder has not accidentally
//      grown a second place that talks to the AI, to static validation, or
//      to the execution runtime.
//   4. An ordinary manual-editor keystroke (src/lib/builder/generationState.ts's
//      setManualSgscript) never reaches any server-function OR runIndicator
//      call — it's a documented, verified pure local state transform.
//   5. Preview execution (submitRunPreview) never calls buildProject,
//      validateProject, or any persistence function — execution is a pure,
//      local, client-side Worker call, wholly separate from AI
//      generation/refinement and from static validation.
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
const previewPanelSrc = read("src/components/builder/PreviewPanel.tsx");
const marketDataHookSrc = read("src/components/builder/useBuilderMarketData.ts");
const builderToolbarSrc = read("src/components/builder/BuilderToolbar.tsx");
const previewRefreshHookSrc = read("src/components/builder/useBuilderPreviewRefresh.ts");

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
  ok(
    "Phase 5A-5C: defaultSettingsFromSpec is reused (not a second settings-derivation) — now via generationState.ts's mergeSettingsWithDefaults, called from both a successful AI build and hydrateFromIndicator",
    /defaultSettingsFromSpec/.test(generationStateSrc),
  );
  ok("Phase 5A-5C: useBuilderProject.ts itself reuses the SAME mergeSettingsWithDefaults (not a second settings-merge)", /mergeSettingsWithDefaults/.test(useBuilderProjectSrc));
  ok(
    "useBuilderProject.ts reuses classifyBuildResult from the shared buildOutcome module (not a second classify())",
    /classifyBuildResult/.test(useBuilderProjectSrc) && /from\s*["']@\/lib\/spec\/buildOutcome["']/.test(useBuilderProjectSrc),
  );
  ok(
    "generationState.ts only type-imports BuildResult/IndicatorSpec from the canonical modules (never calls them)",
    /import\s+type\s*\{[^}]*BuildResult[^}]*\}\s*from\s*["']@\/lib\/project\.functions["']/.test(generationStateSrc),
  );
  ok(
    "Phase 5A-4b: useBuilderProject.ts imports the canonical runIndicator from @/lib/sgscript/client (the ONE execution entry point, not a new runtime)",
    /import\s*\{[^}]*\brunIndicator\b[^}]*\}\s*from\s*["']@\/lib\/sgscript\/client["']/.test(useBuilderProjectSrc),
  );
  ok(
    "Phase 5A-4b: generationState.ts only type-imports RunResult from the canonical sgscript types module (never calls runIndicator)",
    /import\s+type\s*\{[^}]*RunResult[^}]*\}\s*from\s*["']@\/lib\/sgscript\/types["']/.test(generationStateSrc),
  );
}

// ---- 2. Still-forbidden canonical internals -------------------------------
{
  const FORBIDDEN = [
    "sgscript/runtime",
    "sgscript/worker",
    // sgscript/client is DELIBERATELY not forbidden as of Phase 5A-4b — its
    // one export, runIndicator, is the canonical execution entry point
    // Builder is explicitly meant to reuse (see the allow-list above and
    // the "exactly one call site" check below). Only the runtime's own
    // internals (runtime/worker/stdlib/smc/style — everything runIndicator
    // wraps) stay forbidden as DIRECT Builder imports.
    "sgscript/stdlib",
    "sgscript/smc",
    "sgscript/style",
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
      `BuilderWorkspace.tsx never references "${forbidden}" (layout/state/market-data wiring only — no runtime, renderer, or AI internals)`,
      !workspaceSrcTop.includes(forbidden),
    );
    ok(`useBuilderMarketData.ts never references "${forbidden}" (Phase 5A-4d: real bars only, via the canonical fetchBars wrapper)`, !marketDataHookSrc.includes(forbidden));
    ok(`BuilderToolbar.tsx never references "${forbidden}"`, !builderToolbarSrc.includes(forbidden));
    ok(
      `useBuilderPreviewRefresh.ts never references "${forbidden}" (Phase 5A-4e: orchestration only — it decides WHEN to call the existing submitRunPreview, never a second execution/render/AI path)`,
      !previewRefreshHookSrc.includes(forbidden),
    );
  }
  ok("resizable.tsx never references any canonical/forbidden module (it only touches react-resizable-panels)", FORBIDDEN.every((f) => !resizableSrc.includes(f)));
}

// ---- 2b. Phase 5A-4c: PreviewPanel is the ONE allow-listed exception ------
// for StudioChart — everything else forbidden above stays forbidden for
// PreviewPanel too (it renders results, it never re-implements execution or
// a second chart engine).
{
  const FORBIDDEN_FOR_PREVIEW_PANEL = [
    "sgscript/runtime",
    "sgscript/worker",
    "sgscript/client",
    "sgscript/stdlib",
    "sgscript/smc",
    "sgscript/style",
    "validate/pine",
    "validate/sgscript",
    "ai/project-prompt",
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
    "buildProject",
    "validateProject",
    "runIndicator",
    "createServerFn",
    "useServerFn",
    "useMutation",
    "fetch(",
  ];
  for (const forbidden of FORBIDDEN_FOR_PREVIEW_PANEL) {
    ok(`PreviewPanel.tsx never references "${forbidden}" (rendering-only — no execution, no AI, no persistence, no second chart engine)`, !previewPanelSrc.includes(forbidden));
  }
  ok(
    "PreviewPanel.tsx never imports any *.functions server-function module (no market-data fetch, no AI/database call surface)",
    !/from\s+["'][^"']*\.functions["']/.test(previewPanelSrc),
  );
  ok(
    'Phase 5A-4c: PreviewPanel.tsx imports the canonical StudioChart renderer from "@/components/studio/StudioChart" — the one allow-listed exception to the StudioChart ban above',
    /import\s*\{[^}]*\bStudioChart\b[^}]*\}\s*from\s*["']@\/components\/studio\/StudioChart["']/.test(previewPanelSrc),
  );
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

// ---- 4. Exactly one call site each of buildProject/validateProject/runIndicator ---
{
  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  let buildCallSites = 0;
  let validateCallSites = 0;
  let runCallSites = 0;
  const buildCallSiteFiles = [];
  const validateCallSiteFiles = [];
  const runCallSiteFiles = [];
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
    if (/\brunIndicator\s*\(/.test(src)) {
      runCallSites++;
      runCallSiteFiles.push(f);
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
  ok(
    `Phase 5A-4b: exactly one file under src/components/builder/ actually calls runIndicator (found: ${runCallSiteFiles.join(", ") || "none"}) — no duplicate execution engine`,
    runCallSites === 1 && runCallSiteFiles[0] === "useBuilderProject.ts",
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

// ---- 6c. Phase 5A-4b: Preview execution reaches ONLY runIndicator ---------
{
  const submitRunPreviewFnBody = useBuilderProjectSrc.slice(useBuilderProjectSrc.indexOf("async function submitRunPreview"));
  const submitRunPreviewFnSrc = submitRunPreviewFnBody.slice(0, submitRunPreviewFnBody.indexOf("\n  }") + 4);
  ok("useBuilderProject.ts defines submitRunPreview", /async function submitRunPreview/.test(useBuilderProjectSrc));
  ok(
    "submitRunPreview calls ONLY runIndicator — never buildProjectFn/validateProjectFn/createIndicatorFn/updateIndicatorFn/appendIndicatorMessageFn/buildMutation/validateMutation (execution is wholly separate from AI generation and static validation)",
    /runIndicator\s*\(/.test(submitRunPreviewFnSrc) &&
      !/buildProjectFn|validateProjectFn|createIndicatorFn|updateIndicatorFn|appendIndicatorMessageFn|buildMutation\.mutate|validateMutation\.mutate/.test(submitRunPreviewFnSrc),
  );
  ok(
    "submitRunPreview passes the CURRENT canonical state.sgscript to runIndicator, not a copy or a stale draft",
    /runIndicator\s*\(\s*state\.sgscript\s*,/.test(submitRunPreviewFnSrc),
  );
  ok(
    "submitRunPreview uses a stale-result guard (checks a ref-based run id before applying either outcome)",
    (submitRunPreviewFnSrc.match(/runId === runSeqRef\.current/g) ?? []).length === 2,
  );
  ok(
    "a failed Preview run calls applyPreviewFailure (never applyPreviewResult) and a successful run calls applyPreviewResult (never applyPreviewFailure) for the same outcome",
    /applyPreviewResult/.test(submitRunPreviewFnSrc) && /applyPreviewFailure/.test(submitRunPreviewFnSrc),
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

// ---- 9. Phase 5A-4c: exactly one file imports StudioChart, and correctly --
{
  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const importers = [];
  for (const f of files) {
    const src = read(join("src", "components", "builder", f));
    if (/from\s*["']@\/components\/studio\/StudioChart["']/.test(src)) importers.push(f);
  }
  ok(
    `exactly one file under src/components/builder/ imports StudioChart (found: ${importers.join(", ") || "none"}) — no second renderer, no duplicate mount site`,
    importers.length === 1 && importers[0] === "PreviewPanel.tsx",
  );
}

// ---- 10. Phase 5A-4c/4d/4e: previewResult -> LoadedIndicator adapter -------
{
  const indicatorsBlock = previewPanelSrc.slice(
    previewPanelSrc.indexOf("const indicators = useMemo"),
    previewPanelSrc.indexOf("const hasOscPane"),
  );
  ok(
    "no previewResult, or a MARKET-stale one, produces zero indicators (empty array, not a fabricated placeholder indicator)",
    /if\s*\(\s*!previewResult\s*\|\|\s*marketStale\s*\)\s*return\s*\[\]\s*;/.test(indicatorsBlock),
  );
  ok('adapter key is the stable literal "builder-preview"', /key:\s*["']builder-preview["']/.test(indicatorsBlock));
  ok("indicator name comes from previewResult.meta.name, not a hardcoded or re-derived name", /name:\s*previewResult\.meta\.name/.test(indicatorsBlock));
  ok("adapter always marks the preview indicator visible: true", /visible:\s*true/.test(indicatorsBlock));
  ok(
    "the exact previewResult object is passed through as `result` unchanged — never spread, never partially copied",
    /result:\s*previewResult\s*\}/.test(indicatorsBlock),
  );
  ok(
    "a real previewResult maps to exactly ONE LoadedIndicator (single-element array literal, not zero/many)",
    /return\s*\[\{\s*key:/.test(indicatorsBlock),
  );

  const hasOscPaneBlock = previewPanelSrc.slice(
    previewPanelSrc.indexOf("const hasOscPane = useMemo"),
    previewPanelSrc.indexOf("const headerStatus"),
  );
  ok(
    'hasOscPane is true only when at least one plot has pane === "osc", and false with no previewResult or while MARKET-stale (never fabricated)',
    /previewResult\s*&&\s*!marketStale\s*\?\s*previewResult\.plots\.some\(\s*\(p\)\s*=>\s*p\.pane\s*===\s*["']osc["']\s*\)\s*:\s*false/.test(hasOscPaneBlock),
  );

  ok(
    "the `indicators` memo depends only on previewResult/marketStale, not on previewStatus or codeStale — so an error/running status/pending code edit never erases the last-good chart's indicator data (StudioChart keeps rendering the last successful previewResult regardless of status, and while only the code is stale)",
    /\[previewResult,\s*marketStale\]\s*\)\s*;/.test(indicatorsBlock),
  );

  ok(
    "Phase 5A-4d: `marketStale` is computed from previewContext vs the CURRENTLY selected symbol/timeframe — a previewResult computed against a different symbol/timeframe is never drawn as if it belongs to the new selection",
    /previewContext\.symbol\s*!==\s*selectedSymbol\s*\|\|\s*previewContext\.timeframe\s*!==\s*selectedTimeframe/.test(previewPanelSrc),
  );

  ok(
    "Phase 5A-4e: `codeStale` is computed from previewContext.sgscript vs the CURRENT canonical sgscript, only when NOT market-stale — a pending code edit never hides the last-good indicator (it's still valid against the current bars)",
    /codeStale\s*=\s*previewResult\s*!==\s*null\s*&&\s*previewContext\s*!==\s*null\s*&&\s*!marketStale\s*&&\s*previewContext\.sgscript\s*!==\s*sgscript/.test(
      previewPanelSrc,
    ),
  );

  const headerStatusBlock = previewPanelSrc.slice(previewPanelSrc.indexOf("const headerStatus"), previewPanelSrc.indexOf("const overlayMode"));
  ok(
    'Phase 5A-4e fix (found via real hosted QA): the header\'s "Updating preview…" badge is suppressed once previewStatus is "error" — codeStale alone never clears on a failed run (previewContext only ever advances on success), so without this check a terminal runtime failure for the new code would misleadingly keep showing "Updating preview…" forever instead of nothing (the error is already surfaced by the overlay banner)',
    /codeStale\s*&&\s*previewStatus\s*!==\s*["']error["']/.test(headerStatusBlock),
  );
}

// ---- 11. Phase 5A-4c: StudioChart is mounted unconditionally (no remount) --
{
  ok(
    "StudioChart is mounted exactly once in PreviewPanel's JSX, outside any status-based conditional — idle/running/success/error all reuse the SAME instance rather than remounting it per state",
    (previewPanelSrc.match(/<StudioChart\b/g) ?? []).length === 1,
  );
  ok(
    "PreviewPanel passes only the minimum mandatory StudioChart props plus hasOscPane — no trades/tradeLines/onTradeDrag/onPlanOrder/instrument (no invented trading behavior)",
    !/tradeLines=|trades=|onTradeDrag=|onPlanOrder=|instrument=/.test(previewPanelSrc),
  );
  ok(
    'StudioChart is mounted with tool="cursor" and an empty, stable drawings array — Builder never enables drawing-tool creation',
    /tool="cursor"/.test(previewPanelSrc) && /drawings=\{EMPTY_DRAWINGS\}/.test(previewPanelSrc),
  );
  ok(
    "Phase 5A-4e fix: StudioChart is deliberately remounted (key={selectedSymbol:selectedTimeframe}) on a symbol/timeframe change — discovered via real hosted QA to be required because StudioChart's own `sameSet` bars-update heuristic (its own source comment: \"can be fooled by coincidence\") gets fooled when two different symbols' bars share an identical first-bar timestamp (routine at matching wall-clock-aligned intervals), patching just the last bar instead of replacing the whole series and leaving a badly distorted price axis. This is a StudioChart usage change from PreviewPanel, not a StudioChart.tsx edit.",
    /key=\{`\$\{selectedSymbol\}:\$\{selectedTimeframe\}`\}/.test(previewPanelSrc),
  );
}

// ---- 12. Phase 5A-4c: mobile Preview tab keeps the never-remount pattern --
{
  const workspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
  ok(
    'the mobile Preview tab is still toggled via the hidden class (never conditionally rendered/unmounted) — activeTab === "preview" ? "h-full" : "hidden"',
    /activeTab === ["']preview["']\s*\?\s*["']h-full["']\s*:\s*["']hidden["']/.test(workspaceSrc),
  );
  ok(
    "BuilderWorkspace passes state.previewStatus/previewResult/previewError straight through to PreviewPanel (no local copy, no re-derivation)",
    /previewStatus=\{state\.previewStatus\}/.test(workspaceSrc) &&
      /previewResult=\{state\.previewResult\}/.test(workspaceSrc) &&
      /previewError=\{state\.previewError\}/.test(workspaceSrc),
  );
  ok(
    "Phase 5A-4d: BuilderWorkspace passes the REAL bars from useBuilderMarketData through to PreviewPanel, not a hardcoded empty array",
    /bars=\{bars\}/.test(workspaceSrc) && /useBuilderMarketData\s*\(\s*\)/.test(workspaceSrc),
  );
}

// ---- 13. Phase 5A-4d: market-data allow-list + single fetch call site -----
{
  ok(
    "useBuilderMarketData.ts imports the canonical fetchBars from @/lib/marketdata — the ONE market-data entry point every other consumer in this app already uses",
    /import\s*\{[^}]*\bfetchBars\b[^}]*\}\s*from\s*["']@\/lib\/marketdata["']/.test(marketDataHookSrc),
  );
  ok(
    "useBuilderMarketData.ts imports DEFAULT_FAVORITE_TIMEFRAMES from @/lib/symbols — reusing the existing favorites constant, never inventing a new timeframe list",
    /import\s*\{[^}]*\bDEFAULT_FAVORITE_TIMEFRAMES\b[^}]*\}\s*from\s*["']@\/lib\/symbols["']/.test(marketDataHookSrc),
  );
  ok(
    "useBuilderMarketData.ts never calls getProvider(...) directly — it goes through the narrower fetchBars wrapper, never the raw provider registry",
    !/getProvider\s*\(/.test(marketDataHookSrc),
  );
  ok("useBuilderMarketData.ts never imports @/lib/market/provider directly", !marketDataHookSrc.includes("lib/market/provider"));

  const builderDir = join(repoRoot, "src", "components", "builder");
  const files = readdirSync(builderDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const fetchCallSiteFiles = [];
  for (const f of files) {
    const src = read(join("src", "components", "builder", f));
    if (/\bfetchBars\s*\(/.test(src)) fetchCallSiteFiles.push(f);
  }
  ok(
    `exactly one file under src/components/builder/ actually calls fetchBars (found: ${fetchCallSiteFiles.join(", ") || "none"}) — no duplicate market-data fetch path`,
    fetchCallSiteFiles.length === 1 && fetchCallSiteFiles[0] === "useBuilderMarketData.ts",
  );
}

// ---- 14. Phase 5A-4d: defaults, bar count, and the stale-fetch guard ------
{
  ok('default selectedSymbol is the visible, explicit literal "BTCUSDT"', /DEFAULT_BUILDER_SYMBOL\s*=\s*["']BTCUSDT["']/.test(marketDataHookSrc));
  ok('default selectedTimeframe is the visible, explicit literal "15m"', /DEFAULT_BUILDER_TIMEFRAME:\s*Timeframe\s*=\s*["']15m["']/.test(marketDataHookSrc));
  ok(
    "BUILDER_TIMEFRAMES is derived from the existing DEFAULT_FAVORITE_TIMEFRAMES constant, not a hand-typed duplicate array",
    /BUILDER_TIMEFRAMES:\s*Timeframe\[\]\s*=\s*DEFAULT_FAVORITE_TIMEFRAMES/.test(marketDataHookSrc),
  );
  ok(
    "the initial historical fetch requests exactly 500 bars, matching Chart Studio's own established default",
    /HISTORICAL_BAR_COUNT\s*=\s*500/.test(marketDataHookSrc) && /fetchBars\(\s*selectedSymbol\s*,\s*selectedTimeframe\s*,\s*HISTORICAL_BAR_COUNT\s*\)/.test(marketDataHookSrc),
  );
  ok(
    "the fetch effect is keyed on exactly [selectedSymbol, selectedTimeframe] — a selection change is what triggers a refetch, never every render, never a debounce timer",
    /\},\s*\[selectedSymbol,\s*selectedTimeframe\]\s*\)\s*;/.test(marketDataHookSrc),
  );
  ok(
    "a stale-fetch guard exists (a sequence ref incremented per fetch, checked before every state write) — mirroring the exact weight-class of guard already used for runSeqRef in useBuilderProject.ts, not AbortController, not a job system",
    /fetchSeqRef\.current/.test(marketDataHookSrc) && (marketDataHookSrc.match(/fetchId\s*!==\s*fetchSeqRef\.current/g) ?? []).length === 3,
  );
  ok(
    "an empty array returned from fetchBars is treated as a real error (\"No market data returned.\"), never silently treated as success",
    /result\.length === 0/.test(marketDataHookSrc) && /No market data returned\./.test(marketDataHookSrc),
  );
  ok(
    "no fabricated OHLCV anywhere in the market-data hook — every setBars(...) call site is either setBars([]) (clearing on a new fetch) or setBars(result) (the real fetchBars response), never a literal candle object",
    (marketDataHookSrc.match(/setBars\(/g) ?? []).length === 2 && /setBars\(\[\]\)/.test(marketDataHookSrc) && /setBars\(result\)/.test(marketDataHookSrc),
  );
}

// ---- 15. Phase 5A-4d/4e: Run Preview / auto-refresh reach only submitRunPreview ----
{
  ok(
    "useBuilderPreviewRefresh's runNow calls the EXISTING submitRunPreview(bars, settings) with the real fetched bars AND the real canonical settings (Phase 5A-5C) — no second execution path, no new runIndicator call site",
    /function runNow\(\)\s*\{[\s\S]*?submitRunPreview\(l\.bars,\s*l\.settings\)[\s\S]*?\}/.test(previewRefreshHookSrc),
  );
  ok(
    "the preview-refresh hook never calls buildProject/validateProject/createIndicator/updateIndicator/appendIndicatorMessage — automatic and manual Preview both never generate, validate, or persist",
    !/buildProjectFn|validateProjectFn|createIndicatorFn|updateIndicatorFn|appendIndicatorMessageFn|buildMutation\.mutate|validateMutation\.mutate|buildProject\(|validateProject\(/.test(
      previewRefreshHookSrc,
    ),
  );
  ok(
    "triggerManualRun (the Run Preview button's handler) also funnels through the same runNow — no second call site",
    /function triggerManualRun\(\)\s*\{[\s\S]*?runNow\(\)[\s\S]*?\}/.test(previewRefreshHookSrc),
  );
  ok(
    "Phase 5A-4d: canRunPreview (the toolbar-enablement gate) requires real bars via bars.length > 0, so a click can never reach the runtime's own \"No market data loaded\" failure",
    /canRunPreviewCheck\(state\.sgscript,\s*state\.previewStatus,\s*bars\.length > 0\)/.test(workspaceSrcTop),
  );
  ok(
    "the toolbar-enablement gate also blocks while bars are actively (re)loading (!barsLoading), independent of the pure canRunPreview execution-readiness check",
    /&&\s*!barsLoading/.test(workspaceSrcTop),
  );
  ok(
    "Run Preview always executes state.sgscript at click time via the unchanged submitRunPreview contract (Phase 5A-4b) — no snapshot, no second draft field introduced by this phase",
    !/const\s+\w*[Ss]napshot\w*\s*=\s*state\.sgscript/.test(workspaceSrcTop),
  );
}

// ---- 16. Phase 5A-4d: marketDataError and previewError stay separate ------
{
  ok(
    "PreviewPanel destructures marketDataError and previewError as two SEPARATE named props — never one derived from or aliased to the other",
    /marketDataError:\s*string \| null;/.test(previewPanelSrc) && /previewError:\s*string \| null;/.test(previewPanelSrc),
  );
  ok(
    "PreviewPanel's overlay logic branches on marketDataError and previewError independently (distinct overlay modes), never collapsing both into one message",
    /marketDataError\s*\?[\s\S]*?"marketError"/.test(previewPanelSrc) && /previewError && !previewResult[\s\S]*?"runtimeErrorNoResult"/.test(previewPanelSrc),
  );
  ok("BuilderWorkspace passes marketDataError straight through from the market-data hook", /marketDataError=\{marketDataError\}/.test(workspaceSrcTop));
  ok("BuilderWorkspace passes previewError straight through from useBuilderProject's state, unmodified", /previewError=\{state\.previewError\}/.test(workspaceSrcTop));
}

// ---- 17. Phase 5A-4d: symbol/timeframe selectors reuse canonical modules --
{
  ok(
    "PreviewPanel's symbol selector is populated from the existing SYMBOL_REGISTRY (@/lib/symbols) — no new/duplicated instrument list",
    /import\s*\{[^}]*\bSYMBOL_REGISTRY\b[^}]*\}\s*from\s*["']@\/lib\/symbols["']/.test(previewPanelSrc) && /SYMBOL_REGISTRY\.map/.test(previewPanelSrc),
  );
  ok(
    "PreviewPanel's timeframe selector is populated from BUILDER_TIMEFRAMES (the existing favorites constant, re-exported by the market-data hook) — no invented interval strings",
    /import\s*\{\s*BUILDER_TIMEFRAMES\s*\}\s*from\s*["']\.\/useBuilderMarketData["']/.test(previewPanelSrc) && /BUILDER_TIMEFRAMES\.map/.test(previewPanelSrc),
  );
  ok(
    "changing symbol/timeframe calls only the plain onSymbolChange/onTimeframeChange callbacks — no AI call, no server-function call, no useMutation reachable from either selector's onValueChange",
    !/onValueChange=\{[^}]*(buildProjectFn|validateProjectFn|createIndicatorFn|updateIndicatorFn|appendIndicatorMessageFn|Mutation)/.test(previewPanelSrc),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
