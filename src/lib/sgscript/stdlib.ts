// SGScript standard library: vectorized series math.
// A "series" is a plain number[] aligned 1:1 with the loaded bars; NaN = no value.

export type Series = number[];

const N = NaN;

export function nz(s: Series | number, replacement = 0): Series | number {
  if (typeof s === "number") return Number.isFinite(s) ? s : replacement;
  return s.map((v) => (Number.isFinite(v) ? v : replacement));
}

function asSeries(x: Series | number, len: number): Series {
  return typeof x === "number" ? new Array(len).fill(x) : x;
}

export function op(
  a: Series | number,
  b: Series | number,
  f: (x: number, y: number) => number,
): Series {
  const len = typeof a === "number" ? (b as Series).length : a.length;
  const A = asSeries(a, len);
  const B = asSeries(b, len);
  const out = new Array<number>(len);
  for (let i = 0; i < len; i++) out[i] = f(A[i], B[i]);
  return out;
}

export const add = (a: Series | number, b: Series | number) => op(a, b, (x, y) => x + y);
export const sub = (a: Series | number, b: Series | number) => op(a, b, (x, y) => x - y);
export const mul = (a: Series | number, b: Series | number) => op(a, b, (x, y) => x * y);
export const div = (a: Series | number, b: Series | number) =>
  op(a, b, (x, y) => (y === 0 || !Number.isFinite(y) ? N : x / y));

export function map(s: Series, f: (v: number, i: number) => number): Series {
  return s.map(f);
}

export function offset(s: Series, n: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = 0; i < s.length; i++) {
    const j = i - n;
    if (j >= 0 && j < s.length) out[i] = s[j];
  }
  return out;
}

export function change(s: Series, n = 1): Series {
  return sub(s, offset(s, n));
}

export function sma(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  if (len <= 0) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
    if (i >= len) {
      const old = s[i - len];
      if (Number.isFinite(old)) {
        sum -= old;
        count--;
      }
    }
    if (i >= len - 1 && count === len) out[i] = sum / len;
  }
  return out;
}

export function ema(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  if (len <= 0) return out;
  const k = 2 / (len + 1);
  let prev = N;
  let seeded = 0;
  let seedSum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(prev)) {
      seedSum += v;
      seeded++;
      if (seeded === len) {
        prev = seedSum / len;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rma(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  if (len <= 0) return out;
  let prev = N;
  let seeded = 0;
  let seedSum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(prev)) {
      seedSum += v;
      seeded++;
      if (seeded === len) {
        prev = seedSum / len;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (len - 1) + v) / len;
    out[i] = prev;
  }
  return out;
}

export function wma(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < s.length; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < len; j++) {
      const v = s[i - j];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      acc += v * (len - j);
    }
    if (ok) out[i] = acc / denom;
  }
  return out;
}

export function highest(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = len - 1; i < s.length; i++) {
    let m = -Infinity;
    for (let j = 0; j < len; j++) m = Math.max(m, s[i - j]);
    out[i] = Number.isFinite(m) ? m : N;
  }
  return out;
}

export function lowest(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = len - 1; i < s.length; i++) {
    let m = Infinity;
    for (let j = 0; j < len; j++) m = Math.min(m, s[i - j]);
    out[i] = Number.isFinite(m) ? m : N;
  }
  return out;
}

export function stdev(s: Series, len: number): Series {
  const mean = sma(s, len);
  const out = new Array<number>(s.length).fill(N);
  for (let i = len - 1; i < s.length; i++) {
    const m = mean[i];
    if (!Number.isFinite(m)) continue;
    let acc = 0;
    for (let j = 0; j < len; j++) acc += (s[i - j] - m) ** 2;
    out[i] = Math.sqrt(acc / len);
  }
  return out;
}

