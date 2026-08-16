// @name Stochastic Test
// @overlay false

const kLen = input.int('%K Length', 14, { min: 1 })
const kSmooth = input.int('%K Smoothing', 3, { min: 1 })
const dLen = input.int('%D Length', 3, { min: 1 })

const rawStoch = stoch(kLen, 1, 1).k
const k = sma(rawStoch, kSmooth)
const d = sma(k, dLen)

plotOsc(k, {
  title: '%K',
  color: '#0000FF',
  width: 1,
  opacity: 1,
  style: 'line'
})

plotOsc(d, {
  title: '%D',
  color: '#FFA500',
  width: 1,
  opacity: 1,
  style: 'line'
})

hline(80, {
  title: 'Overbought',
  color: '#FF0000',
  pane: 'lower'
})

hline(20, {
  title: 'Oversold',
  color: '#008000',
  pane: 'lower'
})