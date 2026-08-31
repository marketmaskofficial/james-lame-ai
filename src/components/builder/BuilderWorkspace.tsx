import { useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { ChevronUp } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AppNavRail } from "@/components/AppNavRail";
import { canRunPreview as canRunPreviewCheck, canSave, canSaveVersion, canSubmitValidate, displayName } from "@/lib/builder/generationState";
import type { Timeframe } from "@/lib/marketdata";
import { BuilderToolbar } from "./BuilderToolbar";
import { ChatPanel } from "./ChatPanel";
import { CodeEditorPanel } from "./CodeEditorPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SettingsPanel, hasSettingsInputs } from "./SettingsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useBuilderMarketData } from "./useBuilderMarketData";
import { useBuilderPreviewRefresh } from "./useBuilderPreviewRefresh";
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
 * workspace infrastructure. No floating windows, no drag-to-dock.
 *
 * >=1024 (Tailwind `lg:`): the resizable desktop workspace. <1024: a
 * tabbed workspace (Chat/Preview/Code/Settings). Both variants are always
 * mounted in the DOM (toggled via `hidden`, not conditionally rendered) —
 * the same "dual-render, CSS-toggled" responsive pattern already used
 * throughout this app — so neither variant's state is lost when the
 * viewport crosses the breakpoint, and switching mobile tabs never
 * remounts a panel.
 *
 * Phase 5A-4a approved desktop layout (unchanged by Phase 5A-5): Chat is
 * the full-height LEFT column; the RIGHT side is Live Preview on top, Code
 * Editor on the bottom. Phase 5A-5C adds Settings as a THIRD, desktop-only
 * collapsible bar below the main split (mirroring `DiagnosticsPanel`'s own
 * collapsible-bottom-bar chrome) rather than a fourth resizable region —
 * the approved Chat/Preview/Code geometry is untouched. Mobile/tablet keeps
 * its existing dedicated Settings tab; both surfaces render the SAME
 * `<SettingsPanel>` element built once below, exactly like `chat`/`code`/
 * `preview` already do.
 *
 * Phase 5A-5 also adds `initialIndicatorId` — reopening an existing project
 * via `/builder/$id` (`BuilderGate.tsx`) — threaded straight into
 * `useBuilderProject`, and a page-wide unsaved-changes guard built on
 * TanStack Router's own `useBlocker` (confirmed available in the installed
 * router version), covering in-app navigation (Open/New/rail links) AND the
 * browser's native refresh/close warning from ONE hook — no second,
 * hand-rolled router-blocking mechanism.
 */

export type BuilderTab = "chat" | "code" | "preview" | "settings";

const MOBILE_TABS: { id: BuilderTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "preview", label: "Preview" },
  { id: "code", label: "Code" },
  { id: "settings", label: "Settings" },
];

