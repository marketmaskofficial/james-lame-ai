/**
 * Phase 3D-14: the ONLY place that talks to Supabase Storage for the Chart
 * Studio "Image" drawing tool -- StudioChart.tsx never calls
 * `supabase.storage` directly, so the tool's actual network/error handling
 * lives in one small, independently unit-testable module instead of being
 * scattered through the render loop.
 *
 * Bucket ("chart-images") is PRIVATE -- see the Phase 3D-14 migration
 * (supabase/migrations/20260827120000_chart_images_bucket.sql). A private
 * bucket means there is no permanent public URL: every read goes through a
 * short-lived signed URL resolved on demand. The durable, canonical
 * reference persisted into drawing state is always the object PATH
 * ("{userId}/{uuid}.{ext}"), never a URL of any kind -- see
 * `uploadChartImage`'s own doc comment.
 */
import { supabase } from "@/integrations/supabase/client";

export const CHART_IMAGES_BUCKET = "chart-images";

/** Mirrors the bucket's own `file_size_limit` (see the Phase 3D-14
 * migration) -- that server-side limit is the real enforcement layer; this
 * constant only lets the client reject an oversized file before spending
 * an upload round trip. */
export const MAX_CHART_IMAGE_BYTES = 5 * 1024 * 1024;

/** Mirrors the bucket's own `allowed_mime_types`, same reasoning as above. */
export const ALLOWED_CHART_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** How long a resolved signed URL stays valid. Short enough that a leaked
 * URL isn't useful for long; long enough that one chart session realistically
 * won't need it re-resolved mid-view. StudioChart.tsx's runtime cache
 * re-resolves on expiry (see its own doc comment) rather than persisting
 * this anywhere. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type ChartImageValidationError = "too-large" | "unsupported-type";

/** Client-side pre-check only. Purely a fast-fail UX nicety — the bucket's
 * own `file_size_limit`/`allowed_mime_types` is what actually enforces
 * this; a hostile client could skip this function entirely and Storage
 * would still reject the upload. */
export function validateChartImageFile(file: File): ChartImageValidationError | null {
  if (file.size > MAX_CHART_IMAGE_BYTES) return "too-large";
  if (!(ALLOWED_CHART_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "unsupported-type";
  return null;
}

function extensionFor(file: File): string {
  const byType: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
  if (byType[file.type]) return byType[file.type];
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "png";
}

/** The minimal shape this module actually calls on a Supabase client —
 * deliberately structural (not `SupabaseClient<Database>`) so a test can
 * pass a tiny mock object instead of constructing a real client. */
export type ChartImageStorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      createSignedUrl: (path: string, expiresInSeconds: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

/**
 * Uploads an already-validated image into the caller's OWN folder
 * ("{userId}/{uuid}.{ext}" — matching the migration's RLS policies, which
 * check that the first path segment equals `auth.uid()`) and returns the
 * durable, canonical PATH. This return value — and ONLY this — is what
 * StudioChart.tsx persists as `settings.imagePath`. Never a signed URL,
 * never base64, never a blob URL: a signed URL expires and therefore isn't
 * durable drawing state.
 */
export async function uploadChartImage(file: File, userId: string, client: ChartImageStorageClient = supabase): Promise<string> {
  const invalid = validateChartImageFile(file);
  if (invalid) throw new Error(invalid === "too-large" ? "Image exceeds the 5 MB limit." : "Unsupported image type — use PNG, JPEG, WEBP, or GIF.");
  const path = `${userId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await client.storage.from(CHART_IMAGES_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Resolves a short-lived signed URL for a stored path — the only way this
 * PRIVATE bucket's objects are ever viewable. StudioChart.tsx caches the
 * result in memory only (never in persisted drawing state) and re-resolves
 * when a cached URL has expired or failed to load.
 */
export async function createChartImageSignedUrl(path: string, client: ChartImageStorageClient = supabase): Promise<string> {
  const { data, error } = await client.storage.from(CHART_IMAGES_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Failed to create a signed URL for this image.");
  return data.signedUrl;
}

/**
 * Deletes a stored object outright. Phase 3D-14 deliberately does NOT call
 * this when a drawing is deleted or replaced — a `Duplicate`d drawing can
 * share the exact same `imagePath`, so deleting the underlying object the
 * moment ONE of those drawings is removed would silently break every other
 * drawing still referencing it. Exposed here for a possible future
 * explicit "delete this asset" action or a reference-counted cleanup job —
 * neither is built in this phase (see StudioChart.tsx's delete-handling
 * comment).
 */
export async function deleteChartImage(path: string, client: ChartImageStorageClient = supabase): Promise<void> {
  const { error } = await client.storage.from(CHART_IMAGES_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
