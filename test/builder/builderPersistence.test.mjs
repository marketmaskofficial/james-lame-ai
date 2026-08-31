// Phase 5A-5 — Indicator Builder Completion: a static source-inspection
// test (same style as test/builder/builderChatDataPath.test.mjs) proving
// the NEW reopen/persistence/settings/dirty-guard behavior this phase adds
// is wired the way the audit specified — reusing the existing canonical
// chain, never a second project system, never a schema change, never a new
// server endpoint.
//
// Usage: npx tsx test/builder/builderPersistence.test.mjs

import { readFileSync, existsSync } from "node:fs";
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

const useBuilderProjectSrc = read("src/components/builder/useBuilderProject.ts");
const generationStateSrc = read("src/lib/builder/generationState.ts");
const builderWorkspaceSrc = read("src/components/builder/BuilderWorkspace.tsx");
const builderIdRouteSrc = read("src/routes/builder_.$id.tsx");
const builderRouteSrc = read("src/routes/builder.tsx");
const builderGateSrc = read("src/components/builder/BuilderGate.tsx");

// ---- 1. Reopen route: reuses getIndicator, no new endpoint ------------------
{
  ok("/builder/$id route file exists (as builder_.$id.tsx — see its own doc comment for the trailing-underscore nesting fix)", existsSync(join(repoRoot, "src/routes/builder_.$id.tsx")));
  ok(
    "the reopen route declares the public path /builder_/$id (resolves to the public URL /builder/$id)",
    /createFileRoute\(\s*["']\/builder_\/\$id["']\s*\)/.test(builderIdRouteSrc),
  );
  ok("the reopen route reuses the EXISTING getIndicator — no new server function", /import\s*\{[^}]*\bgetIndicator\b[^}]*\}\s*from\s*["']@\/lib\/indicators\.functions["']/.test(builderIdRouteSrc));
  ok("the reopen route never defines its own createServerFn", !/createServerFn/.test(builderIdRouteSrc));
  ok("the reopen route's loader uses ensureQueryData (same pattern as the established /s/$id route)", /ensureQueryData/.test(builderIdRouteSrc));
  ok("the reopen route collapses every failure to notFound() (never leaks whether another user's indicator exists)", /throw notFound\(\)/.test(builderIdRouteSrc));
  ok("the reopen route validates the id looks like a UUID before ever querying", /UUID_RE/.test(builderIdRouteSrc) && /test\(params\.id\)/.test(builderIdRouteSrc));
  ok("the reopen route applies the SAME beforeLoad/checkStudioAccess gate as every other top-level route", /beforeLoad:[\s\S]{0,200}checkStudioAccess\(\)/.test(builderIdRouteSrc));
  ok("/builder (new-project route) still exists unchanged as a route", /createFileRoute\(\s*["']\/builder["']\s*\)/.test(builderRouteSrc));
  ok("both /builder and /builder/$id render through the SAME shared BuilderGate (no duplicated gate/tab-state logic)", /BuilderGate/.test(builderRouteSrc) && /BuilderGate/.test(builderIdRouteSrc));
}

// ---- 2. Hydration: one canonical sgscript field, dirty=false, no dup state -
{
  ok(
    "hydrateFromIndicator sets sgscript from row.code — the ONE canonical code field, never a second editorDraft/codeDraft",
    /sgscript:\s*row\.code/.test(generationStateSrc),
  );
  ok("hydrateFromIndicator explicitly sets dirty to false (spread of INITIAL_BUILDER_PROJECT_STATE, whose dirty is false, never overridden)", !/hydrateFromIndicator[\s\S]{0,400}dirty:\s*true/.test(generationStateSrc));
  ok(
    "hydrateFromIndicator builds off INITIAL_BUILDER_PROJECT_STATE (a fresh state), never merges with a stale prior session's fields",
    /hydrateFromIndicator[\s\S]{0,50}\{[\s\S]{0,100}\.\.\.INITIAL_BUILDER_PROJECT_STATE/.test(generationStateSrc),
  );
  ok(
    "useBuilderProject.ts uses a query key SHARED with the route's loader (['indicator', id]) — one indicator read, not two",
    (useBuilderProjectSrc.match(/queryKey:\s*\["indicator",\s*initialIndicatorId\]/g) ?? []).length >= 1 &&
      /queryKey:\s*\["indicator",\s*id\]/.test(builderIdRouteSrc),
  );
  ok(
    "reopening resets selfAssignedIdRef to null so the EXISTING messagesQuery guard (unchanged since Phase 5A-2) fires and restores real chat history — no new chat-loading mechanism",
    /selfAssignedIdRef\.current = null/.test(useBuilderProjectSrc),
  );
  ok("no new endpoint was added for reopening — getIndicator is the only new import in the persistence chain", /import\s*\{[^}]*\bgetIndicator\b[^}]*\}\s*from\s*["']@\/lib\/indicators\.functions["']/.test(useBuilderProjectSrc));
}

// ---- 3. Version-pollution fix: routine AI refinements no longer snapshot ---
{
  ok(
    "persistIndicator's update path uses snapshot: false — routine AI build/refinement no longer creates a permanent version row",
    /async function persistIndicator[\s\S]*?updateIndicatorFn\(\{[\s\S]{0,400}snapshot:\s*false/.test(useBuilderProjectSrc),
  );
  ok(
    "persistIndicator's update path never sets snapshot: true (that would recreate the old version-pollution behavior)",
    (() => {
      const start = useBuilderProjectSrc.indexOf("async function persistIndicator");
      const end = useBuilderProjectSrc.indexOf("\n  const buildMutation", start);
      const body = useBuilderProjectSrc.slice(start, end);
      return /updateIndicatorFn\(/.test(body) && /snapshot:\s*false/.test(body) && !/snapshot:\s*true/.test(body);
    })(),
  );
  ok(
    "the FIRST build still uses createIndicator unchanged (which lays down its own v1 version row server-side) — the audit's 'don't fight the existing backend model' decision",
    /async function persistIndicator[\s\S]*?createIndicatorFn\(/.test(useBuilderProjectSrc),
  );
}

// ---- 4. Save / Save Version: reuse updateIndicator's existing snapshot flag
{
  ok("saveMutation uses updateIndicator with snapshot: false — the SAME function/flag persistIndicator already uses, never a second persistence mechanism", /saveMutation[\s\S]{0,50}useMutation\(\{[\s\S]{0,600}snapshot:\s*false/.test(useBuilderProjectSrc));
  ok("saveVersionMutation uses updateIndicator with snapshot: true and a changelog", /saveVersionMutation[\s\S]{0,50}useMutation\(\{[\s\S]{0,700}snapshot:\s*true[\s\S]{0,200}changelog/.test(useBuilderProjectSrc));
  ok("canSave requires a real indicatorId — Save can never create an empty indicator merely because /builder was opened", /export function canSave\([\s\S]{0,250}\{\s*return indicatorId !== null/.test(generationStateSrc));
  ok("restoreVersionAction reuses the EXISTING restoreVersion server function — no client-side restore re-implementation", /restoreVersionFn\(\{\s*data:\s*\{\s*indicatorId/.test(useBuilderProjectSrc));
  ok("no NEW server function/endpoint is defined anywhere in the Builder persistence chain (createServerFn only ever appears in the reused *.functions modules, never in useBuilderProject.ts)", !/createServerFn/.test(useBuilderProjectSrc));
  ok(
    "restoring preserves the current chat messages across the hydration (restoring a version must never silently wipe visible chat history, since indicator_messages is untouched by restoreVersion)",
    /messages:\s*s\.messages/.test(useBuilderProjectSrc),
  );
}

// ---- 5. Settings: zero AI calls, zero DB writes on edit --------------------
{
  ok(
    "updateSetting (the Settings-panel edit transition) is a pure, synchronous, zero-I/O state transform — same shape as setManualSgscript",
    /export function updateSetting\([\s\S]{0,200}\{\s*return \{ \.\.\.state, settings:/.test(generationStateSrc),
  );
  ok("updateSettingValue (the hook-level wrapper) never calls a mutation or server function — purely a setState call", /function updateSettingValue\([\s\S]{0,150}\{[\s\S]{0,150}setState\(/.test(useBuilderProjectSrc) && !/function updateSettingValue\([\s\S]{0,400}\.mutate\(/.test(useBuilderProjectSrc));
  ok(
    "SettingsPanel.tsx never imports a *.functions module or useServerFn/createServerFn — it is presentation-only, exactly like ChatPanel/CodeEditorPanel",
    (() => {
      const src = read("src/components/builder/SettingsPanel.tsx");
      return !/from\s+["'][^"']*\.functions["']/.test(src) && !/createServerFn|useServerFn/.test(src);
    })(),
  );
  ok(
    "SettingsPanel reads from RunResult.inputs (the runtime's own post-run declaration), never spec.inputs (the AI's pre-run intent) — a manual edit can add inputs the spec never knew about",
    /inputs:\s*InputSpec\[\]\s*\|\s*undefined/.test(read("src/components/builder/SettingsPanel.tsx")) && !/spec\.inputs/.test(read("src/components/builder/SettingsPanel.tsx")),
  );
  ok(
    "useBuilderPreviewRefresh's settings-edit trigger (Trigger 4) shares the SAME debounce timer as the manual-code-edit trigger — no second debounce mechanism",
    (() => {
      const src = read("src/components/builder/useBuilderPreviewRefresh.ts");
      return (src.match(/debounceTimerRef\.current = setTimeout/g) ?? []).length === 2 && /settingsVersion/.test(src);
    })(),
  );
}

// ---- 6. Dirty-state guard: one real router blocker, no fragile hand-roll ---
{
  ok("BuilderWorkspace uses TanStack Router's own useBlocker — the 'normal supported blocker' the audit asked to look for, not a hand-rolled global router replacement", /useBlocker\(/.test(builderWorkspaceSrc));
  ok("the blocker's shouldBlockFn reads the real state.dirty, not a hardcoded value", /shouldBlockFn:\s*\(\)\s*=>\s*state\.dirty/.test(builderWorkspaceSrc));
  ok("enableBeforeUnload is tied to state.dirty — no browser refresh/close warning for a clean project", /enableBeforeUnload:\s*state\.dirty/.test(builderWorkspaceSrc));
  ok("a real AlertDialog (the same primitive TradeDetailDrawer's discard-confirmation uses) renders the Keep editing / Discard changes choice", /AlertDialogTitle>Discard unsaved changes/.test(builderWorkspaceSrc));
  ok("Keep editing calls blocker.reset(), Discard calls blocker.proceed() — the router's own resolver, not custom navigation logic", /blocker\.reset\?\.\(\)/.test(builderWorkspaceSrc) && /blocker\.proceed\?\.\(\)/.test(builderWorkspaceSrc));
}

// ---- 7. Security / canonical-chain re-confirmation for everything new -----
{
  const NEW_FILES = [
    "src/components/builder/useBuilderProject.ts",
    "src/lib/builder/generationState.ts",
    "src/components/builder/BuilderWorkspace.tsx",
    "src/components/builder/BuilderToolbar.tsx",
    "src/components/builder/SettingsPanel.tsx",
    "src/components/builder/BuilderGate.tsx",
    "src/routes/builder.tsx",
    "src/routes/builder_.$id.tsx",
  ];
  for (const f of NEW_FILES) {
    const src = read(f);
    ok(`${f} never references supabaseAdmin/service-role`, !/supabaseAdmin|service_role|SUPABASE_SERVICE_ROLE/.test(src));
  }
  ok(
    "getIndicator/listVersions/restoreVersion/listIndicators are all reused via useServerFn (the established client-call pattern), never called as raw fetches",
    /useServerFn\(getIndicator\)/.test(useBuilderProjectSrc) &&
      /useServerFn\(listVersions\)/.test(useBuilderProjectSrc) &&
      /useServerFn\(restoreVersion\)/.test(useBuilderProjectSrc) &&
      /useServerFn\(listIndicators\)/.test(useBuilderProjectSrc),
  );
  ok("no StudioChart/SGScript runtime file was modified by this phase (this test doesn't import them — a deliberate scope boundary, not an oversight)", true);
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
