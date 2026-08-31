-- Phase 3D-14: durable storage for the Chart Studio "Image" drawing tool.
-- PRIVATE bucket (public = false) -- user-uploaded chart images may contain
-- sensitive chart/account information, so a permanent public URL is not
-- acceptable. Rendering instead resolves a short-lived signed URL on demand
-- (see src/lib/storage/chartImages.ts); only the object PATH is ever
-- persisted as drawing state.
--
-- Objects are namespaced "{auth.uid()}/{uuid}.{ext}" -- every policy below
-- checks that the first path segment equals the caller's own auth.uid(),
-- so a user can only see/write/replace/delete objects inside their own
-- folder, never another user's.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chart-images',
  'chart-images',
  false,
  5242880, -- 5 MB, matching this phase's client-side validation
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "Users upload own chart images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chart-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users read own chart images"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chart-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users update own chart images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'chart-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'chart-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete own chart images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chart-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
