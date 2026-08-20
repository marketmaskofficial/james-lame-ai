/**
 * UI-4h-2: Value Area derivation over an already-computed volume profile
 * histogram (see `volumeProfile` in src/lib/sgscript/stdlib.ts — the same
 * OHLCV-bar-range-binning engine SGScript's own `volumeProfile(...)`
 * primitive already uses, reused here rather than duplicated). Pure math, no
 * React/DOM — the widget component calls this over whatever bins it computed.
 *
 * Standard "expand from POC" algorithm: start at the Point of Control (the
 * single highest-volume bin), then repeatedly extend whichever open edge
 * (the bin just above the current top, or just below the current bottom)
 * carries more volume, until the accumulated volume reaches `valueAreaPct`
 * of the total (or both edges are exhausted). This keeps the Value Area a
 * single contiguous price range around the POC, which is what "VAH"/"VAL"
 * mean in every real Volume Profile implementation — picking the top-N
 * highest-volume bins by volume alone (ignoring contiguity) would NOT
 * reproduce that and would be a different, less standard statistic.
 */

export type VolumeProfileBin = { top: number; bottom: number; volume: number };

export type ValueArea = {
  /** Index into `bins` of the Point of Control (highest-volume bin), or -1 if `bins` is empty/all-zero. */
  pocIndex: number;
  /** Point of Control price — the POC bin's midpoint. */
  poc: number;
  /** Value Area High — top of the highest bin included in the Value Area. */
  vah: number;
  /** Value Area Low — bottom of the lowest bin included in the Value Area. */
  val: number;
  /** Actual fraction (0-1) of total volume the returned VAH/VAL range contains — meets or exceeds the requested `valueAreaPct` unless every bin had to be included. */
  actualPct: number;
  /** Total volume summed across every bin (not just the Value Area). */
  totalVolume: number;
};

const EMPTY_VALUE_AREA: ValueArea = { pocIndex: -1, poc: 0, vah: 0, val: 0, actualPct: 0, totalVolume: 0 };

export function computeValueArea(bins: VolumeProfileBin[], valueAreaPct: number): ValueArea {
  if (bins.length === 0) return EMPTY_VALUE_AREA;
  const totalVolume = bins.reduce((sum, b) => sum + b.volume, 0);
  if (totalVolume <= 0) return EMPTY_VALUE_AREA;

  let pocIndex = 0;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].volume > bins[pocIndex].volume) pocIndex = i;
  }

  const target = totalVolume * Math.min(Math.max(valueAreaPct, 0), 1);
  let lowIdx = pocIndex;
  let highIdx = pocIndex;
  let included = bins[pocIndex].volume;

  while (included < target && (lowIdx > 0 || highIdx < bins.length - 1)) {
    const belowVol = lowIdx > 0 ? bins[lowIdx - 1].volume : -1;
    const aboveVol = highIdx < bins.length - 1 ? bins[highIdx + 1].volume : -1;
    if (aboveVol >= belowVol) {
      highIdx++;
      included += bins[highIdx].volume;
    } else {
      lowIdx--;
      included += bins[lowIdx].volume;
    }
  }

  return {
    pocIndex,
    poc: (bins[pocIndex].top + bins[pocIndex].bottom) / 2,
    vah: bins[highIdx].top,
    val: bins[lowIdx].bottom,
    actualPct: included / totalVolume,
    totalVolume,
  };
}
