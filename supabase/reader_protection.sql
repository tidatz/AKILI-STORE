-- AKILI STORE: private per-reader copies with visible traceable watermarks.
-- Additive only; existing books, orders, entitlements and files remain unchanged.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ebook-reader-cache', 'ebook-reader-cache', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/pdf'];

alter table public.ebook_access_events
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists watermark_ref text;

create index if not exists ebook_access_watermark_ref_idx
  on public.ebook_access_events(watermark_ref)
  where watermark_ref is not null;

alter table public.ebook_access_events enable row level security;
revoke all on public.ebook_access_events from anon, authenticated;
grant all on public.ebook_access_events to service_role;
