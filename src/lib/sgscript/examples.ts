// Language reference + starter scripts. The reference string is also injected
// into the AI generator prompt so generated SGScript always matches the runtime.

export const SGSCRIPT_REFERENCE = `SGScript (Signal Goat Script) — JavaScript-subset indicator language executed by the Signal Goat runtime.

METADATA (comments at the top)
// @name My Indicator
// @overlay true      // true = draws on price, false = separate lower pane

DATA (arrays aligned to bars, index 0 = oldest, NaN = no value)
open high low close volume time hl2 hlc3 ohlc4 barCount lastIndex

SERIES MATH (return arrays)
sma(s,len) ema(s,len) rma(s,len) wma(s,len) stdev(s,len) highest(s,len) lowest(s,len)
change(s,n?) offset(s,n) cum(s) nz(s,rep?) map(s,fn) rsi(s,len) macd(s,f,sl,sig)
bb(s,len,mult) -> {basis,upper,lower} | atr(len) | tr() | vwap(anchorSeconds?)
pivotHigh(left,right) pivotLow(left,right) volumeProfile(fromIdx,toIdx,bins?)
crossover(a,b) crossunder(a,b) cross(a,b) -> boolean arrays
vwma(s,len) stoch(kLen,kSmooth?,dSmooth?) -> {k,d} | correlation(a,b,len)
variance(s,len) roc(s,len) momentum(s,len)
and(m1,m2,..) or(m1,m2,..) not(m) within(mask,bars) latch(set,reset) -> boolean arrays
gt(a,b) lt(a,b) gte(a,b) lte(a,b) eq(a,b) neq(a,b) -> boolean arrays (NEVER use close > ma on series)
iff(cond,a,b) -> series ternary

SESSIONS & PERIODS (UTC)
session('07:00','10:00') -> boolean mask   firstOf(mask)   sessionRange(mask) -> {high,low}
previousDay() previousWeek() previousMonth() -> {high,low,close} of the last CLOSED period
htfClosed('4h') -> {open,high,low,close} of the last CLOSED HTF candle (never the forming one)
limitPerScope(signalMask, scopeMask, max) -> at most "max" signals per session/run

MARKET STRUCTURE & LIQUIDITY
swings(left?,right?) -> [{index,price,kind:'high'|'low'}] (confirmed pivots only)
marketStructure(left?,right?) -> [{index,price,type:'BOS'|'CHoCH',side:'bull'|'bear'}]
fvg(extend?) / inverseFvg() -> [{from,to,top,bottom,side}]
orderBlocks(displacementMask) -> [{from,to,top,bottom,side}]
displacement(mult?) -> boolean mask (body > ATR14 * mult)
sweep(levelSeries,'above'|'below') -> boolean mask (wick takes level, close back inside)
premiumDiscount(rangeHigh,rangeLow) -> 0..1 position inside a range
htf('1h') -> {open,high,low,close,volume,hl2} resampled and aligned to chart bars
Arithmetic on arrays MUST use add(a,b) sub(a,b) mul(a,b) div(a,b) (div guards /0).
Element access is normal JS: close[i], and normal for-loops are allowed.

INPUTS (persisted per saved indicator)
const len = input.int('Length', 50, { min: 1, max: 500 })
input.float / input.bool / input.color / input.string / input.timeframe / input.session
const src = input.source('Source', close)   // returns a SERIES (open/high/low/close/hl2/hlc3/ohlc4)


OUTPUTS (the Signal Goat renderer reproduces these 1:1 with the Pine twin)
Every "opacity" below is 0..1 OPACITY (1 = fully visible), not Pine's 0..100
TRANSPARENCY (0 = fully visible) — color.new(color.blue, 90) is 90%
transparent, i.e. opacity: 0.1, NOT opacity: 10. Convert with (100 - X) / 100.
plot(series, { title, color, width, opacity, style: 'line'|'histogram'|'area'|'stepline' })
plotOsc(series, opts)      // lower pane
hist(series, opts)         // histogram (lower pane by default)
hline(price, { color, title, dashed, width, pane })
box(top, bottom, index1, index2, {
  color, opacity, borderColor, borderWidth, borderStyle:'solid'|'dashed'|'dotted',
  extend:'none'|'right', text, textColor, textSize, state:'active'|'partial'|'mitigated'
})  // returns a HANDLE: h.setTop/setBottom/setLeft/setRight/extendRight/stopExtend/
    // setState/setColor/setText/hide/remove  (Pine box.set_* / box.delete equivalents)
zones(list, { bullColor, bearColor, borderColor, borderWidth, opacity, mitigatedOpacity,
              textSize, extend, shrink, hideFilled, mitigatedColor, text })
  // list items: { from, to, top, bottom, side:'bull'|'bear' }
  // Full Pine object lifecycle: extends right, shrinks on partial mitigation,
  // marks/hides fully mitigated zones. USE THIS FOR FVG / OB / supply-demand.
  // mitigatedOpacity is a real, non-compounding opacity for mitigated zones
  // (defaults to opacity) — "heavily faded" means a low mitigatedOpacity,
  // not double-dimming on top of it. text is a (zone => string) callback;
  // leave it undefined for no label at all (the clean default), and when
  // set, keep it to 1-3 words ("Bull FVG") — the renderer places it near the
  // zone's trailing edge itself, never repeat it across the zone's width.
line(price1, index1, price2, index2, { color, width, opacity, style, extend:'right', text, textSize })
limitDrawings({ maxVisibleBoxes, maxVisibleLines, maxVisibleLabels, maxVisibleMarkers })
  // Universal density cap: trims each array to the most recent N (by
  // creation order) right before the run returns. Any indicator that can
  // produce a lot of objects over a long chart history (zones, pivots,
  // structure breaks, order blocks, signals) should call this — don't
  // leave the chart to accumulate hundreds of stale drawings indefinitely.
label(index, price, text, { color, textColor, borderColor,
      size:'tiny'|'small'|'normal'|'large', align:'left'|'center'|'right',
      offset, position:'above'|'below' })
  // text may contain \\n — multi-line labels render exactly as written, so port
  // Pine labels ("BUY A\\nEntry: ...\\nSL: ...\\nTP1: ...") verbatim.
signal(boolArray, 'buy'|'sell', text?, { color, shape:'arrow'|'circle'|'square', location })
fill(plotIdA, plotIdB, color, opacity)   // plot() returns its id
log(...)                        // debug output
alertcondition(boolArray, { title, message })   // safe no-op: alerts are not delivered by this
alert(message, freq?)                           // preview/backtest runtime yet, but calling these
                                                 // never throws — never invent a different name for them

VISUAL STYLE — the price chart is primary; drawings give context, never compete with it
- Zone/box fills default to translucent (roughly 10-20% opacity, e.g.
  rgba(34,197,94,0.15)), with a thin (1px), soft-alpha border
  (rgba(...,0.4-0.6)) — never a solid, fully-opaque fill or a bright/thick
  border by default.
- No text inside a zone/box and no marker/arrow for a zone's creation event
  unless the user actually asked for labels/signals — expose a "Show
  Labels"-style input() instead of always-on text. When labels are on, keep
  them to 1-3 words (e.g. "Bull FVG"), not a sentence like "Mitigated
  Bullish FVG" — the renderer places box text near the zone's trailing edge
  itself, so one short label per zone is enough.
- Any indicator that can accumulate objects over a long chart history
  (zones, order blocks, structure breaks, pivots) needs both: (a) its own
  domain-aware cap where relevant (e.g. separate max counts per bull/bear
  side — the runtime has no generic "side" concept, so this is on the
  script), and (b) a call to limitDrawings() as a blanket safety net. Never
  leave a detection loop free to keep drawing for the entire loaded history.
- Give zone-lifecycle indicators (FVG, order blocks, supply/demand) a "Show
  Mitigated Zones" and/or "Remove Zone After Mitigation" input; mitigated
  zones that stay visible should render heavily faded (zones()'s
  mitigatedOpacity, well below the active opacity), never at full strength.

VISUAL PARITY CONTRACT (enforced by the validator)
- Whatever the Pine twin draws, the SGScript MUST draw with the same primitive:
  box.new -> box()/zones(), label.new -> label(), line.new -> line(),
  hline -> hline(), plot -> plot(), plotshape/plotchar -> signal(), fill -> fill().
- NEVER downgrade a zone/box indicator to a plain marker. An FVG indicator must
  produce actual boxes with the same top/bottom, start bar, right extension,
  fill colour and opacity as the Pine version.
- Colours/opacity are shared: pass the same hex/rgba values the Pine inputs use.
- Every user setting in the Pine version (hide filled zones, shrink on
  mitigation, require displacement, colours) must be an input() here and must
  actually change runtime behaviour.
- NOT reproduced yet: table.new, bgcolor. Avoid them; if unavoidable, keep them
  cosmetic in Pine only and never rely on them for information.
- alertcondition() / alert() ARE safe to call (they exist as no-ops), unlike
  table.new/bgcolor which have no SGScript equivalent at all. Always translate
  Pine's alertcondition(cond, title=..., message=...) into
  alertcondition(cond, { title, message }) — never drop it silently and never
  invent unrelated syntax for it.


STRATEGY RULES (required whenever the user asks for a strategy / backtest)
Declare the rules; the deterministic backtest engine executes them. Never
simulate fills, P&L, or equity yourself.
strategy.long(condSeries, { stop, target, stopPoints, targetPoints, targetR, trail, qty, comment })
strategy.short(condSeries, { ...same })
strategy.close(condSeries, { side: 'long'|'short', comment })  // side omitted = close any
strategy.note('one trade per session')                          // documents a limitation
- cond is a boolean[] aligned to the bars (e.g. crossover(fast, slow)).
- stop/target accept a number or a series; stopPoints/targetPoints are distances
  in price from the entry; targetR is a multiple of entry risk (needs a stop).
- trail: a full bar-indexed series for a TRAILING stop (Pine's
  strategy.exit(..., trail_points=...) idiom) — compute the whole desired
  stop-level series once (e.g. sub(close, mul(atr(14), 3)) for an ATR trail,
  or highest(high,20) minus a distance for a Donchian trail) and pass the
  array. The backtest engine ratchets the live stop to trail[i] every bar
  after entry, favourable direction only (never loosens). There is no
  separate exit()/strategy.exit() call — trail on the entry IS the trailing
  stop; do not also emit strategy.close for the same trailing behaviour.
- Entries and exits fill at the NEXT bar's open. Never reference a future bar.
- Emit signal() markers for the same conditions so chart and backtest agree.

RULES
- Plain JS: const/let, if, for, while, functions, objects, arrays.
- No fetch, no DOM, no timers, no imports. Scripts must finish in under 3 seconds.
- Max 10,000 drawing objects. Guard loops with bar indexes.
- Always check Number.isFinite() before drawing from a series value.
- Pine's \`var x = seed\` gives x a REAL starting value from bar 0, not NaN/undefined.
  A hand-rolled per-bar state loop (trend flips, running totals, Supertrend-style
  "persist unless a condition fires" logic) MUST seed its output array with that
  same real value at index 0 (or wherever the loop begins), never leave it NaN and
  rely on a later condition to "eventually" set it. If the triggering condition
  never fires early in the series (a real possibility, not just an edge case),
  new Array(barCount).fill(NaN) plus a naive \`state[i] = state[i-1]\` carries that
  NaN forward indefinitely — every bar in a NaN-poisoned stretch silently reads as
  the WRONG side of any \`state[i] === 1\` check, not as "no data yet".`;