export function trueRange(high: Series, low: Series, close: Series): Series {
  const out = new Array<number>(high.length).fill(N);
  for (let i = 0; i < high.length; i++) {
    const pc = i > 0 ? close[i - 1] : N;
    out[i] = Number.isFinite(pc)
      ? Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc))
      : high[i] - low[i];
  }
  return out;
}

export function atr(high: Series, low: Series, close: Series, len: number): Series {
  return rma(trueRange(high, low, close), len);
}

export function rsi(s: Series, len: number): Series {
  const up = new Array<number>(s.length).fill(N);
  const dn = new Array<number>(s.length).fill(N);
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - s[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const ru = rma(up, len);
  const rd = rma(dn, len);
  return op(ru, rd, (u, d) => {
    if (!Number.isFinite(u) || !Number.isFinite(d)) return N;
    if (d === 0) return 100;
    const rs = u / d;
    return 100 - 100 / (1 + rs);
  });
}

export function macd(
  s: Series,
  fast = 12,
  slow = 26,
  signalLen = 9,
): { macd: Series; signal: Series; hist: Series } {
  const m = sub(ema(s, fast), ema(s, slow));
  const sig = ema(m, signalLen);
  return { macd: m, signal: sig, hist: sub(m, sig) };
}

export function bb(s: Series, len: number, mult: number) {
  const basis = sma(s, len);
  const dev = mul(stdev(s, len), mult);
  return { basis, upper: add(basis, dev), lower: sub(basis, dev) };
}

export function crossover(a: Series | number, b: Series | number): boolean[] {
  const len = typeof a === "number" ? (b as Series).length : a.length;
  const A = asSeries(a, len);
  const B = asSeries(b, len);
  const out = new Array<boolean>(len).fill(false);
  for (let i = 1; i < len; i++) {
    out[i] = A[i - 1] <= B[i - 1] && A[i] > B[i];
  }
  return out;
}

export function crossunder(a: Series | number, b: Series | number): boolean[] {
  return crossover(b, a);
}

export function cross(a: Series | number, b: Series | number): boolean[] {
  const x = crossover(a, b);
  const y = crossunder(a, b);
  return x.map((v, i) => v || y[i]);
}

export function pivotHigh(high: Series, left: number, right: number): Series {
  const out = new Array<number>(high.length).fill(N);
  for (let i = left; i < high.length - right; i++) {
    const v = high[i];
    let ok = Number.isFinite(v);
    for (let j = 1; j <= left && ok; j++) if (high[i - j] >= v) ok = false;
    for (let j = 1; j <= right && ok; j++) if (high[i + j] > v) ok = false;
    if (ok) out[i] = v;
  }
  return out;
}

export function pivotLow(low: Series, left: number, right: number): Series {
  const out = new Array<number>(low.length).fill(N);
  for (let i = left; i < low.length - right; i++) {
    const v = low[i];
    let ok = Number.isFinite(v);
    for (let j = 1; j <= left && ok; j++) if (low[i - j] <= v) ok = false;
    for (let j = 1; j <= right && ok; j++) if (low[i + j] < v) ok = false;
    if (ok) out[i] = v;
  }
  return out;
}

export function cum(s: Series): Series {
  const out = new Array<number>(s.length).fill(N);
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    if (Number.isFinite(s[i])) acc += s[i];
    out[i] = acc;
  }
  return out;
}

// Session-anchored VWAP (resets each UTC day by default).
export function vwap(
  hlc3: Series,
  volume: Series,
  time: Series,
  anchorSeconds = 86_400,
): Series {
  const out = new Array<number>(hlc3.length).fill(N);
  let pv = 0;
  let vol = 0;
  let currentAnchor = -1;
  for (let i = 0; i < hlc3.length; i++) {
    const anchor = Math.floor(time[i] / anchorSeconds);
    if (anchor !== currentAnchor) {
      currentAnchor = anchor;
      pv = 0;
      vol = 0;
    }
    const v = Number.isFinite(volume[i]) ? volume[i] : 0;
    pv += hlc3[i] * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : N;
  }
  return out;
}

