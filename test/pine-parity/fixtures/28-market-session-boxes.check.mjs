import { generateIntradayHourlyBars } from "../bars.mjs";

export const category = "drawing";
export const description =
  "Market Session Boxes: one box + one label per trading session (09:30-16:00 UTC), spanning session start to session end. Exact expected coordinates computed independently below by replicating the Pine source's session-tracking state machine bar-by-bar against real timestamps — not approximated, not derived from the runtime's own output.";

// Session logic needs real time-of-day boundaries; the shared daily bars are
// all midnight timestamps, so this fixture supplies its own intraday set.
export const bars = generateIntradayHourlyBars(500, 42, { sessionStartHour: 9, sessionEndHour: 16 });

/**
 * Independent reference implementation of the Pine source's state machine:
 *   inSession = minuteOfDay in [09:30, 16:00)
 *   newSession = inSession && !inSession[i-1]
 *   endSession = !inSession && inSession[i-1]
 *   sessHigh/sessLow accumulate from newSession through the bar before endSession
 *   on endSession: box(sessHigh, sessLow, sessStartBar, i), label(sessStartBar, sessHigh, "Session")
 *
 * session('09:30','16:00') is minute-of-day >= 570 && < 960. On these
 * on-the-hour bars that's exactly hour >= 10 && hour < 16 (the 09:00 bar's
 * minute-of-day is 540, before 09:30, so it's excluded) — verified against
 * smc.ts's session()/minuteOfDay() source directly, not assumed.
 */
function expectedBoxesAndLabels(bars) {
  const inSession = bars.map((b) => {
    const h = new Date(b.time * 1000).getUTCHours();
    return h >= 10 && h < 16;
  });

  const boxes = [];
  const labels = [];
  let sessHigh = NaN;
  let sessLow = NaN;
  let sessStartBar = NaN;

  for (let i = 1; i < bars.length; i++) {
    const newSession = inSession[i] && !inSession[i - 1];
    const endSession = !inSession[i] && inSession[i - 1];

    if (newSession) {
      sessHigh = bars[i].high;
      sessLow = bars[i].low;
      sessStartBar = i;
    } else if (inSession[i]) {
      sessHigh = Math.max(sessHigh, bars[i].high);
      sessLow = Math.min(sessLow, bars[i].low);
    }

    if (endSession && Number.isFinite(sessStartBar)) {
      boxes.push({
        time1: bars[sessStartBar].time,
        time2: bars[i].time,
        price1: sessHigh,
        price2: sessLow,
      });
      labels.push({
        time: bars[sessStartBar].time,
        price: sessHigh,
        text: "Session",
      });
    }
  }
  return { boxes, labels };
}

function approxEq(a, b, tol = 0.01) {
  return Math.abs(a - b) <= tol;
}

export function check(result) {
  const issues = [];
  const expected = expectedBoxesAndLabels(bars);

  if (result.boxes.length === 0 && expected.boxes.length > 0) {
    issues.push(
      `CRITICAL: zero boxes created, expected exactly ${expected.boxes.length} (one per complete session in the loaded 500 bars)`,
    );
  } else if (result.boxes.length !== expected.boxes.length) {
    issues.push(`box count ${result.boxes.length} != expected ${expected.boxes.length}`);
  }

  if (result.labels.length === 0 && expected.labels.length > 0) {
    issues.push(`CRITICAL: zero labels created, expected exactly ${expected.labels.length}`);
  } else if (result.labels.length !== expected.labels.length) {
    issues.push(`label count ${result.labels.length} != expected ${expected.labels.length}`);
  }

  // Match by time1 (session start) rather than assuming array order, so an
  // ordering difference doesn't masquerade as a coordinate bug.
  const boxByStart = new Map(result.boxes.map((b) => [b.time1, b]));
  let boxMismatches = 0;
  const boxDetails = [];
  for (const exp of expected.boxes) {
    const got = boxByStart.get(exp.time1);
    if (!got) {
      boxMismatches++;
      boxDetails.push(`no box with time1=${exp.time1} (${new Date(exp.time1 * 1000).toISOString()})`);
      continue;
    }
    const problems = [];
    if (got.time2 !== exp.time2) problems.push(`time2 ${got.time2} != ${exp.time2}`);
    if (!approxEq(got.price1, exp.price1)) problems.push(`price1(top) ${got.price1} != ${exp.price1}`);
    if (!approxEq(got.price2, exp.price2)) problems.push(`price2(bottom) ${got.price2} != ${exp.price2}`);
    if (problems.length) {
      boxMismatches++;
      boxDetails.push(`box@${exp.time1}: ${problems.join(", ")}`);
    }
  }
  if (boxMismatches > 0) {
    issues.push(`${boxMismatches}/${expected.boxes.length} boxes have wrong coordinates: ${boxDetails.slice(0, 5).join(" | ")}`);
  }

  const labelByTime = new Map(result.labels.map((l) => [l.time, l]));
  let labelMismatches = 0;
  const labelDetails = [];
  for (const exp of expected.labels) {
    const got = labelByTime.get(exp.time);
    if (!got) {
      labelMismatches++;
      labelDetails.push(`no label at time=${exp.time} (${new Date(exp.time * 1000).toISOString()})`);
      continue;
    }
    const problems = [];
    if (!approxEq(got.price, exp.price)) problems.push(`price ${got.price} != ${exp.price}`);
    if (got.text !== exp.text) problems.push(`text "${got.text}" != "${exp.text}"`);
    if (problems.length) {
      labelMismatches++;
      labelDetails.push(`label@${exp.time}: ${problems.join(", ")}`);
    }
  }
  if (labelMismatches > 0) {
    issues.push(`${labelMismatches}/${expected.labels.length} labels have wrong values: ${labelDetails.slice(0, 5).join(" | ")}`);
  }

  return issues;
}
