// Trading primitives on top of the SGScript stdlib: sessions, previous-period
// levels, market structure, fair value gaps and liquidity sweeps.
//
// These are generic building blocks, not indicator templates — the AI composes
// them so new ICT/SMC combinations never need a hard-coded recipe.

type Series = number[];
const N = NaN;

export type Swing = { index: number; price: number; kind: "high" | "low" };
export type Gap = {
  from: number;
  to: number;
  top: number;
  bottom: number;
  side: "bull" | "bear";
};
export type StructureEvent = {
  index: number;
  price: number;
  type: "BOS" | "CHoCH";
  side: "bull" | "bear";
};

// ---------- time & sessions -------------------------------------------------

/** UTC minutes since midnight for each bar. */
export function minuteOfDay(time: Series): Series {
  return time.map((t) => {
    const d = new Date(t * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  });
}

export function dayIndex(time: Series): Series {
  return time.map((t) => Math.floor(t / 86400));
}

/**
 * Boolean mask for a UTC session window, e.g. session(time, '07:00', '10:00').
 * Windows that wrap midnight (Asia) are handled.
 *
 * Deliberately tolerant about how the window is written, because generated
 * scripts use every Pine-ish spelling: '07:00'/'0700', a single '0700-1000'
 * range, and a trailing day-mask like '0930-1600:23456'.
 */
export function session(
  time: Series,
  start: string,
  end?: string,
): boolean[] {
  const parseMinutes = (s: string): number => {
    const clean = String(s).trim();
    if (clean.includes(":")) {
      const [h, m] = clean.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    }
    const digits = clean.replace(/\D/g, "").padStart(4, "0");
    return Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
  };

  // Drop a trailing day-mask ('0930-1600:23456') before anything else.
  const strip = (s: string) => {
    const m = /^(\d{1,2}:\d{2}|\d{3,4})/.exec(String(s).trim());
    return m ? m[1]! : "";
  };
  let from = typeof start === "string" ? start.trim() : "";
  let to = typeof end === "string" ? end.trim() : "";
  if (!to) {
    // Single-string form: '0700-1000' or '07:00-10:00'.
    const parts = from.split(/[-–]/);
    if (parts.length >= 2) {
      from = parts[0]!;
      to = parts[1]!;
    }
  }
  from = strip(from);
  to = strip(to);
  if (!from || !to) return time.map(() => false);


  const a = parseMinutes(from);
  const b = parseMinutes(to);
  const mins = minuteOfDay(time);
  return mins.map((m) => (a <= b ? m >= a && m < b : m >= a || m < b));
}


/** True on the first bar of each contiguous true-run of a mask. */
export function firstOf(mask: boolean[]): boolean[] {
  return mask.map((v, i) => v && !(i > 0 && mask[i - 1]));
}

/** Running high/low of the current true-run of a mask (NaN outside). */
export function sessionRange(
  mask: boolean[],
  high: Series,
  low: Series,
): { high: Series; low: Series } {
  const len = mask.length;
  const h = new Array<number>(len).fill(N);
  const l = new Array<number>(len).fill(N);
  let ch = -Infinity;
  let cl = Infinity;
  for (let i = 0; i < len; i++) {
    if (!mask[i]) {
      ch = -Infinity;
      cl = Infinity;
      continue;
    }
    if (i === 0 || !mask[i - 1]) {
      ch = high[i];
      cl = low[i];
    } else {
      ch = Math.max(ch, high[i]);
      cl = Math.min(cl, low[i]);
    }
    h[i] = ch;
    l[i] = cl;
  }
  return { high: h, low: l };
}

/**
 * High/low/close of the previous COMPLETED period (day/week/month), carried
 * forward on every bar of the current period.
 */
export function previousPeriod(
  time: Series,
  high: Series,
  low: Series,
  close: Series,
  period: "day" | "week" | "month",
): { high: Series; low: Series; close: Series } {
  const key = (t: number) => {
    const d = new Date(t * 1000);
    if (period === "day") return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (period === "month") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const monday = new Date(d);
    const wd = (d.getUTCDay() + 6) % 7;
    monday.setUTCDate(d.getUTCDate() - wd);
    return `w${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`;
  };
  const len = time.length;
  const ph = new Array<number>(len).fill(N);
  const pl = new Array<number>(len).fill(N);
  const pc = new Array<number>(len).fill(N);
  let cur = key(time[0]);
  let ch = high[0];
  let cl = low[0];
  let cc = close[0];
  let prevH = N;
  let prevL = N;
  let prevC = N;
  for (let i = 0; i < len; i++) {
    const k = key(time[i]);
    if (k !== cur) {
      prevH = ch;
      prevL = cl;
      prevC = cc;
      cur = k;
      ch = high[i];
      cl = low[i];
    } else {
      ch = Math.max(ch, high[i]);
      cl = Math.min(cl, low[i]);
    }
    cc = close[i];
    ph[i] = prevH;
    pl[i] = prevL;
    pc[i] = prevC;
  }
  return { high: ph, low: pl, close: pc };
}

/**
 * Higher-timeframe values from the last CLOSED HTF candle only — no future
 * leak, no forming-candle values. Aligned back onto chart bars.
 */
export function htfClosed(
  time: Series,
  open: Series,
  high: Series,
  low: Series,
  close: Series,
  seconds: number,
): { open: Series; high: Series; low: Series; close: Series } {
  const len = time.length;
  const o = new Array<number>(len).fill(N);
  const h = new Array<number>(len).fill(N);
  const l = new Array<number>(len).fill(N);
  const c = new Array<number>(len).fill(N);
  let bucket = Math.floor(time[0] / seconds);
  let co = open[0];
  let ch = high[0];
  let cl = low[0];
  let cc = close[0];
  let po = N;
  let ph = N;
  let pl = N;
  let pc = N;
  for (let i = 0; i < len; i++) {
    const b = Math.floor(time[i] / seconds);
    if (b !== bucket) {
      po = co;
      ph = ch;
      pl = cl;
      pc = cc;
      bucket = b;
      co = open[i];
      ch = high[i];
      cl = low[i];
    } else {
      ch = Math.max(ch, high[i]);
      cl = Math.min(cl, low[i]);
    }
    cc = close[i];
    o[i] = po;
    h[i] = ph;
    l[i] = pl;
    c[i] = pc;
  }
  return { open: o, high: h, low: l, close: c };
}

// ---------- structure -------------------------------------------------------

/** Confirmed swing points (a pivot only exists once `right` bars closed). */
export function swings(high: Series, low: Series, left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  const len = high.length;
  for (let i = left; i < len - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (high[j] >= high[i]) isHigh = false;
      if (low[j] <= low[i]) isLow = false;
    }
    if (isHigh) out.push({ index: i + right, price: high[i], kind: "high" });
    if (isLow) out.push({ index: i + right, price: low[i], kind: "low" });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Break of structure / change of character, derived from confirmed swings and
 * closes. Events are stamped on the bar that closed through the level.
 */
export function marketStructure(
  high: Series,
  low: Series,
  close: Series,
  left = 3,
  right = 3,
): StructureEvent[] {
  const sw = swings(high, low, left, right);
  const events: StructureEvent[] = [];
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let trend: "bull" | "bear" | null = null;
  let s = 0;
  for (let i = 0; i < close.length; i++) {
    while (s < sw.length && sw[s].index <= i) {
      if (sw[s].kind === "high") lastHigh = sw[s];
      else lastLow = sw[s];
      s++;
    }
    if (lastHigh && close[i] > lastHigh.price) {
      const type = trend === "bear" ? "CHoCH" : "BOS";
      events.push({ index: i, price: lastHigh.price, type, side: "bull" });
      trend = "bull";
      lastHigh = null;
    } else if (lastLow && close[i] < lastLow.price) {
      const type = trend === "bull" ? "CHoCH" : "BOS";
      events.push({ index: i, price: lastLow.price, type, side: "bear" });
      trend = "bear";
      lastLow = null;
    }
  }
  return events;
}

/** Fair value gaps (3-candle imbalance). `to` extends until mitigated. */
export function fvg(
  high: Series,
  low: Series,
  extend = 200,
): Gap[] {
  const out: Gap[] = [];
  for (let i = 2; i < high.length; i++) {
    if (low[i] > high[i - 2]) {
      out.push({ from: i - 1, to: Math.min(high.length - 1, i + extend), top: low[i], bottom: high[i - 2], side: "bull" });
    } else if (high[i] < low[i - 2]) {
      out.push({ from: i - 1, to: Math.min(high.length - 1, i + extend), top: low[i - 2], bottom: high[i], side: "bear" });
    }
  }
  // Truncate each gap at its first mitigation.
  for (const g of out) {
    for (let i = g.from + 2; i <= g.to; i++) {
      const filled = g.side === "bull" ? low[i] <= g.bottom : high[i] >= g.top;
      if (filled) {
        g.to = i;
        break;
      }
    }
  }
  return out;
}

/** Inverse FVGs: gaps that were traded fully through and now act as opposite. */
export function inverseFvg(high: Series, low: Series, close: Series): Gap[] {
  return fvg(high, low).filter((g) =>
    g.side === "bull" ? close[g.to] < g.bottom : close[g.to] > g.top,
  );
}

/**
 * Liquidity sweeps: wick takes a reference level but the bar closes back
 * inside. `level` is a per-bar series (e.g. previous day low, Asia high).
 */
export function sweep(
  high: Series,
  low: Series,
  close: Series,
  level: Series,
  direction: "above" | "below",
): boolean[] {
  return close.map((c, i) => {
    const lv = level[i];
    if (!Number.isFinite(lv)) return false;
    return direction === "above" ? high[i] > lv && c < lv : low[i] < lv && c > lv;
  });
}

/** Displacement: an unusually large body relative to recent average range. */
export function displacement(
  open: Series,
  close: Series,
  atr: Series,
  mult = 1.5,
): boolean[] {
  return close.map((c, i) =>
    Number.isFinite(atr[i]) ? Math.abs(c - open[i]) > atr[i] * mult : false,
  );
}

/** Premium/discount position of price inside a range (0 = low, 1 = high). */
export function premiumDiscount(
  close: Series,
  rangeHigh: Series,
  rangeLow: Series,
): Series {
  return close.map((c, i) => {
    const h = rangeHigh[i];
    const l = rangeLow[i];
    return Number.isFinite(h) && Number.isFinite(l) && h > l ? (c - l) / (h - l) : N;
  });
}

/** Order blocks: last opposite candle before a displacement move. */
export function orderBlocks(
  open: Series,
  high: Series,
  low: Series,
  close: Series,
  disp: boolean[],
): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < close.length; i++) {
    if (!disp[i]) continue;
    const bull = close[i] > open[i];
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      const opposite = bull ? close[j] < open[j] : close[j] > open[j];
      if (opposite) {
        out.push({
          from: j,
          to: Math.min(close.length - 1, i + 100),
          top: high[j],
          bottom: low[j],
          side: bull ? "bull" : "bear",
        });
        break;
      }
    }
  }
  return out;
}

/** Only allow the first `max` true values inside each true-run of `scope`. */
export function limitPerScope(
  signal: boolean[],
  scope: boolean[],
  max = 1,
): boolean[] {
  const out = new Array<boolean>(signal.length).fill(false);
  let count = 0;
  for (let i = 0; i < signal.length; i++) {
    if (!scope[i]) {
      count = 0;
      continue;
    }
    if (i > 0 && !scope[i - 1]) count = 0;
    if (signal[i] && count < max) {
      out[i] = true;
      count++;
    }
  }
  return out;
}
