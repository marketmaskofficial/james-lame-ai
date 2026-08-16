// @name Breakout Alerts Test
// @overlay true

const len = input.int('Breakout Length', 20, { min: 1 });

const highestHigh = highest(high, len);
const lowestLow = lowest(low, len);

const breakoutUp = gte(close, highestHigh);
const breakoutDown = lte(close, lowestLow);

signal(breakoutUp, 'buy', 'Breakout Up', {
  color: '#00FF00',
  shape: 'arrow',
  location: 'below'
});

signal(breakoutDown, 'sell', 'Breakout Down', {
  color: '#FF0000',
  shape: 'arrow',
  location: 'above'
});

alertcondition(breakoutUp, {
  title: 'Breakout Up',
  message: 'Price broke above the {{plot_0}}-bar high'
});

alertcondition(breakoutDown, {
  title: 'Breakout Down',
  message: 'Price broke below the {{plot_0}}-bar low'
});