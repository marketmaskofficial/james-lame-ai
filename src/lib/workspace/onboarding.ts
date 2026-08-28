/**
 * UI-8 first-run onboarding's only piece of workspace-specific logic:
 * turning "the user picked preset X and primary market Y" into the exact
 * same local persistence write the existing Layouts menu already produces
 * when a signed-in OR guest user manually switches to a preset
 * (studio.tsx's `switchToPreset`, which sets `activeLayoutId:
 * CURRENT_LAYOUT_ID` and lets the store-mirror effect write `currentLayout`
 * to localStorage). Writing it directly here — BEFORE Chart Studio's real
 * workspace component ever mounts for this session — means that component
 * needs zero onboarding-specific code: its existing mount effect
 * (`loadLocalStore` -> `initialWorkspaceLayout`) just finds this value like
 * it would any other prior customization.
 */
import type { LayoutNode, WorkspaceLayout } from "./types";
import { PRESETS, type PresetId } from "./presets";
import { defaultLocalStore, saveLocalStore, CURRENT_LAYOUT_ID } from "./persistence";

/** Returns a deep clone of `layout` with every "chart" widget's starting
 * symbol overridden to `symbol` (interval/chartType/settings untouched). */
export function withStartingSymbol(layout: WorkspaceLayout, symbol: string): WorkspaceLayout {
  function walk(node: LayoutNode): LayoutNode {
    if (node.kind === "tabs") {
      return {
        ...node,
        tabs: node.tabs.map((t) =>
          t.widgetTypeId === "chart" && t.chartConfig
            ? { ...t, chartConfig: { ...t.chartConfig, symbol } }
            : t,
        ),
      };
    }
    return { ...node, children: node.children.map(walk) };
  }
  return { ...layout, root: walk(layout.root) };
}

/** Applies the onboarding flow's chosen preset + primary market as the
 * workspace this browser loads next, exactly as if the user had opened the
 * Layouts menu and switched presets themselves. Local-only, same as every
 * other guest/first-session customization in this app — cloud sync (for
 * signed-in users) only ever engages when the user explicitly saves a named
 * layout, unaffected by this. */
export function applyOnboardingWorkspaceChoice(presetId: PresetId, primarySymbol: string): void {
  const chosen = withStartingSymbol(PRESETS[presetId], primarySymbol);
  saveLocalStore({
    ...defaultLocalStore(),
    currentLayout: chosen,
    activeLayoutId: CURRENT_LAYOUT_ID,
  });
}
