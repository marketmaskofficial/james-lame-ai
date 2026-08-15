import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const credentials = z.object({
  name: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  appId: z.string().trim().min(1).max(120),
  appVersion: z.string().trim().min(1).max(40),
  cid: z.string().trim().min(1).max(60),
  sec: z.string().trim().min(1).max(200),
  deviceId: z.string().trim().max(120).optional(),
});

export const listBrokerConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const reg = await import("@/lib/trading/brokers/registry.server");
    return { connections: await reg.listConnections(context.userId) };
  });

/**
 * Saves credentials (encrypted at rest) and immediately proves them against
 * Tradovate. The connection is only reported as connected when the broker
 * answers with a real account list.
 */
export const connectTradovate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ environment: z.enum(["demo", "live"]), credentials })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const reg = await import("@/lib/trading/brokers/registry.server");
    const conn = await reg.saveTradovateConnection(context.userId, {
      environment: data.environment,
      credentials: {
        ...data.credentials,
        // Tradovate ties sessions to a stable device fingerprint; derive one
        // per user + app so re-auth does not look like a new machine.
        deviceId:
          data.credentials.deviceId ??
          `sg-${context.userId.replace(/-/g, "").slice(0, 24)}`,
      },
    });
    try {
      const { connection, accounts } = await reg.verifyConnection(
        context.userId,
        conn.id,
      );
      return { ok: true as const, connection, accounts };
    } catch (e) {
      return {
        ok: false as const,
        connectionId: conn.id,
        error: e instanceof Error ? e.message : "Connection failed",
      };
    }
  });

export const verifyBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ connectionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const reg = await import("@/lib/trading/brokers/registry.server");
    try {
      const { connection, accounts } = await reg.verifyConnection(
        context.userId,
        data.connectionId,
      );
      return { ok: true as const, connection, accounts };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Failed" };
    }
  });

export const importBrokerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        connectionId: z.string().uuid(),
        brokerAccountId: z.string().min(1).max(60),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const reg = await import("@/lib/trading/brokers/registry.server");
    const accountId = await reg.importBrokerAccount(
      context.userId,
      data.connectionId,
      data.brokerAccountId,
    );
    return { accountId };
  });

export const disconnectBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ connectionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const reg = await import("@/lib/trading/brokers/registry.server");
    await reg.deleteConnection(context.userId, data.connectionId);
    return { ok: true };
  });
