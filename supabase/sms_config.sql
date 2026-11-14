-- Server-only RPCs. Vault encrypts credentials; no new browser privileges.
begin;
create or replace function public.akili_ehub_config_read()
returns jsonb language sql stable security invoker set search_path = '' as $$
 select coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets
   where name='akili_store_ehub' limit 1), '{}'::jsonb);
$$;
create or replace function public.akili_ehub_config_save(p_actor uuid, p_values jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_config jsonb; v_key text;
begin
 if not exists(select 1 from public.ebook_admins where user_id=p_actor) then
   raise insufficient_privilege using message='Admin required';
 end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>14000 then
   raise exception 'Invalid SMS configuration';
 end if;
 for v_key in select jsonb_object_keys(p_values) loop
   if v_key not in ('apiKey','apiSecret','senderId','webhookSecret')
      or jsonb_typeof(p_values->v_key)<>'string'
      or length(p_values->>v_key) not between 8 and 4096 then
     raise exception 'Invalid SMS configuration';
   end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('akili_store_ehub',0));
 select id, decrypted_secret::jsonb into v_id, v_config from vault.decrypted_secrets
   where name='akili_store_ehub' limit 1;
 -- A different account's sender must not reuse the previous webhook secret.
 if p_values ? 'senderId' and (v_config->>'senderId') is distinct from (p_values->>'senderId') then
   v_config := coalesce(v_config,'{}'::jsonb) - 'webhookSecret';
 end if;
 v_config := coalesce(v_config,'{}'::jsonb) || p_values;
 if v_id is null then
   perform vault.create_secret(v_config::text,'akili_store_ehub','AKILI STORE SMS server credentials');
 else
   perform vault.update_secret(v_id,v_config::text);
 end if;
 return true;
end;
$$;
revoke all on function public.akili_ehub_config_read() from public, anon, authenticated;
revoke all on function public.akili_ehub_config_save(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.akili_ehub_config_read() to service_role;
grant execute on function public.akili_ehub_config_save(uuid,jsonb) to service_role;
commit;
