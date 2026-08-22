/**
 * Minimal product telemetry.
 *
 * Records only that a step in the core loop happened, plus a few small
 * non-identifying counters. No prompts, no script source, no prices, no
 * account data. Failures are swallowed — telemetry must never break a flow.
 */

import { recordEvent } from "@/lib/telemetry.functions";

export type TelemetryEvent =
  | "ai_build_started"
  | "ai_build_succeeded"
  | "ai_build_failed"
  | "add_to_chart_succeeded"
  | "add_to_chart_failed"
  | "apply_changes_succeeded"
  | "apply_changes_failed"
  | "patch_succeeded"
  | "patch_failed"
  | "ai_build_failed_validation"
  | "patch_failed_validation"
  | "fix_error_started"
  | "fix_error_succeeded"
  | "fix_error_still_failing"
  | "fix_error_request_failed"
  | "backtest_started"
  | "backtest_succeeded"
  | "backtest_blocked"
  | "backtest_failed"
  | "paper_trade_created";

type Props = Record<string, string | number | boolean>;

export function track(event: TelemetryEvent, props: Props = {}): void {
  try {
    void recordEvent({ data: { event, props } }).catch(() => undefined);
  } catch {
    /* never surface telemetry problems to the user */
  }
}
