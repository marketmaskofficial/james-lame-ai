import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  event: z.string().min(1).max(60),
  props: z
    .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()]))
    .default({}),
});

/** Writes one product event for the signed-in user. Best-effort, never throws. */
export const recordEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => schema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("product_events").insert({
      user_id: context.userId,
      event: data.event,
      props: data.props,
    });
    return { ok: !error };
  });