export const DEFAULT_SCRIPT = `// @name EMA Trend + Signals
// @overlay true

const fastLen = input.int('Fast EMA', 21, { min: 1, max: 400 })
const slowLen = input.int('Slow EMA', 55, { min: 1, max: 400 })
const fastColor = input.color('Fast EMA Color', '#e6b800')
const slowColor = input.color('Slow EMA Color', '#38bdf8')
const lineWidth = input.int('Line Width', 2, { min: 1, max: 4 })
const fillColor = input.color('Fill Color', 'rgba(230,184,0,0.08)')
const fillOpacity = input.float('Fill Opacity', 1, { min: 0, max: 1, step: 0.05 })
const showSignals = input.bool('Show signals', true)

// Already the cleanest of the built-in examples: two lines, a fill already
// well under 10% opacity, and signals already gated behind their own
// toggle. Settings here are for parity with the rest of the library, not
// a density fix.
const fast = ema(close, fastLen)
const slow = ema(close, slowLen)

const a = plot(fast, { title: 'Fast EMA', color: fastColor, width: lineWidth })
const b = plot(slow, { title: 'Slow EMA', color: slowColor, width: lineWidth })
fill(a, b, fillColor, fillOpacity)

const up = crossover(fast, slow)
const dn = crossunder(fast, slow)

if (showSignals) {
  signal(up, 'buy', 'Long')
  signal(dn, 'sell', 'Short')
}
`;

