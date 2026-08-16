// @name Bollinger Bands Test
// @overlay true

const len = input.int('Length', 20, { min: 1 });
const mult = input.float('Mult', 2.0);

const basis = sma(close, len);
const dev = mul(stdev(close, len), mult);
const upper = add(basis, dev);
const lower = sub(basis, dev);

plot(basis, {
  title: 'Basis',
  color: '#FF9800',
  width: 1,
  style: 'line'
});

const p1 = plot(upper, {
  title: 'Upper',
  color: '#2196F3',
  width: 1,
  style: 'line'
});

const p2 = plot(lower, {
  title: 'Lower',
  color: '#2196F3',
  width: 1,
  style: 'line'
});

fill(p1, p2, '#2196F3', 90);