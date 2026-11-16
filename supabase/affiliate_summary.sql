-- Accurate affiliate balance and click totals without relying on a capped REST page.
begin;
create or replace function public.akili_affiliate_summary(p_user_id uuid)
returns table(clicks bigint,earned bigint,reserved bigint,available bigint)
language sql security invoker set search_path=public,pg_temp as $affiliate_summary$
  select
    (select count(*) from public.akili_affiliate_clicks c where c.affiliate_id=a.id),
    coalesce((select sum(l.amount_tzs) from public.akili_ledger l where l.affiliate_id=a.id and l.account='affiliate'),0)::bigint,
    coalesce((select sum(w.amount_tzs) from public.akili_withdrawals w where w.user_id=p_user_id and w.status in ('pending','paid')),0)::bigint,
    (
      coalesce((select sum(l.amount_tzs) from public.akili_ledger l where l.affiliate_id=a.id and l.account='affiliate'),0)
      - coalesce((select sum(w.amount_tzs) from public.akili_withdrawals w where w.user_id=p_user_id and w.status in ('pending','paid')),0)
    )::bigint
  from public.akili_affiliates a
  where a.user_id=p_user_id and a.status='active';
$affiliate_summary$;
revoke all on function public.akili_affiliate_summary(uuid) from public,anon,authenticated;
grant execute on function public.akili_affiliate_summary(uuid) to service_role;
commit;