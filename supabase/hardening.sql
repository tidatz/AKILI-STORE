-- Sale allocations are append-only, including for privileged application writes.
create or replace function public.akili_keep_ledger_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Ledger entries are immutable; use a separate compensating transaction';
end $$;
revoke all on function public.akili_keep_ledger_immutable() from public,anon,authenticated;
grant execute on function public.akili_keep_ledger_immutable() to service_role;
create trigger akili_ledger_immutable before update or delete on public.akili_ledger
for each row execute function public.akili_keep_ledger_immutable();
