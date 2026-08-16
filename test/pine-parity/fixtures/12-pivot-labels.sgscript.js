// @name Pivot Labels Test
// @overlay true

const lookback = input.int('Lookback', 8, { min: 2 })

const ph = pivotHigh(lookback, lookback)
const pl = pivotLow(lookback, lookback)

function formatPrice(value) {
  const rounded = value.toFixed(2)
  const trimmed = rounded.replace(/\.?0+$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

const pivotLabels = []

for (let i = 0; i < barCount; i++) {
  const pivotIndex = i - lookback
  if (pivotIndex < 0) continue

  if (Number.isFinite(ph[i])) {
    pivotLabels.push({
      index: pivotIndex,
      price: ph[i],
      side: 'high'
    })
  }

  if (Number.isFinite(pl[i])) {
    pivotLabels.push({
      index: pivotIndex,
      price: pl[i],
      side: 'low'
    })
  }
}

const firstVisibleLabel = Math.max(0, pivotLabels.length - 200)

for (let i = firstVisibleLabel; i < pivotLabels.length; i++) {
  const item = pivotLabels[i]

  if (!Number.isFinite(item.price)) continue

  if (item.side === 'high') {
    label(item.index, item.price, formatPrice(item.price), {
      color: '#FF0000',
      textColor: '#FFFFFF',
      borderColor: '#FF0000',
      size: 'small',
      align: 'center',
      position: 'above'
    })
  } else {
    label(item.index, item.price, formatPrice(item.price), {
      color: '#008000',
      textColor: '#FFFFFF',
      borderColor: '#008000',
      size: 'small',
      align: 'center',
      position: 'below'
    })
  }
}