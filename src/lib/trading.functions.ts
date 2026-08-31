import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const symbol = z.string().trim().toUpperCase().min(2).max(24);
const price = z.number().finite().positive();

export const getTradingSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.syncAccount(context.userId, data.accountId);
  });

export const submitTradeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        accountId: z.string().uuid().optional(),
        symbol,
        side: z.enum(["buy", "sell"]),
        type: z.enum(["market", "limit", "stop", "stop_limit"]),
        qty: z.number().finite().positive(),
        limitPrice: price.optional(),
        stopPrice: price.optional(),
        stopLoss: price.optional(),
        takeProfit: price.optional(),
        reduceOnly: z.boolean().optional(),
        indicatorId: z.string().uuid().optional(),
        indicatorVersion: z.number().int().optional(),
        indicatorName: z.string().max(120).optional(),
        signalId: z.string().max(80).optional(),
        timeframe: z.string().max(10).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    try {
      const res = await oms.submitOrder(context.userId, data);
      const snapshot = await oms.getSnapshot(context.userId, data.accountId);
      return { ...res, snapshot };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Order failed");
    }
  });

export const cancelTradeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ orderId: z.string().uuid(), accountId: z.string().uuid().optional() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.cancelOrder(context.userId, data.orderId);
    return oms.getSnapshot(context.userId, data.accountId);
  });

export const modifyTradeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        accountId: z.string().uuid().optional(),
        limitPrice: price.optional(),
        stopPrice: price.optional(),
        qty: z.number().finite().positive().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.modifyOrder(context.userId, data);
    return oms.getSnapshot(context.userId, data.accountId);
  });

export const setPositionBrackets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        positionId: z.string().uuid(),
        accountId: z.string().uuid().optional(),
        stopLoss: price.nullable().optional(),
        takeProfit: price.nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.setPositionProtection(context.userId, data);
    return oms.getSnapshot(context.userId, data.accountId);
  });

export const closeTradePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        positionId: z.string().uuid(),
        accountId: z.string().uuid().optional(),
        qty: z.number().finite().positive().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.closePosition(context.userId, data);
    return oms.getSnapshot(context.userId, data.accountId);
  });

export const flattenAllPositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.flattenAll(context.userId, data.accountId);
  });

export const resetPaperAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.resetAccount(context.userId, data.accountId);
  });

export const getRiskSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.loadRisk(context.userId);
  });

export const saveRiskSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        max_risk_per_trade: z.number().nonnegative().nullable().optional(),
        max_daily_loss: z.number().nonnegative().nullable().optional(),
        max_position_size: z.number().nonnegative().nullable().optional(),
        max_trades_per_day: z.number().int().nonnegative().nullable().optional(),
        max_open_positions: z.number().int().nonnegative().nullable().optional(),
        require_stop_loss: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.saveRisk(context.userId, data);
  });

export const listTradingAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.listAccounts(context.userId);
  });

// Phase 5B-Final — a read-only fallback for account discovery that never
// touches oms.server.ts/supabaseAdmin. `trading_accounts` already grants
// SELECT to its own owner via RLS, so this can answer "does this user have
// a PAPER account, and which one" using ONLY the caller's own authenticated
// session — no service-role credential required. listTradingAccounts above
// stays the source of truth for the full account list (balances, equity,
// auto-provisioning); this exists so Strategy Execution's paper-only gating
// keeps working even when the privileged path is unavailable.
export const listMyPaperAccountsBasic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trading_accounts")
      .select("id, label, environment, account_number, currency, status")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createPaperTradingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        label: z.string().trim().min(1).max(60),
        startingBalance: z.number().finite().positive().max(10_000_000),
        currency: z.enum(["USD", "EUR", "GBP"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.createPaperAccount(context.userId, data);
    return oms.listAccounts(context.userId);
  });

export const deleteTradingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ accountId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.deletePaperAccount(context.userId, data.accountId);
  });

export const renameTradingAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        label: z.string().trim().min(1).max(60),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    return oms.renamePaperAccount(context.userId, data.accountId, data.label);
  });

export const reverseTradePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ positionId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.reversePosition(context.userId, data.positionId);
    return oms.getSnapshot(context.userId);
  });

export const breakevenTradePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ positionId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const oms = await import("@/lib/trading/oms.server");
    await oms.movePositionToBreakeven(context.userId, data.positionId);
    return oms.getSnapshot(context.userId);
  });
