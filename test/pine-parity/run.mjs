// Pine-parity test harness.
//
// Usage:
//   npx tsx test/pine-parity/run.mjs                 # use cached translations
//   npx tsx test/pine-parity/run.mjs --retranslate    # re-run AI translation for every fixture
//   npx tsx test/pine-parity/run.mjs 06-fvg-boxes      # run a single fixture by name prefix
//
// For each fixture this: validates the Pine source itself, translates it to
// SGScript (cached on disk unless --retranslate), validates the translation
// (static + Pine<->SGScript visual parity), executes it against the shared
// deterministic bar set, then runs the fixture's own `check()` against
// independently-computed reference values. A fixture only passes if every
// stage passes.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { validatePine, formatIssues } from "../../src/lib/validate/pine.ts";
import { validateSgScript, visualParity } from "../../src/lib/validate/sgscript.ts";
import { runScript } from "../../src/lib/sgscript/runtime.ts";
import { runBacktestEngine, DEFAULT_SETTINGS } from "../../src/lib/backtest/engine.ts";
import { generateBars } from "./bars.mjs";
import * as ref from "./reference.mjs";
import { translate } from "./translate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const args = process.argv.slice(2);
const retranslate = args.includes("--retranslate");
const filter = args.find((a) => !a.startsWith("--"));

const bars = generateBars(300, 42);

function loadFixtures() {
  const pineFiles = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".pine"))
    .sort();
  return pineFiles
    .map((f) => f.replace(/\.pine$/, ""))
    .filter((name) => !filter || name.includes(filter));
}

async function runFixture(name) {
  const pinePath = path.join(fixturesDir, `${name}.pine`);
  const checkPath = path.join(fixturesDir, `${name}.check.mjs`);
  const cachePath = path.join(fixturesDir, `${name}.sgscript.js`);

  const pineSource = readFileSync(pinePath, "utf8");
  const mod = await import(`${pathToFileURL(checkPath).href}?t=${Date.now()}`);

  const result = { name, category: mod.category ?? "uncategorized", stages: {} };

  // Stage 1: is our own fixture even valid Pine? (sanity check on the test suite itself)
  const pineReport = validatePine(pineSource);
  result.stages.pineValid = { ok: pineReport.ok, detail: pineReport.ok ? "" : formatIssues(pineReport.issues) };

  // Stage 1b: fixture-specific checks against the Pine source's own analysis
  // (e.g. repaint classification) — opt-in via an exported checkPine().
  if (typeof mod.checkPine === "function") {
    let repaintIssues = [];
    try {
      repaintIssues = (await mod.checkPine(pineReport)) ?? [];
    } catch (e) {
      repaintIssues = [`checkPine() threw: ${e instanceof Error ? e.message : String(e)}`];
    }
    result.stages.repaintOk = { ok: repaintIssues.length === 0, detail: repaintIssues.join("; ") };
  }

  // Stage 2: translate (cached) or retranslate
  let sgscript;
  let translateAttempts = 0;
  if (!retranslate && existsSync(cachePath)) {
    sgscript = readFileSync(cachePath, "utf8");
  } else {
    const t = await translate(pineSource);
    sgscript = t.code;
    translateAttempts = t.attempts;
    writeFileSync(cachePath, sgscript, "utf8");
  }
  result.translateAttempts = translateAttempts;

  // Stage 3: validate the (possibly cached) translation, every run — catches
  // drift if runtime.ts, validators, or a hand-edited cache fall out of sync.
  const sgReport = validateSgScript(sgscript);
  const parityIssues = visualParity(pineSource, sgscript);
  const allSgIssues = [...sgReport.issues, ...parityIssues];
  const sgOk = !allSgIssues.some((i) => i.severity === "error");
  result.stages.sgscriptValid = { ok: sgOk, detail: sgOk ? "" : formatIssues(allSgIssues) };

  // Stage 4: execute against the shared deterministic bars.
  let runResult;
  let runError;
  try {
    runResult = runScript({
      id: "test",
      code: sgscript,
      bars,
      settings: mod.settings ?? {},
    });
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
  }
  result.stages.runtimeOk = { ok: !!runResult, detail: runError ?? "" };

  // For strategy fixtures, also run the real backtest engine so checks can
  // verify actual trade outcomes (fills, stop ratcheting, exits) — not just
  // that the runtime recorded the right shape of entry.
  let backtest;
  if (runResult?.strategy?.declared) {
    backtest = runBacktestEngine({
      bars,
      strategy: runResult.strategy,
      symbol: "TEST",
      interval: "1d",
      strategyName: name,
      settings: DEFAULT_SETTINGS,
    });
  }

  // Stage 5: fixture-specific correctness check against independent reference math.
  let checkIssues = [];
  if (runResult) {
    try {
      checkIssues = (await mod.check(runResult, { bars, ref, backtest })) ?? [];
    } catch (e) {
      checkIssues = [`check() threw: ${e instanceof Error ? e.message : String(e)}`];
    }
  }
  result.stages.checkOk = { ok: checkIssues.length === 0, detail: checkIssues.join("; ") };
  result.warnings = runResult?.warnings ?? [];

  result.pass = Object.values(result.stages).every((s) => s.ok);
  return result;
}

