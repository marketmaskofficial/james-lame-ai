// @name RSI Mean Reversion Strategy Test
// @overlay true

const len = input.int('RSI Length', 14, { min: 1 })
const oversold = input.int('Oversold', 30, { min: 0, max: 100 })
const overbought = input.int('Overbought', 70, { min: 0, max: 100 })
const stopPct = input.float('Stop %', 2.0, { min: 0 })
const targetPct = input.float('Target %', 4.0, { min: 0 })

const rsiVal = rsi(close, len)
plot(rsiVal, {
  title: 'RSI',
  color: '#2196F3',
  width: 1,
  opacity: 100,
  style: 'line'
})

const longCond = crossover(rsiVal, oversold)
const shortCond = crossunder(rsiVal, overbought)

const longStop = mul(close, 1 - stopPct / 100)
const longTarget = mul(close, 1 + targetPct / 100)
const shortStop = mul(close, 1 + stopPct / 100)
const shortTarget = mul(close, 1 - targetPct / 100)

strategy.long(longCond, {
  stop: longStop,
  target: longTarget,
  qty: 10,
  comment: 'Long'
})

strategy.short(shortCond, {
  stop: shortStop,
  target: shortTarget,
  qty: 10,
  comment: 'Short'
})

signal(longCond, 'buy', 'Long', {
  color: '#26A69A',
  shape: 'arrow',
  location: 'below'
})

signal(shortCond, 'sell', 'Short', {
  color: '#EF5350',
  shape: 'arrow',
  location: 'above'
})