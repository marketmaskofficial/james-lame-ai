import { useState } from "react";
import { Check, LayoutGrid, Pencil, RotateCcw, Save, Star, Trash2, X } from "lucide-react";
import type { WorkspaceLayout } from "@/lib/workspace/types";
import { CURRENT_LAYOUT_ID } from "@/lib/workspace/persistence";

type Props = {
  layouts: WorkspaceLayout[];
  activeLayoutId: string;
  defaultLayoutId: string | null;
  onSwitch: (id: string) => void;
  onSaveAsNew: (name: string) => void;
  onSaveActive: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string | null) => void;
  onResetToBeginner: () => void;
  /** Whether named layouts are cloud-synced (signed in) or local-only. */
  signedIn?: boolean;
  /** Non-blocking sync failure message, if the last cloud read/write failed. */
  syncError?: string | null;
};

/**
 * "Layouts" trigger + popover — save/switch/rename/delete/default named
 * workspace layouts, plus a reset to the Beginner preset. Same lightweight-
 * dropdown idiom as AddWidgetMenu, not a modal; renaming and "save as new"
 * use a simple inline text input rather than a separate dialog system.
 */
export function LayoutMenu({
  layouts,
  activeLayoutId,
  defaultLayoutId,
  onSwitch,
  onSaveAsNew,
  onSaveActive,
  onRename,
  onDelete,
  onSetDefault,
  onResetToBeginner,
  signedIn,
  syncError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const closeAll = () => {
    setOpen(false);
    setSavingAs(false);
    setRenamingId(null);
  };

  const isNamedActive = activeLayoutId !== CURRENT_LAYOUT_ID;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Layouts"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${
          open ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeAll} />
          <div className="absolute right-0 z-40 mt-1 w-64 rounded-[8px] border border-border bg-popover p-1 shadow-xl">
            {syncError ? (
              <div className="mb-1 rounded bg-destructive/10 px-2 py-1 text-[10.5px] leading-snug text-destructive">
                {syncError}
              </div>
            ) : !signedIn ? (
              <div className="mb-1 px-2 py-1 text-[10.5px] text-muted-foreground">
                Local only — sign in to sync layouts across devices.
              </div>
            ) : null}
            <button
              onClick={() => {
                onSwitch(CURRENT_LAYOUT_ID);
                closeAll();
              }}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-accent ${
                !isNamedActive ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span>Current (unsaved)</span>
              {!isNamedActive && <Check className="h-3 w-3" />}
            </button>

            {layouts.length > 0 && <div className="my-1 h-px bg-border" />}

            {layouts.map((l) => {
              const id = l.id as string;
              const isActive = activeLayoutId === id;
              const isDefault = defaultLayoutId === id;
              const isRenaming = renamingId === id;
              return (
                <div
                  key={id}
                  className={`group/row flex items-center gap-1 rounded px-1 py-0.5 ${
                    isActive ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  {isRenaming ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            onRename(id, renameValue);
                            setRenamingId(null);
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none"
                      />
                      <button
                        title="Save name"
                        onClick={() => {
                          onRename(id, renameValue);
                          setRenamingId(null);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        title="Cancel"
                        onClick={() => setRenamingId(null)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onSwitch(id);
                          closeAll();
                        }}
                        className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[11px] ${
                          isActive ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {l.name}
                      </button>
                      <button
                        title={isDefault ? "Default layout" : "Set as default"}
                        onClick={() => onSetDefault(isDefault ? null : id)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-accent ${
                          isDefault ? "text-brand opacity-100" : "text-muted-foreground"
                        }`}
                      >
                        <Star className="h-3 w-3" fill={isDefault ? "currentColor" : "none"} />
                      </button>
                      <button
                        title="Rename"
                        onClick={() => {
                          setRenamingId(id);
                          setRenameValue(l.name);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/row:opacity-100"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => onDelete(id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-destructive group-hover/row:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            <div className="my-1 h-px bg-border" />

            {isNamedActive && (
              <button
                onClick={() => {
                  onSaveActive();
                  closeAll();
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                <Save className="h-3 w-3" /> Save
              </button>
            )}

            {savingAs ? (
              <div className="flex items-center gap-1 px-1 py-0.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Layout name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      onSaveAsNew(newName.trim());
                      setSavingAs(false);
                      setNewName("");
                      closeAll();
                    }
                    if (e.key === "Escape") setSavingAs(false);
                  }}
                  className="h-6 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none"
                />
                <button
                  title="Save"
                  disabled={!newName.trim()}
                  onClick={() => {
                    onSaveAsNew(newName.trim());
                    setSavingAs(false);
                    setNewName("");
                    closeAll();
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Check className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSavingAs(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
              >
                <Save className="h-3 w-3" /> Save as new layout…
              </button>
            )}

            <button
              onClick={() => {
                onResetToBeginner();
                closeAll();
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Reset to Beginner
            </button>
          </div>
        </>
      )}
    </div>
  );
}
