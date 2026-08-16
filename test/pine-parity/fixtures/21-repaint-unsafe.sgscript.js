// @name Repaint Unsafe Test
// @overlay true

const higherTimeframe = input.timeframe('Higher Timeframe', '1W')
const htfClose = htf(higherTimeframe).close

plot(htfClose, {
  title: 'HTF Close (live, repaints)',
  color: '#FF0000',
  width: 1,
  opacity: 100,
  style: 'line'
})