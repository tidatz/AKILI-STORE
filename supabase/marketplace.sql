-- Additive upgrade for the existing single-book store. Never drops customer data.
begin;
create table if not exists public.akili_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', phone text not null default '', bio text not null default '',
  role text not null default 'reader' check(role in ('reader','author')),
  status text not null default 'active' check(status in ('active','restricted')),
  created_at timestamptz not null default now()
);
alter table public.ebook_books add column if not exists author_id uuid references auth.users(id);
alter table public.ebook_books add column if not exists author_name text not null default '';
alter table public.ebook_books add column if not exists category text not null default 'Biashara';
alter table public.ebook_books add column if not exists language text not null default 'Kiswahili';
alter table public.ebook_books add column if not exists preview_path text;
alter table public.ebook_books add column if not exists page_count integer check(page_count > 0);
alter table public.ebook_books add column if not exists moderation_note text not null default '';
alter table public.ebook_books drop constraint if exists ebook_books_status_check;
alter table public.ebook_books add constraint ebook_books_status_check check(status in ('draft','submitted','changes_requested','published','rejected','archived'));
alter table public.ebook_orders add column if not exists user_id uuid references auth.users(id);
alter table public.ebook_site_settings add column if not exists hero_title text not null default 'Maarifa mazuri. Hatua kubwa.';
alter table public.ebook_site_settings add column if not exists hero_description text not null default 'Gundua vitabu vya kukusaidia kuelewa zaidi, kufanya maamuzi bora na kujenga kitu chako.';
alter table public.ebook_site_settings add column if not exists support_email text not null default 'tidatzsupport@gmail.com';
alter table public.ebook_site_settings add column if not exists author_percent integer not null default 60 check(author_percent between 0 and 100);
alter table public.ebook_site_settings add column if not exists withdrawal_min_tzs integer not null default 10000 check(withdrawal_min_tzs >= 500);
alter table public.ebook_site_settings add column if not exists withdrawal_fee_tzs integer not null default 2000 check(withdrawal_fee_tzs >= 0);
update public.ebook_site_settings set site_name='AKILI STORE' where id=1 and site_name='';

create table if not exists public.akili_author_invitations (
  id uuid primary key default gen_random_uuid(), email text not null,
  token_hash text unique not null, invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days', accepted_by uuid references auth.users(id),
  accepted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.akili_entitlements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  book_id uuid not null references public.ebook_books(id), order_id uuid not null unique references public.ebook_orders(id),
  revoked_at timestamptz, created_at timestamptz not null default now(), unique(user_id,book_id)
);
create table if not exists public.akili_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.ebook_books(id), page integer not null default 1 check(page>0),
  total_pages integer not null default 1 check(total_pages>0), updated_at timestamptz not null default now(),
  primary key(user_id,book_id)
);
create table if not exists public.akili_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  book_id uuid not null references public.ebook_books(id), rating integer not null check(rating between 1 and 5),
  body text not null check(length(body) between 10 and 2000),
  status text not null default 'pending' check(status in ('pending','published','rejected')),
  created_at timestamptz not null default now(), unique(user_id,book_id)
);
create table if not exists public.akili_support_tickets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  subject text not null, message text not null, reply text not null default '',
  status text not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.akili_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  title text not null, body text not null default '', href text not null default '/my-library',
  read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.akili_audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
  action text not null, target_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.akili_product_versions (
  id uuid primary key default gen_random_uuid(), book_id uuid not null references public.ebook_books(id),
  actor_id uuid not null references auth.users(id), snapshot jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.akili_ledger (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ebook_orders(id),
  author_id uuid references auth.users(id), account text not null check(account in ('author','platform','system')),
  amount_tzs integer not null check(amount_tzs>=0), created_at timestamptz not null default now(), unique(order_id,account)
);
create table if not exists public.akili_withdrawals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  amount_tzs integer not null check(amount_tzs>0), fee_tzs integer not null check(fee_tzs>=0),
  phone text not null, status text not null default 'pending' check(status in ('pending','paid','declined')),
  reference text, note text not null default '', created_at timestamptz not null default now(), processed_at timestamptz
);
create index if not exists akili_books_author on public.ebook_books(author_id);
create index if not exists akili_orders_user on public.ebook_orders(user_id,created_at desc);
create index if not exists akili_notifications_user on public.akili_notifications(user_id,created_at desc);
create index if not exists akili_ledger_author on public.akili_ledger(author_id);
create index if not exists akili_withdrawals_user on public.akili_withdrawals(user_id,status);

