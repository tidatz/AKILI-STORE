-- AKILI STORE: private per-reader copies with visible traceable watermarks.
-- Additive only; existing books, orders, entitlements and files remain unchanged.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ebook-reader-cache', 'ebook-reader-cache', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/pdf'];
