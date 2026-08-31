import { useState } from "react";
import { X } from "lucide-react";

/**
 * Phase 4E-2 — one reusable control for every taxonomy field (Setup,
 * Strategy, Emotion, Mistakes, Tags). A native `<input list>` +
 * `<datalist>` gives free-text entry with browser-provided autocomplete in
 * a single compact control — no custom combobox component needed to keep
 * "type a new value" and "pick a suggestion" in one place.
 *
 * `multi=false` (Setup/Strategy/Emotion): submitting text REPLACES the
 * single current value. `multi=true` (Mistakes/Tags): submitting text ADDS
 * a chip (case-insensitive de-duplicated against what's already selected).
 * Either way, `value`/`onChange` are always `string[]` — 0 or 1 items for
 * single-select, any number for multi-select — matching
 * `JournalDraft`'s own field shapes 1:1, so the parent never needs a
 * separate single/multi code path when wiring this up.
 */
export function JournalChipField({
  label,
  hint,
  value,
  onChange,
  suggestions,
  multi,
  placeholder,
  datalistId,
}: {
  label: string;
  /** Optional subtle context shown next to the label (e.g. the trade's own
   * computed session, for the Session field — never auto-applied). */
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  multi: boolean;
  placeholder: string;
  datalistId: string;
}) {
  const [inputValue, setInputValue] = useState("");

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (multi) {
      const already = value.some((v) => v.toLowerCase() === trimmed.toLowerCase());
      onChange(already ? value : [...value, trimmed]);
    } else {
      onChange([trimmed]);
    }
    setInputValue("");
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const availableSuggestions = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="ml-1 normal-case text-muted-foreground/70">{hint}</span>}
      </span>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={`${v}-${i}`} className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium">
              {v}
              <button type="button" onClick={() => removeAt(i)} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${v}`}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {(multi || value.length === 0) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit(inputValue);
          }}
          className="contents"
        >
          <input
            type="text"
            list={datalistId}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={() => commit(inputValue)}
            placeholder={placeholder}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <datalist id={datalistId}>
            {availableSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </form>
      )}

      {availableSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {availableSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-brand hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
