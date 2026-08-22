import type { IndicatorSpec } from "./types";

/**
 * Derives the settings object a freshly built/modified indicator should
 * snapshot: each declared input's own default, keyed by name — the same
 * shape `settings` already takes everywhere else (indicators.settings /
 * indicator_versions.settings), so a version created straight off a
 * successful build carries sensible defaults even before the user has
 * touched the settings editor.
 */
export function defaultSettingsFromSpec(
  spec: IndicatorSpec,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const input of spec.inputs) {
    out[input.name] = input.default;
  }
  return out;
}
