export type AlertCondition = "above" | "below" | "crosses_above" | "crosses_below";

/**
 * `above`/`below` are level conditions — true whenever the current price is
 * already past the threshold, independent of history (unchanged since the
 * original widget; existing `cooldown_seconds` re-arm dedup on the caller
 * side is what stops these from re-firing every poll).
 *
 * `crosses_above`/`crosses_below` are edge conditions — true only on the
 * transition through the threshold, using the previous completed candle's
 * close as "which side price was already on" so an alert doesn't fire
 * immediately just because price already happens to be past the threshold
 * at creation/poll time. `prevClose: null` (fetch failed, or no history)
 * means the side is unknown, so a crossing can't be confirmed — never fires.
 */
export function evaluateCondition(
  condition: AlertCondition,
  price: number,
  threshold: number,
  prevClose: number | null,
): boolean {
  switch (condition) {
    case "above":
      return price >= threshold;
    case "below":
      return price <= threshold;
    case "crosses_above":
      return prevClose !== null && prevClose <= threshold && price > threshold;
    case "crosses_below":
      return prevClose !== null && prevClose >= threshold && price < threshold;
    default:
      return false;
  }
}
