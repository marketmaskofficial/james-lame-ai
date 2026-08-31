// Phase 5B-Final — the ONE browser-side call site for trusted paper order
// submission. Both the manual ticket (TradingPanel) and Strategy Execution
// (useStrategyExecution) call this SAME function, so they converge on the
// SAME trusted transport boundary (supabase/functions/paper-submit-order)
// instead of forming two execution systems.
//
// `SubmitInput`/`AccountSnapshot` are imported as TYPES ONLY — TypeScript
// erases type-only imports at compile time, so nothing from the server-only
// oms.server.ts module (or its supabaseAdmin/service-role dependencies)
// ever reaches the browser bundle. This file never imports oms.server.ts
// as a value, never imports supabaseAdmin, and never touches a database
// table directly.
import { supabase } from "@/integrations/supabase/client";
import type { AccountSnapshot } from "@/lib/trading/types";
import type { SubmitInput } from "@/lib/trading/oms.server";

export type PaperOrderResult = {
  orderId?: string;
  rejected?: string | null;
  duplicate?: boolean;
  snapshot?: AccountSnapshot;
};

export async function submitPaperOrder(input: SubmitInput): Promise<PaperOrderResult> {
  const { data, error } = await supabase.functions.invoke("paper-submit-order", { body: input });
  if (error) throw new Error(error.message ?? "Order failed");
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as PaperOrderResult;
}
