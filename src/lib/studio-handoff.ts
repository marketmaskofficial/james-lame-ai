// Hand-off channel between the AI chat (/app) and Chart Studio (/studio).
// Kept in sessionStorage so a full page navigation preserves it.

const KEY = "sg.studio.handoff";

export type StudioHandoff = {
  language: "sgscript" | "pine";
  code: string;
  title?: string;
  symbol?: string;
  interval?: string;
};

export function setStudioHandoff(payload: StudioHandoff) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(payload));
}

export function takeStudioHandoff(): StudioHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  sessionStorage.removeItem(KEY);
  try {
    return JSON.parse(raw) as StudioHandoff;
  } catch {
    return null;
  }
}

// Drawing persistence lives in src/lib/workspace/drawings.ts now (keyed by
// chart instance id, not just symbol:interval — see that file's doc comment
// for why the old symbol:interval-only key collided across chart instances).
// The legacy "sg.studio.drawings" localStorage key it used to read/write is
// still read once, as a fallback, by that module's `loadDrawingsFor`.
