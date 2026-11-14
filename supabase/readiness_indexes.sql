-- Add covering indexes for the existing foreign keys and reader/admin query paths.
begin;
create index if not exists akili_audit_actor_idx on public.akili_audit_logs(actor_id,created_at desc);
create index if not exists akili_invite_accepted_idx on public.akili_author_invitations(accepted_by);
create index if not exists akili_invite_sender_idx on public.akili_author_invitations(invited_by);
create index if not exists akili_entitlement_book_idx on public.akili_entitlements(book_id);
create index if not exists akili_version_actor_idx on public.akili_product_versions(actor_id);
create index if not exists akili_version_book_idx on public.akili_product_versions(book_id,created_at desc);
create index if not exists akili_progress_book_idx on public.akili_reading_progress(book_id);
create index if not exists akili_review_book_idx on public.akili_reviews(book_id,status,created_at desc);
create index if not exists akili_sms_actor_idx on public.akili_sms_campaigns(actor_id,created_at desc);
create index if not exists akili_support_user_idx on public.akili_support_tickets(user_id,created_at desc);
create index if not exists akili_access_event_order_idx on public.ebook_access_events(order_id,created_at desc);
create index if not exists akili_access_token_order_idx on public.ebook_access_tokens(order_id);
create index if not exists akili_order_book_idx on public.ebook_orders(book_id,created_at desc);
commit;
