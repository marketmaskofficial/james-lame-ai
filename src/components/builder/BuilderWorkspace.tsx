import { useEffect, useRef, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AppNavRail } from "@/components/AppNavRail";
import { canRunPreview as canRunPreviewCheck, canSubmitValidate } from "@/lib/builder/generationState";
import type { Timeframe } from "@/lib/marketdata";
import { BuilderToolbar } from "./BuilderToolbar";
import { ChatPanel } from "./ChatPanel";
import { CodeEditorPanel } from "./CodeEditorPanel";
import { PreviewPanel, type PreviewContext } from "./PreviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useBuilderMarketData } from "./useBuilderMarketData";
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
 * throughout this app (e.g. Trade Explorer's table/cards,
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
 *
 * Phase 5A-4a — approved desktop layout change: Chat stays the full-height
 * LEFT column (never moved); the RIGHT side is no longer a flat sibling of
 * Chat but a nested vertical split — Live Preview on top, Code Editor on
 * the bottom — built with a `<ResizablePanelGroup orientation="vertical">`
 * nested inside the outer horizontal group's second `<ResizablePanel>`.
 * `react-resizable-panels` supports nested groups natively (confirmed by
 * reading the installed library: `Group` sets `flexDirection` via an
 * inline style keyed off its own `orientation` prop, so a nested group
 * needs no special wiring or a second workspace system) — this is still
 * the same plain primitive, one level deeper, never Studio's dockable-
 * widget architecture. `preview` joins `chat`/`code` as a third
 * built-once-reused-by-reference element, so `PreviewPanel` gets the same
 * single-instance guarantee `ChatPanel`/`CodeEditorPanel` already have.
 *
 * Phase 5A-4c — `PreviewPanel` now mounts the real `StudioChart` renderer,
 * fed from `state.previewStatus`/`previewResult`/`previewError` (Phase
 * 5A-4b's execution state).
 *
 * Phase 5A-4d — `useBuilderMarketData` (a separate, Builder-local hook —
 * deliberately NOT folded into `useBuilderProject`/`BuilderProjectState`,
 * see that hook's own doc comment) supplies real `bars`/`barsLoading`/
 * `marketDataError`/`selectedSymbol`/`selectedTimeframe`. Run Preview is a
 * real, manual, `BuilderToolbar` action that calls the EXISTING
 * `submitRunPreview(bars)` with these real bars — no second execution path,
 * no automatic re-run on symbol/timeframe/code change (that's Phase
 * 5A-4e's job). `previewContext`/`pendingPreviewContextRef` below exist
 * solely to know which symbol/timeframe the currently-displayed
 * `previewResult` was actually computed against, so `PreviewPanel` can
 * honestly disclose staleness rather than ever drawing an indicator
 * computed against one symbol's bars on top of a different symbol's
 * candles.
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
}: {
  activeTab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  signedIn: boolean;
}) {
  const { state, prompt, setPrompt, submitPrompt, submitFixError, updateSgscript, submitValidate, submitRunPreview } = useBuilderProject(signedIn);
  const { selectedSymbol, setSelectedSymbol, selectedTimeframe, setSelectedTimeframe, bars, barsLoading, marketDataError } = useBuilderMarketData();

  /** Tracks which symbol/timeframe the CURRENTLY-DISPLAYED `previewResult`
   * was actually run against. Updated only when `previewResult` changes to
   * a new successful value (never on failure — `applyPreviewFailure` never
   * touches `previewResult`, so this must not update either, or a failed
   * run against a NEW symbol would incorrectly relabel the OLD, still-
   * displayed chart as belonging to the new one). `pendingPreviewContextRef`
   * captures the context a Run Preview click was made under; the effect
   * below only promotes it once `previewResult`'s reference actually
   * changes, tying this strictly to real success. */
  const pendingPreviewContextRef = useRef<PreviewContext | null>(null);
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null);
  useEffect(() => {
    if (state.previewResult && pendingPreviewContextRef.current) {
      setPreviewContext(pendingPreviewContextRef.current);
    }
  }, [state.previewResult]);

  function handleRunPreview() {
    pendingPreviewContextRef.current = { symbol: selectedSymbol, timeframe: selectedTimeframe };
    void submitRunPreview(bars);
  }

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
  const preview = (
    <PreviewPanel
      bars={bars}
      barsLoading={barsLoading}
      marketDataError={marketDataError}
      selectedSymbol={selectedSymbol}
      selectedTimeframe={selectedTimeframe}
      onSymbolChange={setSelectedSymbol}
      onTimeframeChange={(tf: Timeframe) => setSelectedTimeframe(tf)}
      previewStatus={state.previewStatus}
      previewResult={state.previewResult}
      previewError={state.previewError}
      previewContext={previewContext}
    />
  );
  const canValidate = canSubmitValidate(state.sgscript, state.status, state.validationPending, signedIn);
  const canRunPreview = canRunPreviewCheck(state.sgscript, state.previewStatus, bars.length > 0) && !barsLoading;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppNavRail />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <BuilderToolbar
          canValidate={canValidate}
          validationPending={state.validationPending}
          onValidate={submitValidate}
          canRunPreview={canRunPreview}
          previewRunning={state.previewStatus === "running"}
          onRunPreview={handleRunPreview}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Desktop / large tablet: Chat (left) | Preview-over-Code (right, nested split). */}
          <div className="hidden h-full lg:block">
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
