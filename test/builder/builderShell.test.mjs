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

// ---- Toolbar: every action is unconditionally disabled, never a fake stub -
{
  const buttonBlocks = toolbarSrc.split(/<button/).slice(1); // one entry per <button ...>...</button> region
  ok("BuilderToolbar renders at least 3 action buttons (Save, Validate, Add to Chart)", buttonBlocks.length >= 3);
  ok(
    "every toolbar button is unconditionally disabled (a literal `disabled` attribute, never `disabled={someCondition}`)",
    buttonBlocks.every((b) => /\bdisabled(\s|>)/.test(b.slice(0, 60))),
  );
  ok("no toolbar button ever computes a conditional disabled state (disabled={...})", !/disabled=\{/.test(toolbarSrc));
  ok('Save button is present', /aria-label="Save"/.test(toolbarSrc));
  ok('Validate button is present', /aria-label="Validate"/.test(toolbarSrc));
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
      ok(`${file} never imports canonical module "${forbidden}" (Phase 5A-1 is shell-only)`, !src.includes(forbidden));
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
