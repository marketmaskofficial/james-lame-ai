// @name SMA Crossover Test
// @overlay true

const fastLen = input.int('Fast Length', 20, { min: 1 })
const slowLen = input.int('Slow Length', 50, { min: 1 })

const fastMA = sma(close, fastLen)
const slowMA = sma(close, slowLen)

plot(fastMA, {
  title: 'Fast SMA',
  color: '#2196F3',
  width: 1,
  style: 'line'
})

plot(slowMA, {
  title: 'Slow SMA',
  color: '#FF9800',
  width: 1,
  style: 'line'
})

const bullCross = crossover(fastMA, slowMA)
const bearCross = crossunder(fastMA, slowMA)

signal(bullCross, 'buy', 'Bull Cross', {
  color: '#4CAF50',
  shape: 'arrow',
  location: 'below'
})

signal(bearCross, 'sell', 'Bear Cross', {
  color: '#F23645',
  shape: 'arrow',
  location: 'above'
})