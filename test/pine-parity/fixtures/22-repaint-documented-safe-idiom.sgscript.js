// @name Repaint Documented Safe Idiom Test
// @overlay true

const htf = input.timeframe('Higher Timeframe', '1W')
const htfClose = htfClosed(htf).close

plot(htfClose, {
  title: 'HTF Close (confirmed via [1] + lookahead_on)',
  color: '#0000FF',
  width: 1,
  opacity: 1,
  style: 'line'
})