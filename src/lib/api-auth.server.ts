import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifies the Supabase bearer token on a raw HTTP API route and returns the
 * user id, plus an RLS-scoped Supabase client authenticated AS that user
 * (its requests carry the caller's own bearer token, not the anon key) —
 * usable for any authenticated read/write this route needs to make on the
 * user's behalf, e.g. AI usage accounting (src/lib/ai-usage.server.ts).
 * Server routes are NOT covered by `requireSupabaseAuth`, so any expensive
 * endpoint must call this itself.
 */
export async function requireApiUser(
  request: Request,
): Promise<{ userId: string; supabase: SupabaseClient } | Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) return unauthorized();

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "auth_unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });

  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return unauthorized();

  // A second client, otherwise identical, but whose requests carry the
  // caller's own bearer token — so RLS-scoped inserts/selects (like AI usage
  // accounting) run AS that user, never as anon and never as service role.
  const userScopedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });

  return { userId: data.user.id, supabase: userScopedClient };
}

function unauthorized() {
  return new Response(
    JSON.stringify({ error: "unauthorized", message: "Sign in to use this feature." }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}

const buckets = new Map<string, number[]>();

/**
 * Small in-memory sliding-window limiter. Per worker instance, so it is a
 * cost guard rail rather than a hard quota — enough to stop runaway loops
 * and casual abuse of the AI endpoints.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Response | null {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    buckets.set(key, hits);
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: `Too many requests. Try again in ${retry}s.`,
      }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(retry) },
      },
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return null;
}
