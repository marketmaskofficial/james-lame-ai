import { useState } from "react";
import { Eye, EyeOff, Plus, Settings2, Trash2 } from "lucide-react";
import { EXAMPLES } from "@/lib/sgscript/examples";
import type { CrosshairInfo } from "@/components/studio/StudioChart";
import type { Bar, InputSpec } from "@/lib/sgscript/types";

export type LegendIndicator = {
  key: string;
  name: string;
  visible: boolean;
  /** Numeric inputs shown inline next to the name, e.g. "21 55" for a
   * dual-EMA indicator — matches how a real terminal's legend surfaces an
   * indicator's key parameters without opening its settings. */
  inputs?: InputSpec[];
};

type Props = {
  symbol: string;
  intervalLabel: string;
  crosshair: CrosshairInfo | null;
  /** Shown as the OHLC readout whenever the crosshair isn't over a bar. */
  latestBar: Bar | null;
  indicators: LegendIndicator[];
  editingKey: string | null;
  onSelectIndicator: (key: string) => void;
  onToggleVisible: (key: string) => void;
  onRemoveIndicator: (key: string) => void;
  onOpenSettings: (key: string) => void;
  /** null = blank starter script. */
  onPickTemplate: (code: string | null) => void;
};

/**
 * On-chart legend: replaces what used to be a full-width row above the
 * chart. Floats over the top-left corner like a real charting terminal's
 * legend instead of reserving its own strip of vertical space.
 */
export function ChartLegendStrip({
  symbol,
  intervalLabel,
  crosshair,
  latestBar,
  indicators,
  editingKey,
  onSelectIndicator,
  onToggleVisible,
  onRemoveIndicator,
  onOpenSettings,
  onPickTemplate,
}: Props) {
  const [templatesOpen, setTemplatesOpen] = useState(false);

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-[6px] bg-panel/75 px-1.5 py-0.5 backdrop-blur-sm">
        <span className="text-[13px] font-medium">
          {symbol} · {intervalLabel}
        </span>
        {(() => {
          // Latest candle by default; the hovered candle takes over the
          // instant the crosshair sits over one, same as a real terminal's
          // OHLC readout — never blank, never stuck on a stale hover.
          const ohlcBar = crosshair?.bar ?? latestBar;
          if (!ohlcBar) return null;
          return (
            <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              {(["open", "high", "low", "close"] as const).map((k) => (
                <span key={k}>
                  {k[0].toUpperCase()}
                  <span
                    className={
                      ohlcBar.close >= ohlcBar.open
                        ? "ml-0.5 text-emerald-400"
                        : "ml-0.5 text-red-400"
                    }
                  >
                    {ohlcBar[k].toLocaleString("en-US", {
                      maximumFractionDigits: ohlcBar[k] >= 100 ? 2 : 6,
                    })}
                  </span>
                </span>
              ))}
              {ohlcBar.volume !== undefined && (
                <span>V{Math.round(ohlcBar.volume).toLocaleString()}</span>
              )}
              {crosshair?.bar &&
                crosshair.values.map((v) => (
                  <span key={v.title} style={{ color: v.color }}>
                    {v.title} {v.value.toFixed(4)}
                  </span>
                ))}
            </span>
          );
        })()}
      </div>

      {indicators.map((ind) => (
        <div
          key={ind.key}
          className={`group pointer-events-auto flex items-center gap-1.5 rounded-[6px] bg-panel/75 px-1.5 py-0.5 backdrop-blur-sm ${
            editingKey === ind.key ? "ring-1 ring-brand/60" : ""
          }`}
        >
          <button
            onClick={() => onSelectIndicator(ind.key)}
            className="flex items-center gap-1.5 text-[12px] hover:text-brand"
          >
            <span>{ind.name}</span>
            {ind.inputs && ind.inputs.filter((i) => i.type === "number").length > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {ind.inputs
                  .filter((i) => i.type === "number")
                  .slice(0, 3)
                  .map((i) => String(i.value))
                  .join(" ")}
              </span>
            )}
          </button>
          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              title={ind.visible ? "Hide" : "Show"}
              onClick={() => onToggleVisible(ind.key)}
              className="text-muted-foreground hover:text-foreground"
            >
              {ind.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button
              title="Settings"
              onClick={() => onOpenSettings(ind.key)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            <button
              title="Remove from chart"
              onClick={() => onRemoveIndicator(ind.key)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        </div>
      ))}

      <div className="pointer-events-auto relative">
        <button
          onClick={() => setTemplatesOpen((v) => !v)}
          className="flex items-center gap-1 rounded-[6px] bg-panel/75 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur-sm hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> New indicator
        </button>
        {templatesOpen && (
          <div className="absolute left-0 z-40 mt-1 w-52 rounded-[8px] border border-border bg-popover p-1 shadow-xl">
            <button
              onClick={() => {
                onPickTemplate(null);
                setTemplatesOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
            >
              Blank script
            </button>
            <div className="my-1 h-px bg-border" />
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                onClick={() => {
                  onPickTemplate(ex.code);
                  setTemplatesOpen(false);
                }}
                className="block w-full truncate rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                {ex.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
