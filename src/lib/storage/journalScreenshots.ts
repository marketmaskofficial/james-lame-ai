/**
 * Phase 4E-2 — the ONLY place that talks to Supabase Storage for Trade
 * Journal screenshots. Mirrors `src/lib/storage/chartImages.ts` exactly
 * (private bucket, `{userId}/{uuid}.{ext}` path convention, signed-URL
 * reads, path-only persistence) but uses its own bucket: journal
 * screenshots are 1:1 owned by a journal entry and deletable outright,
 * unlike chart-drawing images which can be shared across duplicated
 * drawings — sharing one bucket would risk one feature's delete semantics
 * breaking the other's.
 *
 * Bucket ("journal-screenshots") is PRIVATE — see the Phase 4E-2 migration
 * (supabase/migrations/20260829140000_journal_taxonomy_and_reviews.sql).
 * The durable, canonical reference persisted into `journal_screenshots` is
 * always the object PATH, never a URL — a signed URL expires and is
 * resolved fresh on demand by the server (see `listJournalScreenshots` in
 * `src/lib/trades.functions.ts`), never stored.
 */
import { supabase } from "@/integrations/supabase/client";

export const JOURNAL_SCREENSHOTS_BUCKET = "journal-screenshots";

/** Mirrors the bucket's own `file_size_limit`. */
export const MAX_JOURNAL_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Mirrors the bucket's own `allowed_mime_types`. */
export const ALLOWED_JOURNAL_SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type JournalScreenshotValidationError = "too-large" | "unsupported-type";

/** Client-side pre-check only — the bucket's own `file_size_limit`/
 * `allowed_mime_types` is what actually enforces this. */
export function validateJournalScreenshotFile(file: File): JournalScreenshotValidationError | null {
  if (file.size > MAX_JOURNAL_SCREENSHOT_BYTES) return "too-large";
  if (!(ALLOWED_JOURNAL_SCREENSHOT_MIME_TYPES as readonly string[]).includes(file.type)) return "unsupported-type";
  return null;
}

function extensionFor(file: File): string {
  const byType: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
  if (byType[file.type]) return byType[file.type];
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "png";
}

/** Deliberately structural (not `SupabaseClient<Database>`), matching
 * `chartImages.ts`'s own convention, so a test can pass a small mock. */
export type JournalScreenshotStorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
};

/**
 * Uploads an already-validated image into the caller's OWN folder
 * ("{userId}/{uuid}.{ext}") and returns the durable, canonical PATH — the
 * only thing ever persisted into `journal_screenshots.storage_path`.
 */
export async function uploadJournalScreenshotFile(file: File, userId: string, client: JournalScreenshotStorageClient = supabase): Promise<string> {
  const invalid = validateJournalScreenshotFile(file);
  if (invalid) throw new Error(invalid === "too-large" ? "Image exceeds the 5 MB limit." : "Unsupported image type — use PNG, JPEG, WEBP, or GIF.");
  const path = `${userId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await client.storage.from(JOURNAL_SCREENSHOTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