// Volume profile over a window of bars: returns price bins with traded volume.
export function volumeProfile(
  high: Series,
  low: Series,
  volume: Series,
  from: number,
  to: number,
  bins = 24,
): { top: number; bottom: number; volume: number }[] {
  const lo = Math.min(...low.slice(from, to + 1).filter(Number.isFinite));
  const hi = Math.max(...high.slice(from, to + 1).filter(Number.isFinite));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const step = (hi - lo) / bins;
  const buckets = new Array<number>(bins).fill(0);
  for (let i = from; i <= to; i++) {
    const h = high[i];
    const l = low[i];
    const v = Number.isFinite(volume[i]) ? volume[i] : 0;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
    const startBin = Math.max(0, Math.floor((l - lo) / step));
    const endBin = Math.min(bins - 1, Math.floor((h - lo) / step));
    const span = endBin - startBin + 1;
    for (let b = startBin; b <= endBin; b++) buckets[b] += v / span;
  }
  return buckets.map((vol, b) => ({
    bottom: lo + b * step,
    top: lo + (b + 1) * step,
    volume: vol,
  }));
}

// Resample bars to a higher timeframe and re-align each HTF value back onto
// the chart's bar index, so multi-timeframe logic stays 1:1 with the chart.
export function resample(
  time: Series,
  open: Series,
  high: Series,
  low: Series,
  close: Series,
  volume: Series,
  seconds: number,
): { open: Series; high: Series; low: Series; close: Series; volume: Series } {
  const len = time.length;
  const o = new Array<number>(len).fill(N);
  const h = new Array<number>(len).fill(N);
  const l = new Array<number>(len).fill(N);
  const c = new Array<number>(len).fill(N);
  const v = new Array<number>(len).fill(N);
  let bucket = -1;
  let co = N;
  let ch = -Infinity;
  let cl = Infinity;
  let cv = 0;
  for (let i = 0; i < len; i++) {
    const b = Math.floor(time[i] / seconds);
    if (b !== bucket) {
      bucket = b;
      co = open[i];
      ch = high[i];
      cl = low[i];
      cv = Number.isFinite(volume[i]) ? volume[i] : 0;
    } else {
      ch = Math.max(ch, high[i]);
      cl = Math.min(cl, low[i]);
      cv += Number.isFinite(volume[i]) ? volume[i] : 0;
    }
    o[i] = co;
    h[i] = ch;
    l[i] = cl;
    c[i] = close[i];
    v[i] = cv;
  }
  return { open: o, high: h, low: l, close: c, volume: v };
}

// ---- additional primitives -------------------------------------------------

export function vwma(s: Series, volume: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = len - 1; i < s.length; i++) {
    let pv = 0;
    let v = 0;
    let ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      if (!Number.isFinite(s[j])) { ok = false; break; }
      const vol = Number.isFinite(volume[j]) ? volume[j] : 0;
      pv += s[j] * vol;
      v += vol;
    }
    out[i] = ok && v > 0 ? pv / v : N;
  }
  return out;
}

export function variance(s: Series, len: number): Series {
  const sd = stdev(s, len);
  return sd.map((v) => (Number.isFinite(v) ? v * v : N));
}

export function roc(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = len; i < s.length; i++) {
    const prev = s[i - len];
    out[i] = Number.isFinite(prev) && prev !== 0 ? ((s[i] - prev) / prev) * 100 : N;
  }
  return out;
}

export function momentum(s: Series, len: number): Series {
  const out = new Array<number>(s.length).fill(N);
  for (let i = len; i < s.length; i++) out[i] = s[i] - s[i - len];
  return out;
}

