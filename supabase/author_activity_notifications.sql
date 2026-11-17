begin;

create table if not exists public.akili_email_deliveries (
  key text primary key,
  recipient text not null,
  status text not null default 'queued'
    check (status in ('queued','sending','accepted','unknown','failed')),
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.akili_email_deliveries enable row level security;
revoke all on public.akili_email_deliveries from anon, authenticated;
grant all on public.akili_email_deliveries to service_role;

-- Record an author-facing in-app sale notice in the same transaction as
-- the paid order, entitlement and revenue allocation.
create or replace function public.ebook_apply_payment_event(
  p_event_id text, p_reference text, p_order_id uuid, p_status text,
  p_amount integer, p_currency text
) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  p record;
  o record;
  b record;
  author_share integer;
  rate integer;
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
    select author_percent into rate from public.ebook_site_settings where id=1;
    author_share:=floor(p_amount*coalesce(rate,60)/100.0)::integer;

    insert into public.akili_ledger(order_id,author_id,account,amount_tzs) values
      (o.id,b.author_id,'author',author_share),
      (o.id,null,'system',floor(p_amount*0.10)::integer),
      (o.id,null,'platform',p_amount-author_share-floor(p_amount*0.10)::integer)
      on conflict do nothing;

    if o.user_id is not null then
      insert into public.akili_entitlements(user_id,book_id,order_id)
        values(o.user_id,o.book_id,o.id) on conflict do nothing;
      insert into public.akili_notifications(user_id,title,body,href)
        values(o.user_id,'Kitabu chako kipo tayari',b.title,'/my-library');
    end if;

    if b.author_id is not null then
      insert into public.akili_notifications(user_id,title,body,href)
        values(
          b.author_id,
          'Hongera! Kitabu chako kimeuzwa',
          b.title || ' kimeuzwa kwa TSh ' || to_char(p_amount,'FM999,999,999,990'),
          '/sales-analytics'
        );
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
