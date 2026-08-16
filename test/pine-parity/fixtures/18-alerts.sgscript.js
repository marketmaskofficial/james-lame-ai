// @name Breakout Alerts Test
// @overlay true

const len = input.int('Breakout Length', 20, { min: 1 });

const highestHigh = highest(high, len);
const lowestLow = lowest(low, len);

const breakoutUp = gte(close, highestHigh);
const breakoutDown = lte(close, lowestLow);

signal(breakoutUp, 'buy', 'Price broke above the breakout high', {
  color: '#4CAF50',
  shape: 'arrow',
  location: 'below'
});

signal(breakoutDown, 'sell', 'Price broke below the breakout low', {
  color: '#F23645',
  shape: 'arrow',
  location: 'above'
});