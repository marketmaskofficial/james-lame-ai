// @name MACD Test
// @overlay false

const fastLen = input.int('Fast Length', 12, { min: 1 })
const slowLen = input.int('Slow Length', 26, { min: 1 })
const signalLen = input.int('Signal Length', 9, { min: 1 })

const macdResult = macd(close, fastLen, slowLen, signalLen)

plotOsc(macdResult.macd, {
  title: 'MACD',
  color: '#0000FF',
  width: 1,
  style: 'line'
})

plotOsc(macdResult.signal, {
  title: 'Signal',
  color: '#FFA500',
  width: 1,
  style: 'line'
})

hist(macdResult.hist, {
  title: 'Histogram',
  color: '#808080',
  width: 1
})

hline(0, {
  title: 'Zero',
  color: '#808080',
  pane: 'lower'
})