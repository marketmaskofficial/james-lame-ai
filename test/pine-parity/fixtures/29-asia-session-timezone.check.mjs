import { generateIntradayBars } from "../bars.mjs";

export const category = "drawing";
export const description =
  "Exact reproduction of the reported bug: BTCUSDT-style 15m bars, an Asia session (20:00-00:00) defined in a named timezone (America/New_York) via Pine's time(tf, session, timezone) three-arg form. Exact expected box/label coordinates computed independently via Intl.DateTimeFormat (a completely different NY-time conversion method than whatever the AI translation uses internally), not approximated.";

// Session boundaries only mean something against real timestamps -
// generate BTCUSDT-style continuous 15m bars (crypto trades 24/7, so no
// exchange-hours gaps to account for). sessionStartHour/EndHour here are
// UTC and only pick the drift regime for realistic price data; the actual
// session boundary this fixture checks is computed independently below via
// the real America/New_York timezone, not these hours.
export const bars = generateIntradayBars(500, 7, { intervalMinutes: 15, sessionStartHour: 1, sessionEndHour: 5 });

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});

/** True if `time` (unix seconds) falls in the 20:00-24:00 America/New_York local hour window. */
function inAsiaSessionNY(time) {
  const parts = nyFormatter.formatToParts(new Date(time * 1000));
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number(hourPart) % 24; // Intl can return "24" for midnight depending on locale
  return hour >= 20;
}

function expectedBoxesAndLabels(bars) {
  const inSession = bars.map((b) => inAsiaSessionNY(b.time));
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
      boxes.push({ time1: bars[sessStartBar].time, time2: bars[i].time, price1: sessHigh, price2: sessLow });
      labels.push({ time: bars[sessStartBar].time, price: sessHigh, text: "Asia Session" });
    }
  }
  return { boxes, labels };
}

function approxEq(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

export function check(result) {
  const issues = [];
  const expected = expectedBoxesAndLabels(bars);

  if (expected.boxes.length === 0) {
    issues.push("test setup bug: independent reference itself computed zero sessions — fixture data doesn't span a full session, fix the fixture");
    return issues;
  }

  if (result.boxes.length === 0) {
    issues.push(
      `CRITICAL: zero boxes created, expected exactly ${expected.boxes.length} (timezone-aware Asia session, one per day across ${bars.length} 15m bars)`,
    );
  } else if (result.boxes.length !== expected.boxes.length) {
    issues.push(`box count ${result.boxes.length} != expected ${expected.boxes.length}`);
  }
  if (result.labels.length === 0 && expected.labels.length > 0) {
    issues.push(`CRITICAL: zero labels created, expected exactly ${expected.labels.length}`);
  } else if (result.labels.length !== expected.labels.length) {
    issues.push(`label count ${result.labels.length} != expected ${expected.labels.length}`);
  }

  const boxByStart = new Map(result.boxes.map((b) => [b.time1, b]));
  let boxMismatches = 0;
  const details = [];
  for (const exp of expected.boxes) {
    const got = boxByStart.get(exp.time1);
    if (!got) {
      boxMismatches++;
      details.push(`no box with time1=${exp.time1} (${new Date(exp.time1 * 1000).toISOString()})`);
      continue;
    }
    const problems = [];
    if (got.time2 !== exp.time2) problems.push(`time2 ${got.time2} != ${exp.time2}`);
    if (!approxEq(got.price1, exp.price1)) problems.push(`price1 ${got.price1} != ${exp.price1}`);
    if (!approxEq(got.price2, exp.price2)) problems.push(`price2 ${got.price2} != ${exp.price2}`);
    if (problems.length) {
      boxMismatches++;
      details.push(`box@${exp.time1}: ${problems.join(", ")}`);
    }
  }
  if (boxMismatches > 0) {
    issues.push(`${boxMismatches}/${expected.boxes.length} boxes wrong: ${details.slice(0, 5).join(" | ")}`);
  }

  // Every box/label must fall within the loaded bar range (the other class
  // of bug this whole investigation is about: valid-looking coordinates
  // that are nonetheless outside what the chart has loaded).
  const minTime = bars[0].time;
  const maxTime = bars[bars.length - 1].time;
  const outOfRange = result.boxes.filter((b) => b.time1 < minTime || b.time2 > maxTime);
  if (outOfRange.length > 0) {
    issues.push(`${outOfRange.length} box(es) have coordinates outside the loaded bar range [${minTime}, ${maxTime}]`);
  }

  return issues;
}
