// @name MA Cross Strategy Test
// @overlay true

const fastLen = input.int('Fast Length', 10)
const slowLen = input.int('Slow Length', 30)

const fastMA = sma(close, fastLen)
const slowMA = sma(close, slowLen)

plot(fastMA, {
  title: 'Fast',
  color: '#2196F3',
  width: 1,
  opacity: 100,
  style: 'line'
})

plot(slowMA, {
  title: 'Slow',
  color: '#FF9800',
  width: 1,
  opacity: 100,
  style: 'line'
})

const longCond = crossover(fastMA, slowMA)
const shortCond = crossunder(fastMA, slowMA)

signal(longCond, 'buy', 'Long', {
  color: '#2196F3',
  shape: 'arrow',
  location: 'below'
})

signal(shortCond, 'sell', 'Short', {
  color: '#FF9800',
  shape: 'arrow',
  location: 'above'
})

strategy.long(longCond, {
  qty: 10,
  comment: 'Long'
})

strategy.short(shortCond, {
  qty: 10,
  comment: 'Short'
})

strategy.note('Position size: 10% of equity')