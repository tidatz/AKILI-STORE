-- AKILI STORE affiliate attribution and per-product/per-campaign commission control.
-- Additive only. Existing orders, payments and creator shares are preserved.
begin;

create table if not exists public.akili_affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null unique,
  status text not null default 'pending' check (status in ('pending','active','suspended','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);

create table if not exists public.akili_affiliate_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  code text not null unique,
  description text not null default '',
  product_id uuid references public.ebook_books(id) on delete restrict,
  commission_percent_of_platform numeric(5,2) not null check (commission_percent_of_platform between 0 and 100),
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.akili_affiliate_product_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.ebook_books(id) on delete cascade,
  commission_percent_of_platform numeric(5,2) not null check (commission_percent_of_platform between 0 and 100),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.akili_affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.akili_affiliates(id) on delete restrict,
  campaign_id uuid references public.akili_affiliate_campaigns(id) on delete set null,
  product_id uuid references public.ebook_books(id) on delete set null,
  token_hash text not null unique,
  commission_percent_of_platform numeric(5,2) not null default 0 check (commission_percent_of_platform between 0 and 100),
  landing_path text not null default '/',
  referrer_host text not null default '',
  attributed_order_id uuid unique references public.ebook_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days'
);

create table if not exists public.akili_order_attributions (
  order_id uuid primary key references public.ebook_orders(id) on delete cascade,
  click_id uuid not null unique references public.akili_affiliate_clicks(id) on delete restrict,
  affiliate_id uuid not null references public.akili_affiliates(id) on delete restrict,
  campaign_id uuid references public.akili_affiliate_campaigns(id) on delete set null,
  product_id uuid not null references public.ebook_books(id) on delete restrict,
  commission_percent_of_platform numeric(5,2) not null check (commission_percent_of_platform between 0 and 100),
  created_at timestamptz not null default now()
);

alter table public.akili_ledger add column if not exists affiliate_id uuid references public.akili_affiliates(id);
alter table public.akili_ledger add column if not exists campaign_id uuid references public.akili_affiliate_campaigns(id);
alter table public.akili_ledger add column if not exists commission_percent_of_platform numeric(5,2);
alter table public.akili_ledger drop constraint if exists akili_ledger_account_check;
alter table public.akili_ledger add constraint akili_ledger_account_check
  check (account in ('author','platform','system','affiliate'));

create index if not exists akili_affiliates_status on public.akili_affiliates(status,created_at desc);
create index if not exists akili_campaigns_status_dates on public.akili_affiliate_campaigns(status,starts_at,ends_at);
create index if not exists akili_affiliate_clicks_affiliate on public.akili_affiliate_clicks(affiliate_id,created_at desc);
create index if not exists akili_order_attributions_affiliate on public.akili_order_attributions(affiliate_id,created_at desc);
create index if not exists akili_ledger_affiliate on public.akili_ledger(affiliate_id,created_at desc);

-- All affiliate financial and attribution tables are server-only.
do $$ declare t text; begin
  foreach t in array array[
    'akili_affiliates','akili_affiliate_campaigns','akili_affiliate_product_rules',
    'akili_affiliate_clicks','akili_order_attributions'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
revoke all on public.akili_ledger from anon,authenticated;
grant all on public.akili_ledger to service_role;

-- Replace the existing idempotent payment allocator. Affiliate commission is
-- calculated only from the platform share; author and system shares are untouched.
create or replace function public.ebook_apply_payment_event(
  p_event_id text,p_reference text,p_order_id uuid,p_status text,p_amount integer,p_currency text
) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  p record; o record; b record; attribution record;
  author_share integer; system_share integer; platform_share integer;
  affiliate_share integer; rate integer;
begin
  if p_status not in ('completed','failed','expired','voided') then raise exception 'Unsupported provider status'; end if;
  select * into p from public.ebook_payments where provider_reference=p_reference and order_id=p_order_id for update;
  select * into o from public.ebook_orders where id=p_order_id for update;
  if p.id is null or o.id is null or p.amount_tzs<>p_amount or o.amount_tzs<>p_amount or p.currency<>p_currency or p_currency<>'TZS' then
    raise exception 'Payment mismatch';
  end if;
  insert into public.ebook_webhook_events(event_id,provider_reference) values(p_event_id,p_reference) on conflict do nothing;
  if p.status='completed' then return true; end if;
  update public.ebook_payments set status=p_status,updated_at=now() where id=p.id;
  if p_status='completed' then
    update public.ebook_orders set status='paid',paid_at=coalesce(paid_at,now()) where id=o.id;
    select * into b from public.ebook_books where id=o.book_id;
    select author_percent into rate from public.ebook_site_settings where id=1;
    author_share:=floor(p_amount*coalesce(rate,60)/100.0)::integer;
    system_share:=least(floor(p_amount*0.10)::integer,greatest(0,p_amount-author_share));
    platform_share:=p_amount-author_share-system_share;
    affiliate_share:=0;
    select * into attribution from public.akili_order_attributions where order_id=o.id;
    if attribution.order_id is not null and attribution.commission_percent_of_platform>0
       and attribution.affiliate_id is not null then
      affiliate_share:=floor(platform_share*attribution.commission_percent_of_platform/100.0)::integer;
    end if;
    insert into public.akili_ledger(order_id,author_id,account,amount_tzs)
      values(o.id,b.author_id,'author',author_share),(o.id,null,'system',system_share)
      on conflict(order_id,account) do nothing;
    if attribution.order_id is not null and affiliate_share>0 then
      insert into public.akili_ledger(order_id,author_id,affiliate_id,campaign_id,account,amount_tzs,commission_percent_of_platform)
      values(o.id,null,attribution.affiliate_id,attribution.campaign_id,'affiliate',affiliate_share,attribution.commission_percent_of_platform)
      on conflict(order_id,account) do nothing;
    end if;
    insert into public.akili_ledger(order_id,author_id,account,amount_tzs)
      values(o.id,null,'platform',platform_share-affiliate_share)
      on conflict(order_id,account) do nothing;
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


-- Preserve author withdrawals and allow approved affiliates to withdraw their
-- commission balance through the same audited payout queue.
create or replace function public.akili_request_withdrawal(p_user_id uuid,p_amount integer,p_phone text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $withdrawal$
declare earned bigint; reserved bigint; minimum integer; fee integer; result uuid; affiliate_key uuid; profile_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
 select status into profile_status from public.akili_profiles where user_id=p_user_id;
 select id into affiliate_key from public.akili_affiliates where user_id=p_user_id and status='active';
 if profile_status is distinct from 'active' or (not exists(
   select 1 from public.akili_profiles where user_id=p_user_id and role='author'
 ) and affiliate_key is null) then raise exception 'Author or active affiliate required'; end if;
 select withdrawal_min_tzs,withdrawal_fee_tzs into minimum,fee from public.ebook_site_settings where id=1;
 select coalesce(sum(amount_tzs),0) into earned from public.akili_ledger
 where (account='author' and author_id=p_user_id)
    or (account='affiliate' and affiliate_id=affiliate_key and affiliate_key is not null);
 select coalesce(sum(amount_tzs),0) into reserved from public.akili_withdrawals where user_id=p_user_id and status in ('pending','paid');
 if p_amount<minimum or p_amount<=fee or p_amount>earned-reserved or length(p_phone)<>12 or p_phone !~ '^255[0-9]{9}' then
   raise exception 'Invalid withdrawal or insufficient balance';
 end if;
 insert into public.akili_withdrawals(user_id,amount_tzs,fee_tzs,phone) values(p_user_id,p_amount,fee,p_phone) returning id into result;
 return result;
end $withdrawal$;
revoke all on function public.akili_request_withdrawal(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.akili_request_withdrawal(uuid,integer,text) to service_role;

commit;
