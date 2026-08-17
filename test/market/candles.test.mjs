// Real coverage for the market-data hygiene layer (src/lib/market/candles.ts)
// that every historical-bar provider — today just crypto, later
// futures/stocks/forex — inherits for free. This logic was previously
// untested despite being exactly the kind of pure, deterministic code that's
// cheap to test thoroughly and expensive to get subtly wrong (a duplicate or
// out-of-order bar silently corrupts every consumer: the chart, runScript(),
// and the backtest engine all trust this array is clean).
//
// Usage: npx tsx test/market/candles.test.mjs

import {
  normalizeBars,
  mergeLiveBar,
  prependBars,
  barOpenTime,
  intervalSeconds,
  isStale,
} from "../../src/lib/market/candles.ts";

let pass = 0;
let fail = 0;
const failures = [];

function bar(time, open, high, low, close, volume = 1) {
  return { time, open, high, low, close, volume };
}

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function ok(name, cond) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}\n  expected truthy condition`); }
}

// ---- normalizeBars -------------------------------------------------------

check(
  "normalizeBars: sorts unsorted input ascending",
  normalizeBars([bar(300, 1, 2, 0, 1), bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1)]).map((b) => b.time),
  [100, 200, 300],
);

check(
  "normalizeBars: drops malformed rows (non-finite time, high<low, NaN OHLC)",
  normalizeBars([
    bar(100, 1, 2, 0, 1),
    bar(NaN, 1, 2, 0, 1),
    bar(200, 1, 0, 5, 1), // high < low
    bar(300, NaN, 2, 0, 1),
    bar(0, 1, 2, 0, 1), // time must be > 0
    bar(-5, 1, 2, 0, 1),
    bar(400, 1, 2, 0, 1),
  ]).map((b) => b.time),
  [100, 400],
);

check(
  "normalizeBars: duplicate timestamps collapse to the LAST occurrence in input order (re-sent forming candle)",
  normalizeBars([bar(100, 1, 2, 0, 1), bar(100, 9, 9, 9, 9, 9)]).map((b) => b.close),
  [9],
);

check("normalizeBars: empty input -> empty output", normalizeBars([]), []);

// ---- mergeLiveBar ---------------------------------------------------------

{
  const prev = [bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1.5)];
  const updated = bar(200, 1, 2, 0, 9);
  const next = mergeLiveBar(prev, updated);
  check("mergeLiveBar: equal timestamp replaces the forming (last) candle", next.map((b) => b.close), [1, 9]);
  ok("mergeLiveBar: does not mutate the input array", prev[1].close === 1.5);
}

{
  const prev = [bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1)];
  const next = mergeLiveBar(prev, bar(300, 1, 2, 0, 5));
  check("mergeLiveBar: newer timestamp appends a new bar", next.map((b) => b.time), [100, 200, 300]);
}

{
  const prev = [bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1), bar(300, 1, 2, 0, 1)];
  const next = mergeLiveBar(prev, bar(400, 1, 2, 0, 1), 3);
  check("mergeLiveBar: appending past maxBars truncates from the front", next.map((b) => b.time), [200, 300, 400]);
}

{
  const prev = [bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1), bar(300, 1, 2, 0, 1)];
  const next = mergeLiveBar(prev, bar(200, 1, 2, 0, 7));
  check("mergeLiveBar: older timestamp matching an existing bar patches it in place", next.map((b) => b.close), [1, 7, 1]);
  check("mergeLiveBar: patching an older bar never reorders the array", next.map((b) => b.time), [100, 200, 300]);
}

{
  const prev = [bar(100, 1, 2, 0, 1), bar(300, 1, 2, 0, 1)];
  const next = mergeLiveBar(prev, bar(200, 1, 2, 0, 9)); // no bar at time=200 exists
  check("mergeLiveBar: older timestamp with no matching bar is ignored (never re-appended out of order)", next, prev);
}

{
  const prev = [bar(100, 1, 2, 0, 1)];
  const next = mergeLiveBar(prev, bar(200, 1, 0, 5, 1)); // high < low, invalid
  check("mergeLiveBar: invalid incoming bar is ignored", next, prev);
}

check("mergeLiveBar: empty prev array returns prev unchanged", mergeLiveBar([], bar(100, 1, 2, 0, 1)), []);

// ---- prependBars ------------------------------------------------------------

check("prependBars: empty older returns current unchanged", prependBars([], [bar(100, 1, 2, 0, 1)]).map((b) => b.time), [100]);

check(
  "prependBars: empty current returns normalizeBars(older)",
  prependBars([bar(200, 1, 2, 0, 1), bar(100, 1, 2, 0, 1)], []).map((b) => b.time),
  [100, 200],
);

check(
  "prependBars: only strictly-earlier older bars are kept, no duplication/reorder of current",
  prependBars(
    [bar(50, 1, 2, 0, 1), bar(100, 9, 9, 9, 9), bar(150, 1, 2, 0, 1)], // 100 and 150 overlap/exceed current[0]
    [bar(100, 1, 2, 0, 1), bar(200, 1, 2, 0, 1)],
  ).map((b) => b.time),
  [50, 100, 200],
);

// ---- intervalSeconds / barOpenTime -----------------------------------------

check("intervalSeconds: 5m", intervalSeconds("5m"), 300);
check("intervalSeconds: 4h", intervalSeconds("4h"), 14400);
check("intervalSeconds: 1d", intervalSeconds("1d"), 86400);
check("intervalSeconds: 1w", intervalSeconds("1w"), 604800);
check("intervalSeconds: 1M (calendar month, variable length) is unsupported -> null", intervalSeconds("1M"), null);
check("intervalSeconds: malformed string -> null", intervalSeconds("garbage"), null);

check("barOpenTime: floors to the interval boundary", barOpenTime(1234567 + 61, "5m"), Math.floor((1234567 + 61) / 300) * 300);
check("barOpenTime: unsupported interval (1M) returns the input unchanged", barOpenTime(1234567, "1M"), 1234567);

// ---- isStale ----------------------------------------------------------------

check("isStale: empty bars -> false", isStale([], "5m", 1000), false);
check(
  "isStale: last bar within 2x interval of now -> false",
  isStale([bar(1000, 1, 2, 0, 1)], "5m", 1000 + 300),
  false,
);
check(
  "isStale: last bar older than 2x interval -> true",
  isStale([bar(1000, 1, 2, 0, 1)], "5m", 1000 + 601),
  true,
);
check(
  "isStale: unknown interval (intervalSeconds null) -> false, not a crash",
  isStale([bar(1000, 1, 2, 0, 1)], "1M", 999999),
  false,
);

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
