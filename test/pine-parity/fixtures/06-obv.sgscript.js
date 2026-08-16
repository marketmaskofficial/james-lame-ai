// @name OBV Test
// @overlay false

const closeChange = change(close);
const direction = map(closeChange, function(value) {
  return Number.isFinite(value) ? Math.sign(value) : NaN;
});

const obvVal = cum(mul(direction, volume));
const obvMA = sma(obvVal, 20);

plot(obvVal, {
  title: 'OBV',
  color: '#0000FF',
  width: 1,
  style: 'line'
});

plot(obvMA, {
  title: 'OBV MA',
  color: '#FFA500',
  width: 1,
  style: 'line'
});