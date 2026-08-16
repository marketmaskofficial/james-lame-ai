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
by asking the AI to try harder. Still open:

- **`htf()`'s `close` is a pass-through** (`13-htf-ema`): `resample()` in
  `stdlib.ts` only buckets `open`/`high`/`low`/`volume` — `close` is always
  just the base-timeframe close, un-aggregated. A close-based HTF indicator
  may be numerically indistinguishable from its on-chart equivalent.

Fixed so far:

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
