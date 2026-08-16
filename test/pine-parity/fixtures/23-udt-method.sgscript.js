// @name UDT and Method Test
// @overlay true

const lookback = input.int('Lookback', 10, { min: 1 })

const ph = pivotHigh(lookback, lookback)
const pl = pivotLow(lookback, lookback)

function isRecent(point, currentBar, maxAge) {
    return Number.isFinite(point.barIndex) &&
        (currentBar - point.barIndex) <= maxAge
}

let lastHigh = {
    price: NaN,
    barIndex: NaN,
    isHigh: true
}

let lastLow = {
    price: NaN,
    barIndex: NaN,
    isHigh: false
}

const recentHighPivot = new Array(barCount).fill(false)

for (let i = 0; i < barCount; i++) {
    if (Number.isFinite(ph[i])) {
        lastHigh = {
            price: ph[i],
            barIndex: i - lookback,
            isHigh: true
        }
    }

    if (Number.isFinite(pl[i])) {
        lastLow = {
            price: pl[i],
            barIndex: i - lookback,
            isHigh: false
        }
    }

    const recentHigh = isRecent(lastHigh, i, 30)
    recentHighPivot[i] = recentHigh && Number.isFinite(ph[i])
}

signal(recentHighPivot, 'sell', 'Recent High', {
    color: '#FF0000',
    shape: 'arrow',
    location: 'above'
})