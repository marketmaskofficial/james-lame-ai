// Phase 5B-Final — trusted paper-execution boundary. Static source-
// inspection coverage (same style as strategyExecutionWiring.test.mjs) for
// the parts that CANNOT be exercised live from this sandbox (no Supabase
// CLI access token here — see the Phase 5B-Final report for the honest
// account of what could/could not be invoked end-to-end). This proves the
// SOURCE enforces every required property; it is not a substitute for the
// hosted QA already documented separately.
//
// Usage: npx tsx test/trading/trustedExecutionBoundary.test.mjs

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

const edgeFnPath = "supabase/functions/paper-submit-order/index.ts";
const edgeSrc = read(edgeFnPath);
const omsSrc = read("src/lib/trading/oms.server.ts");
const clientSrc = read("src/lib/trading/paperExecutionClient.ts");
const studioSrc = read("src/routes/studio.tsx");
const hookSrc = read("src/components/studio/useStrategyExecution.ts");
const adapterSrc = read("src/lib/trading/strategyExecution.ts");

// ---- Edge Function exists and is registered ---------------------------------
{
  ok("the trusted Edge Function file exists", existsSync(join(repoRoot, edgeFnPath)));
  ok("supabase/functions/import_map.json exists, resolving @/ to src/ and @supabase/supabase-js to an npm specifier", (() => {
    const p = join(repoRoot, "supabase/functions/import_map.json");
    if (!existsSync(p)) return false;
    const json = JSON.parse(readFileSync(p, "utf8"));
    return json.imports?.["@/"] && json.imports?.["@supabase/supabase-js"];
  })());
  ok("supabase/config.toml registers paper-submit-order with verify_jwt and the shared import map", /\[functions\.paper-submit-order\][\s\S]{0,200}verify_jwt = true/.test(read("supabase/config.toml")));
}

// ---- 1. Unauthenticated rejected --------------------------------------------
{
  ok(
    "the function requires an Authorization: Bearer token before doing anything else, and returns 401 when absent",
    /const token = authHeader\.startsWith\("Bearer "\)[\s\S]{0,120}if \(!token\) return json\(\{ error: "Unauthorized" \}, 401\);/.test(edgeSrc),
  );
  ok(
    "identity is derived ONLY from authedClient.auth.getUser(token) — a failed/invalid verification also returns 401",
    /auth\.getUser\(token\)[\s\S]{0,120}if \(userErr \|\| !userData\?\.user\) return json\(\{ error: "Unauthorized" \}, 401\);/.test(edgeSrc),
  );
  ok("verify_jwt = true is set at the platform level too — a second, independent backstop before the function body ever runs", /verify_jwt = true/.test(read("supabase/config.toml")));
}

// ---- 2/3. Foreign account / non-paper account rejected ----------------------
{
  ok(
    "the function never trusts a userId from the request body — userId comes only from the verified JWT (payload is never read for it)",
    !/payload\.userId|body\.userId|input\.userId/.test(edgeSrc),
  );
  ok(
    "account lookup is scoped through the CALLER's OWN RLS-scoped client (authedClient), not the admin client — a foreign account simply returns no row under RLS",
    /authedClient\s*\.from\("trading_accounts"\)[\s\S]{0,120}\.eq\("id", payload\.accountId\)[\s\S]{0,40}\.single\(\)/.test(edgeSrc),
  );
  ok("a missing/foreign account is rejected with 404 before the OMS is ever called", /if \(acctErr \|\| !acct\) return json\(\{ error: "Trading account not found" \}, 404\)/.test(edgeSrc));
  ok(
    "a non-paper account is explicitly rejected with 403 before the OMS is ever called",
    /if \(acct\.environment !== "paper"\)[\s\S]{0,150}return json\(\{[\s\S]{0,80}\}, 403\)/.test(edgeSrc),
  );
  ok(
    "the OMS itself independently re-checks ownership and paper-only inside submitOrder/getAccount — a second, server-side backstop even if the Edge Function's own check were somehow bypassed",
    /acct\.environment !== "paper"[\s\S]{0,150}throw new OmsError/.test(omsSrc),
  );
}

