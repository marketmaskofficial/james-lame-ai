import { useMemo } from "react";
import { AlertTriangle, LineChart, Loader2 } from "lucide-react";
import { StudioChart, type Drawing, type LoadedIndicator } from "@/components/studio/StudioChart";
import type { Bar, RunResult } from "@/lib/sgscript/types";
import type { PreviewStatus } from "@/lib/builder/generationState";

/**
 * Phase 5A-4c — Live Preview region, now mounting the REAL canonical
 * renderer (`StudioChart`, the exact same component Chart Studio uses —
 * never a copy, never a second lightweight-charts setup). Presentation
 * only: every value it renders (`bars`, `previewStatus`, `previewResult`,
 * `previewError`) comes from `useBuilderProject` via `BuilderWorkspace`;
 * this component owns no Builder state of its own and makes no server/AI
 * calls.
 *
 * `bars` is currently always the module-level empty array from
 * `BuilderWorkspace` — Phase 5A-4d is responsible for supplying real
 * market data. Until then, `runIndicator` itself refuses to execute
 * against zero bars ("No market data loaded", see the Phase 5A-4b runtime
 * audit), so `previewResult` cannot exist without bars either — mounting
 * `StudioChart` with `bars=[]` here simply lets it show its own honest,
 * native empty chart surface rather than a fabricated placeholder.
 *
 * `StudioChart` is mounted unconditionally (idle/running/success/error
 * all use the SAME instance) so it never remounts on a status transition —
 * only the overlay caption/banner on top of it changes. This mirrors the
 * "built once, reused by reference" rule `BuilderWorkspace` already
 * applies to `chat`/`code`/`preview` themselves, one level deeper.
 */

const EMPTY_DRAWINGS: Drawing[] = [];
function noopAddDrawing(): void {}
function noopRemoveDrawing(): void {}
function noopSelectDrawing(): void {}

export function PreviewPanel({
  bars,
  previewStatus,
  previewResult,
  previewError,
}: {
  bars: Bar[];
  previewStatus: PreviewStatus;
  previewResult: RunResult | null;
  previewError: string | null;
}) {
  const indicators = useMemo<LoadedIndicator[]>(() => {
    if (!previewResult) return [];
    return [{ key: "builder-preview", name: previewResult.meta.name, visible: true, result: previewResult }];
  }, [previewResult]);

  const hasOscPane = useMemo(
    () => (previewResult ? previewResult.plots.some((p) => p.pane === "osc") : false),
    [previewResult],
  );

  const showIdleCaption = previewStatus !== "running" && !previewResult && !previewError;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Live Preview</span>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          {previewStatus === "running" && (
            <span className="flex items-center gap-1 text-brand">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running preview…
            </span>
          )}
          <span>Symbol —</span>
          <span aria-hidden="true">·</span>
          <span>Timeframe —</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <StudioChart
          bars={bars}
          indicators={indicators}
          tool="cursor"
          drawings={EMPTY_DRAWINGS}
          onAddDrawing={noopAddDrawing}
          onRemoveDrawing={noopRemoveDrawing}
          selectedId={null}
          onSelectDrawing={noopSelectDrawing}
          hasOscPane={hasOscPane}
        />

        {showIdleCaption && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <LineChart className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Chart preview will appear after a successful build.</p>
          </div>
        )}

        {previewError && !previewResult && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{previewError}</p>
          </div>
        )}

        {previewError && previewResult && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{previewError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
