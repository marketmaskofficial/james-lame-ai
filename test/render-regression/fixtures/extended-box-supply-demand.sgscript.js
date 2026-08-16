// @name Test Supply Demand Zone
// @overlay true
//
// Deliberately not derived from a Pine fixture: this exists solely to
// exercise box.extend === "right" (a zone that starts at a fixed bar and
// extends to the current edge of the chart, e.g. an unmitigated supply/
// demand zone), which none of the pine-parity fixtures cover.

const swingIdx = 20;

box(high[swingIdx], low[swingIdx], swingIdx, swingIdx + 1, {
  color: 'rgba(249,115,22,0.25)',
  borderColor: '#f97316',
  extend: 'right',
});