export function stoch(
  high: Series,
  low: Series,
  close: Series,
  kLen: number,
  kSmooth = 3,
  dSmooth = 3,
): { k: Series; d: Series } {
  const hh = highest(high, kLen);
  const ll = lowest(low, kLen);
  const raw = close.map((c, i) => {
    const range = hh[i] - ll[i];
    return Number.isFinite(range) && range !== 0 ? ((c - ll[i]) / range) * 100 : N;
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

export function correlation(a: Series, b: Series, len: number): Series {
  const out = new Array<number>(a.length).fill(N);
  for (let i = len - 1; i < a.length; i++) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let j = i - len + 1; j <= i; j++) {
      if (!Number.isFinite(a[j]) || !Number.isFinite(b[j])) continue;
      sa += a[j]; sb += b[j];
      saa += a[j] * a[j]; sbb += b[j] * b[j];
      sab += a[j] * b[j];
      n++;
    }
    if (n < 2) continue;
    const num = n * sab - sa * sb;
    const den = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
    out[i] = den !== 0 ? num / den : N;
  }
  return out;
}

/** Boolean helpers so scripts don't hand-roll loops for combined conditions. */
export const and = (...m: boolean[][]) =>
  m[0].map((_, i) => m.every((x) => x[i]));
export const or = (...m: boolean[][]) =>
  m[0].map((_, i) => m.some((x) => x[i]));
export const not = (m: boolean[]) => m.map((v) => !v);

/** True for `bars` bars after each true value (inclusive window). */
export function within(mask: boolean[], bars: number): boolean[] {
  const out = new Array<boolean>(mask.length).fill(false);
  let age = Infinity;
  for (let i = 0; i < mask.length; i++) {
    age = mask[i] ? 0 : age + 1;
    out[i] = age <= bars;
  }
  return out;
}

/** Latches true from the first true value until `reset` fires. */
export function latch(set: boolean[], reset: boolean[]): boolean[] {
  const out = new Array<boolean>(set.length).fill(false);
  let on = false;
  for (let i = 0; i < set.length; i++) {
    if (reset[i]) on = false;
    if (set[i]) on = true;
    out[i] = on;
  }
  return out;
}

// ---- element-wise comparison / boolean logic -------------------------------
// Series comparisons must be vectorized: `close > ma` is meaningless in JS on
// arrays, so scripts use gt(close, ma) etc. All six comparators (plus aliases)
// are generated from one implementation so the family stays consistent.

type Cmp = (x: number, y: number) => boolean;

function cmpOp(a: Series | number, b: Series | number, f: Cmp): boolean[] {
  const len = typeof a === "number" ? (b as Series).length : a.length;
  const A = asSeries(a, len);
  const B = asSeries(b, len);
  const out = new Array<boolean>(len).fill(false);
  for (let i = 0; i < len; i++) {
    const x = A[i];
    const y = B[i];
    out[i] = Number.isFinite(x) && Number.isFinite(y) ? f(x, y) : false;
  }
  return out;
}

export const gt = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x > y);
export const lt = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x < y);
export const gte = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x >= y);
export const lte = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x <= y);
export const eq = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x === y);
export const neq = (a: Series | number, b: Series | number) => cmpOp(a, b, (x, y) => x !== y);
// Pine-style aliases
export const ge = gte;
export const le = lte;
export const ne = neq;
export const above = gt;
export const below = lt;

function asBools(x: boolean[] | boolean, len: number): boolean[] {
  return typeof x === "boolean" ? new Array<boolean>(len).fill(x) : x;
}

/** Element-wise ternary: iff(cond, whenTrue, whenFalse) -> Series. */
export function iff(
  cond: boolean[] | boolean,
  a: Series | number,
  b: Series | number,
): Series {
  const len = Array.isArray(cond)
    ? cond.length
    : typeof a === "number"
      ? (b as Series).length
      : (a as Series).length;
  const C = asBools(cond, len);
  const A = asSeries(a, len);
  const B = asSeries(b, len);
  const out = new Array<number>(len).fill(N);
  for (let i = 0; i < len; i++) out[i] = C[i] ? A[i] : B[i];
  return out;
}
