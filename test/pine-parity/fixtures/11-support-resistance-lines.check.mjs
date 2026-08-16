export const category = "drawing";
export const description = "Horizontal support/resistance rays from pivots";
export const settings = { "Pivot Lookback": 15 };

export function check(result, { bars, ref }) {
  const issues = [];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const expectedTotal = ref.pivots(highs, 15).highs.length + ref.pivots(lows, 15).lows.length;

  if (result.lines.length === 0) {
    issues.push(`CRITICAL: zero lines drawn, expected roughly ${expectedTotal} S/R rays`);
  } else if (result.lines.length < expectedTotal * 0.3 || result.lines.length > expectedTotal * 3) {
    issues.push(`line count ${result.lines.length} is far from expected order-of-magnitude ~${expectedTotal}`);
  }

  const extendRight = result.lines.filter((l) => l.extend === "right");
  if (result.lines.length > 0 && extendRight.length === 0) {
    issues.push("Pine source uses extend=extend.right on every line, but none of the output lines have extend:'right'");
  }

  return issues;
}
