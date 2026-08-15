import { createFileRoute } from "@tanstack/react-router";

// Fetch a spot price for a Binance symbol with fallback endpoints.
async function fetchPrice(symbol: string): Promise<number | null> {
  const sources = [
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
    `https://api.binance.us/api/v3/ticker/price?symbol=${symbol}`,
    `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`,
  ];
  for (const src of sources) {
    try {
      const r = await fetch(src);
      if (!r.ok) continue;
      const j = (await r.json()) as { price?: string };
      const p = j.price ? parseFloat(j.price) : NaN;
      if (Number.isFinite(p)) return p;
    } catch {
      // try next
    }
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/check-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Simple gate: cron sends the project's publishable key as apikey.
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: alerts, error: aErr } = await supabaseAdmin
          .from("alerts")
          .select(
            "id, user_id, symbol, condition, threshold, cooldown_seconds, last_triggered_at",
          )
          .eq("active", true);
        if (aErr) {
          return new Response(JSON.stringify({ error: aErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const list = alerts ?? [];
        if (list.length === 0) {
          return Response.json({ ok: true, checked: 0, triggered: 0 });
        }

        const symbols = Array.from(new Set(list.map((a) => a.symbol)));
        const prices = new Map<string, number>();
        await Promise.all(
          symbols.map(async (s) => {
            const p = await fetchPrice(s);
            if (p !== null) prices.set(s, p);
          }),
        );

        const now = Date.now();
        let triggered = 0;

        for (const a of list) {
          const price = prices.get(a.symbol);
          if (price === undefined) continue;
          const threshold = Number(a.threshold);
          const hit =
            a.condition === "above" ? price >= threshold : price <= threshold;
          if (!hit) continue;

          if (a.last_triggered_at) {
            const last = new Date(a.last_triggered_at).getTime();
            if (now - last < a.cooldown_seconds * 1000) continue;
          }

          const { error: nErr } = await supabaseAdmin
            .from("alert_notifications")
            .insert({
              alert_id: a.id,
              user_id: a.user_id,
              symbol: a.symbol,
              condition: a.condition,
              threshold: threshold,
              triggered_price: price,
            });
          if (nErr) {
            console.error("insert notification failed", nErr.message);
            continue;
          }
          await supabaseAdmin
            .from("alerts")
            .update({ last_triggered_at: new Date(now).toISOString() })
            .eq("id", a.id);
          triggered++;
        }

        return Response.json({
          ok: true,
          checked: list.length,
          symbols: symbols.length,
          triggered,
        });
      },
    },
  },
});
