// Phase 5B-Final — the ONE trusted transport boundary for paper order
// submission. This file contains NO order/fill/position/P&L/risk logic of
// its own: it verifies who the caller is, confirms the account they named
// is theirs and is PAPER, then calls the EXISTING, unchanged OMS
// (src/lib/trading/oms.server.ts) via __setTrustedDbClient. See that
// function's doc comment for why this cross-runtime import exists — in
// short, Supabase Edge Functions are always given SUPABASE_SERVICE_ROLE_KEY
// by the platform itself, while the app's own Node/TanStack server is not
// guaranteed to be. One OMS, two hosts, never two engines.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { submitOrder, getSnapshot, __setTrustedDbClient, OmsError, type SubmitInput } from "@/lib/trading/oms.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function isValidPayload(v: unknown): v is SubmitInput {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.accountId === "string" &&
    p.accountId.length > 0 &&
    typeof p.symbol === "string" &&
    p.symbol.length > 0 &&
    (p.side === "buy" || p.side === "sell") &&
    (p.type === "market" || p.type === "limit" || p.type === "stop" || p.type === "stop_limit") &&
    typeof p.qty === "number" &&
    Number.isFinite(p.qty) &&
    p.qty > 0
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  // Step 1 — identity comes ONLY from a verified JWT, never from the body.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);

  const authedClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await authedClient.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  // Step 2 — narrow, validated payload only.
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!isValidPayload(payload)) return json({ error: "Invalid order payload" }, 400);

  // Step 3 — ownership + paper-only, checked here through the caller's OWN
  // RLS-scoped session (never the admin client). Postgres RLS itself is the
  // ownership proof: a foreign or missing account simply returns no row.
  // This is a first backstop; submitOrder's own getAccount() re-checks
  // ownership independently below, so a bypass here still can't reach a
  // foreign or non-paper account.
  const { data: acct, error: acctErr } = await authedClient
    .from("trading_accounts")
    .select("id, environment")
    .eq("id", payload.accountId)
    .single();
  if (acctErr || !acct) return json({ error: "Trading account not found" }, 404);
  if (acct.environment !== "paper") {
    return json({ error: "Automated/trusted paper execution requires a PAPER account." }, 403);
  }

  // Step 4 — hand off to the EXISTING, unchanged OMS. This is the only
  // place this function touches order/fill/position/P&L/risk logic, and it
  // does so by calling the exact function the Node server already uses.
  const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  __setTrustedDbClient(adminClient);
  try {
    const result = await submitOrder(userId, payload);
    const snapshot = await getSnapshot(userId, payload.accountId);
    return json({ ...result, snapshot });
  } catch (e) {
    const message = e instanceof OmsError ? e.message : "Order failed";
    return json({ error: message }, 400);
  } finally {
    __setTrustedDbClient(null);
  }
});
