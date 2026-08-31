// Regression guard for the Phase 5A-1 Indicator Builder workspace shell:
// a static source-inspection check (same style as
// test/dashboard/journalAnalyticsDataPath.test.mjs and
// test/dashboard/journalWorkspaceCrossNav.test.mjs) that:
//   - /builder is registered with the same access-gating pattern every
//     other top-level route uses,
//   - AppNavRail links to it,
//   - the toolbar's Save/Validate/Add to Chart actions are unconditionally
//     disabled (never a fake-success stub),
//   - the Builder shell never imports the canonical SGScript/Pine/AI/
//     renderer/backtest implementation modules — Phase 5A-1 is UI shell +
//     routing only, and this enforces the "one canonical chain, never a
//     second indicator system" rule from the Phase 5A audit going forward,
//   - loading /builder cannot make any server/AI call, because none of its
//     files reference `createServerFn`, `useServerFn`, or any
//     `*.functions` module at all.
//
// There is no live-browser render harness in this codebase, so this proves
// the SOURCE never reaches for a duplicate pipeline/renderer, not that a
// mounted component behaves a certain way visually (that's covered by the
// hosted browser QA already performed for this phase).
//
// Phase 5A-2 note: `BUILDER_FILES` below is deliberately still the
// presentational UI-shell files only — none of them may EVER import the
// canonical generation chain, by design (all real `buildProject`/
// `createIndicator`/`updateIndicator`/`listIndicatorMessages`/
// `appendIndicatorMessage` calls are isolated to exactly ONE file,
// `src/components/builder/useBuilderProject.ts`, plus the pure
// `src/lib/builder/generationState.ts`). Those two files are NOT in this
// list on purpose — see `test/builder/builderChatDataPath.test.mjs` for
// their own explicit allow-list test.
//
// Usage: npx tsx test/builder/builderShell.test.mjs

import { readFileSync } from "node:fs";
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

const BUILDER_FILES = [
  "src/routes/builder.tsx",
  "src/components/builder/BuilderWorkspace.tsx",
  "src/components/builder/BuilderToolbar.tsx",
  "src/components/builder/ChatPanel.tsx",
  "src/components/builder/CodeEditorPanel.tsx",
  "src/components/builder/PreviewPanel.tsx",
  "src/components/builder/SettingsPanel.tsx",
  "src/components/builder/DiagnosticsPanel.tsx",
];

const sources = Object.fromEntries(BUILDER_FILES.map((f) => [f, read(f)]));
const routeSrc = sources["src/routes/builder.tsx"];
const navRailSrc = read("src/components/AppNavRail.tsx");
const toolbarSrc = sources["src/components/builder/BuilderToolbar.tsx"];

