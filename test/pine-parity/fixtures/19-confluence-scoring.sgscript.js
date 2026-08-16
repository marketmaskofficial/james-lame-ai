// @name Confluence Scoring Test
// @overlay false

const fastLen = input.int('Fast EMA', 9);
const slowLen = input.int('Slow EMA', 21);

const fastEma = ema(close, fastLen);
const slowEma = ema(close, slowLen);
const rsiVal = rsi(close, 14);

let score = iff(gt(fastEma, slowEma), 1, 0);
score = add(score, iff(gt(close, fastEma), 1, 0));
score = add(score, iff(gt(rsiVal, 50), 1, 0));
score = add(score, iff(lt(rsiVal, 70), 1, 0));
score = sub(score, iff(gt(rsiVal, 80), 1, 0));

const greenScore = iff(gte(score, 3), score, NaN);
const grayScore = iff(lt(score, 3), score, NaN);

hist(grayScore, {
  title: 'Confluence Score',
  color: '#808080',
  opacity: 100
});

hist(greenScore, {
  title: 'Confluence Score',
  color: '#008000',
  opacity: 100
});

hline(3, {
  title: 'Threshold',
  color: '#FFA500',
  pane: true
});