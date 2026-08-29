// Regression guard for the Phase 4E-1 Trade Journal write path
// (`saveTradeJournalForPosition`, src/lib/trades.functions.ts), in the same
// spirit as test/dashboard/tradesDataPath.test.mjs and
// test/dashboard/accountsDataPath.test.mjs: a static check that the journal
// write path never imports the OMS, `supabaseAdmin`, or `trading.functions`,
// is wired through the same RLS-scoped `requireSupabaseAuth` middleware
// every other Dashboard/Trade Explorer function uses, and explicitly scopes
// every read/write by the authenticated user (belt-and-suspenders alongside
// RLS, not a replacement for it). There is no live-Supabase test harness in
// this codebase to exercise the actual handler against a real database, so
// this proves the SOURCE never reaches for the service-role-requiring path.
//
// Usage: npx tsx test/dashboard/journalDataPath.test.mjs

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

function bodyOf(name) {
  const idx = src.indexOf(`export const ${name}`);
  if (idx === -1) return null;
  const nextIdx = src.indexOf("export const", idx + 1);
  return nextIdx === -1 ? src.slice(idx) : src.slice(idx, nextIdx);
}

// ---- source-level checks: no service-role/OMS path anywhere -------------
{
  ok("trades.functions.ts (journal write path lives here) never imports the OMS (oms.server)", !importsFrom(src, "oms\\.server"));
  ok(
    "trades.functions.ts never imports supabaseAdmin/client.server",
    !importsFrom(src, "client\\.server") && !src.includes("supabaseAdmin"),
  );
  ok("trades.functions.ts never imports trading.functions", !importsFrom(src, "trading\\.functions"));
  ok("trades.functions.ts imports requireSupabaseAuth (the RLS-scoped middleware)", /import\s*\{[^}]*requireSupabaseAuth[^}]*\}/.test(src));
}

// ---- saveTradeJournalForPosition is exported and wired through the same
// middleware every other Trade Explorer function uses
{
  ok("saveTradeJournalForPosition is exported as a function", typeof tradesFns.saveTradeJournalForPosition === "function");
  const re = /saveTradeJournalForPosition\s*=\s*createServerFn\([^)]*\)\s*\.middleware\(\[requireSupabaseAuth\]\)/;
  ok("saveTradeJournalForPosition is wired through requireSupabaseAuth", re.test(src));

  const body = bodyOf("saveTradeJournalForPosition");
  ok("saveTradeJournalForPosition exists in source", body !== null);
  ok("saveTradeJournalForPosition reads/writes through context.supabase, not a second/admin client", body.includes("context.supabase"));
}

// ---- explicit position-ownership check before any journal write ----------
{
  const body = bodyOf("saveTradeJournalForPosition");
  ok(
    "saveTradeJournalForPosition explicitly verifies the position belongs to the caller (trade_positions + user_id) before writing",
    /from\(\s*["']trade_positions["']\s*\)[\s\S]{0,200}\.eq\(\s*["']user_id["']/.test(body),
  );
}

// ---- explicit user scoping on the write path (belt-and-suspenders
// alongside RLS, matching the newer Dashboard/Trade Explorer convention)
{
  const body = bodyOf("saveTradeJournalForPosition");
  ok(
    "the existing-entry lookup is explicitly scoped by user_id (not relying on RLS alone)",
    /from\(\s*["']journal_entries["']\)[\s\S]{0,200}\.eq\(\s*["']user_id["']/.test(body),
  );
  ok(
    "the UPDATE path is explicitly scoped by user_id (not just by id)",
    /\.update\(\{[\s\S]{0,200}\}\)[\s\S]{0,120}\.eq\(\s*["']user_id["']/.test(body),
  );
  ok("the INSERT path sets user_id from context.userId, never from client input", /insert\(\{[\s\S]{0,80}user_id:\s*context\.userId/.test(body));
}

// ---- narrow partial write: only notes/session are ever set on UPDATE,
// never a full-row overwrite of fields this editor doesn't own -----------
{
  const body = bodyOf("saveTradeJournalForPosition");
  const updateCallMatch = body.match(/\.update\(\{([\s\S]{0,200}?)\}\)/);
  ok("saveTradeJournalForPosition's UPDATE call exists", !!updateCallMatch);
  const updatePayload = updateCallMatch ? updateCallMatch[1] : "";
  ok("the UPDATE payload writes notes", /notes\s*:/.test(updatePayload));
  ok("the UPDATE payload writes session", /session\s*:/.test(updatePayload));
  for (const untouchedField of [
    "timeframe",
    "side",
    "qty",
    "entry_price",
    "exit_price",
    "realized_pnl",
    "indicator_name",
    "signal_id",
    "chart_state",
  ]) {
    ok(`the UPDATE payload never touches '${untouchedField}' (fields this editor doesn't own)`, !new RegExp(`\\b${untouchedField}\\s*:`).test(updatePayload));
  }
}

// ---- one-entry-per-position discipline: looks up the most recent existing
// row before deciding insert vs. update, and never deletes legacy duplicates
{
  const body = bodyOf("saveTradeJournalForPosition");
  ok(
    "looks up the existing entry ordered by created_at desc, limited to the most recent (defensive against legacy duplicates)",
    /order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)[\s\S]{0,40}\.limit\(\s*1\s*\)/.test(body),
  );
  ok("never issues a delete on journal_entries (no destructive duplicate cleanup)", !/\.from\(\s*["']journal_entries["']\)[\s\S]{0,400}\.delete\(/.test(body));
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
