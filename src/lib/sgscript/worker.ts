/// <reference lib="webworker" />
import { runScript } from "./runtime";
import type { RunRequest, RunResponse } from "./types";

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const req = e.data;
  try {
    const result = runScript(req);
    (self as unknown as Worker).postMessage({ ...result, id: req.id } as RunResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lineMatch = /sgscript\.js:(\d+)/.exec(
      err instanceof Error ? (err.stack ?? "") : "",
    );
    (self as unknown as Worker).postMessage({
      ok: false,
      id: req.id,
      error: message,
      ...(lineMatch ? { line: Number(lineMatch[1]) - 2 } : {}),
    } as RunResponse);
  }
};
