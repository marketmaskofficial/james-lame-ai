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
plot(series, { title, color, width, opacity, style: 'line'|'histogram'|'area'|'stepline' })
plotOsc(series, opts)      // lower pane
hist(series, opts)         // histogram (lower pane by default)
hline(price, { color, title, dashed, width, pane })
box(top, bottom, index1, index2, {
  color, opacity, borderColor, borderWidth, borderStyle:'solid'|'dashed'|'dotted',
  extend:'none'|'right', text, textColor, textSize, state:'active'|'partial'|'mitigated'
})  // returns a HANDLE: h.setTop/setBottom/setLeft/setRight/extendRight/stopExtend/
    // setState/setColor/setText/hide/remove  (Pine box.set_* / box.delete equivalents)
zones(list, { bullColor, bearColor, borderColor, opacity, extend, shrink, hideFilled,
              mitigatedColor, text })  // list items: { from, to, top, bottom, side:'bull'|'bear' }
  // Full Pine object lifecycle: extends right, shrinks on partial mitigation,
  // marks/hides fully mitigated zones. USE THIS FOR FVG / OB / supply-demand.
line(price1, index1, price2, index2, { color, width, opacity, style, extend:'right', text })
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
strategy.long(condSeries, { stop, target, stopPoints, targetPoints, targetR, qty, comment })
strategy.short(condSeries, { ...same })
strategy.close(condSeries, { side: 'long'|'short', comment })  // side omitted = close any
strategy.note('one trade per session')                          // documents a limitation
- cond is a boolean[] aligned to the bars (e.g. crossover(fast, slow)).
- stop/target accept a number or a series; stopPoints/targetPoints are distances
  in price from the entry; targetR is a multiple of entry risk (needs a stop).
- Entries and exits fill at the NEXT bar's open. Never reference a future bar.
- Emit signal() markers for the same conditions so chart and backtest agree.

RULES
- Plain JS: const/let, if, for, while, functions, objects, arrays.
- No fetch, no DOM, no timers, no imports. Scripts must finish in under 3 seconds.
- Max 10,000 drawing objects. Guard loops with bar indexes.
- Always check Number.isFinite() before drawing from a series value.`;

export const DEFAULT_SCRIPT = `// @name EMA Trend + Signals
// @overlay true

const fastLen = input.int('Fast EMA', 21, { min: 1, max: 400 })
const slowLen = input.int('Slow EMA', 55, { min: 1, max: 400 })
const showSignals = input.bool('Show signals', true)

const fast = ema(close, fastLen)
const slow = ema(close, slowLen)

const a = plot(fast, { title: 'Fast EMA', color: '#e6b800' })
const b = plot(slow, { title: 'Slow EMA', color: '#38bdf8' })
fill(a, b, 'rgba(230,184,0,0.08)')

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
const r = rsi(close, len)

plotOsc(r, { title: 'RSI', color: '#a78bfa' })
hline(70, { title: 'Overbought', color: 'rgba(239,68,68,0.5)', pane: 'osc' })
hline(30, { title: 'Oversold', color: 'rgba(34,197,94,0.5)', pane: 'osc' })
hline(50, { color: 'rgba(255,255,255,0.15)', pane: 'osc' })
`,
  },
  {
    name: "Fair value gaps (FVG)",
    code: `// @name Fair Value Gaps
// @overlay true

const extend = input.int('Extend bars', 20, { min: 1, max: 200 })
const minAtrMult = input.float('Min size (ATR)', 0.15, { min: 0, max: 5, step: 0.05 })
const a = atr(14)

for (let i = 2; i <= lastIndex; i++) {
  const size = a[i]
  if (!Number.isFinite(size)) continue
  const bullGap = low[i] - high[i - 2]
  const bearGap = low[i - 2] - high[i]
  const to = Math.min(lastIndex, i + extend)

  if (bullGap > size * minAtrMult) {
    box(high[i - 2], low[i], i - 2, to, { color: 'rgba(34,197,94,0.14)', borderColor: 'rgba(34,197,94,0.5)' })
  }
  if (bearGap > size * minAtrMult) {
    box(high[i], low[i - 2], i - 2, to, { color: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.5)' })
  }
}
`,
  },
  {
    name: "VWAP + session levels",
    code: `// @name VWAP + Daily Levels
// @overlay true

const v = vwap()
plot(v, { title: 'VWAP', color: '#38bdf8', width: 2 })

// Previous day high / low drawn as rays
const d = htf('1d')
for (let i = 1; i <= lastIndex; i++) {
  const newDay = Math.floor(time[i] / 86400) !== Math.floor(time[i - 1] / 86400)
  if (!newDay) continue
  const pdh = d.high[i - 1]
  const pdl = d.low[i - 1]
  const to = Math.min(lastIndex, i + 96)
  if (Number.isFinite(pdh)) line(pdh, i, pdh, to, { color: 'rgba(239,68,68,0.6)', dashed: true, text: 'PDH' })
  if (Number.isFinite(pdl)) line(pdl, i, pdl, to, { color: 'rgba(34,197,94,0.6)', dashed: true, text: 'PDL' })
}
`,
  },
  {
    name: "Market structure (BOS)",
    code: `// @name Market Structure BOS
// @overlay true

const left = input.int('Pivot left', 5, { min: 1, max: 50 })
const right = input.int('Pivot right', 5, { min: 1, max: 50 })

const ph = pivotHigh(left, right)
const pl = pivotLow(left, right)

let lastHigh = NaN, lastHighIdx = -1
let lastLow = NaN, lastLowIdx = -1
const bull = new Array(barCount).fill(false)
const bear = new Array(barCount).fill(false)

for (let i = 0; i <= lastIndex; i++) {
  if (Number.isFinite(ph[i])) { lastHigh = ph[i]; lastHighIdx = i }
  if (Number.isFinite(pl[i])) { lastLow = pl[i]; lastLowIdx = i }

  if (Number.isFinite(lastHigh) && close[i] > lastHigh) {
    bull[i] = true
    line(lastHigh, lastHighIdx, lastHigh, i, { color: '#22c55e', text: 'BOS' })
    lastHigh = NaN
  }
  if (Number.isFinite(lastLow) && close[i] < lastLow) {
    bear[i] = true
    line(lastLow, lastLowIdx, lastLow, i, { color: '#ef4444', text: 'BOS' })
    lastLow = NaN
  }
}

signal(bull, 'buy', 'BOS up')
signal(bear, 'sell', 'BOS down')
`,
  },
  {
    name: "Volume profile",
    code: `// @name Volume Profile
// @overlay true

const bins = input.int('Bins', 30, { min: 5, max: 100 })
const lookback = input.int('Lookback bars', 200, { min: 20, max: 1000 })

const from = Math.max(0, lastIndex - lookback)
const profile = volumeProfile(from, lastIndex, bins)
let maxVol = 0
for (const p of profile) maxVol = Math.max(maxVol, p.volume)

for (const p of profile) {
  if (maxVol <= 0) break
  const width = Math.round((p.volume / maxVol) * (lookback * 0.25))
  const isPoc = p.volume === maxVol
  box(p.bottom, p.top, lastIndex - width, lastIndex, {
    color: isPoc ? 'rgba(230,184,0,0.35)' : 'rgba(56,189,248,0.18)',
  })
  if (isPoc) line(p.top, from, p.top, lastIndex, { color: '#e6b800', dashed: true, text: 'POC' })
}
`,
  },
];
