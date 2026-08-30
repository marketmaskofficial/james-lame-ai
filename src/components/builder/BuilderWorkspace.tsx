import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AppNavRail } from "@/components/AppNavRail";
import { BuilderToolbar } from "./BuilderToolbar";
import { ChatPanel } from "./ChatPanel";
import { CodeEditorPanel } from "./CodeEditorPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

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
 */

export type BuilderTab = "chat" | "code" | "preview" | "settings";

const MOBILE_TABS: { id: BuilderTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "code", label: "Code" },
  { id: "preview", label: "Preview" },
  { id: "settings", label: "Settings" },
];

export function BuilderWorkspace({ activeTab, onTabChange }: { activeTab: BuilderTab; onTabChange: (tab: BuilderTab) => void }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <BuilderToolbar />

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Desktop / large tablet: three-panel resizable workspace. */}
          <div className="hidden h-full lg:block">
            <ResizablePanelGroup orientation="horizontal" className="h-full">
              <ResizablePanel defaultSize="27" minSize="18" className="min-w-0">
                <ChatPanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="43" minSize="24" className="min-w-0">
                <CodeEditorPanel />
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
              <div className={activeTab === "chat" ? "h-full" : "hidden"}>
                <ChatPanel />
              </div>
              <div className={activeTab === "code" ? "h-full" : "hidden"}>
                <CodeEditorPanel />
              </div>
              <div className={activeTab === "preview" ? "h-full" : "hidden"}>
                <PreviewPanel />
              </div>
              <div className={activeTab === "settings" ? "h-full" : "hidden"}>
                <SettingsPanel />
              </div>
            </div>
          </div>
        </div>

        <DiagnosticsPanel />
      </div>
    </div>
  );
}