// ---- /builder route registration & access gating --------------------------
{
  ok('builder.tsx declares createFileRoute("/builder")', /createFileRoute\(\s*["']\/builder["']\s*\)/.test(routeSrc));
  ok("builder.tsx is client-only (ssr: false), matching every other gated top-level route", /ssr:\s*false/.test(routeSrc));
  ok(
    "builder.tsx imports the SAME checkStudioAccess/isStudioGateTestBypassed/isStudioGateLocalPaidBypassed trio every other gated route uses — no new auth architecture",
    /import\s*\{[^}]*checkStudioAccess[^}]*isStudioGateTestBypassed[^}]*isStudioGateLocalPaidBypassed[^}]*\}\s*from\s*["']@\/lib\/subscription-status["']/.test(
      routeSrc,
    ) ||
      /import\s*\{[^}]*isStudioGateTestBypassed[^}]*isStudioGateLocalPaidBypassed[^}]*checkStudioAccess[^}]*\}\s*from\s*["']@\/lib\/subscription-status["']/.test(
        routeSrc,
      ) ||
      (/checkStudioAccess/.test(routeSrc) &&
        /isStudioGateTestBypassed/.test(routeSrc) &&
        /isStudioGateLocalPaidBypassed/.test(routeSrc) &&
        /from\s*["']@\/lib\/subscription-status["']/.test(routeSrc)),
  );
  ok("builder.tsx's beforeLoad calls checkStudioAccess()", /beforeLoad:[\s\S]{0,200}checkStudioAccess\(\)/.test(routeSrc));
  ok('unauthenticated redirects to /auth', /access === "unauthenticated"[\s\S]{0,60}redirect\(\{\s*to:\s*["']\/auth["']/.test(routeSrc));
  ok('unpaid redirects to /pricing', /access === "unpaid"[\s\S]{0,60}redirect\(\{\s*to:\s*["']\/pricing["']/.test(routeSrc));
  ok("builder.tsx renders BuilderWorkspace as its component", /BuilderWorkspace/.test(routeSrc));
}

// ---- AppNavRail wiring -----------------------------------------------------
{
  ok('AppNavRail links to "/builder"', /RailLink\s+to="\/builder"/.test(navRailSrc));
  ok("the /builder rail link uses a distinct icon from Chart Studio's LineChart icon", /to="\/builder"[^/]*icon=\{<Code2\b/.test(navRailSrc));
  ok('the /builder rail link is titled "Indicator Builder"', /to="\/builder"[\s\S]{0,120}title="Indicator Builder"/.test(navRailSrc));
  ok("Chart Studio's own rail link is untouched (still LineChart / \"Chart Studio\")", /to="\/studio"[\s\S]{0,120}title="Chart Studio"/.test(navRailSrc));
}

// ---- Toolbar: Save/Add to Chart still unconditionally disabled; Phase
// ---- 5A-3 activates Validate, Phase 5A-4d additionally activates Run
// ---- Preview — no OTHER button ever computes a conditional disabled state.
{
  const buttonBlocks = toolbarSrc.split(/<button/).slice(1); // one entry per <button ...>...</button> region
  ok("BuilderToolbar renders at least 4 action buttons (Save, Validate, Run Preview, Add to Chart)", buttonBlocks.length >= 4);

  const saveBlock = buttonBlocks.find((b) => /aria-label="Save"/.test(b));
  const validateBlock = buttonBlocks.find((b) => /aria-label="Validate"/.test(b));
  const runPreviewBlock = buttonBlocks.find((b) => /aria-label="Run Preview"/.test(b));
  const addToChartBlock = buttonBlocks.find((b) => /aria-label="Add to Chart"/.test(b));

  ok(
    "Save remains unconditionally disabled (a literal `disabled` attribute, never `disabled={someCondition}`)",
    Boolean(saveBlock) && /\bdisabled(\s|>)/.test(saveBlock.slice(0, 60)) && !/disabled=\{/.test(saveBlock.slice(0, 60)),
  );
  ok(
    "Add to Chart remains unconditionally disabled (a literal `disabled` attribute, never `disabled={someCondition}`)",
    Boolean(addToChartBlock) && /\bdisabled(\s|>)/.test(addToChartBlock.slice(0, 60)) && !/disabled=\{/.test(addToChartBlock.slice(0, 60)),
  );
  ok(
    "Validate is a Phase 5A-3 exception: conditionally disabled via disabled={!canValidate}, driven by canValidate (a real prop, not a hardcoded true)",
    Boolean(validateBlock) && /disabled=\{!canValidate\}/.test(validateBlock),
  );
  ok(
    "Phase 5A-4d: Run Preview is conditionally disabled via disabled={!canRunPreview}, driven by canRunPreview (a real prop, not a hardcoded true)",
    Boolean(runPreviewBlock) && /disabled=\{!canRunPreview\}/.test(runPreviewBlock),
  );
  ok(
    "no button OTHER than Validate/Run Preview ever computes a conditional disabled state (disabled={...})",
    (toolbarSrc.match(/disabled=\{/g) ?? []).length === 2,
  );
  ok('Save button is present', /aria-label="Save"/.test(toolbarSrc));
  ok('Validate button is present', /aria-label="Validate"/.test(toolbarSrc));
  ok('Run Preview button is present', /aria-label="Run Preview"/.test(toolbarSrc));
  ok('Add to Chart button is present', /aria-label="Add to Chart"/.test(toolbarSrc));
}

// ---- No duplicated canonical logic + no server/AI call on load -----------
{
  // Every module the Phase 5A audit identified as the canonical
  // generation/validation/runtime/render/backtest chain. Builder must
  // consume these later by IMPORTING them (a plain reference is fine and
  // expected in later phases) — Phase 5A-1 must reference NONE of them yet,
  // since it wires nothing real.
  const FORBIDDEN_CANONICAL_IMPORTS = [
    "sgscript/runtime",
    "sgscript/worker",
    "sgscript/client",
    "sgscript/stdlib",
    "validate/pine",
    "validate/sgscript",
    "project.functions",
    "analyze.functions",
    "sgscript.functions",
    "indicators.functions",
    "indicatorMessages.functions",
    "backtest/engine",
    "backtest.functions",
    "components/studio/StudioChart",
    "lightweight-charts",
  ];
  for (const [file, src] of Object.entries(sources)) {
    for (const forbidden of FORBIDDEN_CANONICAL_IMPORTS) {
      // Phase 5A-4c: PreviewPanel.tsx is the ONE deliberate exception to the
      // StudioChart ban — it's Builder's real Live Preview surface now, and
      // StudioChart is the canonical renderer it's explicitly meant to
      // reuse (never a second chart engine). This mirrors the exact
      // precedent already set for sgscript/client becoming allowed in
      // useBuilderProject.ts back in Phase 5A-4b: the FULL exception list
      // still applies to every other file, and PreviewPanel.tsx itself
      // still forbids everything else here (lightweight-charts, every
      // sgscript/* internal, every *.functions module) — see
      // test/builder/builderChatDataPath.test.mjs's own dedicated section
      // for PreviewPanel's complete, explicit allow/forbid proof.
      if (file === "src/components/builder/PreviewPanel.tsx" && forbidden === "components/studio/StudioChart") continue;
      ok(`${file} never imports canonical module "${forbidden}" (Phase 5A-1 shell-only rule, still in force except PreviewPanel.tsx's StudioChart exception)`, !src.includes(forbidden));
    }
  }

  // No server function machinery anywhere in the Builder shell — this is
  // what actually proves "loading /builder cannot make any AI/server call":
  // there is nothing in these files capable of issuing one.
  for (const [file, src] of Object.entries(sources)) {
    ok(`${file} never imports createServerFn`, !src.includes("createServerFn"));
    ok(`${file} never imports useServerFn`, !src.includes("useServerFn"));
    ok(`${file} never imports a "*.functions" module`, !/from\s+["'][^"']*\.functions["']/.test(src));
    ok(`${file} never references supabaseAdmin/service_role`, !/supabaseAdmin|service_role|SUPABASE_SERVICE_ROLE/.test(src));
  }
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
