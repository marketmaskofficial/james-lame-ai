import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SELECT =
  "id, name, code, pine, spec, kind, symbol, timeframe, current_version, settings, is_overlay, created_at, updated_at";
const VERSION_SELECT =
  "id, indicator_id, version, name, spec, pine, code, settings, is_overlay, changelog, created_at";

const jsonRecord = z.record(z.string(), z.unknown());

export const listIndicators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("indicators")
      .select(SELECT)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getIndicator = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("indicators")
      .select(SELECT)
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createIndicator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        code: z.string().max(200_000),
        pine: z.string().max(200_000).optional(),
        spec: jsonRecord.optional(),
        kind: z.enum(["indicator", "strategy"]).optional(),
        symbol: z.string().max(40).optional(),
        timeframe: z.string().max(10).optional(),
        settings: jsonRecord.optional(),
        isOverlay: z.boolean().optional(),
        changelog: z.string().max(500).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("indicators")
      .insert({
        user_id: context.userId,
        name: data.name,
        code: data.code,
        pine: data.pine ?? "",
        spec: (data.spec ?? {}) as never,
        kind: data.kind ?? "indicator",
        symbol: data.symbol ?? null,
        timeframe: data.timeframe ?? null,
        current_version: 1,
        settings: (data.settings ?? {}) as never,
        is_overlay: data.isOverlay ?? true,
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("indicator_versions").insert({
      indicator_id: row.id,
      user_id: context.userId,
      version: 1,
      name: row.name,
      spec: row.spec as never,
      pine: row.pine ?? "",
      code: row.code,
      settings: row.settings as never,
      is_overlay: row.is_overlay,
      changelog: data.changelog ?? "Initial version",
    });

    return row;
  });

export const updateIndicator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        code: z.string().max(200_000).optional(),
        pine: z.string().max(200_000).optional(),
        spec: jsonRecord.optional(),
        kind: z.enum(["indicator", "strategy"]).optional(),
        symbol: z.string().max(40).optional(),
        timeframe: z.string().max(10).optional(),
        settings: jsonRecord.optional(),
        isOverlay: z.boolean().optional(),
        // When true, snapshot the resulting state as a new version.
        snapshot: z.boolean().optional(),
        changelog: z.string().max(500).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.code !== undefined) patch.code = data.code;
    if (data.pine !== undefined) patch.pine = data.pine;
    if (data.spec !== undefined) patch.spec = data.spec;
    if (data.kind !== undefined) patch.kind = data.kind;
    if (data.symbol !== undefined) patch.symbol = data.symbol;
    if (data.timeframe !== undefined) patch.timeframe = data.timeframe;
    if (data.settings !== undefined) patch.settings = data.settings;
    if (data.isOverlay !== undefined) patch.is_overlay = data.isOverlay;

    if (data.snapshot) {
      const { data: cur } = await context.supabase
        .from("indicators")
        .select(SELECT)
        .eq("id", data.id)
        .single();
      if (cur) patch.current_version = (cur.current_version ?? 1) + 1;
    }

    if (Object.keys(patch).length === 0) return { ok: true, version: null };

    const { data: row, error } = await context.supabase
      .from("indicators")
      .update(patch as never)
      .eq("id", data.id)
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);

    if (data.snapshot && row) {
      await context.supabase.from("indicator_versions").insert({
        indicator_id: row.id,
        user_id: context.userId,
        version: row.current_version,
        name: row.name,
        spec: row.spec as never,
        pine: row.pine ?? "",
        code: row.code,
        settings: row.settings as never,
        is_overlay: row.is_overlay,
        changelog: data.changelog ?? "Updated",
      });
    }

    return { ok: true, version: row?.current_version ?? null };
  });

export const deleteIndicator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("indicators")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateIndicator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), name: z.string().trim().max(120).optional() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: src, error: readErr } = await context.supabase
      .from("indicators")
      .select(SELECT)
      .eq("id", data.id)
      .single();
    if (readErr) throw new Error(readErr.message);

    const { data: row, error } = await context.supabase
      .from("indicators")
      .insert({
        user_id: context.userId,
        name: data.name?.trim() || `${src.name} copy`,
        code: src.code,
        pine: src.pine ?? "",
        spec: src.spec as never,
        kind: src.kind,
        symbol: src.symbol,
        timeframe: src.timeframe,
        current_version: 1,
        settings: src.settings as never,
        is_overlay: src.is_overlay,
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("indicator_versions").insert({
      indicator_id: row.id,
      user_id: context.userId,
      version: 1,
      name: row.name,
      spec: row.spec as never,
      pine: row.pine ?? "",
      code: row.code,
      settings: row.settings as never,
      is_overlay: row.is_overlay,
      changelog: `Duplicated from "${src.name}"`,
    });

    return row;
  });

export const listVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ indicatorId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("indicator_versions")
      .select(VERSION_SELECT)
      .eq("indicator_id", data.indicatorId)
      .order("version", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const restoreVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ indicatorId: z.string().uuid(), version: z.number().int().min(1) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: v, error } = await context.supabase
      .from("indicator_versions")
      .select(VERSION_SELECT)
      .eq("indicator_id", data.indicatorId)
      .eq("version", data.version)
      .single();
    if (error) throw new Error(error.message);

    const { data: cur } = await context.supabase
      .from("indicators")
      .select("current_version")
      .eq("id", data.indicatorId)
      .single();
    const nextVersion = (cur?.current_version ?? 1) + 1;

    const { error: upErr } = await context.supabase
      .from("indicators")
      .update({
        name: v.name,
        code: v.code,
        pine: v.pine,
        spec: v.spec as never,
        settings: v.settings as never,
        is_overlay: v.is_overlay,
        current_version: nextVersion,
      } as never)
      .eq("id", data.indicatorId);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.from("indicator_versions").insert({
      indicator_id: data.indicatorId,
      user_id: context.userId,
      version: nextVersion,
      name: v.name,
      spec: v.spec as never,
      pine: v.pine,
      code: v.code,
      settings: v.settings as never,
      is_overlay: v.is_overlay,
      changelog: `Restored from v${data.version}`,
    });

    return { ok: true, version: nextVersion, restored: v };
  });
