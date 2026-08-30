import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AppNavRail } from "@/components/AppNavRail";
import { canSubmitValidate } from "@/lib/builder/generationState";
import { BuilderToolbar } from "./BuilderToolbar";
import { ChatPanel } from "./ChatPanel";
import { CodeEditorPanel } from "./CodeEditorPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useBuilderProject } from "./useBuilderProject";

/**
 * Phase 5A-1 — the dedicated Indicator Builder workspace shell.
 *
 * Purpose-built and simpler than Chart Studio's `WorkspaceLayout`/
 * `LayoutNode` dockable-widget tree (`src/lib/workspace/types.ts`) on
 * purpose, per the Phase 5A audit: Builder's regions are conceptually
 * fixed (chat / code / preview), not a general arbitrary-widget desk, so
 * it uses the plain `react-resizable-panels` primitives directly
 * (`src/components/ui/resizable.tsx` — already a dependency of this repo,
 * previously unused) rather than importing any of Chart Studio's
 * workspace infrastructure. No floating windows, no drag-to-dock, no
 * nested layout tree.
 *
 * >=1024 (Tailwind `lg:`): the three-panel resizable desktop workspace.
 * <1024: a tabbed workspace (Chat/Code/Preview/Settings). Both variants
 * are always mounted in the DOM (toggled via `hidden`, not conditionally
 * rendered) — the same "dual-render, CSS-toggled" responsive pattern
 * already used throughout this app (e.g. Trade Explorer's table/cards,
 * `JournalPerformanceTable`) — so neither variant's state is lost when the
 * viewport crosses the breakpoint, and switching mobile tabs never
 * remounts a panel.
 *
 * Phase 5A-2: `useBuilderProject` is called exactly ONCE here (not once per
 * ChatPanel instance) — its returned state/callbacks are handed to BOTH the
 * desktop and mobile ChatPanel, so there is only ever one generation
 * mutation/one conversation in flight regardless of viewport, and the
 * conversation survives a mobile tab switch or a desktop/mobile breakpoint
 * crossing without any special-casing.
 *
 * Phase 5A-3: the SAME rule applies to `code` — built once here from
 * `state.sgscript`/`updateSgscript`, reused by reference for both layouts,
 * so the real CodeMirror instance inside `CodeEditorPanel` never remounts
 * (and never loses undo history/cursor position) on a tab switch or
 * breakpoint crossing either. `readOnly={state.status === "generating"}` is
 * computed here, once, from the same canonical state — not duplicated
 * per-layout.
 */

export type BuilderTab = "chat" | "code" | "preview" | "settings";

const MOBILE_TABS: { id: BuilderTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "code", label: "Code" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
];

export function BuilderWorkspace({
  activeTab,
  onTabChange,
  signedIn,
}: {
  activeTab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  signedIn: boolean;
}) {
  const { state, prompt, setPrompt, submitPrompt, submitFixError, updateSgscript, submitValidate } = useBuilderProject(signedIn);

  const chat = (
    <ChatPanel project={state} prompt={prompt} onPromptChange={setPrompt} onSubmit={submitPrompt} onFixError={submitFixError} signedIn={signedIn} />
  );
  const code = (
    <CodeEditorPanel
      sgscript={state.sgscript}
      hasValidationResult={state.validation !== null}
      onChange={updateSgscript}
      readOnly={state.status === "generating"}
    />
  );
  const canValidate = canSubmitValidate(state.sgscript, state.status, state.validationPending, signedIn);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <BuilderToolbar canValidate={canValidate} validationPending={state.validationPending} onValidate={submitValidate} />

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Desktop / large tablet: three-panel resizable workspace. */}
          <div className="hidden h-full lg:block">
            <ResizablePanelGroup orientation="horizontal" className="h-full">
              <ResizablePanel defaultSize="27" minSize="18" className="min-w-0">
                {chat}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="43" minSize="24" className="min-w-0">
                {code}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="30" minSize="18" className="min-w-0">
                <PreviewPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          {/* Mobile / small tablet: tabbed workspace. */}
          <div className="flex h-full flex-col lg:hidden">
            <div className="flex shrink-0 border-b border-border" role="tablist" aria-label="Builder panels">
              {MOBILE_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  onClick={() => onTabChange(t.id)}
                  className={`flex-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors ${
                    activeTab === t.id ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              <div className={activeTab === "chat" ? "h-full" : "hidden"}>{chat}</div>
              <div className={activeTab === "code" ? "h-full" : "hidden"}>{code}</div>
              <div className={activeTab === "preview" ? "h-full" : "hidden"}>
                <PreviewPanel />
              </div>
              <div className={activeTab === "settings" ? "h-full" : "hidden"}>
                <SettingsPanel />
              </div>
            </div>
          </div>
        </div>

        <DiagnosticsPanel validation={state.validation} pending={state.validationPending} error={state.validationError} />
      </div>
    </div>
  );
}
