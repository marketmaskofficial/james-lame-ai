// @name HTF Trend Bias Test
// @overlay false

const weekly = htf('1w');
const bullish = gt(close, weekly.open);
const bias = iff(bullish, 1, -1);

const bullBias = iff(bullish, bias, NaN);
const bearBias = iff(not(bullish), bias, NaN);

hist(bullBias, {
  title: 'HTF Bias',
  color: '#008000',
  opacity: 100
});

hist(bearBias, {
  title: 'HTF Bias',
  color: '#FF0000',
  opacity: 100
});