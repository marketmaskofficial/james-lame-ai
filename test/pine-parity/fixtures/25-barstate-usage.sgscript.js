// @name Barstate Usage Test
// @overlay true

const len = input.int('Length', 20, { min: 1 })

const avg = sma(close, len)
plot(avg, {
  title: 'SMA',
  color: '#2196F3',
  width: 1,
  style: 'line'
})

const confirmed = new Array(barCount).fill(true)
if (lastIndex >= 0) confirmed[lastIndex] = false

const longCond = and(crossover(close, avg), confirmed)

signal(longCond, 'buy', '', {
  color: '#4CAF50',
  shape: 'arrow',
  location: 'below'
})

if (
  lastIndex >= 0 &&
  lastIndex < barCount &&
  Number.isFinite(high[lastIndex])
) {
  label(lastIndex, high[lastIndex], 'Last Bar', {
    color: '#787B86',
    textColor: '#FFFFFF',
    borderColor: '#787B86',
    size: 'normal',
    align: 'center',
    position: 'above'
  })
}