export const category = "drawing";
export const description = "Fair Value Gap zones as persistent box() rectangles — the exact bug reported and fixed in this session (box.new was silently downgraded to a signal() marker)";

export function check(result, { bars, ref }) {
  const issues = [];
  const expectedGaps = ref.fairValueGaps(bars);

  if (result.boxes.length === 0) {
    issues.push(
      `CRITICAL: zero boxes drawn (this is the known regression — box.new getting downgraded to markers). Expected ~${expectedGaps.length} FVG zones.`,
    );
    return issues;
  }

  const lowRatio = 0.5;
  const highRatio = 2.0;
  if (result.boxes.length < expectedGaps.length * lowRatio || result.boxes.length > expectedGaps.length * highRatio) {
    issues.push(
      `box count ${result.boxes.length} is far from the expected ~${expectedGaps.length} FVGs (independently computed from low[i]>high[i-2] / high[i]<low[i-2])`,
    );
  }

  const badCoords = result.boxes.filter(
    (b) => !Number.isFinite(b.price1) || !Number.isFinite(b.price2) || !Number.isFinite(b.time1) || !Number.isFinite(b.time2),
  );
  if (badCoords.length > 0) issues.push(`${badCoords.length} box(es) have non-finite coordinates`);

  const zeroHeight = result.boxes.filter((b) => Math.abs(b.price1 - b.price2) < 1e-9);
  if (zeroHeight.length === result.boxes.length) issues.push("every box has zero height (top === bottom)");

  return issues;
}
