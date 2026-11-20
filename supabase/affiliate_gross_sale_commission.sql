-- Affiliate commission is a percentage of the actual paid book price.
-- For attributed sales: affiliate receives 10% (or the rate snapshotted on the click),
-- and the author receives the remaining 90%. Unattributed sales remain 100% author earnings.
begin;

alter table public.akili_affiliate_campaigns
  alter column commission_percent_of_platform set default 10;
alter table public.akili_affiliate_product_rules
  alter column commission_percent_of_platform set default 10;
alter table public.akili_affiliate_clicks
  alter column commission_percent_of_platform set default 10;

create or replace function public.ebook_apply_payment_event(
  p_event_id text,
  p_reference text,
  p_order_id uuid,
  p_status text,
  p_amount integer,
  p_currency text
) returns boolean
language plpgsql security invoker set search_path=public,pg_temp
as $$
declare
  p record;
  o record;
  b record;
  attribution record;
  affiliate_share integer := 0;
  author_share integer;
  rate numeric(5,2) := 10;
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
    update public.ebook_orders
      set status='paid',paid_at=coalesce(paid_at,now()) where id=o.id;

    select * into b from public.ebook_books where id=o.book_id;
    select * into attribution from public.akili_order_attributions where order_id=o.id;

    if attribution.order_id is not null and attribution.affiliate_id is not null then
      rate := greatest(0,least(100,coalesce(attribution.commission_percent_of_platform,10)));
      affiliate_share := floor(p_amount*rate/100.0)::integer;
    end if;

    author_share := p_amount-affiliate_share;

    -- One paid sale is split from the actual amount collected, not a platform share.
    insert into public.akili_ledger(order_id,author_id,account,amount_tzs)
      values(o.id,b.author_id,'author',author_share)
      on conflict(order_id,account) do nothing;

    if affiliate_share>0 then
      insert into public.akili_ledger(
        order_id,author_id,affiliate_id,campaign_id,account,amount_tzs,commission_percent_of_platform
      ) values(
        o.id,null,attribution.affiliate_id,attribution.campaign_id,'affiliate',
        affiliate_share,rate
      ) on conflict(order_id,account) do nothing;
    end if;

    -- No platform or system deduction is taken from the author's sale proceeds.
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

revoke all on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.ebook_apply_payment_event(text,text,uuid,text,integer,text)
  to service_role;

commit;
