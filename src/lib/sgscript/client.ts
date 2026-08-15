// Browser-side driver for the SGScript worker: one worker per call site,
// hard-killed if a script exceeds the time budget.

import type { Bar, RunResponse, RunResult } from "./types";
import { LIMITS } from "./types";

let seq = 0;

export function runIndicator(
  code: string,
  bars: Bar[],
  settings: Record<string, number | boolean | string> = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const id = `r${++seq}`;
    const kill = () => worker.terminate();
    const timer = setTimeout(() => {
      kill();
      reject(new Error("Script timed out — check for an infinite loop."));
    }, LIMITS.timeoutMs + 1500);

    worker.onmessage = (e: MessageEvent<RunResponse>) => {
      clearTimeout(timer);
      kill();
      const res = e.data;
      if (res.ok) resolve(res);
      else reject(new Error(res.line ? `Line ${res.line}: ${res.error}` : res.error));
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      kill();
      reject(new Error(e.message || "Script failed to run"));
    };

    worker.postMessage({ id, code, bars, settings });
  });
}
