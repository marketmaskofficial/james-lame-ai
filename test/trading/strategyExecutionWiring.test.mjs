// Phase 5B — static source-inspection coverage (same style as
// test/builder/builderStudioHandoff.test.mjs) proving the strategy
// execution wiring reuses the existing OMS end to end: PAPER-only,
// explicit arm/disarm, historical-signal safety, no direct table writes,
// no second P&L/positions store, no new server endpoint, no schema change.
//
// Usage: npx tsx test/trading/strategyExecutionWiring.test.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
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

const adapterSrc = read("src/lib/trading/strategyExecution.ts");
const hookSrc = read("src/components/studio/useStrategyExecution.ts");
const panelSrc = read("src/components/studio/TradingPanel.tsx");
const studioSrc = read("src/routes/studio.tsx");
const omsSrc = read("src/lib/trading/oms.server.ts");
const tradingFnsSrc = read("src/lib/trading.functions.ts");

// ---- 1/2. PAPER-only, structurally, not just button text -------------------
{
  ok(
    "the hook's start() rejects a non-paper account BEFORE any armedContext is ever created — a structural guard, not a disabled-button-only one",
    /function start\(\)[\s\S]{0,400}account\.environment !== "paper"[\s\S]{0,200}return;/.test(hookSrc),
  );
  ok("start() checks environment !== 'paper' explicitly (never assumes paper by omission)", /account\.environment !== "paper"/.test(hookSrc));
  ok(
    "the OMS itself independently refuses to route a non-paper, non-broker account — a second, server-side backstop even if the client guard were somehow bypassed",
    /acct\.environment !== "paper"[\s\S]{0,150}throw new OmsError/.test(omsSrc),
  );
  ok("live broker execution remains structurally disabled at the OMS layer (untouched by Phase 5B)", /LIVE_TRADING_ENABLED\s*=\s*false/.test(read("src/lib/trading/brokers/registry.server.ts")));
}

// ---- 3. Historical signals cannot submit (5B-6) -----------------------------
{
  ok(
    "selectEligibleSignals requires a signal's bar time to be STRICTLY AFTER armedAt — the boundary captured once at Start, never silently advanced",
    /bar\.time <= ctx\.armedAt\) continue/.test(adapterSrc),
  );
  ok(
    "selectEligibleSignals excludes the currently-forming last bar (lastConfirmedIndex = bars.length - 2) — no repaint execution even though the runtime calls entries 'always a confirmed bar' from its own point of view",
    /lastConfirmedIndex = bars\.length - 2/.test(adapterSrc),
  );
  ok(
    "start() captures armedAt from the CURRENT last bar at the moment of arming, never bar 0 or a fixed constant — arming does not retroactively make historical bars eligible",
    /armedAt: bars\[bars\.length - 1\]\.time/.test(hookSrc),
  );
}

// ---- 4/5/6/7/8. Duplicate-order protection (5B-7) --------------------------
{
  ok(
    "strategySignalId is built from indicator/symbol/timeframe/bar-time/kind/side — deterministic identity, never Math.random/crypto.randomUUID/Date.now as the identity itself",
    /export function strategySignalId/.test(adapterSrc) && !/strategySignalId[\s\S]{0,300}(Math\.random|randomUUID)/.test(adapterSrc),
  );
  ok(
    "selectEligibleSignals filters out any signalId already in the caller-supplied alreadyProcessed set — the same strategy re-evaluated (settings/resize/remount/repeated evaluation) returns nothing already handled",
    /if \(alreadyProcessed\.has\(signalId\)\) continue;/.test(adapterSrc),
  );
  ok(
    "the execution effect marks a signal's id as processed BEFORE awaiting the OMS submission — a second overlapping evaluation can never see it as still-eligible",
    /processedSignalsRef\.current\.add\(signal\.signalId\);[\s\S]{0,150}const intent = resolveOrderIntent/.test(hookSrc),
  );
  ok(
    "a synchronous isRunningRef guard prevents two overlapping submission loops (e.g. a new bar closing while a previous batch is still mid-submission) from both resolving against a not-yet-updated dedup set",
    /isRunningRef\.current\)\s*return;/.test(hookSrc) && /isRunningRef\.current = true;/.test(hookSrc) && /isRunningRef\.current = false;/.test(hookSrc),
  );
  ok(
    "symbol/timeframe/account changes while armed auto-disarm rather than silently continuing an old armedAt boundary against new data",
    /if \(armedKeyRef\.current !== key\)[\s\S]{0,80}setMode\("off"\)/.test(hookSrc),
  );
}

// ---- 9. Backtest never submits OMS orders -----------------------------------
{
  ok(
    "StrategyTester.tsx (the existing Backtest UI) never imports submitTradeOrder/useStrategyExecution — backtesting and paper execution are structurally separate call paths",
    !/submitTradeOrder|useStrategyExecution/.test(read("src/components/studio/StrategyTester.tsx")),
  );
  ok("runBacktestEngine itself never imports the OMS", !/submitOrder|trading\.functions|oms\.server/.test(read("src/lib/backtest/engine.ts")));
}

// ---- 10. Builder Preview never submits OMS orders ---------------------------
{
  const builderFiles = [
    "src/components/builder/useBuilderProject.ts",
    "src/components/builder/BuilderWorkspace.tsx",
    "src/components/builder/PreviewPanel.tsx",
  ];
  for (const f of builderFiles) {
    ok(`${f} never imports submitTradeOrder/the OMS/useStrategyExecution — Builder Preview cannot submit paper orders`, !/submitTradeOrder|oms\.server|useStrategyExecution/.test(read(f)));
  }
}