export function BuilderWorkspace({
  activeTab,
  onTabChange,
  signedIn,
  initialIndicatorId,
}: {
  activeTab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  signedIn: boolean;
  initialIndicatorId?: string;
}) {
  const {
    state,
    prompt,
    setPrompt,
    submitPrompt,
    submitFixError,
    updateSgscript,
    submitValidate,
    submitRunPreview,
    manualEditVersion,
    updateSetting,
    settingsVersion,
    renameProject,
    saveIndicator,
    savePending,
    saveError,
    saveVersionIndicator,
    saveVersionPending,
    saveVersionError,
    versions,
    versionsLoading,
    versionsError,
    setHistoryOpen,
    restoreVersionAction,
    restorePending,
    messagesLoadError,
    savedIndicators,
    savedIndicatorsLoading,
    setOpenMenuOpen,
  } = useBuilderProject(signedIn, initialIndicatorId);
  const { selectedSymbol, setSelectedSymbol, selectedTimeframe, setSelectedTimeframe, bars, barsLoading, marketDataError } = useBuilderMarketData();

  const { previewContext, triggerManualRun } = useBuilderPreviewRefresh({
    sgscript: state.sgscript,
    buildStatus: state.status,
    previewStatus: state.previewStatus,
    previewResult: state.previewResult,
    manualEditVersion,
    settings: state.settings,
    settingsVersion,
    selectedSymbol,
    selectedTimeframe,
    bars,
    barsLoading,
    submitRunPreview,
  });

  // Phase 5A-5D — one page-wide unsaved-changes guard covering BOTH in-app
  // navigation (Open/New/rail links — anything that calls `navigate()`) and
  // the native browser refresh/close warning, via TanStack Router's own
  // `useBlocker`. `shouldBlockFn`/`enableBeforeUnload` are recreated fresh
  // every render (closing over the current `state.dirty`), so the
  // underlying `history.block` registration self-heals on every dirty-state
  // change — no separate ref/staleness handling needed for a boolean this
  // cheap to recompute.
  const blocker = useBlocker({
    shouldBlockFn: () => state.dirty,
    enableBeforeUnload: state.dirty,
    withResolver: true,
  });

  const chat = (
    <ChatPanel
      project={state}
      prompt={prompt}
      onPromptChange={setPrompt}
      onSubmit={submitPrompt}
      onFixError={submitFixError}
      signedIn={signedIn}
      messagesLoadError={messagesLoadError}
    />
  );
  const code = (
    <CodeEditorPanel
      sgscript={state.sgscript}
      hasValidationResult={state.validation !== null}
      onChange={updateSgscript}
      readOnly={state.status === "generating"}
    />
  );
  const preview = (
    <PreviewPanel
      bars={bars}
      barsLoading={barsLoading}
      marketDataError={marketDataError}
      selectedSymbol={selectedSymbol}
      selectedTimeframe={selectedTimeframe}
      onSymbolChange={setSelectedSymbol}
      onTimeframeChange={(tf: Timeframe) => setSelectedTimeframe(tf)}
      sgscript={state.sgscript}
      previewStatus={state.previewStatus}
      previewResult={state.previewResult}
      previewError={state.previewError}
      previewContext={previewContext}
    />
  );
  const settingsPanel = <SettingsPanel inputs={state.previewResult?.inputs} settings={state.settings} onChange={updateSetting} />;

  const canValidate = canSubmitValidate(state.sgscript, state.status, state.validationPending, signedIn);
  const canRunPreview = canRunPreviewCheck(state.sgscript, state.previewStatus, bars.length > 0) && !barsLoading;
  const name = displayName(state);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <BuilderToolbar
          name={name}
          onRename={renameProject}
          dirty={state.dirty}
          currentVersion={state.currentVersion}
          autoPersistError={state.autoPersistError}
          canValidate={canValidate}
          validationPending={state.validationPending}
          onValidate={submitValidate}
          canRunPreview={canRunPreview}
          previewRunning={state.previewStatus === "running"}
          onRunPreview={triggerManualRun}
          canSave={canSave(state.indicatorId, state.dirty, savePending, signedIn)}
          savePending={savePending}
          saveError={saveError}
          onSave={saveIndicator}
          canSaveVersion={canSaveVersion(state.indicatorId, state.dirty, saveVersionPending, signedIn)}
          saveVersionPending={saveVersionPending}
          saveVersionError={saveVersionError}
          onSaveVersion={saveVersionIndicator}
          versions={versions}
          versionsLoading={versionsLoading}
          versionsError={versionsError}
          onHistoryOpenChange={setHistoryOpen}
          onRestoreVersion={restoreVersionAction}
          restorePending={restorePending}
          savedIndicators={savedIndicators}
          savedIndicatorsLoading={savedIndicatorsLoading}
          onOpenMenuOpenChange={setOpenMenuOpen}
          currentIndicatorId={state.indicatorId}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Desktop / large tablet: Chat (left) | Preview-over-Code (right, nested split). */}
          <div className="hidden h-full flex-col lg:flex">
            <div className="min-h-0 flex-1">
              <ResizablePanelGroup orientation="horizontal" className="h-full">
                <ResizablePanel defaultSize="28" minSize="20" className="min-w-0">
                  {chat}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="72" minSize="45" className="min-w-0">
                  <ResizablePanelGroup orientation="vertical" className="h-full">
                    <ResizablePanel defaultSize="65" minSize="30" className="min-h-0">
                      {preview}
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize="35" minSize="22" className="min-h-0">
                      {code}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            {hasSettingsInputs(state.previewResult) && (
              <DesktopSettingsBar>{settingsPanel}</DesktopSettingsBar>
            )}
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
              <div className={activeTab === "preview" ? "h-full" : "hidden"}>{preview}</div>
              <div className={activeTab === "code" ? "h-full" : "hidden"}>{code}</div>
              <div className={activeTab === "settings" ? "h-full" : "hidden"}>{settingsPanel}</div>
            </div>
          </div>
        </div>

        <DiagnosticsPanel validation={state.validation} pending={state.validationPending} error={state.validationError} />
      </div>

      <AlertDialog open={blocker.status === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>This project has unsaved changes. Leaving now will discard them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Desktop-only collapsible Settings bar, mirroring `DiagnosticsPanel`'s own
 * collapsible-bottom-bar chrome exactly (same collapse affordance, same
 * border/typography) so Settings gets a real desktop home WITHOUT adding a
 * fourth resizable region to the approved Phase 5A-4a geometry. Only
 * rendered once the current indicator actually declares inputs — an empty
 * bar permanently taking up space for a script with nothing to configure
 * would be dead chrome. */
function DesktopSettingsBar({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="shrink-0 border-t border-border bg-sidebar">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Settings</span>
        <ChevronUp className={`h-3 w-3 transition-transform ${collapsed ? "rotate-180" : ""}`} />
      </button>
      {!collapsed && <div className="max-h-52 overflow-y-auto border-t border-border/60">{children}</div>}
    </div>
  );
}
