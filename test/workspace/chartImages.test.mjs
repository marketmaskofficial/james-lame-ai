// Coverage for the Chart Studio "Image" drawing tool's storage wrapper:
// src/lib/storage/chartImages.ts. No React, no DOM, no real network/Supabase
// project — every function accepts an injectable `client` matching the
// module's own minimal `ChartImageStorageClient` shape, so this file passes
// a small mock instead of constructing a real Supabase client (which would
// require live project credentials this test environment doesn't have).
//
// What this locks in: uploads go to the caller's OWN folder
// ("{userId}/{uuid}.{ext}", matching the Phase 3D-14 migration's owner-
// scoped RLS), client-side validation rejects oversized/unsupported files
// BEFORE ever calling the network, and every function surfaces a real Error
// on failure rather than silently swallowing it.
//
// Usage: npx tsx test/workspace/chartImages.test.mjs

import {
  CHART_IMAGES_BUCKET,
  MAX_CHART_IMAGE_BYTES,
  ALLOWED_CHART_IMAGE_MIME_TYPES,
  validateChartImageFile,
  uploadChartImage,
  createChartImageSignedUrl,
  deleteChartImage,
} from "../../src/lib/storage/chartImages.ts";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}\n  expected truthy condition`);
  }
}

async function rejects(name, fn) {
  try {
    await fn();
    fail++;
    failures.push(`${name}\n  expected the promise to reject, but it resolved`);
  } catch {
    pass++;
  }
}

function makeFile(name, type, sizeBytes) {
  // A real `File` (Node 20+ global) with actual byte length — validation
  // reads `.size`, not the buffer's semantic content, so filler bytes are fine.
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

// ---- validateChartImageFile -------------------------------------------

{
  ok("a normal small PNG passes validation", validateChartImageFile(makeFile("a.png", "image/png", 1024)) === null);
  ok("a file exactly at the limit passes", validateChartImageFile(makeFile("a.png", "image/png", MAX_CHART_IMAGE_BYTES)) === null);
  ok("a file one byte over the limit is rejected as too-large", validateChartImageFile(makeFile("a.png", "image/png", MAX_CHART_IMAGE_BYTES + 1)) === "too-large");
  ok("an unsupported MIME type is rejected", validateChartImageFile(makeFile("a.pdf", "application/pdf", 1024)) === "unsupported-type");
  ok("every ALLOWED_CHART_IMAGE_MIME_TYPES entry individually passes", ALLOWED_CHART_IMAGE_MIME_TYPES.every((type) => validateChartImageFile(makeFile("a", type, 1024)) === null));
}

// ---- uploadChartImage ---------------------------------------------------

function makeMockClient({ uploadError = null } = {}) {
  const calls = { upload: [], createSignedUrl: [], remove: [] };
  const client = {
    storage: {
      from(bucket) {
        return {
          async upload(path, file, options) {
            calls.upload.push({ bucket, path, file, options });
            if (uploadError) return { data: null, error: { message: uploadError } };
            return { data: { path }, error: null };
          },
          async createSignedUrl(path, expiresIn) {
            calls.createSignedUrl.push({ bucket, path, expiresIn });
            return { data: { signedUrl: `https://mock.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc` }, error: null };
          },
          async remove(paths) {
            calls.remove.push({ bucket, paths });
            return { data: null, error: null };
          },
        };
      },
    },
  };
  return { client, calls };
}

{
  const { client, calls } = makeMockClient();
  const file = makeFile("chart.png", "image/png", 2048);
  const path = await uploadChartImage(file, "user-123", client);
  ok("uploadChartImage returns a path (never a URL)", !path.startsWith("http") && !path.startsWith("data:") && !path.startsWith("blob:"));
  ok("the path is namespaced under the caller's own userId (RLS owner-folder convention)", path.startsWith("user-123/"));
  ok("the path ends with the correct extension for the file's MIME type", path.endsWith(".png"));
  ok("upload targeted the chart-images bucket", calls.upload[0].bucket === CHART_IMAGES_BUCKET);
  ok("upload passed the file's real contentType through", calls.upload[0].options.contentType === "image/png");
  ok("upload did not set upsert (never silently overwrite)", calls.upload[0].options.upsert === false);
}

{
  const { client, calls } = makeMockClient();
  const bigFile = makeFile("huge.png", "image/png", MAX_CHART_IMAGE_BYTES + 1);
  await rejects("uploadChartImage rejects an oversized file", () => uploadChartImage(bigFile, "user-123", client));
  ok("an oversized file never reaches the network at all", calls.upload.length === 0);
}

{
  const { client, calls } = makeMockClient();
  const badFile = makeFile("doc.pdf", "application/pdf", 1024);
  await rejects("uploadChartImage rejects an unsupported MIME type", () => uploadChartImage(badFile, "user-123", client));
  ok("an unsupported-type file never reaches the network at all", calls.upload.length === 0);
}

{
  const { client } = makeMockClient({ uploadError: "new row violates row-level security policy" });
  const file = makeFile("chart.png", "image/png", 2048);
  await rejects("uploadChartImage surfaces a Storage-side error (e.g. RLS rejection) instead of swallowing it", () => uploadChartImage(file, "user-123", client));
}

{
  const { client } = makeMockClient();
  const jpg = makeFile("photo.jpg", "image/jpeg", 2048);
  const path = await uploadChartImage(jpg, "user-abc", client);
  ok("a .jpg file gets the .jpg extension (not .jpeg)", path.endsWith(".jpg"));
}

// ---- createChartImageSignedUrl ------------------------------------------

{
  const { client, calls } = makeMockClient();
  const url = await createChartImageSignedUrl("user-123/abc.png", client);
  ok("createChartImageSignedUrl returns a real URL string", typeof url === "string" && url.startsWith("https://"));
  ok("it targeted the chart-images bucket", calls.createSignedUrl[0].bucket === CHART_IMAGES_BUCKET);
  ok("it requested the given path", calls.createSignedUrl[0].path === "user-123/abc.png");
  ok("it requested a positive, bounded expiry (a durable/never-expiring URL would defeat the whole point of a private bucket)", calls.createSignedUrl[0].expiresIn > 0 && calls.createSignedUrl[0].expiresIn <= 24 * 60 * 60);
}

{
  const client = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null, error: { message: "Object not found" } }),
      }),
    },
  };
  await rejects("createChartImageSignedUrl rejects when the object is missing/inaccessible", () => createChartImageSignedUrl("user-123/gone.png", client));
}

// ---- deleteChartImage ----------------------------------------------------

{
  const { client, calls } = makeMockClient();
  await deleteChartImage("user-123/abc.png", client);
  ok("deleteChartImage targeted the chart-images bucket", calls.remove[0].bucket === CHART_IMAGES_BUCKET);
  ok("deleteChartImage passed the exact path to remove", calls.remove[0].paths[0] === "user-123/abc.png" && calls.remove[0].paths.length === 1);
}

{
  const client = {
    storage: {
      from: () => ({
        remove: async () => ({ data: null, error: { message: "permission denied" } }),
      }),
    },
  };
  await rejects("deleteChartImage surfaces a Storage-side error instead of swallowing it", () => deleteChartImage("someone-else/abc.png", client));
}

// ---- summary ----------------------------------------------------------------

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:\n");
  for (const f of failures) console.log(`  ${f}\n`);
  process.exit(1);
}