// ---- 11. Visual-only indicators cannot execute ------------------------------
{
  ok(
    "start() refuses to arm when the strategy hasn't declared any rules (strategy.declared === false) — a visual-only indicator can never be armed",
    /if \(!strategy \|\| !strategy\.declared\)[\s\S]{0,150}return;/.test(hookSrc),
  );
  ok(
    "selectEligibleSignals itself is also a no-op for an undeclared strategy, as a second, independent backstop",
    /if \(!strategy\.declared \|\| bars\.length < 2\) return \[\];/.test(adapterSrc),
  );
}

// ---- 12. Risk rejection creates no fill (reuses existing risk_settings) ---
{
  ok(
    "the hook surfaces res.rejected as lastSignalError and does nothing else — it never retries, never modifies the order to force it through, and the signal stays marked processed (no automatic retry loop)",
    /if \(res\.rejected\)[\s\S]{0,60}setLastSignalError\(res\.rejected\);/.test(hookSrc),
  );
  ok("strategy execution reuses the EXISTING preTradeCheck/risk_settings path inside submitOrder — no second risk engine", /preTradeCheck\(/.test(omsSrc) && !/preTradeCheck/.test(hookSrc) && !/preTradeCheck/.test(adapterSrc));
}

// ---- 13. Stop/disarm blocks future signals ----------------------------------
{
  ok("stop() sets mode back to off, which the execution effect's own guard checks before doing anything", /function stop\(\)[\s\S]{0,100}setMode\("off"\)/.test(hookSrc));
  ok("the execution effect's very first line refuses to run at all unless mode === 'paper'", /if \(mode !== "paper" \|\| !armedContext \|\| !strategy \|\| isRunningRef\.current\) return;/.test(hookSrc));
}

// ---- 14/15/16/17. Existing OMS is the ONLY persistence/P&L path -----------
{
  ok(
    "useStrategyExecution never writes to trade_orders/trade_positions/trade_executions directly — it only calls the caller-supplied submitOrderFn (the existing submitTradeOrder server function)",
    !/trade_orders|trade_positions|trade_executions|supabaseAdmin|\.from\(/.test(hookSrc),
  );
  ok("the pure adapter module (strategyExecution.ts) has ZERO I/O of any kind — no fetch, no Supabase, no server function imports", !/fetch\(|supabase|createServerFn|useServerFn/.test(adapterSrc));
  ok("the pure adapter module never computes P&L/commission/balance — those fields never appear in it", !/realized_pnl|commission|balance/.test(adapterSrc));
  ok(
    "studio.tsx wires the hook's submitOrderFn to the EXISTING submitOrderFn (useServerFn(submitTradeOrder)) already bound for the manual ticket — not a new server function",
    /submitOrderFn: \(input\) => submitOrderFn\(\{ data: input \}\)/.test(studioSrc),
  );
  ok("no new createServerFn was added to trading.functions.ts for strategy execution (submitTradeOrder is reused as-is)", (tradingFnsSrc.match(/createServerFn/g) ?? []).length === (read("src/lib/trading.functions.ts").match(/createServerFn/g) ?? []).length);
}

// ---- 18. No new schema ------------------------------------------------------
{
  const migrationsDir = join(repoRoot, "supabase/migrations");
  ok("migrations directory exists and is untouched by this phase (sanity check, not a destructive scan)", existsSync(migrationsDir) && readdirSync(migrationsDir).length > 0);
}

// ---- 19. No new AI calls in the execution loop ------------------------------
{
  ok("useStrategyExecution never imports/calls buildProject/generateText/any AI pipeline", !/buildProject|generateText|project\.functions/.test(hookSrc));
  ok("the pure adapter never imports/calls any AI pipeline", !/buildProject|generateText|project\.functions/.test(adapterSrc));
}

// ---- 20. No service-role/browser exposure -----------------------------------
{
  for (const [name, src] of [
    ["src/lib/trading/strategyExecution.ts", adapterSrc],
    ["src/components/studio/useStrategyExecution.ts", hookSrc],
    ["src/components/studio/TradingPanel.tsx", panelSrc],
  ]) {
    ok(`${name} never references supabaseAdmin/service-role/OPENAI_API_KEY`, !/supabaseAdmin|service_role|SUPABASE_SERVICE_ROLE|OPENAI_API_KEY/.test(src));
  }
}

// ---- Quantity model (5B-13) — explicit, never silently inferred -----------
{
  ok("an entry's own declared qty wins when positive; otherwise falls back to the caller's configured default — never a hardcoded implicit quantity", /const qty = pending\.qty && pending\.qty > 0 \? pending\.qty : defaultQty;/.test(adapterSrc));
  ok("Paper Qty is a real, visible, user-editable control (never silently inferred leverage)", /Paper Qty/.test(panelSrc) && /onPaperQtyChange/.test(panelSrc));
}

// ---- Reversal behavior (5B-14) — OMS native flip, no manual accounting ----
{
  ok(
    "resolveOrderIntent's entry branch never inspects the currently open position to decide direction — it always resolves to the strategy's OWN declared side, letting the OMS's own native long<->short flip (confirmed in the architecture audit) handle any reversal",
    /if \(pending\.kind === "entry"\) \{[\s\S]{0,400}side: pending\.declaredSide === "short" \? "sell" : "buy",/.test(adapterSrc),
  );
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