export const EXAMPLES: { name: string; code: string }[] = [
  { name: "EMA trend + signals", code: DEFAULT_SCRIPT },
  {
    name: "RSI oscillator",
    code: `// @name RSI
// @overlay false

const len = input.int('Length', 14, { min: 2, max: 200 })
const rsiColor = input.color('RSI Color', '#a78bfa')
const rsiWidth = input.int('RSI Width', 1, { min: 1, max: 4 })

const showOverbought = input.bool('Show Overbought', true)
const showOversold = input.bool('Show Oversold', true)
const showMidline = input.bool('Show Midline', true)
const overboughtLevel = input.int('Overbought Level', 70, { min: 50, max: 100 })
const oversoldLevel = input.int('Oversold Level', 30, { min: 0, max: 50 })
const overboughtColor = input.color('Overbought Color', 'rgba(239,68,68,0.5)')
const oversoldColor = input.color('Oversold Color', 'rgba(34,197,94,0.5)')

// This one never actually had a clutter problem — a single oscillator line
// plus native axis-labeled reference levels, no text drawn across the pane
// and nothing that accumulates over history. Settings here are for parity
// with the other examples, not a density fix.
const r = rsi(close, len)
plotOsc(r, { title: 'RSI', color: rsiColor, width: rsiWidth })

if (showOverbought) hline(overboughtLevel, { title: 'Overbought', color: overboughtColor, pane: 'osc' })
if (showOversold) hline(oversoldLevel, { title: 'Oversold', color: oversoldColor, pane: 'osc' })
if (showMidline) hline(50, { color: 'rgba(255,255,255,0.15)', pane: 'osc' })
`,
  },
  {
    name: "Fair value gaps (FVG)",
    code: `// @name Fair Value Gaps
// @overlay true

const minAtrMult = input.float('Min size (ATR)', 0.15, { min: 0, max: 5, step: 0.05 })

const showBull = input.bool('Show Bullish FVGs', true)
const showBear = input.bool('Show Bearish FVGs', true)
const showLabels = input.bool('Show Labels', false)
const showMitigated = input.bool('Show Mitigated Zones', true)
const removeAfterMitigation = input.bool('Remove Zone After Mitigation', false)
const maxBull = input.int('Max Bullish Zones', 8, { min: 1, max: 50 })
const maxBear = input.int('Max Bearish Zones', 8, { min: 1, max: 50 })
const bullFill = input.color('Bullish Fill', 'rgba(34,197,94,0.15)')
const bearFill = input.color('Bearish Fill', 'rgba(239,68,68,0.15)')
const fillOpacity = input.float('Fill Opacity', 1, { min: 0, max: 1, step: 0.05 })
const borderColor = input.color('Border Color', 'rgba(148,163,184,0.45)')
const borderWidth = input.int('Border Width', 1, { min: 0, max: 4 })
const labelSize = input.string('Label Size', 'tiny', { options: ['tiny', 'small', 'normal', 'large'] })
const historicalOpacity = input.float('Historical Zone Opacity', 0.35, { min: 0, max: 1, step: 0.05 })

// Candles stay the primary read: zones are a translucent 10-20%-opacity
// fill, a thin border, no text and no arrows unless explicitly turned on,
// and only the most recent zones per side are kept — see limitDrawings()
// and the Max Bullish/Bearish Zones inputs below for how.
const a = atr(14)
const gaps = []

for (let i = 2; i <= lastIndex; i++) {
  const size = a[i]
  if (!Number.isFinite(size)) continue
  const bullGap = low[i] - high[i - 2]
  const bearGap = low[i - 2] - high[i]
  const to = lastIndex

  if (bullGap > size * minAtrMult) {
    gaps.push({ from: i - 2, to, top: low[i], bottom: high[i - 2], side: 'bull' })
  }
  if (bearGap > size * minAtrMult) {
    gaps.push({ from: i - 2, to, top: low[i - 2], bottom: high[i], side: 'bear' })
  }
}

// Domain-specific (bull vs bear side) capping happens here, per-side, before
// the zones are even created — the runtime has no generic notion of "side".
const bullGaps = gaps.filter(g => g.side === 'bull').slice(-maxBull)
const bearGaps = gaps.filter(g => g.side === 'bear').slice(-maxBear)
const visible = []
if (showBull) visible.push(...bullGaps)
if (showBear) visible.push(...bearGaps)

zones(visible, {
  bullColor: bullFill,
  bearColor: bearFill,
  opacity: fillOpacity,
  mitigatedOpacity: historicalOpacity,
  borderColor: borderColor,
  borderWidth: borderWidth,
  textSize: labelSize,
  extend: true,
  shrink: true,
  hideFilled: removeAfterMitigation || !showMitigated,
  text: showLabels ? (z => z.side === 'bull' ? 'Bull FVG' : 'Bear FVG') : undefined,
})

// A universal safety net on top of the per-side caps above — any indicator
// can call this, not just this one, so the chart can never be spammed with
// hundreds of leftover objects regardless of what a script's own logic does.
limitDrawings({ maxVisibleBoxes: maxBull + maxBear, maxVisibleLabels: maxBull + maxBear })
`,
  },
  {
    name: "Order blocks (OB)",
    code: `// @name Order Blocks
// @overlay true

const dispMult = input.float('Displacement (ATR mult)', 1.5, { min: 0.5, max: 5, step: 0.1 })

const showBull = input.bool('Show Bullish OBs', true)
const showBear = input.bool('Show Bearish OBs', true)
const showLabels = input.bool('Show Labels', false)
const showMitigated = input.bool('Show Mitigated Zones', true)
const removeAfterMitigation = input.bool('Remove Zone After Mitigation', false)
const maxBull = input.int('Max Bullish Zones', 8, { min: 1, max: 50 })
const maxBear = input.int('Max Bearish Zones', 8, { min: 1, max: 50 })
const bullFill = input.color('Bullish Fill', 'rgba(34,197,94,0.15)')
const bearFill = input.color('Bearish Fill', 'rgba(239,68,68,0.15)')
const fillOpacity = input.float('Fill Opacity', 1, { min: 0, max: 1, step: 0.05 })
const borderColor = input.color('Border Color', 'rgba(148,163,184,0.45)')
const borderWidth = input.int('Border Width', 1, { min: 0, max: 4 })
const labelSize = input.string('Label Size', 'tiny', { options: ['tiny', 'small', 'normal', 'large'] })
const historicalOpacity = input.float('Historical Zone Opacity', 0.35, { min: 0, max: 1, step: 0.05 })

// Same visual system as Fair Value Gaps: a translucent zone behind candles,
// no text/labels unless asked, only the most recent N zones per side.
const disp = displacement(dispMult)
const gaps = orderBlocks(disp)

const bullGaps = gaps.filter(g => g.side === 'bull').slice(-maxBull)
const bearGaps = gaps.filter(g => g.side === 'bear').slice(-maxBear)
const visible = []
if (showBull) visible.push(...bullGaps)
if (showBear) visible.push(...bearGaps)

zones(visible, {
  bullColor: bullFill,
  bearColor: bearFill,
  opacity: fillOpacity,
  mitigatedOpacity: historicalOpacity,
  borderColor: borderColor,
  borderWidth: borderWidth,
  textSize: labelSize,
  extend: true,
  shrink: true,
  hideFilled: removeAfterMitigation || !showMitigated,
  text: showLabels ? (z => z.side === 'bull' ? 'Bull OB' : 'Bear OB') : undefined,
})

limitDrawings({ maxVisibleBoxes: maxBull + maxBear, maxVisibleLabels: maxBull + maxBear })
`,
  },
  {
    name: "VWAP + session levels",
    code: `// @name VWAP + Daily Levels
// @overlay true

const showVwap = input.bool('Show VWAP', true)
const vwapColor = input.color('VWAP Color', '#38bdf8')
const vwapWidth = input.int('VWAP Width', 2, { min: 1, max: 4 })

const showPdh = input.bool('Show PDH', true)
const showPdl = input.bool('Show PDL', true)
const showLabels = input.bool('Show Labels', false)
const maxDays = input.int('Max Days', 10, { min: 1, max: 60 })
const pdhColor = input.color('PDH Color', 'rgba(239,68,68,0.6)')
const pdlColor = input.color('PDL Color', 'rgba(34,197,94,0.6)')
const lineWidth = input.int('Line Width', 1, { min: 1, max: 4 })
const lineOpacity = input.float('Line Opacity', 1, { min: 0, max: 1, step: 0.05 })
const labelSize = input.string('Label Size', 'tiny', { options: ['tiny', 'small', 'normal', 'large'] })

if (showVwap) {
  const v = vwap()
  plot(v, { title: 'VWAP', color: vwapColor, width: vwapWidth })
}

// Previous day high/low, each ray spanning exactly its own day (until the
// next day boundary, or lastIndex for the current day) instead of a
// hardcoded bar count that only happened to make sense at one timeframe.
// Only the most recent Max Days are kept, not every day in the history.
const d = htf('1d')
const dayStarts = []
for (let i = 1; i <= lastIndex; i++) {
  const newDay = Math.floor(time[i] / 86400) !== Math.floor(time[i - 1] / 86400)
  if (newDay) dayStarts.push(i)
}

const from = Math.max(0, dayStarts.length - maxDays)
for (let k = from; k < dayStarts.length; k++) {
  const i = dayStarts[k]
  const to = k + 1 < dayStarts.length ? dayStarts[k + 1] : lastIndex
  const pdh = d.high[i - 1]
  const pdl = d.low[i - 1]
  if (showPdh && Number.isFinite(pdh)) {
    line(pdh, i, pdh, to, {
      color: pdhColor, width: lineWidth, opacity: lineOpacity, dashed: true,
      ...(showLabels ? { text: 'PDH', textSize: labelSize } : {}),
    })
  }
  if (showPdl && Number.isFinite(pdl)) {
    line(pdl, i, pdl, to, {
      color: pdlColor, width: lineWidth, opacity: lineOpacity, dashed: true,
      ...(showLabels ? { text: 'PDL', textSize: labelSize } : {}),
    })
  }
}

limitDrawings({ maxVisibleLines: maxDays * 2 })
`,
  },
  {
    name: "Market structure (BOS)",
    code: `// @name Market Structure BOS
// @overlay true

const left = input.int('Pivot left', 5, { min: 1, max: 50 })
const right = input.int('Pivot right', 5, { min: 1, max: 50 })

const showBull = input.bool('Show Bullish BOS', true)
const showBear = input.bool('Show Bearish BOS', true)
const showLabels = input.bool('Show Labels', false)
const showMarkers = input.bool('Show Markers', false)
const maxBull = input.int('Max Bullish Breaks', 8, { min: 1, max: 50 })
const maxBear = input.int('Max Bearish Breaks', 8, { min: 1, max: 50 })
const bullColor = input.color('Bullish Line', '#22c55e')
const bearColor = input.color('Bearish Line', '#ef4444')
const lineWidth = input.int('Line Width', 1, { min: 1, max: 4 })
const labelSize = input.string('Label Size', 'tiny', { options: ['tiny', 'small', 'normal', 'large'] })

// Direction already reads from line color — text and markers are optional,
// off by default, so one break doesn't announce itself through three
// separate channels at once. Only the most recent breaks per side are kept.
const ph = pivotHigh(left, right)
const pl = pivotLow(left, right)

let lastHigh = NaN, lastHighIdx = -1
let lastLow = NaN, lastLowIdx = -1
const bullBreaks = []
const bearBreaks = []

for (let i = 0; i <= lastIndex; i++) {
  if (Number.isFinite(ph[i])) { lastHigh = ph[i]; lastHighIdx = i }
  if (Number.isFinite(pl[i])) { lastLow = pl[i]; lastLowIdx = i }

  if (Number.isFinite(lastHigh) && close[i] > lastHigh) {
    bullBreaks.push({ price: lastHigh, from: lastHighIdx, to: i })
    lastHigh = NaN
  }
  if (Number.isFinite(lastLow) && close[i] < lastLow) {
    bearBreaks.push({ price: lastLow, from: lastLowIdx, to: i })
    lastLow = NaN
  }
}

const visibleBull = showBull ? bullBreaks.slice(-maxBull) : []
const visibleBear = showBear ? bearBreaks.slice(-maxBear) : []

for (const b of visibleBull) {
  line(b.price, b.from, b.price, b.to, {
    color: bullColor,
    width: lineWidth,
    ...(showLabels ? { text: 'BOS', textSize: labelSize } : {}),
  })
}
for (const b of visibleBear) {
  line(b.price, b.from, b.price, b.to, {
    color: bearColor,
    width: lineWidth,
    ...(showLabels ? { text: 'BOS', textSize: labelSize } : {}),
  })
}

if (showMarkers) {
  const bull = new Array(barCount).fill(false)
  const bear = new Array(barCount).fill(false)
  for (const b of visibleBull) bull[b.to] = true
  for (const b of visibleBear) bear[b.to] = true
  signal(bull, 'buy', 'BOS up')
  signal(bear, 'sell', 'BOS down')
}

limitDrawings({ maxVisibleLines: maxBull + maxBear, maxVisibleMarkers: maxBull + maxBear })
`,
  },
  {
    name: "Volume profile",
    code: `// @name Volume Profile
// @overlay true

const bins = input.int('Bins', 30, { min: 5, max: 100 })
const lookback = input.int('Lookback bars', 200, { min: 20, max: 1000 })
const showPoc = input.bool('Show POC Line', true)
const profileColor = input.color('Profile Color', 'rgba(56,189,248,0.18)')
const pocColor = input.color('POC Color', 'rgba(230,184,0,0.35)')
const fillOpacity = input.float('Fill Opacity', 1, { min: 0, max: 1, step: 0.05 })
const borderWidth = input.int('Border Width', 0, { min: 0, max: 4 })
const borderColor = input.color('Border Color', 'rgba(148,163,184,0.45)')
const labelSize = input.string('Label Size', 'tiny', { options: ['tiny', 'small', 'normal', 'large'] })

// Profile bars sit behind candles like any other zone, so price stays
// readable. No border by default (box() would otherwise fall back to its
// own default blue outline on every bin) — the POC line/label is the only
// text this indicator ever draws, and it's a single toggle, not per-bin.
const from = Math.max(0, lastIndex - lookback)
const profile = volumeProfile(from, lastIndex, bins)
let maxVol = 0
for (const p of profile) maxVol = Math.max(maxVol, p.volume)

for (const p of profile) {
  if (maxVol <= 0) break
  const width = Math.round((p.volume / maxVol) * (lookback * 0.25))
  const isPoc = p.volume === maxVol
  box(p.bottom, p.top, lastIndex - width, lastIndex, {
    color: isPoc ? pocColor : profileColor,
    opacity: fillOpacity,
    borderColor: borderColor,
    borderWidth: borderWidth,
  })
  if (isPoc && showPoc) {
    line(p.top, from, p.top, lastIndex, { color: pocColor, dashed: true, text: 'POC', textSize: labelSize })
  }
}
`,
  },
];
