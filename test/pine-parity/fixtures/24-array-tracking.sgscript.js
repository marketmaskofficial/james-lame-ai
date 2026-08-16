// @name Array Tracking Test
// @overlay false

const maxLevels = input.int('Max Tracked Levels', 5, { min: 1, max: 20 })
const lookback = input.int('Pivot Lookback', 10, { min: 1 })

const ph = pivotHigh(lookback, lookback)
const levels = []
const trackedCount = new Array(barCount).fill(0)

for (let i = 0; i < barCount; i++) {
  if (Number.isFinite(ph[i])) {
    levels.push(ph[i])

    if (levels.length > maxLevels) {
      levels.shift()
    }
  }

  trackedCount[i] = levels.length
}

plot(trackedCount, {
  title: 'Tracked Levels',
  style: 'histogram',
  color: '#0000FF'
})