async function main() {
  const names = loadFixtures();
  if (names.length === 0) {
    console.error(filter ? `No fixture matches "${filter}"` : "No fixtures found in test/pine-parity/fixtures");
    process.exit(1);
  }

  console.log(`Running ${names.length} fixture(s)${retranslate ? " (retranslating)" : " (cached translations)"}...\n`);

  const results = [];
  for (const name of names) {
    process.stdout.write(`  ${name} ... `);
    try {
      const r = await runFixture(name);
      results.push(r);
      console.log(r.pass ? "PASS" : "FAIL");
    } catch (e) {
      results.push({ name, category: "?", pass: false, stages: {}, error: e instanceof Error ? e.message : String(e) });
      console.log(`ERROR (${e instanceof Error ? e.message : e})`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed\n`);

  // By-category rollup.
  const byCategory = new Map();
  for (const r of results) {
    const c = byCategory.get(r.category) ?? { pass: 0, total: 0 };
    c.total++;
    if (r.pass) c.pass++;
    byCategory.set(r.category, c);
  }
  console.log("By category:");
  for (const [cat, c] of [...byCategory.entries()].sort()) {
    console.log(`  ${c.pass}/${c.total}  ${cat}`);
  }

  console.log("\nFailures:");
  const failures = results.filter((r) => !r.pass);
  if (failures.length === 0) console.log("  (none)");
  for (const r of failures) {
    console.log(`\n  ${r.name}`);
    if (r.error) console.log(`    ERROR: ${r.error}`);
    for (const [stage, s] of Object.entries(r.stages ?? {})) {
      if (!s.ok) console.log(`    [${stage}] ${s.detail}`);
    }
  }

  writeReport(results, passed);
}

function writeReport(results, passed) {
  const lines = [];
  lines.push("# Pine parity report");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} — ${passed}/${results.length} passed.`);
  lines.push("");
  lines.push("| Fixture | Category | Pine valid | Repaint | SGScript valid | Runtime | Check | Result |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const s = r.stages ?? {};
    const cell = (k) => (s[k] ? (s[k].ok ? "OK" : "FAIL") : "-");
    lines.push(
      `| ${r.name} | ${r.category} | ${cell("pineValid")} | ${cell("repaintOk")} | ${cell("sgscriptValid")} | ${cell("runtimeOk")} | ${cell("checkOk")} | ${r.pass ? "PASS" : "FAIL"} |`,
    );
  }
  lines.push("");
  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    lines.push("## Failure detail");
    lines.push("");
    for (const r of failures) {
      lines.push(`### ${r.name}`);
      if (r.error) lines.push(`- ERROR: ${r.error}`);
      for (const [stage, s] of Object.entries(r.stages ?? {})) {
        if (!s.ok) lines.push(`- **${stage}**: ${s.detail}`);
      }
      lines.push("");
    }
  }
  writeFileSync(path.join(__dirname, "REPORT.md"), lines.join("\n"), "utf8");
  console.log(`\nFull report written to test/pine-parity/REPORT.md`);
}

main();
