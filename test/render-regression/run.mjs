// Real-browser render regression suite.
//
// Everything in test/pine-parity verifies the SGScript runtime in isolation:
// given some bars, does it *compute* the right plots/boxes/lines/labels?
// It never asks whether those objects actually end up as pixels on the real
// Chart Studio chart — which is exactly the class of bug this suite guards
// against (runtime produced N boxes, renderer drew 0, UI still said
// "Indicator updated on the chart.").
//
// This suite drives the REAL app (dev server, real /studio route, real
// candle fetch, real "Add to Chart" button) with Playwright, and asserts on
// the render telemetry StudioChart reports through
// window.__lastRenderDiagnostics (wired in src/routes/studio.tsx via
// onRenderStats) — i.e. what was actually drawn, not just what the runtime
// computed. A regression where boxes are generated but not drawn fails this
// suite even though it would pass pine-parity.
//
// Usage:
//   npx tsx test/render-regression/run.mjs
//   npx tsx test/render-regression/run.mjs box            # filter by case name substring
//
// Requires the dev server; this script starts one on an unused port if none
// is already reachable on PORT, and tears down anything it started itself.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const pineParityFixtures = path.join(repoRoot, "test", "pine-parity", "fixtures");
const localFixtures = path.join(__dirname, "fixtures");
const PORT = process.env.RENDER_REGRESSION_PORT ?? 8080;
const BASE_URL = `http://localhost:${PORT}`;
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));

function readFixture(dir, name) {
  return readFileSync(path.join(dir, name), "utf8");
}

// Each case: a script that should produce visuals of `primitive` type, and
// the render-stats field to assert drawn > 0 on. `primitive` must match one
// of the RenderStats keys StudioChart reports (see StudioChart.tsx).
const CASES = [
  {
    name: "plot-ema-continuous-line",
    desc: "Basic plot (EMA) renders as a continuous visible line",
    source: readFixture(pineParityFixtures, "02-ema-ribbon.sgscript.js"),
    primitive: "plots",
  },
  {
    name: "box-fvg-zone",
    desc: "Box (Fair Value Gap) renders as a persistent rectangular zone",
    source: readFixture(pineParityFixtures, "09-fvg-boxes.sgscript.js"),
    primitive: "boxes",
  },
  {
    name: "extended-box-supply-demand",
    desc: "Box with extend:right renders extending to the current chart edge",
    source: readFixture(localFixtures, "extended-box-supply-demand.sgscript.js"),
    primitive: "boxes",
  },
  {
    name: "lines-support-resistance",
    desc: "Lines (support/resistance) render as horizontal levels",
    source: readFixture(pineParityFixtures, "11-support-resistance-lines.sgscript.js"),
    primitive: "lines",
  },
  {
    name: "markers-buy-sell",
    desc: "Markers (buy/sell signals) render on the chart",
    source: readFixture(pineParityFixtures, "01-sma-crossover.sgscript.js"),
    primitive: "markers",
  },
  {
    name: "sessions-boxes",
    desc: "Session rectangles render across the visible range",
    source: readFixture(pineParityFixtures, "28-market-session-boxes.sgscript.js"),
    primitive: "boxes",
  },
  {
    name: "fill-bollinger-bands",
    desc: "Fill between two plots (Bollinger Bands) renders as a shaded band",
    source: readFixture(pineParityFixtures, "08-bollinger-bands.sgscript.js"),
    primitive: "fills",
  },
  {
    name: "oscillator-rsi",
    desc: "Oscillator (RSI) renders in its own pane",
    source: readFixture(pineParityFixtures, "03-rsi-basic.sgscript.js"),
    primitive: "plots",
  },
].filter((c) => !filter || c.name.includes(filter));

