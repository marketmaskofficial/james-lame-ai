import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const FEEDBACK_CATEGORIES = [
  "Bug",
  "AI Generated Wrong Result",
  "Indicator Problem",
  "Backtest Problem",
  "Chart Problem",
  "Trading Problem",
  "Feature Request",
  "Other",
] as const;

const schema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().min(3).max(4000),
  page: z.string().max(120).optional(),
  symbol: z.string().max(40).optional(),
  timeframe: z.string().max(10).optional(),
  projectId: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
});

/** Stores one beta feedback report for the signed-in user. */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => schema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("feedback").insert({
      user_id: context.userId,
      category: data.category,
      message: data.message,
      page: data.page ?? null,
      symbol: data.symbol ?? null,
      timeframe: data.timeframe ?? null,
      project_id: data.projectId ?? null,
      app_version: data.appVersion ?? null,
    });
    if (error) throw new Error("Could not save feedback");
    return { ok: true };
  });
