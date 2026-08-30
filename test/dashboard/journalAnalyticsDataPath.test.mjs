// Regression guard for the Phase 4F Journal Analytics server data path
// (`listJournalAnalyticsTrades`, src/lib/journalAnalytics.functions.ts), in
// the same spirit as test/dashboard/journalDataPath.test.mjs and
// test/dashboard/tradesDataPath.test.mjs: a static check that this new
// module never imports the OMS, `supabaseAdmin`, or `trading.functions`, is
// wired through the same RLS-scoped `requireSupabaseAuth` middleware every
// other Dashboard/Trade Explorer/Journal function uses, explicitly scopes
// every read by the authenticated user, and — the Phase 4F-specific
// property — pages through the FULL closed-trade result set rather than
// silently capping at Phase 4D's 2000-row Trade Explorer limit.
//
// Usage: npx tsx test/dashboard/journalAnalyticsDataPath.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as journalAnalyticsFns from "../../src/lib/journalAnalytics.functions.ts";

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

const srcRaw = readFileSync(join(repoRoot, "src/lib/journalAnalytics.functions.ts"), "utf8");
const src = stripComments(srcRaw);

const importsFrom = (s, pattern) => new RegExp(`from\\s+["'][^"']*${pattern}[^"']*["']`).test(s);

// ---- source-level checks: no service-role/OMS path anywhere -------------
{
  ok("journalAnalytics.functions.ts never imports the OMS (oms.server)", !importsFrom(src, "oms\\.server"));
  ok(
    "journalAnalytics.functions.ts never imports supabaseAdmin/client.server",
    !importsFrom(src, "client\\.server") && !src.includes("supabaseAdmin"),
  );
  ok("journalAnalytics.functions.ts never imports trading.functions", !importsFrom(src, "trading\\.functions"));
  ok("journalAnalytics.functions.ts imports requireSupabaseAuth (the RLS-scoped middleware)", /import\s*\{[^}]*requireSupabaseAuth[^}]*\}/.test(src));
}

// ---- listJournalAnalyticsTrades is exported and wired through the same
// middleware every other Journal/Trade Explorer function uses
{
  ok("listJournalAnalyticsTrades is exported as a function", typeof journalAnalyticsFns.listJournalAnalyticsTrades === "function");
  const re = /listJournalAnalyticsTrades\s*=\s*createServerFn\([^)]*\)\s*\.middleware\(\[requireSupabaseAuth\]\)/;
  ok("listJournalAnalyticsTrades is wired through requireSupabaseAuth", re.test(src));
  ok("listJournalAnalyticsTrades reads through context.supabase, not a second/admin client", src.includes("context.supabase"));
}

// ---- explicit user_id scoping on every journal-side table read ------------
{
  ok(
    "journal_entries read is scoped by user_id (defense-in-depth alongside RLS)",
    /from\("journal_entries"[^)]*\)[\s\S]{0,200}\.eq\("user_id",\s*context\.userId\)/.test(src),
  );
  ok(
    "journal_entry_terms read is scoped by user_id",
    /from\("journal_entry_terms"[^)]*\)[\s\S]{0,200}\.eq\("user_id",\s*context\.userId\)/.test(src),
  );
  ok(
    "journal_taxonomy_terms read is scoped by user_id",
    /from\("journal_taxonomy_terms"[^)]*\)[\s\S]{0,200}\.eq\("user_id",\s*context\.userId\)/.test(src),
  );
  ok("v_closed_trades read is scoped by account_id from validated input", src.includes('.eq("account_id", args.accountId)'));
}

// ---- Phase 4F's core scale requirement: no silent 2000-row cap ------------
{
  ok(
    "exports its own hard ceiling constant, separate from Phase 4D's MAX_FETCH_ROWS",
    typeof journalAnalyticsFns.ANALYTICS_TRADE_HARD_CEILING === "number",
  );
  ok(
    "the hard ceiling is significantly above Phase 4D's 2000-row Trade Explorer cap",
    journalAnalyticsFns.ANALYTICS_TRADE_HARD_CEILING >= 20000,
  );
  ok("exports a batch size for paginated fetching", typeof journalAnalyticsFns.ANALYTICS_TRADE_BATCH_SIZE === "number");
  ok(
    "fetch loop uses .range(...) (real pagination), not a single .limit(...) cap",
    /\.range\(offset,\s*offset\s*\+\s*ANALYTICS_TRADE_BATCH_SIZE\s*-\s*1\)/.test(src),
  );
  ok(
    "pagination uses a stable tiebreaker (position_id) alongside closed_at, so same-timestamp rows can't be split unpredictably across pages",
    /\.order\("closed_at"[^)]*\)[\s\S]{0,120}\.order\("position_id"/.test(src),
  );
  ok(
    "the loop continues (does not stop) once a full page comes back, only stopping on a short page or the hard ceiling",
    /if\s*\(page\.length\s*<\s*ANALYTICS_TRADE_BATCH_SIZE\)\s*break/.test(src),
  );
  ok("truncation beyond the hard ceiling is disclosed via a returned `truncated` flag, never silent", /truncated\s*=\s*true/.test(src));
}

// ---- chunked (never N+1 / never one query per trade) id lookups -----------
{
  ok(
    "id lookups are chunked via a shared helper rather than issuing one request per id",
    src.includes("fetchByIdsInChunks"),
  );
  ok("chunk size is a small bounded constant, not the full id list in one request", /ID_CHUNK_SIZE\s*=\s*500/.test(src));
}

// ---- assembly logic is delegated to the pure, independently-tested builder
{
  ok(
    "the server function delegates trade/journal/term assembly to the pure buildJournalAnalyticsTrades (no duplicate join logic in the I/O shell)",
    src.includes("buildJournalAnalyticsTrades("),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
