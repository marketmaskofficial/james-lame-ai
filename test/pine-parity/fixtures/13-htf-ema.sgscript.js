// @name HTF EMA Test
// @overlay true

const higherTimeframe = input.timeframe('Higher Timeframe', '1W')
const emaLength = input.int('EMA Length', 10, { min: 1 })

function timeframeInfo(value) {
  const tf = String(value).trim().toUpperCase()

  if (/^\d+$/.test(tf)) {
    return { unit: 'minute', count: Math.max(1, Number(tf)) }
  }

  const match = tf.match(/^(\d+)?([SMHDW])$/)
  if (!match) return { unit: 'week', count: 1 }

  const count = Math.max(1, Number(match[1] || 1))
  const suffix = match[2]

  if (suffix === 'S') return { unit: 'second', count }
  if (suffix === 'H') return { unit: 'hour', count }
  if (suffix === 'D') return { unit: 'day', count }
  if (suffix === 'W') return { unit: 'week', count }
  if (suffix === 'M') return { unit: 'month', count }

  return { unit: 'week', count: 1 }
}

function timestampMs(value) {
  if (!Number.isFinite(value)) return NaN
  return value < 100000000000 ? value * 1000 : value
}

function bucketKey(timestamp, info) {
  const ms = timestampMs(timestamp)
  if (!Number.isFinite(ms)) return NaN

  if (info.unit === 'month') {
    const date = new Date(ms)
    const monthNumber = date.getUTCFullYear() * 12 + date.getUTCMonth()
    return Math.floor(monthNumber / info.count)
  }

  let duration = 60000
  let anchor = 0

  if (info.unit === 'second') duration = info.count * 1000
  if (info.unit === 'minute') duration = info.count * 60000
  if (info.unit === 'hour') duration = info.count * 3600000
  if (info.unit === 'day') duration = info.count * 86400000

  if (info.unit === 'week') {
    duration = info.count * 7 * 86400000
    anchor = 4 * 86400000
  }

  return Math.floor((ms - anchor) / duration)
}

const tfInfo = timeframeInfo(higherTimeframe)
const htfEma = new Array(barCount).fill(NaN)
const bucketStarts = []
const bucketEnds = []
const bucketCloses = []

let activeKey = NaN
let activeStart = -1

for (let i = 0; i < barCount; i++) {
  const key = bucketKey(time[i], tfInfo)
  if (!Number.isFinite(key)) continue

  if (activeStart < 0) {
    activeKey = key
    activeStart = i
  } else if (key !== activeKey) {
    const end = i - 1
    bucketStarts.push(activeStart)
    bucketEnds.push(end)
    bucketCloses.push(close[end])

    activeKey = key
    activeStart = i
  }
}

if (activeStart >= 0 && barCount > 0) {
  const end = barCount - 1
  bucketStarts.push(activeStart)
  bucketEnds.push(end)
  bucketCloses.push(close[end])
}

const bucketEma = new Array(bucketCloses.length).fill(NaN)
const alpha = 2 / (emaLength + 1)
let emaValue = NaN

for (let i = 0; i < bucketCloses.length; i++) {
  const value = bucketCloses[i]
  if (!Number.isFinite(value)) continue

  if (!Number.isFinite(emaValue)) {
    emaValue = value
  } else {
    emaValue = alpha * value + (1 - alpha) * emaValue
  }

  bucketEma[i] = emaValue
}

for (let bucket = 1; bucket < bucketStarts.length; bucket++) {
  const previousClosedEma = bucketEma[bucket - 1]
  if (!Number.isFinite(previousClosedEma)) continue

  for (let i = bucketStarts[bucket]; i <= bucketEnds[bucket]; i++) {
    htfEma[i] = previousClosedEma
  }
}

plot(htfEma, {
  title: 'HTF EMA',
  color: '#FF00FF',
  width: 2,
  opacity: 1,
  style: 'line'
})