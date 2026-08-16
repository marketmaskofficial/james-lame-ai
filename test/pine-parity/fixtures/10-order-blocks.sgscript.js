// @name Order Blocks Test
// @overlay true

const lookback = input.int('Swing Lookback', 10, { min: 2 })

const ph = pivotHigh(lookback, lookback)
const pl = pivotLow(lookback, lookback)

const events = []

for (let i = lookback; i < barCount; i++) {
  const pivotIndex = i - lookback
  const pivotClose = close[pivotIndex]

  if (Number.isFinite(ph[i]) && Number.isFinite(pivotClose)) {
    events.push({
      index: pivotIndex,
      price: ph[i],
      close: pivotClose,
      side: 'high'
    })
  }

  if (Number.isFinite(pl[i]) && Number.isFinite(pivotClose)) {
    events.push({
      index: pivotIndex,
      price: pl[i],
      close: pivotClose,
      side: 'low'
    })
  }
}

const firstVisible = Math.max(0, events.length - 200)

for (let i = firstVisible; i < events.length; i++) {
  const event = events[i]

  if (
    !Number.isFinite(event.index) ||
    !Number.isFinite(event.price) ||
    !Number.isFinite(event.close)
  ) {
    continue
  }

  if (event.side === 'high') {
    box(event.price, event.close, event.index, event.index + 3, {
      color: '#F23645',
      opacity: 20,
      borderColor: '#F23645',
      borderWidth: 1,
      borderStyle: 'solid',
      extend: 'none'
    })

    label(event.index, event.price, 'OB-H', {
      color: '#F23645',
      textColor: '#FFFFFF',
      borderColor: '#F23645',
      size: 'tiny',
      align: 'center',
      position: 'above'
    })
  } else {
    box(event.price, event.close, event.index, event.index + 3, {
      color: '#089981',
      opacity: 20,
      borderColor: '#089981',
      borderWidth: 1,
      borderStyle: 'solid',
      extend: 'none'
    })

    label(event.index, event.price, 'OB-L', {
      color: '#089981',
      textColor: '#FFFFFF',
      borderColor: '#089981',
      size: 'tiny',
      align: 'center',
      position: 'below'
    })
  }
}