export const category = "drawing";
export const description = "Pivot-based order blocks: box + label pairs";
export const settings = { "Swing Lookback": 10 };

export function check(result, { bars, ref }) {
  const issues = [];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const expectedHighPivots = ref.pivots(highs, 10).highs.length;
  const expectedLowPivots = ref.pivots(lows, 10).lows.length;
  const expectedTotal = expectedHighPivots + expectedLowPivots;

  if (result.boxes.length === 0) {
    issues.push(`CRITICAL: zero boxes drawn, expected roughly ${expectedTotal} order-block zones`);
  } else if (result.boxes.length < expectedTotal * 0.3 || result.boxes.length > expectedTotal * 3) {
    // Wide tolerance: ta.pivothigh/low's exact tie-breaking can differ subtly
    // from this reference's strict max/min, but the order of magnitude
    // should still line up.
    issues.push(`box count ${result.boxes.length} is far from expected order-of-magnitude ~${expectedTotal}`);
  }

  if (result.labels.length === 0) {
    issues.push("CRITICAL: zero labels drawn — Pine source calls label.new alongside every box.new");
  }

  return issues;
}
