# Chart Studio + Signal Goat Script runtime

## Reality check on Pine Script

Pine Script is TradingView's proprietary, closed-source language. There is no legal or public compiler/runtime for it outside TradingView, and we do not have one. So we will not claim to execute Pine.

Approach: introduce **SGScript** — our own indicator format that runs in our own runtime. The AI already writes Pine; it will additionally emit an SGScript block (same logic, our syntax) whenever the user asks to run an indicator in Chart Studio. Pine output stays for people exporting to TradingView.

## What already exists (reuse, don't rebuild)

- `/api/klines` — Binance OHLCV proxy with fallbacks (candles source; free, no key).
- `lightweight-charts` already installed and used in `ChartCanvas` in `src/routes/app.tsx`.
- Auth, subscriptions, `scripts`/`messages` tables, server-fn + RLS patterns in `src/lib/*.functions.ts`.
- AI generation stream at `src/routes/api/generate.ts`.

## Architecture

**Charting library:** keep `lightweight-charts` v5. It gives professional candles, zoom/pan, crosshair, multiple panes (v5 panes API) for oscillators, line/histogram/area series, and markers. Boxes/zones/labels/drawing tools are drawn on a transparent canvas overlay synced to the chart's time and price scales.

**Market data:** `/api/klines` (Binance). Enough for crypto now. Stocks/futures would need a paid data vendor later — out of scope for this build.

**SGScript language (v1):** a small, safe JavaScript-subset DSL. A script is a function body evaluated once per script (vectorized), not per bar:

```js
// @name EMA + FVG
// @overlay true
input('len', 50)
const e = ema(close, input.len)
plot(e, { title: 'EMA', color: '#e6b800' })
signal(crossover(close, e), 'buy', 'Long')
box(fvgTop, fvgBottom, fromIndex, toIndex, { color: '#22c55e33' })
```

- Runtime provides series helpers: `sma ema rma wma vwap atr rsi macd stdev highest lowest crossover crossunder change nz` plus raw `open high low close volume time` as `Float64Array`-backed series.
- Outputs API: `plot`, `plotOsc` (separate pane), `hist`, `line`, `box`, `label`, `signal`, `fill`, `hline`.
- `input(name, default, opts)` declares settings, persisted per saved-indicator.
- Multi-timeframe: `htf('1h')` returns a resampled OHLCV set derived client-side from loaded candles (no extra API), aligned back to chart bars.

**Execution & security:** compiled and run in a Web Worker with a frozen scope — no `window`, `fetch`, `document`, no network, timeouts (2s) and output caps (10k drawings). Code is user data; it never runs on the server.

**Output rendering:** the worker returns a plain JSON draw list (`{plots, oscillators, boxes, lines, labels, markers}`). The chart component diffs it and applies: line/histogram series for plots, a second pane for oscillators, series markers for buy/sell signals, and the overlay canvas for boxes/labels/rays. Editing code and pressing Add to Chart re-runs the worker and re-renders — no reload.

Advanced targets (EMA/VWAP, S/R, market structure, liquidity sweeps, FVGs, session levels, volume profile, buy/sell labels) are all expressible with this primitive set; volume profile uses a histogram-of-price-bins helper plus box/line output.

## Saved indicators (database)

New table `indicators`: `id, user_id, name, code, settings jsonb, is_overlay, created_at, updated_at`, with GRANTs and owner-only RLS policies. Server functions in `src/lib/indicators.functions.ts`: list / get / create / rename / update / delete. Settings (input overrides) save with the indicator so they follow the user across devices.

## UI: `/studio` route

- Top bar: symbol search, timeframe buttons, chart-type, indicator manager (added indicators with toggle/settings/remove), save.
- Left rail: drawing tools — trend line, horizontal line/ray, rectangle, fib retracement, text, measure, eraser. Drawings live on the overlay canvas and persist per symbol in local state.
- Right/bottom dock: Monaco-free lightweight code editor (CodeMirror 6, small) + Run/Add to Chart, error panel with line numbers, and a Saved Indicators list.
- `/app` gets an **Open in Chart** button beside generated code: converts/moves the current script into Chart Studio via a store + `/studio?from=chat`.

## AI integration

`src/routes/api/generate.ts` gains an SGScript section: when the user asks for something runnable, the model emits a ```sgscript block after the Pine block, with the language reference and hard rules inlined. The Open in Chart button prefers the sgscript block; if only Pine exists, we ask the model for a one-shot translation via a new `translateToSgScript` server fn.

## Now vs later

Now: SGScript runtime + worker, Chart Studio UI, drawings, saved indicators with RLS, Open in Chart, AI emits SGScript, crypto data.
Later (needs money/infra): equities & futures data vendor, real tick/order-flow footprint data, server-side backtests at scale, sharing/marketplace of indicators.

## Build order

1. Migration for `indicators` + `indicators.functions.ts`.
2. `src/lib/sgscript/` — runtime, stdlib, worker, types.
3. `src/components/studio/` — chart, overlay canvas, drawings, editor, indicator manager.
4. `/studio` route wiring + Open in Chart from `/app`.
5. Generator prompt update + translation fallback.
