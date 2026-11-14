-- Run as postgres in one transaction; every fixture and mutation is rolled back.
begin isolation level repeatable read;
do $$
declare
 owner_id uuid; reader_a uuid:=gen_random_uuid(); reader_b uuid:=gen_random_uuid(); book_id uuid;
 link_id uuid; link_hash text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 other_hash text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 email_hash text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 blocked boolean; paid_before bigint; ledger_before bigint; admin_before bigint;
begin
 select a.user_id into owner_id from public.ebook_admins a join public.akili_profiles p on p.user_id=a.user_id where p.status='active' and p.deleted_at is null order by a.created_at limit 1;
 select id into book_id from public.ebook_books where status='published' and pdf_path is not null limit 1;
 if owner_id is null or book_id is null then raise exception 'Admin and published PDF are required'; end if;
 select count(*) into paid_before from public.ebook_orders where status='paid';
 select count(*) into ledger_before from public.akili_ledger;
 select count(*) into admin_before from public.ebook_admins;
 insert into auth.users(id,aud,role,email,email_confirmed_at) values
 (reader_a,'authenticated','authenticated','qa-'||reader_a::text||'@example.invalid',now()),
 (reader_b,'authenticated','authenticated','qa-'||reader_b::text||'@example.invalid',now());
 insert into public.akili_profiles(user_id,display_name,email) values
 (reader_a,'Temporary QA A','qa-'||reader_a::text||'@example.invalid'),
 (reader_b,'Temporary QA B','qa-'||reader_b::text||'@example.invalid')
 on conflict(user_id) do update set email=excluded.email,display_name=excluded.display_name;
 -- Execute actual application routines under the same database role as PostgREST.
 set local role service_role;
 if admin_before=1 then
   blocked:=false;
   begin perform public.akili_manage_user(owner_id,owner_id,'role','reader'); exception when others then blocked:=true; end;
   if not blocked then raise exception 'Last admin demotion was allowed'; end if;
 end if;
 blocked:=false;
 begin perform public.akili_manage_user(owner_id,owner_id,'account','delete'); exception when others then blocked:=true; end;
 if not blocked then raise exception 'Self deletion was allowed'; end if;
 perform public.akili_manage_book_access(owner_id,reader_a,book_id,true);
 if not exists(select 1 from public.akili_book_grants where user_id=reader_a and revoked_at is null) then raise exception 'Grant failed'; end if;
 perform public.akili_manage_book_access(owner_id,reader_a,book_id,false);
 if exists(select 1 from public.akili_book_grants where user_id=reader_a and revoked_at is null) then raise exception 'Revoke failed'; end if;
 insert into public.akili_author_links(label,token_hash,created_by,expires_at,use_limit) values('Temporary QA',link_hash,owner_id,now()+interval '1 day',1) returning id into link_id;
 perform public.akili_accept_author_link(reader_a,link_hash);
 perform public.akili_accept_author_link(reader_a,link_hash);
 if (select uses from public.akili_author_links where id=link_id)<>1 or (select role from public.akili_profiles where user_id=reader_a)<>'author' then raise exception 'Author acceptance or idempotency failed'; end if;
 blocked:=false;
 begin perform public.akili_accept_author_link(reader_b,link_hash); exception when others then blocked:=true; end;
 if not blocked then raise exception 'Quota bypassed'; end if;
 insert into public.akili_author_links(label,token_hash,created_by,expires_at,use_limit,revoked_at) values('Temporary revoked QA',other_hash,owner_id,now()+interval '1 day',2,now());
 blocked:=false;
 begin perform public.akili_accept_author_link(reader_b,other_hash); exception when others then blocked:=true; end;
 if not blocked then raise exception 'Revoked link accepted'; end if;
 insert into public.akili_author_invitations(email,token_hash,invited_by) values('qa-'||reader_b::text||'@example.invalid',email_hash,owner_id);
 blocked:=false;
 begin perform public.akili_accept_invitation(reader_a,email_hash); exception when others then blocked:=true; end;
 if not blocked then raise exception 'Email binding bypassed'; end if;
 perform public.akili_accept_invitation(reader_b,email_hash);
 if (select role from public.akili_profiles where user_id=reader_b)<>'author' then raise exception 'Email invitation failed'; end if;
 perform public.akili_manage_user(owner_id,reader_a,'role','admin');
 if not exists(select 1 from public.ebook_admins where user_id=reader_a) then raise exception 'Admin promotion failed'; end if;
 perform public.akili_manage_user(owner_id,reader_a,'account','restricted');
 blocked:=false;
 begin perform public.akili_manage_book_access(reader_a,reader_b,book_id,true); exception when others then blocked:=true; end;
 if not blocked then raise exception 'Restricted admin performed mutation'; end if;
 perform public.akili_manage_user(owner_id,reader_a,'account','active');
 perform public.akili_manage_user(owner_id,reader_a,'account','delete');
 if exists(select 1 from public.ebook_admins where user_id=reader_a) or not exists(select 1 from public.akili_profiles where user_id=reader_a and deleted_at is not null and status='restricted') then raise exception 'Soft delete failed'; end if;
 perform public.akili_manage_user(owner_id,reader_a,'account','restore');
 if exists(select 1 from public.ebook_admins where user_id=reader_a) or not exists(select 1 from public.akili_profiles where user_id=reader_a and deleted_at is null and status='active') then raise exception 'Restore incorrectly restored admin or failed'; end if;
 if (select count(*) from public.ebook_orders where status='paid')<>paid_before or (select count(*) from public.akili_ledger)<>ledger_before then raise exception 'Financial records changed'; end if;
 reset role;
end $$;
rollback;
select 'passed: grants, revocation, roles, last-admin guard, deletion, restore, email binding, author link quota and idempotency; all fixtures rolled back' as verification;