async function isServerUp() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function startDevServer() {
  const proc = spawn("npx", ["vite", "dev", "--port", String(PORT), "--strictPort"], {
    cwd: repoRoot,
    stdio: "pipe",
    shell: true,
  });
  const ready = new Promise((resolve, reject) => {
    let out = "";
    const onData = (buf) => {
      out += String(buf);
      if (/ready in|Local:/i.test(out)) resolve();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`dev server exited early (code ${code}): ${out.slice(-2000)}`)));
    setTimeout(() => reject(new Error(`dev server did not become ready in time: ${out.slice(-2000)}`)), 45000);
  });
  await ready;
  // Give the SSR/route graph a moment to finish warming up past "ready".
  for (let i = 0; i < 15; i++) {
    if (await isServerUp()) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return proc;
}

async function loadStudio(page) {
  await page.goto(`${BASE_URL}/studio`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("text=BTCUSDT", { timeout: 15000 });
  await page.waitForFunction(
    () => /\d{2,3},\d{3}\.\d{2}/.test(document.body.innerText),
    { timeout: 20000 },
  );
  await page.waitForTimeout(1000); // let the bar fetch settle fully, not just the first price tick
}

async function runCase(page, testCase) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), testCase.source);
  await page.getByRole("button", { name: /^Paste$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Add to Chart/i }).click();

  // runCode's own waitForRenderStats already blocks (up to 800ms) on real
  // render telemetry before it resolves; give the full pipeline
  // (translate-check -> runtime -> setIndicators -> rAF draw -> stats
  // callback -> logRenderOutcome) real wall-clock room on top of that.
  let diag;
  for (let i = 0; i < 20; i++) {
    diag = await page.evaluate(() => window.__lastRenderDiagnostics);
    if (diag) break;
    await page.waitForTimeout(250);
  }

  if (!diag) {
    return { ok: false, detail: "no render diagnostics reported at all — Add to Chart likely never completed" };
  }
  const runtimeCount = diag.result[testCase.primitive];
  if (!runtimeCount) {
    return {
      ok: false,
      detail: `fixture produced 0 ${testCase.primitive} — fixture itself is broken, not a render bug (runtime output: ${JSON.stringify(diag.result)})`,
    };
  }
  if (!diag.stats) {
    return { ok: false, detail: `runtime produced ${runtimeCount} ${testCase.primitive} but no render stats were ever reported for key=${diag.key}` };
  }
  const stat = diag.stats[testCase.primitive];
  if (!stat) {
    return { ok: false, detail: `render stats present but missing the "${testCase.primitive}" field entirely: ${JSON.stringify(diag.stats)}` };
  }
  if (stat.drawn <= 0) {
    return {
      ok: false,
      detail: `runtime produced ${runtimeCount} ${testCase.primitive}, renderer drew 0 (received=${stat.received} offscreen=${stat.offscreen} waitingForGeometry=${stat.waitingForGeometry} failed=${stat.failed} chartGeometryReady=${diag.stats.chartGeometryReady})`,
    };
  }
  return { ok: true, detail: `${stat.drawn}/${runtimeCount} ${testCase.primitive} drawn` };
}

async function main() {
  let ownedServer = null;
  if (!(await isServerUp())) {
    console.log(`No dev server on port ${PORT} — starting one for this run...`);
    ownedServer = await startDevServer();
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });

  const results = [];
  try {
    for (const testCase of CASES) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      try {
        await loadStudio(page);
        const r = await runCase(page, testCase);
        results.push({ name: testCase.name, desc: testCase.desc, ...r, pageErrors });
      } catch (e) {
        results.push({
          name: testCase.name,
          desc: testCase.desc,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
          pageErrors,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (ownedServer) ownedServer.kill();
  }

  console.log("\n=== Render regression results ===");
  let failures = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`[${mark}] ${r.name} — ${r.desc}`);
    console.log(`       ${r.detail}`);
    if (r.pageErrors?.length) {
      console.log(`       page errors: ${r.pageErrors.join(" | ")}`);
    }
    if (!r.ok) failures++;
  }
  console.log(`\n${results.length - failures}/${results.length} passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
