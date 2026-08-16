// @name Support/Resistance Lines Test
// @overlay true

const lookback = input.int('Pivot Lookback', 15, { min: 2 });

const ph = pivotHigh(lookback, lookback);
const pl = pivotLow(lookback, lookback);
const pivotLines = [];

for (let i = lookback; i < barCount; i++) {
  if (Number.isFinite(ph[i])) {
    pivotLines.push({
      from: i - lookback,
      to: i,
      price: ph[i],
      color: '#F23645'
    });
  }

  if (Number.isFinite(pl[i])) {
    pivotLines.push({
      from: i - lookback,
      to: i,
      price: pl[i],
      color: '#089981'
    });
  }
}

const firstLine = Math.max(0, pivotLines.length - 200);

for (let i = firstLine; i < pivotLines.length; i++) {
  const level = pivotLines[i];

  if (
    Number.isFinite(level.price) &&
    Number.isFinite(level.from) &&
    Number.isFinite(level.to)
  ) {
    line(level.price, level.from, level.price, level.to, {
      color: level.color,
      width: 1,
      opacity: 100,
      style: 'dashed',
      extend: 'right'
    });
  }
}