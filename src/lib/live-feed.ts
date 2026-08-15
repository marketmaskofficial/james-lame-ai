import type { Bar } from "@/lib/sgscript/types";
import { fetchBars } from "@/lib/marketdata";

export type LiveStatus = "connecting" | "live" | "polling" | "offline";

type Handlers = {
  onBar: (bar: Bar) => void;
  onStatus?: (s: LiveStatus) => void;
};

const WS_INTERVALS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "1w",
]);

/**
 * Streams the forming candle for a symbol/timeframe.
 * Uses Binance's public kline websocket, falling back to REST polling when the
 * socket cannot be established (blocked networks, unsupported interval).
 */
export function subscribeKlines(
  symbol: string,
  interval: string,
  { onBar, onStatus }: Handlers,
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const status = (s: LiveStatus) => {
    if (!closed) onStatus?.(s);
  };

  const startPolling = () => {
    if (closed || pollTimer) return;
    status("polling");
    const tick = async () => {
      try {
        const bars = await fetchBars(symbol, interval, 2);
        const last = bars[bars.length - 1];
        if (last && !closed) onBar(last);
      } catch {
        status("offline");
      }
    };
    void tick();
    pollTimer = setInterval(() => void tick(), 5000);
  };

  const connect = () => {
    if (closed) return;
    if (typeof WebSocket === "undefined" || !WS_INTERVALS.has(interval)) {
      startPolling();
      return;
    }
    status("connecting");
    try {
      ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`,
      );
    } catch {
      startPolling();
      return;
    }

    ws.onopen = () => {
      attempts = 0;
      status("live");
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as {
          k?: {
            t: number;
            o: string;
            h: string;
            l: string;
            c: string;
            v: string;
          };
        };
        const k = msg.k;
        if (!k) return;
        onBar({
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        });
      } catch {
        /* ignore malformed frame */
      }
    };

    const fail = () => {
      if (closed) return;
      ws = null;
      attempts += 1;
      if (attempts >= 3) {
        startPolling();
        return;
      }
      status("connecting");
      retry = setTimeout(connect, 1000 * attempts);
    };

    ws.onerror = fail;
    ws.onclose = fail;
  };

  connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    if (pollTimer) clearInterval(pollTimer);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  };
}
