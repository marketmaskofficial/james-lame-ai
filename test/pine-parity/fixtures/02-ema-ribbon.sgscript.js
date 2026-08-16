// @name EMA Ribbon Test
// @overlay true

const len1 = input.int('EMA 1', 9, { min: 1 });
const len2 = input.int('EMA 2', 21, { min: 1 });
const len3 = input.int('EMA 3', 55, { min: 1 });

const ema1 = ema(close, len1);
const ema2 = ema(close, len2);
const ema3 = ema(close, len3);

plot(ema1, { title: 'EMA 9', color: '#00FFFF', width: 1, opacity: 100, style: 'line' });
plot(ema2, { title: 'EMA 21', color: '#FFFF00', width: 1, opacity: 100, style: 'line' });
plot(ema3, { title: 'EMA 55', color: '#800080', width: 1, opacity: 100, style: 'line' });