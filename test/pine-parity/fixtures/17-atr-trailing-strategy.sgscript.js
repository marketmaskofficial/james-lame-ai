// @name ATR Trailing Stop Strategy Test
// @overlay true

const atrLen = input.int('ATR Length', 14, { min: 1 })
const atrMult = input.float('ATR Multiplier', 3.0, { min: 0 })
const trendLen = input.int('Trend EMA Length', 20, { min: 1 })

const atrVal = atr(atrLen)
const trendEma = ema(close, trendLen)

plot(trendEma, {
  title: 'Trend EMA',
  color: '#0000FF',
  width: 1,
  opacity: 100,
  style: 'line'
})

const longCond = crossover(close, trendEma)
const shortCond = crossunder(close, trendEma)

const atrDistance = mul(atrVal, atrMult)
const longTrail = sub(close, atrDistance)
const shortTrail = add(close, atrDistance)

signal(longCond, 'buy', 'Long', {
  color: '#00AA00',
  shape: 'arrow',
  location: 'below'
})

signal(shortCond, 'sell', 'Short', {
  color: '#CC0000',
  shape: 'arrow',
  location: 'above'
})

strategy.long(longCond, {
  trail: longTrail,
  qty: 10,
  comment: 'Long'
})

strategy.short(shortCond, {
  trail: shortTrail,
  qty: 10,
  comment: 'Short'
})