# Pine parity test suite

Measures real coverage of the Pine → SGScript → runtime → chart pipeline
against independently-computed expected values, instead of eyeballing one
indicator at a time.

## Run it

```
npm run test:pine-parity                 # cached translations (fast, free)
npm run test:pine-parity -- --retranslate # re-run AI translation for every fixture
npm run test:pine-parity -- 09-fvg        # run only fixtures whose name matches
```

Writes `REPORT.md` in this folder every run.

## How a fixture is judged

Each `NN-name.pine` / `NN-name.check.mjs` pair goes through 4 gates, all of
which must pass:

1. **`pineValid`** — the fixture's own Pine source passes `validatePine()`
   (sanity check on the test suite itself — if this fails, the fixture is
   broken, not the pipeline).
2. **`sgscriptValid`** — the AI's SGScript translation passes
   `validateSgScript()` + `visualParity()` (same checks the app itself runs).
3. **`runtimeOk`** — the translation executes against the shared
   deterministic bar set (`bars.mjs`, seeded, same every run) without
   throwing.
4. **`checkOk`** — the fixture's own `check(result, { bars, ref })` passes.
   This is where "correct" is actually defined: numeric series are compared
   against independent reference math in `reference.mjs` (not against
   whatever the AI happened to produce — that would prove nothing), and
   drawing-heavy fixtures assert real object counts/shapes computed the same
   way.

## Translation caching

The AI translation for each fixture is cached to `NN-name.sgscript.js` and
committed. Everyday runs use the cache (fast, deterministic, free) and only
re-validate + re-execute it — which still catches runtime/validator
regressions. Use `--retranslate` to measure real end-to-end AI fidelity again
(e.g. after a prompt or model change) and refresh the cache.

If you hand-edit a `.sgscript.js` cache file to explore a fix, that's fine —
the harness always re-validates and re-executes it on every run regardless of
where it came from.

## Adding a regression case

Any time a user reports a broken indicator, add it here permanently instead
of just patching it and moving on:

1. Save the reported Pine source as `fixtures/NN-short-name.pine` (next
   available number).
2. Write `fixtures/NN-short-name.check.mjs` exporting `category`,
   `description`, optional `settings`, and
   `check(result, { bars, ref, backtest })` returning an array of issue
   strings (empty = pass). `backtest` is a real `BacktestReport` (or
   `BacktestBlocked`), automatically run for any fixture whose script
   declares strategy rules — use it to assert on actual trade fills/stops,
   not just the raw runtime output. Reuse `helpers.mjs`'s `bestMatchingPlot`
   for numeric series, or write structural assertions (counts, coordinate
   sanity, direction) for drawing/strategy output — see existing fixtures for
   patterns.
3. Run with `--retranslate` once to generate and commit the
   `.sgscript.js` cache.
4. If it fails, that failure is now permanent and visible in every future
   report until it's actually fixed — not just in this one conversation.

## Known gaps this suite has already surfaced

Not every failure is a translation bug — some are the runtime not being able
to represent a Pine construct at all. Worth fixing at the runtime level, not
by asking the AI to try harder.

None currently open. Fixed so far:

- ~~`htf()`'s `close` is a pass-through~~ — **on closer inspection this was
  not actually a bug.** `htf()` deliberately represents the *forming* HTF
  candle (as opposed to `htfClosed()`, the last *closed* one), and a
  forming candle's close is by definition wherever the underlying price
  currently is — so `close[i]` tracking the base-timeframe close is
  correct, not a shortcut. Verified `htfClosed()` independently implements
  genuinely different "last closed bucket" semantics, confirming the two
  primitives are intentionally distinct rather than `htf()` being broken.
  What *was* a real, separate bug found while re-checking this: weekly
  bucketing used plain `floor(time/604800)`, bucketing relative to the Unix
  epoch (1970-01-01, a **Thursday**) instead of real Monday-start calendar
  weeks — what every exchange and TradingView's own weekly bars use. Fixed
  via a shared `bucketOf()` helper (`stdlib.ts`) that both `resample()` and
  `htfClosed()` (`smc.ts`) now use, shifting by 3 days so boundaries land on
  real Mondays. Also added calendar-month bucketing (`"1M"`, via a
  `MONTH_BUCKET` sentinel using real UTC year/month instead of a fixed
  seconds duration) — previously `"1M"` threw "Unknown timeframe" outright,
  since a month has no fixed length in seconds to put in `TF_SECONDS`.
  Verified with 21 real daily bars starting on an actual Monday: weekly
  buckets now flip exactly on bars 0/7/14, and `close[i] === weeklyClose[i]`
  every bar as expected — confirming the pass-through really is correct.
  `14-htf-trend-bias`'s own independent reference math was updated to the
  same Monday-aligned bucketing (it briefly failed after the runtime fix —
  for the right reason: the runtime's bucket boundaries moved, and the
  fixture's hand-rolled reference calc was still using the old, unaligned
  ones).
- ~~No `alertcondition`/`alert()` primitive~~ — `runtime.ts` now has both as
  no-op `warn()` stubs (same pattern as `table()`/`bgcolor()`), so a literal
  `alertcondition(...)` call no longer throws and takes the whole script
  down. `SGSCRIPT_REFERENCE` also documents them so the AI preserves the call
  instead of guessing whether to drop it.
- ~~No `strategy.exit()` / trailing stops~~ — `strategy.long`/`short` now
  accept a `trail: series` option (`StrategyEntryOut.trail`); the backtest
  engine (`engine.ts`) ratchets the live stop to `trail[i]` every bar after
  entry, favourable direction only, instead of leaving `stop` frozen at its
  entry-time value. `17-atr-trailing-strategy`'s check now verifies this
  against real backtest trade output (via the harness's new `backtest`
  context, see below), not just that the field exists.
