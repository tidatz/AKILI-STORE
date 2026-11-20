-- Author earnings policy: 100% of verified book sales and one flat TSh 2,000 author withdrawal fee.
-- The ledger is append-only. Historical allocations are balanced with explicit adjustment rows.
begin;

alter table public.akili_ledger drop constraint if exists akili_ledger_account_check;
alter table public.akili_ledger add constraint akili_ledger_account_check
  check (account in ('author','platform','system','affiliate','author_adjustment','author_reversal','platform_adjustment','system_adjustment'));

with paid as (
  select o.id as order_id, o.amount_tzs,
    coalesce(sum(l.amount_tzs) filter (where l.account='author'),0)::bigint as author_paid,
    coalesce(sum(l.amount_tzs) filter (where l.account='platform'),0)::bigint as platform_paid,
    coalesce(sum(l.amount_tzs) filter (where l.account='system'),0)::bigint as system_paid,
    coalesce((array_agg(l.author_id) filter (where l.account='author'))[1],b.author_id) as author_id
  from public.ebook_orders o
  join public.ebook_books b on b.id=o.book_id
  left join public.akili_ledger l on l.order_id=o.id
  where o.status='paid'
  group by o.id,o.amount_tzs,b.author_id
), adjustments as (
  select order_id,author_id,'author_adjustment'::text as account,
    (amount_tzs-author_paid)::integer as amount_tzs
  from paid where author_id is not null and amount_tzs>author_paid
  union all
  select order_id,null,'platform_adjustment',
    platform_paid::integer from paid where platform_paid>0
  union all
  select order_id,null,'system_adjustment',
    system_paid::integer from paid where system_paid>0
)
insert into public.akili_ledger(order_id,author_id,account,amount_tzs)
select order_id,author_id,account,amount_tzs from adjustments
on conflict(order_id,account) do nothing;

update public.ebook_site_settings set author_percent=100 where id=1;

create or replace function public.ebook_apply_payment_event(
  p_event_id text, p_reference text, p_order_id uuid, p_status text,
  p_amount integer, p_currency text
) returns boolean
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare p record; o record; b record;
begin
  if p_status not in ('completed','failed','expired','voided') then
    raise exception 'Unsupported provider status';
  end if;
  select * into p from public.ebook_payments
    where provider_reference=p_reference and order_id=p_order_id for update;
  select * into o from public.ebook_orders where id=p_order_id for update;
  if p.id is null or o.id is null or p.amount_tzs<>p_amount
    or o.amount_tzs<>p_amount or p.currency<>p_currency or p_currency<>'TZS' then
    raise exception 'Payment mismatch';
  end if;
  insert into public.ebook_webhook_events(event_id,provider_reference)
    values(p_event_id,p_reference) on conflict do nothing;
  if p.status='completed' then return true; end if;
  update public.ebook_payments set status=p_status,updated_at=now() where id=p.id;
  if p_status='completed' then
    update public.ebook_orders set status='paid',paid_at=coalesce(paid_at,now()) where id=o.id;
    select * into b from public.ebook_books where id=o.book_id;
    -- Every verified book sale is credited in full to its author. Operating costs are absorbed by the platform.
    insert into public.akili_ledger(order_id,author_id,account,amount_tzs) values
      (o.id,b.author_id,'author',p_amount),
      (o.id,null,'system',0),
      (o.id,null,'platform',0)
    on conflict do nothing;
    if o.user_id is not null then
      insert into public.akili_entitlements(user_id,book_id,order_id)
        values(o.user_id,o.book_id,o.id) on conflict do nothing;
      insert into public.akili_notifications(user_id,title,body,href)
        values(o.user_id,'Kitabu chako kipo tayari',b.title,'/my-library');
    end if;
    if b.author_id is not null then
      insert into public.akili_notifications(user_id,title,body,href)
        values(b.author_id,'Hongera! Kitabu chako kimeuzwa',
          b.title || ' kimeuzwa kwa TSh ' || to_char(p_amount,'FM999,999,999,990'),
          '/sales-analytics');
    end if;
  else
    update public.ebook_orders
      set status=case when p_status='expired' then 'expired' else 'failed' end
      where id=o.id and status<>'paid';
  end if;
  return true;
end $$;

create or replace function public.akili_request_withdrawal(
  p_user_id uuid, p_amount integer, p_phone text
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  earned bigint; reserved bigint; minimum integer; fee integer;
  result uuid; affiliate_key uuid; profile_status text; author_account boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
  select status into profile_status from public.akili_profiles where user_id=p_user_id;
  select exists(select 1 from public.akili_profiles where user_id=p_user_id and role='author')
    into author_account;
  select id into affiliate_key from public.akili_affiliates
    where user_id=p_user_id and status='active';
  if profile_status is distinct from 'active'
    or (not author_account and affiliate_key is null) then
    raise exception 'Author or active affiliate required';
  end if;

  select withdrawal_min_tzs,withdrawal_fee_tzs
    into minimum,fee from public.ebook_site_settings where id=1;
  if author_account then
    -- One fixed author fee, with no percentage deduction and no TSh 10,000 minimum.
    minimum := 2001;
    fee := 2000;
  end if;

  select coalesce(sum(amount_tzs) filter (where account in ('author','author_adjustment')),0)
       - coalesce(sum(amount_tzs) filter (where account='author_reversal'),0)
       + coalesce(sum(amount_tzs) filter (where account='affiliate' and affiliate_id=affiliate_key and affiliate_key is not null),0)
    into earned from public.akili_ledger
    where (author_id=p_user_id and account in ('author','author_adjustment','author_reversal'))
       or (account='affiliate' and affiliate_id=affiliate_key and affiliate_key is not null);
  select coalesce(sum(amount_tzs),0) into reserved from public.akili_withdrawals
    where user_id=p_user_id and status in ('pending','paid');

  if p_amount<minimum or p_amount<=fee or p_amount>earned-reserved
    or length(p_phone)<>12 or p_phone !~ '^255[0-9]{9}$' then
    raise exception 'Invalid withdrawal or insufficient balance';
  end if;
  insert into public.akili_withdrawals(user_id,amount_tzs,fee_tzs,phone)
    values(p_user_id,p_amount,fee,p_phone) returning id into result;
  return result;
end $$;

revoke all on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text) to service_role;
revoke all on function public.akili_request_withdrawal(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.akili_request_withdrawal(uuid,integer,text) to service_role;

commit;
