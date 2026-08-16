export const category = "language-features";
export const description = "Pine v6 user-defined type (type SwingPoint) + method (isRecent), ported into SGScript's plain-JS object/function subset";
export const settings = { Lookback: 10 };

export function check(result, { bars, ref }) {
  const issues = [];
  const highs = bars.map((b) => b.high);
  const expectedHighPivots = ref.pivots(highs, 10).highs.length;

  if (result.markers.length === 0 && expectedHighPivots > 0) {
    issues.push(`CRITICAL: zero markers, expected roughly ${expectedHighPivots} pivot-high markers (the UDT/method logic reduces to "mark every confirmed pivot high" in this fixture)`);
  } else if (result.markers.length < expectedHighPivots * 0.3 || result.markers.length > expectedHighPivots * 3) {
    issues.push(`marker count ${result.markers.length} is far from expected order-of-magnitude ~${expectedHighPivots}`);
  }

  return issues;
}
