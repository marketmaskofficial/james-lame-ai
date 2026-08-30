import { SlidersHorizontal } from "lucide-react";

/**
 * Phase 5A-1 — Settings shell. Mobile/tablet gets a dedicated tab for this
 * now so the responsive tab architecture (Chat/Code/Preview/Settings) is
 * established early, per the Phase 5A-1 brief — desktop has no separate
 * column for it yet since there are no real indicator inputs to expose
 * until generation is wired (Phase 5A-2+).
 */
export function SettingsPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-y-auto px-4 text-center">
      <SlidersHorizontal className="h-5 w-5 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">Indicator settings will appear here after a successful build.</p>
    </div>
  );
}
