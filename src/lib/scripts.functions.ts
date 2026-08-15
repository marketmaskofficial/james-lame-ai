import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Scripts ----------

export const listScripts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("scripts")
      .select("id, title, code, created_at, updated_at, is_public")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setScriptPublic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), isPublic: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scripts")
      .update({ is_public: data.isPublic })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, isPublic: data.isPublic };
  });

export const getPublicScript = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const client = createClient(url, key, {
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
    const { data: script, error } = await client
      .from("scripts")
      .select("id, title, code, created_at, updated_at, is_public")
      .eq("id", data.id)
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!script) return null;
    const { data: messages } = await client
      .from("messages")
      .select("role, content, created_at")
      .eq("script_id", data.id)
      .order("created_at", { ascending: true });
    return { script, messages: messages ?? [] };
  });


export const getScript = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("scripts")
      .select("id, title, code, created_at, updated_at")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ title: z.string().trim().max(200).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("scripts")
      .insert({
        user_id: userId,
        title: data.title?.trim() || "New chat",
        prompt: "",
        code: "",
      })
      .select("id, title, code, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), title: z.string().trim().min(1).max(200) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scripts")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scripts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Messages ----------

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ scriptId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("script_id", data.scriptId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const appendTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        scriptId: z.string().uuid(),
        userMessage: z.string().min(1).max(8000),
        assistantMessage: z.string().min(1).max(200_000),
        code: z.string().max(200_000).optional(),
        titleIfEmpty: z.string().trim().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { error: msgErr } = await supabase.from("messages").insert([
      { script_id: data.scriptId, role: "user", content: data.userMessage },
      {
        script_id: data.scriptId,
        role: "assistant",
        content: data.assistantMessage,
      },
    ]);
    if (msgErr) throw new Error(msgErr.message);

    const update: {
      updated_at: string;
      code?: string;
      title?: string;
    } = { updated_at: new Date().toISOString() };
    if (data.code) update.code = data.code;

    if (data.titleIfEmpty) {
      const { data: current } = await supabase
        .from("scripts")
        .select("title")
        .eq("id", data.scriptId)
        .single();
      if (!current?.title || current.title === "New chat") {
        update.title = data.titleIfEmpty.slice(0, 60);
      }
    }

    const { error: updErr } = await supabase
      .from("scripts")
      .update(update)
      .eq("id", data.scriptId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true };
  });
