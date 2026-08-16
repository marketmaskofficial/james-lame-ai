// @name Supertrend Test
// @overlay true

const atrLen = input.int('ATR Length', 10);
const mult = input.float('Multiplier', 3.0);

const atrVal = atr(atrLen);
const atrOffset = mul(atrVal, mult);
const upperBand = add(hl2, atrOffset);
const lowerBand = sub(hl2, atrOffset);

const trend = new Array(barCount).fill(1);

for (let i = 1; i < barCount; i++) {
  trend[i] = trend[i - 1];

  if (Number.isFinite(upperBand[i - 1]) && close[i] > upperBand[i - 1]) {
    trend[i] = 1;
  } else if (Number.isFinite(lowerBand[i - 1]) && close[i] < lowerBand[i - 1]) {
    trend[i] = -1;
  }
}

const bullishLine = new Array(barCount).fill(NaN);
const bearishLine = new Array(barCount).fill(NaN);

for (let i = 0; i < barCount; i++) {
  if (trend[i] === 1 && Number.isFinite(lowerBand[i])) {
    bullishLine[i] = lowerBand[i];
  } else if (trend[i] === -1 && Number.isFinite(upperBand[i])) {
    bearishLine[i] = upperBand[i];
  }
}

plot(bullishLine, {
  title: 'Supertrend',
  color: '#4CAF50',
  width: 2,
  style: 'line'
});

plot(bearishLine, {
  title: 'Supertrend',
  color: '#F23645',
  width: 2,
  style: 'line'
});