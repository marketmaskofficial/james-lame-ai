// Regression guard for Phase 4G's Trade Explorer <-> Journal Analytics
// cross-navigation: a static source-inspection check (same style as
// test/dashboard/journalDataPath.test.mjs) that:
//   - the Trade Explorer contextual region never introduces a second
//     full-dataset Journal Analytics fetch (no listJournalAnalyticsTrades
//     import anywhere near it),
//   - it reuses the existing Phase 4F pure aggregation/presentation logic
//     rather than reimplementing the Journaled/Non-Journaled split,
//   - every "Analyze this X" link in the Trade Detail drawer targets a real
//     JournalFocusKind value understood by /journal's own focus contract,
//   - the cross-links carry only the shared Account/Symbol/Date parameters
//     (never Trade Explorer-only direction/outcome/session/sort/page state),
//   - the /journal -> /trades "View Journaled Trades" link uses Trade
//     Explorer's existing validated `journal` filter contract.
//
// There is no live-browser test harness in this codebase to render these
// components, so this proves the SOURCE never reaches for a duplicate
// fetch/engine and always targets the real, already-existing contracts.
//
// Usage: npx tsx test/dashboard/journalWorkspaceCrossNav.test.mjs

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

const contextRegionSrc = read("src/components/trades/JournalContextRegion.tsx");
const drawerSrc = read("src/components/trades/TradeDetailDrawer.tsx");
const tradesRouteSrc = read("src/routes/trades.tsx");
const journalRouteSrc = read("src/routes/journal.tsx");

// ---- Trade Explorer's contextual region never duplicates the full
// Journal Analytics fetch/engine ------------------------------------------
{
  ok(
    "JournalContextRegion never imports listJournalAnalyticsTrades (no duplicate full-dataset fetch)",
    !contextRegionSrc.includes("listJournalAnalyticsTrades"),
  );
  ok(
    "JournalContextRegion never imports the server data-path module directly",
    !/from\s+["'][^"']*journalAnalytics\.functions[^"']*["']/.test(contextRegionSrc),
  );
  ok(
    "JournalContextRegion reuses the existing journaledVsNonJournaled aggregation (no reimplementation)",
    /import\s*\{[^}]*journaledVsNonJournaled[^}]*\}/.test(contextRegionSrc),
  );
  ok(
    "JournalContextRegion reuses the existing JournaledComparisonCard presentation component",
    /import\s*\{[^}]*JournaledComparisonCard[^}]*\}/.test(contextRegionSrc),
  );
  ok("trades.tsx never imports listJournalAnalyticsTrades either", !tradesRouteSrc.includes("listJournalAnalyticsTrades"));
}

// ---- Trade Detail drawer: every "Analyze this X" link targets a real
// focusKind value, and carries only the shared filter context -------------
{
  const FOCUS_KINDS = ["setup", "strategy", "grade", "emotion", "mistake", "tag", "session"];
  for (const kind of FOCUS_KINDS) {
    ok(`TradeDetailDrawer has an AnalyzeLink wired to focusKind "${kind}"`, new RegExp(`kind="${kind}"`).test(drawerSrc));
  }
  ok("AnalyzeLink navigates to /journal", /to="\/journal"/.test(drawerSrc));
  ok("AnalyzeLink's search sets focusKind from its own kind prop", /focusKind:\s*kind/.test(drawerSrc));
  ok("AnalyzeLink's search sets focusValue from its own value prop", /focusValue:\s*value/.test(drawerSrc));
  ok(
    "AnalyzeLink carries the shared accountId/symbol/from/to context, never a hardcoded value",
    /accountId:\s*context\.accountId/.test(drawerSrc) &&
      /symbol:\s*context\.symbol/.test(drawerSrc) &&
      /from:\s*context\.from/.test(drawerSrc) &&
      /to:\s*context\.to/.test(drawerSrc),
  );
  ok(
    "AnalyzeLink never references Trade Explorer-only filters (direction/outcome/session-filter/sortKey/page) that /journal doesn't support",
    !/direction:|outcome:|sortKey:|sortDir:|page:/.test(drawerSrc.slice(drawerSrc.indexOf("function AnalyzeLink"))),
  );
  ok("TradeDetailDrawer's props require a journalContext for building these links", /journalContext:\s*JournalLinkContext/.test(drawerSrc));
  ok(
    "trades.tsx passes its current accountId/symbol/from/to as the drawer's journalContext",
    /journalContext=\{\{\s*accountId:[^}]*symbol[^}]*from[^}]*to[^}]*\}\}/.test(tradesRouteSrc),
  );
}

// ---- /journal -> /trades "View Journaled Trades" uses the existing
// validated journal filter contract ----------------------------------------
{
  ok('journal.tsx links to /trades with journal: "journaled"', /to="\/trades"[\s\S]{0,200}journal:\s*"journaled"/.test(journalRouteSrc));
  ok(
    "the View Journaled Trades link carries the shared accountId/symbol/from/to, not Journal Analytics' focusKind/focusValue",
    (() => {
      const idx = journalRouteSrc.indexOf('to="/trades"');
      if (idx === -1) return false;
      const nearby = journalRouteSrc.slice(idx, idx + 300);
      return nearby.includes("tradesLink.accountId") && !nearby.includes("focusKind");
    })(),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
