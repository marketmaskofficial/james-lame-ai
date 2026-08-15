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

const DRAWINGS_KEY = "sg.studio.drawings";

export function loadDrawings(symbol: string, interval: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<
      string,
      unknown[]
    >;
    return all[`${symbol}:${interval}`] ?? [];
  } catch {
    return [];
  }
}

export function saveDrawings(
  symbol: string,
  interval: string,
  drawings: unknown[],
) {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<
      string,
      unknown[]
    >;
    all[`${symbol}:${interval}`] = drawings;
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked */
  }
}
