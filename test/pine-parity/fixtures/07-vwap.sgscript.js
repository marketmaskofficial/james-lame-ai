// @name VWAP Test
// @overlay true

const srcVal = hlc3;
const cumVolPrice = cum(mul(srcVal, volume));
const cumVol = cum(volume);
const vwapVal = div(cumVolPrice, cumVol);

plot(vwapVal, {
  title: 'VWAP',
  color: '#FFFF00',
  width: 2,
  style: 'line'
});