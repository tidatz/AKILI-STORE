-- Run on a dedicated Supabase project; server-only access through service_role.
create extension if not exists pgcrypto;

create table if not exists public.ebook_books (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (length(slug) between 2 and 100),
  title text not null,
  subtitle text not null default '',
  description text not null default '',
  price_tzs integer not null check (price_tzs >= 500),
  status text not null default 'draft' check (status in ('draft','published')),
  featured boolean not null default false,
  cover_path text,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ebook_single_featured on public.ebook_books(featured) where featured = true;

create table if not exists public.ebook_site_settings (
  id integer primary key default 1 check(id=1),
  site_name text not null default '',
  logo_path text,
  favicon_path text,
  primary_color text not null default '#1D4ED8',
  text_color text not null default '#121826',
  font_style text not null default 'system' check (font_style in ('system','serif')),
  buy_label text not null default 'NUNUA SASA',
  about_book text not null default '',
  about_author text not null default '',
  contents text not null default '',
  contact text not null default '',
  menu_about_book text not null default 'Kuhusu Kitabu',
  menu_about_author text not null default 'Kuhusu Mwandishi',
  menu_contents text not null default 'Yaliyomo',
  menu_contact text not null default 'Mawasiliano',
  published_at timestamptz not null default now()
);

create table if not exists public.ebook_orders (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null unique,
  checkout_secret_hash text not null,
  book_id uuid not null references public.ebook_books(id) on delete restrict,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  amount_tzs integer not null check (amount_tzs >= 500),
  currency text not null default 'TZS' check(currency='TZS'),
  status text not null default 'pending' check(status in ('pending','paid','failed','expired')),
  email_sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ebook_orders_recent on public.ebook_orders(created_at desc);
create index if not exists ebook_orders_email on public.ebook_orders(customer_email);

create table if not exists public.ebook_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.ebook_orders(id) on delete restrict,
  provider_reference text not null unique,
  amount_tzs integer not null check(amount_tzs >= 500),
  currency text not null default 'TZS' check(currency='TZS'),
  status text not null default 'pending' check(status in ('pending','completed','failed','expired','voided')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Safe when installing this schema onto a previously existing store.
alter table public.ebook_payments add column if not exists last_checked_at timestamptz;

create table if not exists public.ebook_access_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ebook_orders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ebook_access_expiry on public.ebook_access_tokens(expires_at);

create table if not exists public.ebook_access_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ebook_orders(id) on delete restrict,
  event_type text not null check(event_type in ('reader_open','download_request')),
  created_at timestamptz not null default now()
);
create index if not exists ebook_access_recent on public.ebook_access_events(created_at desc);

create table if not exists public.ebook_webhook_events (
  event_id text primary key,
  provider_reference text not null,
  received_at timestamptz not null default now()
);

create table if not exists public.ebook_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Browser clients must never access business tables directly, even if logged in.
alter table public.ebook_books enable row level security;
alter table public.ebook_site_settings enable row level security;
alter table public.ebook_orders enable row level security;
alter table public.ebook_payments enable row level security;
alter table public.ebook_access_tokens enable row level security;
alter table public.ebook_access_events enable row level security;
alter table public.ebook_webhook_events enable row level security;
alter table public.ebook_admins enable row level security;
revoke all on public.ebook_books, public.ebook_site_settings, public.ebook_orders,
  public.ebook_payments, public.ebook_access_tokens, public.ebook_access_events,
  public.ebook_webhook_events, public.ebook_admins from anon, authenticated;
grant all on public.ebook_books, public.ebook_site_settings, public.ebook_orders,
  public.ebook_payments, public.ebook_access_tokens, public.ebook_access_events,
  public.ebook_webhook_events, public.ebook_admins to service_role;

-- One transaction processes an event and marks both payment and order.
create or replace function public.ebook_apply_payment_event(
  p_event_id text, p_reference text, p_order_id uuid, p_status text,
  p_amount integer, p_currency text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_payment record;
begin
  if p_status not in ('completed','failed','expired','voided') then
    raise exception 'Unsupported provider status';
  end if;
  select p.order_id, p.amount_tzs, p.currency, p.status as payment_status,
         o.amount_tzs as order_amount
    into v_payment
    from public.ebook_payments p
    join public.ebook_orders o on o.id=p.order_id
    where p.provider_reference=p_reference and p.order_id=p_order_id
    for update of p,o;
  if not found or v_payment.amount_tzs<>p_amount
    or v_payment.order_amount<>p_amount or v_payment.currency<>p_currency
    or p_currency<>'TZS' then
    raise exception 'Payment reference/order/amount mismatch';
  end if;
  insert into public.ebook_webhook_events(event_id,provider_reference)
    values(p_event_id,p_reference) on conflict do nothing;
  if v_payment.payment_status='completed' then return true; end if;
  update public.ebook_payments
    set status=p_status,updated_at=now()
    where provider_reference=p_reference;
  if p_status='completed' then
    update public.ebook_orders set status='paid',paid_at=coalesce(paid_at,now())
      where id=p_order_id;
  else
    update public.ebook_orders set status='failed'
      where id=p_order_id and status<>'paid';
  end if;
  return true;
end;
$$;
revoke all on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) to service_role;

-- Public covers/logos, private PDFs. No anonymous storage write policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('ebook-assets','ebook-assets',true,10485760,array['image/png','image/jpeg','image/webp','image/x-icon','image/svg+xml'])
  on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('ebook-pdfs','ebook-pdfs',false,52428800,array['application/pdf'])
  on conflict(id) do nothing;

insert into public.ebook_site_settings(id,site_name) values(1,'') on conflict(id) do nothing;
insert into public.ebook_books(slug,title,price_tzs,status,featured)
  values('mifumo-7-muhimu','Mifumo 7 Muhimu Kila Biashara Inayohitaji Ili Kufanikiwa',25000,'published',true)
  on conflict(slug) do nothing;

-- After creating an Auth user in Supabase, grant access explicitly:
-- insert into public.ebook_admins(user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
