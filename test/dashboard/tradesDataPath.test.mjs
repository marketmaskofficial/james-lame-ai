// Regression guard for the Phase 4D Trade Explorer data path, in the same
// spirit as test/dashboard/accountsDataPath.test.mjs: a static check that
// src/lib/trades.functions.ts never imports the OMS, `supabaseAdmin`, or
// `trading.functions` — the exact class of bug that broke the Dashboard's
// account loading in Phase 4B-1 (see accountsDataPath.test.mjs's own doc
// comment). There is no live-Supabase test harness in this codebase to
// exercise the actual handler against a real database/RLS, so this proves
// the SOURCE never reaches for the service-role-requiring path, and that
// the new server functions are wired the same way `listClosedTrades`/
// `listDashboardAccounts` already are.
//
// Usage: npx tsx test/dashboard/tradesDataPath.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as tradesFns from "../../src/lib/trades.functions.ts";

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

const srcRaw = readFileSync(join(repoRoot, "src/lib/trades.functions.ts"), "utf8");
const src = stripComments(srcRaw);

const importsFrom = (s, pattern) => new RegExp(`from\\s+["'][^"']*${pattern}[^"']*["']`).test(s);

// ---- source-level checks: no service-role/OMS path anywhere -------------
{
  ok("trades.functions.ts never imports the OMS (oms.server)", !importsFrom(src, "oms\\.server"));
  ok("trades.functions.ts never imports supabaseAdmin/client.server", !importsFrom(src, "client\\.server") && !src.includes("supabaseAdmin"));
  ok("trades.functions.ts never imports trading.functions", !importsFrom(src, "trading\\.functions"));
  ok("trades.functions.ts imports requireSupabaseAuth (the RLS-scoped middleware)", /import\s*\{[^}]*requireSupabaseAuth[^}]*\}/.test(src));
}

// ---- every exported server function is wired through the same middleware
{
  ok("listClosedTradesPage is exported as a function", typeof tradesFns.listClosedTradesPage === "function");
  ok("listExecutionsForPosition is exported as a function", typeof tradesFns.listExecutionsForPosition === "function");
  ok("getJournalEntryForPosition is exported as a function", typeof tradesFns.getJournalEntryForPosition === "function");

  for (const name of ["listClosedTradesPage", "listExecutionsForPosition", "getJournalEntryForPosition"]) {
    const re = new RegExp(`${name}\\s*=\\s*createServerFn\\([^)]*\\)\\s*\\.middleware\\(\\[requireSupabaseAuth\\]\\)`);
    ok(`${name} is wired through requireSupabaseAuth, the same RLS-scoped middleware every other Dashboard read uses`, re.test(src));
  }
}

// ---- each handler reads through context.supabase, not a second/admin client
{
  for (const name of ["listClosedTradesPage", "listExecutionsForPosition", "getJournalEntryForPosition"]) {
    const idx = src.indexOf(`export const ${name}`);
    ok(`${name} exists in source`, idx !== -1);
    const nextIdx = src.indexOf("export const", idx + 1);
    const body = nextIdx === -1 ? src.slice(idx) : src.slice(idx, nextIdx);
    ok(`${name} reads through context.supabase`, body.includes("context.supabase"));
  }
}

// ---- executions/journal reads are scoped to a single position, never a
// blanket "every position" query that could leak across accounts/positions
{
  ok(
    "listExecutionsForPosition filters by position_id (never fetches unscoped)",
    /listExecutionsForPosition[\s\S]{0,400}\.eq\(\s*["']position_id["']/.test(src),
  );
  ok(
    "getJournalEntryForPosition filters by position_id (never fetches unscoped)",
    /getJournalEntryForPosition[\s\S]{0,400}\.eq\(\s*["']position_id["']/.test(src),
  );
}

// ---- reuses the Dashboard's shared row-mapping/column-select constants,
// never redeclares a second `v_closed_trades` column list or mapping
{
  ok(
    "listClosedTradesPage reuses CLOSED_TRADE_VIEW_SELECT from dashboard.functions.ts (no second column list)",
    src.includes("CLOSED_TRADE_VIEW_SELECT"),
  );
  ok(
    "listClosedTradesPage reuses mapClosedTradeViewRow from dashboard.functions.ts (no second row-mapping)",
    src.includes("mapClosedTradeViewRow"),
  );
  ok(
    "listClosedTradesPage delegates filter/sort/paginate to queryClosedTrades (no duplicated logic)",
    src.includes("queryClosedTrades"),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
