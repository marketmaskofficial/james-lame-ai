// @name Repaint Safe Offset Test
// @overlay true

const htf = input.timeframe('Higher Timeframe', '1W')
const htfClose = htfClosed(htf).close

plot(htfClose, {
  title: 'HTF Close (confirmed)',
  color: '#0000FF',
  width: 1,
  opacity: 100,
  style: 'line'
})