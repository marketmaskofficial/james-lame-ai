/**
 * AI Builder conversation history is scoped per indicator project
 * (public.indicators.id) so that switching which project's chat is showing
 * never leaks another project's turns into it. The server query itself is
 * already filtered by `indicator_id` (see listIndicatorMessages), but this
 * pure filter is the client-side guard against a stale in-flight query
 * resolving after the user has already switched projects — a real race a
 * naive "just append whatever the query returns" effect would be exposed to.
 */
export type ScopedMessage<T> = { indicatorId: string; message: T };

export function messagesForIndicator<T>(
  all: ScopedMessage<T>[],
  indicatorId: string | null,
): T[] {
  if (!indicatorId) return [];
  return all.filter((m) => m.indicatorId === indicatorId).map((m) => m.message);
}
