// Regression guard for the Phase 4B-1 hosted bug: the Dashboard's account
// list broke on a real Lovable Cloud deploy where the database itself was
// fully connected, because it reused `listTradingAccounts`
// (src/lib/trading.functions.ts), which lazily imports the OMS
// (src/lib/trading/oms.server.ts) and reads through `supabaseAdmin` — a
// service-role client requiring SUPABASE_SERVICE_ROLE_KEY, which that
// environment didn't expose.
//
// There is no live-Supabase/mocked-request-context test harness in this
// codebase (no test imports any `*.functions.ts` server function and
// exercises its handler — `listClosedTrades` itself has no such test
// either, only its underlying pure `deriveClosedTrades` logic does), so an
// end-to-end "does this actually avoid needing the service-role key at
// runtime" test isn't feasible here. What IS feasible and meaningful: a
// static check that the Dashboard's account-loading source never imports
// the OMS, `supabaseAdmin`, or `trading.functions` again — the exact
// regression that caused this bug — plus confirming the new function is
// shaped the way the fix requires.
//
// Usage: npx tsx test/dashboard/accountsDataPath.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as dashboardFns from "../../src/lib/dashboard.functions.ts";

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

const dashboardFnsSrcRaw = readFileSync(join(repoRoot, "src/lib/dashboard.functions.ts"), "utf8");
const dashboardRouteSrcRaw = readFileSync(join(repoRoot, "src/routes/dashboard.tsx"), "utf8");
// Doc comments deliberately name `oms.server`/`supabaseAdmin`/`trading.functions`
// in backticks to explain what NOT to do — strip comments before scanning so
// that prose doesn't false-positive as actual code usage.
const dashboardFnsSrc = stripComments(dashboardFnsSrcRaw);
const dashboardRouteSrc = stripComments(dashboardRouteSrcRaw);

const importsFrom = (src, pattern) => new RegExp(`from\\s+["'][^"']*${pattern}[^"']*["']`).test(src);

// ---- dashboard.functions.ts: the account-loading server function itself --
{
  ok(
    "dashboard.functions.ts never imports the OMS (oms.server)",
    !importsFrom(dashboardFnsSrc, "oms\\.server"),
  );
  ok(
    "dashboard.functions.ts never imports supabaseAdmin/client.server",
    !importsFrom(dashboardFnsSrc, "client\\.server") && !dashboardFnsSrc.includes("supabaseAdmin"),
  );
  ok(
    "dashboard.functions.ts never imports trading.functions (listTradingAccounts's home)",
    !importsFrom(dashboardFnsSrc, "trading\\.functions"),
  );
  ok("listDashboardAccounts is exported as a function", typeof dashboardFns.listDashboardAccounts === "function");
  ok("listClosedTrades is still exported as a function (unrelated to this fix)", typeof dashboardFns.listClosedTrades === "function");
  ok(
    "listDashboardAccounts reads trading_accounts directly",
    /listDashboardAccounts[\s\S]{0,400}from\(\s*["']trading_accounts["']\s*\)/.test(dashboardFnsSrc),
  );
  ok(
    "listDashboardAccounts is wired through requireSupabaseAuth (the same RLS-scoped middleware listClosedTrades uses)",
    /listDashboardAccounts\s*=\s*createServerFn\([^)]*\)\s*\.middleware\(\[requireSupabaseAuth\]\)/.test(dashboardFnsSrc),
  );
  ok(
    "listDashboardAccounts reads through context.supabase, not a second/admin client",
    /listDashboardAccounts[\s\S]{0,400}context\.supabase/.test(dashboardFnsSrc),
  );
}

// ---- dashboard.tsx: the route must consume the new function, not the old one
{
  ok("dashboard.tsx imports listDashboardAccounts from dashboard.functions", /import\s*\{[^}]*listDashboardAccounts[^}]*\}\s*from\s*["']@\/lib\/dashboard\.functions["']/.test(dashboardRouteSrc));
  ok("dashboard.tsx no longer imports listTradingAccounts (the admin-client-backed function)", !dashboardRouteSrc.includes("listTradingAccounts"));
  ok("dashboard.tsx no longer imports trading.functions at all", !importsFrom(dashboardRouteSrc, "trading\\.functions"));
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
