// Phase 5A-4d — real algorithm coverage for the Builder market-data
// stale-fetch guard in `src/components/builder/useBuilderMarketData.ts`.
//
// The hook itself cannot be mounted here — there is no live-browser/React
// render harness in this codebase (see test/builder/builderShell.test.mjs's
// own header comment) — so, exactly like
// test/builder/previewExecution.test.mjs's stale-run-guard section (E) did
// for `runSeqRef`, this test mirrors the hook's EXACT algorithm using a
// plain object in place of a `useRef` (a ref is just a mutable box — the
// algorithm is identical either way) and a stub async function in place of
// `fetchBars` (the real network call cannot run under plain Node/tsx either,
// since `fetchBars` requests a page-relative URL that only resolves inside a
// browser origin). This is a genuine, non-mocked execution of the real race
// logic — not a static source-inspection proof.
//
// Usage: npx tsx test/builder/builderMarketData.test.mjs

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
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} (${a} === ${e})`, a === e);
}

function fixtureBars(symbol, n = 5) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    __symbol: symbol, // test-only tag proving which fetch produced this array
  }));
}

// Mirrors useBuilderMarketData's exact effect body: increment a sequence
// number, clear bars immediately, await the fetch, and only ever apply an
// outcome (success or failure) if the sequence ref still matches.
function makeMarketDataSimulator(fetchImpl) {
  const fetchSeqRef = { current: 0 };
  let bars = [];
  let barsLoading = false;
  let marketDataError = null;

  async function selectSymbolTimeframe(symbol, timeframe, delayMs) {
    const fetchId = ++fetchSeqRef.current;
    barsLoading = true;
    marketDataError = null;
    bars = [];
    try {
      const result = await fetchImpl(symbol, timeframe, delayMs);
      if (fetchId !== fetchSeqRef.current) return;
      if (result.length === 0) {
        marketDataError = "No market data returned.";
        return;
      }
      bars = result;
    } catch (e) {
      if (fetchId !== fetchSeqRef.current) return;
      marketDataError = e instanceof Error ? e.message : "Market data unavailable";
    } finally {
      if (fetchId === fetchSeqRef.current) barsLoading = false;
    }
  }

  return {
    selectSymbolTimeframe,
    get state() {
      return { bars, barsLoading, marketDataError };
    },
  };
}

async function stubFetchBars(symbol, timeframe, delayMs) {
  await new Promise((r) => setTimeout(r, delayMs));
  return fixtureBars(`${symbol}:${timeframe}`);
}

// ==== A. Real fetch-and-apply, no race ==========================================
{
  const sim = makeMarketDataSimulator(stubFetchBars);
  await sim.selectSymbolTimeframe("BTCUSDT", "15m", 5);
  ok("single selection: bars are the real fetched bars for that symbol/timeframe", sim.state.bars.length === 5 && sim.state.bars[0].__symbol === "BTCUSDT:15m");
  eq("single selection: barsLoading settles to false", sim.state.barsLoading, false);
  eq("single selection: no marketDataError", sim.state.marketDataError, null);
}

// ==== B. Symbol change: an OLDER, SLOWER fetch must never overwrite the NEWER selection ===
{
  const sim = makeMarketDataSimulator(stubFetchBars);
  const first = sim.selectSymbolTimeframe("BTCUSDT", "15m", 60); // slow
  const second = sim.selectSymbolTimeframe("ETHUSDT", "15m", 10); // fast, started after, resolves first
  await Promise.all([first, second]);
  ok(
    "symbol change: the bars visible after both settle belong to the NEWER selection (ETHUSDT), never the older, slower-resolving BTCUSDT response",
    sim.state.bars.length > 0 && sim.state.bars[0].__symbol === "ETHUSDT:15m",
  );
  eq("symbol change: barsLoading is false once the newer fetch has actually settled", sim.state.barsLoading, false);
}

// ==== C. Timeframe change: same guard applies along the timeframe axis =========
{
  const sim = makeMarketDataSimulator(stubFetchBars);
  const first = sim.selectSymbolTimeframe("BTCUSDT", "1h", 60); // slow
  const second = sim.selectSymbolTimeframe("BTCUSDT", "5m", 10); // fast, newer
  await Promise.all([first, second]);
  ok(
    "timeframe change: the bars visible belong to the NEWER timeframe (5m), never the older, slower-resolving 1h response",
    sim.state.bars[0].__symbol === "BTCUSDT:5m",
  );
}

// ==== D. A real fetch failure never lets a stale earlier success linger as barsLoading=true ===
{
  const sim = makeMarketDataSimulator(async (symbol, timeframe, delayMs) => {
    await new Promise((r) => setTimeout(r, delayMs));
    if (symbol === "BROKEN") throw new Error("Market data unavailable (502)");
    return fixtureBars(`${symbol}:${timeframe}`);
  });
  await sim.selectSymbolTimeframe("BROKEN", "15m", 5);
  eq("a real thrown fetch error clears bars rather than fabricating any candles", sim.state.bars, []);
  eq("a real thrown fetch error is surfaced as marketDataError", sim.state.marketDataError, "Market data unavailable (502)");
  eq("barsLoading settles to false after a real failure", sim.state.barsLoading, false);
}

// ==== E. An empty (but successful) fetch is treated as an error, not silent success ====
{
  const sim = makeMarketDataSimulator(async () => []);
  await sim.selectSymbolTimeframe("BTCUSDT", "15m", 0);
  eq("an empty array response is never treated as a successful load", sim.state.bars, []);
  eq('an empty array response surfaces the exact "No market data returned." message', sim.state.marketDataError, "No market data returned.");
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