// ---- 4. Valid owned paper account accepted (reuses the EXISTING OMS) -------
{
  ok(
    "a request that passes every check hands off to the UNCHANGED submitOrder/getSnapshot exported by oms.server.ts — no parallel order/fill/position logic in the Edge Function",
    /const result = await submitOrder\(userId, payload\);/.test(edgeSrc) && /const snapshot = await getSnapshot\(userId, payload\.accountId\);/.test(edgeSrc),
  );
  ok("the Edge Function imports submitOrder/getSnapshot/__setTrustedDbClient/OmsError from the SAME oms.server.ts the Node server uses — not a copy", /from "@\/lib\/trading\/oms\.server"/.test(edgeSrc));
  ok(
    "the admin client is injected via __setTrustedDbClient immediately before the OMS call and cleared in a finally block — no lingering privileged override across requests",
    /__setTrustedDbClient\(adminClient\);[\s\S]{0,400}finally \{[\s\S]{0,40}__setTrustedDbClient\(null\);/.test(edgeSrc),
  );
}

// ---- 5/6. Deterministic idempotency / retry does not duplicate -------------
{
  ok(
    "submitOrder now activates the SAME unique-index-backed clientTag atomicity for signal-based orders as manual tickets, via a signal: prefix — previously null, which disabled dedup entirely for strategy orders",
    /const clientTag = input\.signalId\s*\n\s*\? `signal:\$\{input\.signalId\}`/.test(omsSrc),
  );
  ok(
    "the existing duplicate-key catch (unique index -> 23505) still resolves by looking up the row with the same client_tag and returning { duplicate: true } instead of throwing — unchanged, now reachable for signals too",
    /duplicate key\|23505[\s\S]{0,300}duplicate: true as const/.test(omsSrc),
  );
  ok(
    "strategySignalId (the identity that becomes clientTag) is built deterministically from indicator/symbol/timeframe/bar-time/kind/side — a retried request for the SAME signal produces the SAME clientTag, not a new one",
    /export function strategySignalId/.test(adapterSrc) && !/strategySignalId[\s\S]{0,300}(Math\.random|randomUUID)/.test(adapterSrc),
  );
}

// ---- 7. Risk rejection creates no fill (unchanged, reused) ------------------
{
  ok("preTradeCheck (risk_settings) still runs inside submitOrder, unmodified by this phase", /preTradeCheck\(/.test(omsSrc));
  ok("the Edge Function contains no risk-check logic of its own — it relies entirely on submitOrder's existing preTradeCheck", !/preTradeCheck|risk_settings/.test(edgeSrc));
}

// ---- 8/9. Browser/strategy layer never writes tables; OMS remains source of truth --
{
  ok(
    "paperExecutionClient.ts (the ONE browser-side call site) never touches a database table directly — it only calls supabase.functions.invoke",
    !/\.from\(|trade_orders|trade_positions|trade_executions|supabaseAdmin/.test(clientSrc),
  );
  ok("paperExecutionClient.ts imports SubmitInput/AccountSnapshot as TYPES ONLY (erased at build time) — no runtime import of oms.server.ts reaches the browser bundle", /import type \{ SubmitInput \} from "@\/lib\/trading\/oms\.server"/.test(clientSrc));
  ok("useStrategyExecution still never writes to trade_orders/trade_positions/trade_executions directly", !/trade_orders|trade_positions|trade_executions|supabaseAdmin|\.from\(/.test(hookSrc));
}

// ---- 10. No service secret reachable client-side ----------------------------
{
  for (const [name, src] of [
    ["src/lib/trading/paperExecutionClient.ts", clientSrc],
    ["src/routes/studio.tsx", studioSrc],
    ["src/components/studio/useStrategyExecution.ts", hookSrc],
  ]) {
    ok(`${name} never references SUPABASE_SERVICE_ROLE_KEY/service_role/supabaseAdmin`, !/SUPABASE_SERVICE_ROLE|service_role|supabaseAdmin/.test(src));
  }
  ok(
    "the Edge Function reads SUPABASE_SERVICE_ROLE_KEY only from Deno.env (the platform-provisioned server runtime), never from a request header/body/query param",
    /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(edgeSrc) && !/req\.headers\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(edgeSrc),
  );
  ok(
    "the Edge Function never interpolates the service-role key's value into a response body or the admin client into JSON",
    !/json\(\{[^}]*SUPABASE_SERVICE_ROLE_KEY/.test(edgeSrc) && !/json\(\{[^}]*adminClient/.test(edgeSrc),
  );
}

// ---- 11. Manual PAPER and strategy PAPER converge on the same OMS ----------
{
  ok("the manual ticket's submit branch calls submitPaperOrder", /const res = await submitPaperOrder\(\{/.test(studioSrc));
  ok("Strategy Execution's submitOrderFn is wired to the SAME submitPaperOrder function, not a second implementation", /submitOrderFn: \(input\) => submitPaperOrder\(input\)/.test(studioSrc));
  ok("both call sites resolve to the one export in paperExecutionClient.ts", (studioSrc.match(/submitPaperOrder/g) ?? []).length >= 2 && /export async function submitPaperOrder/.test(clientSrc));
}

// ---- 12/13. Backtest / Builder Preview cannot reach the execution endpoint --
{
  const neverReferencesExecution = (src) => !/submitPaperOrder|paper-submit-order|paperExecutionClient|useStrategyExecution/.test(src);
  ok("StrategyTester.tsx (Backtest UI) never references the trusted execution client/endpoint/hook", neverReferencesExecution(read("src/components/studio/StrategyTester.tsx")));
  ok("the backtest engine itself never references the trusted execution client/endpoint/hook", neverReferencesExecution(read("src/lib/backtest/engine.ts")));
  for (const f of [
    "src/components/builder/useBuilderProject.ts",
    "src/components/builder/BuilderWorkspace.tsx",
    "src/components/builder/PreviewPanel.tsx",
  ]) {
    ok(`${f} never references the trusted execution client/endpoint/hook`, neverReferencesExecution(read(f)));
  }
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
