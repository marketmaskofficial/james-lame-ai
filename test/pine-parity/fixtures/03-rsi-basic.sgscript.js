// @name RSI Test
// @overlay false

const len = input.int('RSI Length', 14, { min: 1 });
const rsiVal = rsi(close, len);

plotOsc(rsiVal, {
  title: 'RSI',
  color: '#800080',
  width: 1,
  style: 'line'
});

hline(70, {
  title: 'Overbought',
  color: '#FF0000',
  pane: 'lower'
});

hline(30, {
  title: 'Oversold',
  color: '#008000',
  pane: 'lower'
});

hline(50, {
  title: 'Midline',
  color: '#808080',
  pane: 'lower'
});