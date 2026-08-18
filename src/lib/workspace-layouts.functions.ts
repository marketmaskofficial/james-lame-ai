import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SELECT = "id, name, layout, is_default, created_at, updated_at";

const jsonRecord = z.record(z.string(), z.unknown());

/**
 * Saves a named workspace layout. Upserts by id when one is supplied
 * (updating an already-saved layout), otherwise inserts a new row — mirrors
 * how the local "Save" vs "Save as new layout…" actions in LayoutMenu work.
 */
export const saveWorkspaceLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        layout: jsonRecord,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("workspace_layouts")
        .update({ name: data.name, layout: data.layout as never, updated_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw new Error("Could not save this workspace layout");
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("workspace_layouts")
      .insert({ user_id: context.userId, name: data.name, layout: data.layout as never })
      .select("id")
      .single();
    if (error) throw new Error("Could not save this workspace layout");
    return { ok: true, id: inserted.id as string };
  });

export const listWorkspaceLayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("workspace_layouts")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteWorkspaceLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workspace_layouts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Marks one layout as the user's default and unmarks any other — a single
 * two-statement operation (clear all, then set the target) rather than a
 * read-then-write race that could momentarily leave two rows default or
 * none at all.
 */
export const setDefaultWorkspaceLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error: clearError } = await context.supabase
      .from("workspace_layouts")
      .update({ is_default: false })
      .eq("user_id", context.userId);
    if (clearError) throw new Error(clearError.message);
    if (data.id) {
      const { error: setError } = await context.supabase
        .from("workspace_layouts")
        .update({ is_default: true })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (setError) throw new Error(setError.message);
    }
    return { ok: true };
  });
