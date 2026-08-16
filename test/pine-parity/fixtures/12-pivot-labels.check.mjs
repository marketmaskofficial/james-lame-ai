export const category = "drawing";
export const description = "Swing high/low price labels";
export const settings = { Lookback: 8 };

export function check(result, { bars, ref }) {
  const issues = [];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const expectedTotal = ref.pivots(highs, 8).highs.length + ref.pivots(lows, 8).lows.length;

  if (result.labels.length === 0) {
    issues.push(`CRITICAL: zero labels drawn, expected roughly ${expectedTotal} pivot labels`);
  } else if (result.labels.length < expectedTotal * 0.3 || result.labels.length > expectedTotal * 3) {
    issues.push(`label count ${result.labels.length} is far from expected order-of-magnitude ~${expectedTotal}`);
  }

  const withText = result.labels.filter((l) => typeof l.text === "string" && l.text.trim().length > 0);
  if (result.labels.length > 0 && withText.length < result.labels.length) {
    issues.push(`${result.labels.length - withText.length} label(s) have no text — Pine source always sets str.tostring(price)`);
  }

  return issues;
}
