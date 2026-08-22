import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Backs UI-5c's persistent AI Builder conversation history. Reads/writes
// public.indicator_messages, scoped by indicator_id (see the pending
// migration 20260822090000_indicator_messages.sql). Until that migration is
// applied, both calls below will fail server-side (relation does not
// exist) — callers must treat that as "conversation isn't persisted yet",
// not as a fatal error; the AI Builder itself keeps working locally either
// way (see AiSidePanel.tsx's persistMessage/loadMessages handling).

const SELECT = "id, indicator_id, role, kind, content, status, issues, created_at";

export const listIndicatorMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ indicatorId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("indicator_messages")
      .select(SELECT)
      .eq("indicator_id", data.indicatorId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const appendIndicatorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        indicatorId: z.string().uuid(),
        role: z.enum(["user", "ai"]),
        kind: z.enum(["build", "explain"]).default("build"),
        content: z.string().max(20_000),
        status: z.enum(["success", "warning", "error"]).optional(),
        issues: z.number().int().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("indicator_messages").insert({
      indicator_id: data.indicatorId,
      user_id: context.userId,
      role: data.role,
      kind: data.kind,
      content: data.content,
      status: data.status ?? null,
      issues: data.issues ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
