import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  Clock,
  Code2,
  FolderOpen,
  History as HistoryIcon,
  Loader2,
  Play,
  PlusSquare,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The narrow slice of `listVersions`'s return this toolbar needs. */
export type VersionRow = { version: number; changelog: string | null; created_at: string };
/** The narrow slice of `listIndicators`'s return the Open menu needs. */
export type SavedIndicatorRow = { id: string; name: string; updated_at: string; symbol: string | null; timeframe: string | null };

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Phase 5A-1/5A-3/5A-4d/5A-5 — the top Builder toolbar.
 *
 * Phase 5A-5 replaces the previous hardcoded "Untitled Indicator"/disabled
 * Save/Add-to-Chart placeholders with real, working actions: an inline
 * editable name, Open (saved-project discovery via the already-existing
 * `listIndicators`), Save/Save Version (the already-existing
 * `updateIndicator`'s `snapshot` flag), and a combined Save Version/History
 * popover (`listVersions`/`restoreVersion`). Add to Chart remains
 * unconditionally disabled — that hand-off is a later phase.
 *
 * Below `sm` (640px) the action buttons collapse to icon-only (label still
 * available via `title`) — the name/status area is the side that must never
 * disappear, so the action buttons are the side that shrinks.
 */
export function BuilderToolbar({
  name,
  onRename,
  dirty,
  currentVersion,
  autoPersistError,

  canValidate,
  validationPending,
  onValidate,
  canRunPreview,
  previewRunning,
  onRunPreview,

  canSave,
  savePending,
  saveError,
  onSave,

  canSaveVersion,
  saveVersionPending,
  saveVersionError,
  onSaveVersion,

  versions,
  versionsLoading,
  versionsError,
  onHistoryOpenChange,
  onRestoreVersion,
  restorePending,

  savedIndicators,
  savedIndicatorsLoading,
  onOpenMenuOpenChange,
  currentIndicatorId,
}: {
  name: string;
  onRename: (name: string) => void;
  dirty: boolean;
  currentVersion: number | null;
  autoPersistError: string | null;

  canValidate: boolean;
  validationPending: boolean;
  onValidate: () => void;
  canRunPreview: boolean;
  previewRunning: boolean;
  onRunPreview: () => void;

  canSave: boolean;
  savePending: boolean;
  saveError: string | null;
  onSave: () => void;

  canSaveVersion: boolean;
  saveVersionPending: boolean;
  saveVersionError: string | null;
  onSaveVersion: (changelog: string) => void;

  versions: VersionRow[];
  versionsLoading: boolean;
  versionsError: string | null;
  onHistoryOpenChange: (open: boolean) => void;
  onRestoreVersion: (version: number) => void;
  restorePending: boolean;

  savedIndicators: SavedIndicatorRow[];
  savedIndicatorsLoading: boolean;
  onOpenMenuOpenChange: (open: boolean) => void;
  currentIndicatorId: string | null;
}) {
  const [nameDraft, setNameDraft] = useState(name);
  const [editingName, setEditingName] = useState(false);
  const [changelog, setChangelog] = useState("");

  function commitName() {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setNameDraft(name);
  }

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Code2 className="h-4 w-4 shrink-0 text-brand" />
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(name);
                setEditingName(false);
              }
            }}
            aria-label="Indicator name"
            className="min-w-0 flex-1 rounded border border-brand bg-background px-1.5 py-0.5 text-sm font-semibold text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(name);
              setEditingName(true);
            }}
            title="Rename"
            className="truncate rounded px-0.5 text-left text-sm font-semibold text-foreground hover:bg-accent"
          >
            {name}
          </button>
        )}
        <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
          {dirty ? "Unsaved" : currentIndicatorId ? "Saved" : "Draft"}
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">{currentVersion ? `v${currentVersion}` : "No version"}</span>
        {autoPersistError && (
          <span className="hidden shrink-0 truncate text-[10px] text-destructive lg:inline" title={autoPersistError}>
            Not saved: {autoPersistError}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <Popover onOpenChange={onOpenMenuOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Open a saved indicator"
              aria-label="Open"
              className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent sm:px-2.5"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0 text-xs">
            <Link
              to="/builder"
              className="flex items-center gap-1.5 border-b border-border px-3 py-2 font-medium text-brand hover:bg-accent"
            >
              <PlusSquare className="h-3.5 w-3.5" /> New Project
            </Link>
            <div className="border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Your Saved Indicators
            </div>
            <div className="max-h-72 overflow-y-auto">
              {savedIndicatorsLoading ? (
                <p className="p-3 text-muted-foreground">Loading…</p>
              ) : savedIndicators.length === 0 ? (
                <p className="p-3 text-muted-foreground">No saved indicators yet.</p>
              ) : (
                savedIndicators.map((row) => (
                  <Link
                    key={row.id}
                    to="/builder/$id"
                    params={{ id: row.id }}
                    className={`flex flex-col gap-0.5 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-accent ${
                      row.id === currentIndicatorId ? "bg-accent/50" : ""
                    }`}
                  >
                    <span className="truncate font-medium text-foreground">{row.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {shortDate(row.updated_at)}
                      {row.symbol ? ` · ${row.symbol}${row.timeframe ? ` ${row.timeframe}` : ""}` : ""}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          title={canSave ? "Save — update this indicator without creating a new version" : "Save"}
          aria-label="Save"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          {savePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{savePending ? "Saving…" : "Save"}</span>
        </button>
        {saveError && <span className="hidden text-[10px] text-destructive lg:inline">{saveError}</span>}

        <Popover onOpenChange={onHistoryOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Save Version / History"
              aria-label="Save Version / History"
              className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent sm:px-2.5"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">History</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 text-xs">
            <div className="space-y-1.5 border-b border-border p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Save Version</p>
              <input
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                placeholder="Optional reason — e.g. EMA refinement"
                className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={!canSaveVersion || saveVersionPending}
                onClick={() => {
                  onSaveVersion(changelog);
                  setChangelog("");
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveVersionPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save Version
              </button>
              {saveVersionError && <p className="text-[10px] text-destructive">{saveVersionError}</p>}
            </div>
            <div className="border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Version History
            </div>
            <div className="max-h-60 overflow-y-auto">
              {versionsLoading ? (
                <p className="p-3 text-muted-foreground">Loading…</p>
              ) : versionsError ? (
                <p className="p-3 text-destructive">Could not load version history.</p>
              ) : versions.length === 0 ? (
                <p className="p-3 text-muted-foreground">No versions yet.</p>
              ) : (
                versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">v{v.version}</span>
                        <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">{shortDate(v.created_at)}</span>
                      </div>
                      {v.changelog && <p className="truncate text-[10px] text-muted-foreground">{v.changelog}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={restorePending || v.version === currentVersion}
                      onClick={() => onRestoreVersion(v.version)}
                      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          disabled={!canValidate}
          onClick={onValidate}
          title={canValidate ? "Validate — run static validation on the current code" : "Validate — describe and build an indicator first"}
          aria-label="Validate"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          {validationPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{validationPending ? "Validating…" : "Validate"}</span>
        </button>
        <button
          type="button"
          disabled={!canRunPreview}
          onClick={onRunPreview}
          title={canRunPreview ? "Run Preview — execute the current code against the loaded historical bars" : "Run Preview — needs real code and loaded market data"}
          aria-label="Run Preview"
          className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          {previewRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{previewRunning ? "Running…" : "Run Preview"}</span>
        </button>
        <button
          type="button"
          disabled
          title="Add to Chart — available once the Chart Studio hand-off is wired in a later phase"
          aria-label="Add to Chart"
          className="flex items-center gap-1.5 rounded-md bg-brand px-1.5 py-1 text-[11px] font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-2.5"
        >
          <PlusSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add to Chart</span>
        </button>
      </div>
    </header>
  );
}