-- Every business table is server-only. Supabase Auth validates the user; API checks ownership.
do $$ declare t text; begin
  foreach t in array array['akili_profiles','akili_author_invitations','akili_entitlements','akili_reading_progress','akili_reviews','akili_support_tickets','akili_notifications','akili_audit_logs','akili_product_versions','akili_ledger','akili_withdrawals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
-- Approved samples use a different private bucket. Full PDFs never become public previews.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ebook-previews','ebook-previews',false,10485760,array['application/pdf']) on conflict(id) do nothing;

insert into public.akili_profiles(user_id,display_name,role)
 select u.id,'Dr Swabur','author' from auth.users u join public.ebook_admins a on a.user_id=u.id
 where lower(u.email)='tidatzacademy@gmail.com' on conflict(user_id) do nothing;
update public.ebook_books set author_id=(select user_id from public.akili_profiles where display_name='Dr Swabur' limit 1),author_name='Dr Swabur'
 where slug='mifumo-7-muhimu' and author_id is null;

-- Payment, entitlement, allocation and notification commit together, including retries.
create or replace function public.ebook_apply_payment_event(p_event_id text,p_reference text,p_order_id uuid,p_status text,p_amount integer,p_currency text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare p record; o record; b record; author_share integer; rate integer;
begin
 if p_status not in ('completed','failed','expired','voided') then raise exception 'Unsupported provider status'; end if;
 select * into p from public.ebook_payments where provider_reference=p_reference and order_id=p_order_id for update;
 select * into o from public.ebook_orders where id=p_order_id for update;
 if p.id is null or o.id is null or p.amount_tzs<>p_amount or o.amount_tzs<>p_amount or p.currency<>p_currency or p_currency<>'TZS' then raise exception 'Payment mismatch'; end if;
 insert into public.ebook_webhook_events(event_id,provider_reference) values(p_event_id,p_reference) on conflict do nothing;
 if p.status='completed' then return true; end if;
 update public.ebook_payments set status=p_status,updated_at=now() where id=p.id;
 if p_status='completed' then
   update public.ebook_orders set status='paid',paid_at=coalesce(paid_at,now()) where id=o.id;
   select * into b from public.ebook_books where id=o.book_id;
   select author_percent into rate from public.ebook_site_settings where id=1;
   author_share:=floor(p_amount*coalesce(rate,60)/100.0)::integer;
   insert into public.akili_ledger(order_id,author_id,account,amount_tzs) values
     (o.id,b.author_id,'author',author_share),(o.id,null,'system',floor(p_amount*0.10)::integer),
     (o.id,null,'platform',p_amount-author_share-floor(p_amount*0.10)::integer) on conflict do nothing;
   if o.user_id is not null then
     insert into public.akili_entitlements(user_id,book_id,order_id) values(o.user_id,o.book_id,o.id) on conflict do nothing;
     insert into public.akili_notifications(user_id,title,body) values(o.user_id,'Kitabu chako kipo tayari',b.title);
   end if;
 else
   update public.ebook_orders set status=case when p_status='expired' then 'expired' else 'failed' end where id=o.id and status<>'paid';
 end if;
 return true;
end $$;
revoke all on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) to service_role;

create or replace function public.akili_request_withdrawal(p_user_id uuid,p_amount integer,p_phone text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare earned bigint; reserved bigint; minimum integer; fee integer; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
 if not exists(select 1 from public.akili_profiles where user_id=p_user_id and role='author' and status='active') then raise exception 'Author required'; end if;
 select withdrawal_min_tzs,withdrawal_fee_tzs into minimum,fee from public.ebook_site_settings where id=1;
 select coalesce(sum(amount_tzs),0) into earned from public.akili_ledger where author_id=p_user_id and account='author';
 select coalesce(sum(amount_tzs),0) into reserved from public.akili_withdrawals where user_id=p_user_id and status in ('pending','paid');
 if p_amount<minimum or p_amount<=fee or p_amount>earned-reserved or p_phone!~'^255[0-9]{9}$' then raise exception 'Invalid withdrawal or insufficient balance'; end if;
 insert into public.akili_withdrawals(user_id,amount_tzs,fee_tzs,phone) values(p_user_id,p_amount,fee,p_phone) returning id into result;
 return result;
end $$;
revoke all on function public.akili_request_withdrawal(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.akili_request_withdrawal(uuid,integer,text) to service_role;

-- Invitation acceptance is atomic and binds to the authenticated, verified email.
create or replace function public.akili_accept_invitation(p_user_id uuid,p_token_hash text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare invite record; email_address text;
begin
 select lower(email) into email_address from auth.users where id=p_user_id and email_confirmed_at is not null;
 select * into invite from public.akili_author_invitations where token_hash=p_token_hash for update;
 if invite.id is null or invite.expires_at<=now() or invite.accepted_at is not null or lower(invite.email)<>email_address or email_address is null then raise exception 'Invitation invalid'; end if;
 update public.akili_author_invitations set accepted_by=p_user_id,accepted_at=now() where id=invite.id;
 update public.akili_profiles set role='author' where user_id=p_user_id and status='active';
 return true;
end $$;
revoke all on function public.akili_accept_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.akili_accept_invitation(uuid,text) to service_role;
commit;
