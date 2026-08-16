// @name Table and Bgcolor Test
// @overlay true

const len = input.int('Length', 20, { min: 1 });
const avg = sma(close, len);
const bullish = gt(close, avg);

plot(avg, {
  title: 'SMA',
  color: '#0000FF',
  width: 1,
  opacity: 1,
  style: 'line'
});