-- Additive access, appearance and author onboarding upgrade. Financial records stay immutable.
begin;
alter table public.akili_profiles add column if not exists deleted_at timestamptz;
alter table public.akili_profiles add column if not exists appearance jsonb not null default '{}';
alter table public.ebook_site_settings add column if not exists appearance jsonb not null default '{"design":"classic","mode":"normal"}';

create table if not exists public.akili_book_grants (
 user_id uuid not null references auth.users(id), book_id uuid not null references public.ebook_books(id),
 granted_by uuid not null references auth.users(id), created_at timestamptz not null default now(), revoked_at timestamptz,
 primary key(user_id,book_id)
);
create table if not exists public.akili_author_links (
 id uuid primary key default gen_random_uuid(), label text not null, token_hash text not null unique,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null, use_limit integer not null check(use_limit between 1 and 1000),
 uses integer not null default 0 check(uses>=0), revoked_at timestamptz
);
create table if not exists public.akili_author_link_acceptances (
 link_id uuid not null references public.akili_author_links(id), user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), primary key(link_id,user_id)
);
create index if not exists akili_grants_book on public.akili_book_grants(book_id);
create index if not exists akili_grants_actor on public.akili_book_grants(granted_by);
create index if not exists akili_links_actor on public.akili_author_links(created_by);
create index if not exists akili_link_users on public.akili_author_link_acceptances(user_id);
alter table public.akili_book_grants enable row level security;
alter table public.akili_author_links enable row level security;
alter table public.akili_author_link_acceptances enable row level security;
revoke all on public.akili_book_grants,public.akili_author_links,public.akili_author_link_acceptances from public,anon,authenticated;
grant all on public.akili_book_grants,public.akili_author_links,public.akili_author_link_acceptances to service_role;

create or replace function public.akili_manage_user(p_actor uuid,p_user uuid,p_operation text,p_value text default '')
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare target public.akili_profiles; admin_count integer; is_admin boolean;
begin
 -- Serialize role/account mutations so two admins cannot simultaneously remove the last admin.
 perform pg_advisory_xact_lock(193742,1);
 if not exists(select 1 from public.ebook_admins a join public.akili_profiles p on p.user_id=a.user_id where a.user_id=p_actor and p.status='active' and p.deleted_at is null)
 then raise exception 'Active admin required' using errcode='42501'; end if;
 select * into target from public.akili_profiles where user_id=p_user for update;
 if target.user_id is null then raise exception 'User not found'; end if;
 select exists(select 1 from public.ebook_admins where user_id=p_user) into is_admin;
 select count(*) into admin_count from public.ebook_admins a join public.akili_profiles p on p.user_id=a.user_id where p.status='active' and p.deleted_at is null;
 if p_operation='role' then
   if p_value not in ('reader','author','admin') or target.deleted_at is not null then raise exception 'Invalid role or deleted user'; end if;
   if p_value<>'admin' and is_admin and target.status='active' and admin_count<=1 then raise exception 'Last active admin is protected'; end if;
   if p_value='admin' then
     if target.status<>'active' then raise exception 'Activate account before granting admin'; end if;
     insert into public.ebook_admins(user_id) values(p_user) on conflict do nothing;
   else
     delete from public.ebook_admins where user_id=p_user;
     update public.akili_profiles set role=p_value where user_id=p_user;
   end if;
 elsif p_operation='account' then
   if p_value not in ('active','restricted','delete','restore') then raise exception 'Invalid account operation'; end if;
   if p_value in ('restricted','delete') and p_actor=p_user then raise exception 'Cannot suspend or delete your own account'; end if;
   if p_value in ('restricted','delete') and is_admin and target.status='active' and admin_count<=1 then raise exception 'Last active admin is protected'; end if;
   if p_value='delete' then
     update public.akili_profiles set status='restricted',deleted_at=now() where user_id=p_user;
     delete from public.ebook_admins where user_id=p_user;
     update public.ebook_access_tokens set revoked_at=now() where order_id in(select id from public.ebook_orders where user_id=p_user);
   elsif p_value='restore' then
     update public.akili_profiles set status='active',deleted_at=null where user_id=p_user;
   else
     if target.deleted_at is not null then raise exception 'Restore deleted account first'; end if;
     update public.akili_profiles set status=p_value where user_id=p_user;
   end if;
 else raise exception 'Invalid operation'; end if;
 insert into public.akili_audit_logs(actor_id,action,target_id,details) values(p_actor,'user.'||p_operation,p_user::text,jsonb_build_object('value',p_value));
 return true;
end $$;

create or replace function public.akili_manage_book_access(p_actor uuid,p_user uuid,p_book uuid,p_grant boolean)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.ebook_admins a join public.akili_profiles p on p.user_id=a.user_id where a.user_id=p_actor and p.status='active' and p.deleted_at is null)
 then raise exception 'Active admin required' using errcode='42501'; end if;
 if not exists(select 1 from public.akili_profiles where user_id=p_user and deleted_at is null) or not exists(select 1 from public.ebook_books where id=p_book and pdf_path is not null) then raise exception 'User or book not found'; end if;
 if p_grant then
   insert into public.akili_book_grants(user_id,book_id,granted_by) values(p_user,p_book,p_actor)
   on conflict(user_id,book_id) do update set granted_by=p_actor,created_at=now(),revoked_at=null;
 else
   update public.akili_book_grants set revoked_at=now() where user_id=p_user and book_id=p_book and revoked_at is null;
   update public.akili_entitlements set revoked_at=now() where user_id=p_user and book_id=p_book and revoked_at is null;
   update public.ebook_access_tokens set revoked_at=now() where order_id in(select id from public.ebook_orders where user_id=p_user and book_id=p_book);
 end if;
 insert into public.akili_audit_logs(actor_id,action,target_id,details) values(p_actor,case when p_grant then 'access.granted' else 'access.revoked' end,p_user::text,jsonb_build_object('book_id',p_book));
 return true;
end $$;

create or replace function public.akili_accept_author_link(p_user uuid,p_hash text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare invitation public.akili_author_links;
begin
 if not exists(select 1 from auth.users a join public.akili_profiles p on p.user_id=a.id where a.id=p_user and a.email_confirmed_at is not null and p.status='active' and p.deleted_at is null)
 then raise exception 'Verified active account required' using errcode='42501'; end if;
 select * into invitation from public.akili_author_links where token_hash=p_hash for update;
 if invitation.id is null then raise exception 'Link not found'; end if;
 -- Reopening a previously accepted link is idempotent, including when its quota is now full.
 if exists(select 1 from public.akili_author_link_acceptances where link_id=invitation.id and user_id=p_user) then return true; end if;
 if invitation.revoked_at is not null or invitation.expires_at<=now() or invitation.uses>=invitation.use_limit then raise exception 'Link expired, revoked or full'; end if;
 insert into public.akili_author_link_acceptances(link_id,user_id) values(invitation.id,p_user);
 update public.akili_author_links set uses=uses+1 where id=invitation.id;
 update public.akili_profiles set role='author' where user_id=p_user;
 insert into public.akili_audit_logs(actor_id,action,target_id,details) values(p_user,'author.link_accepted',invitation.id::text,'{}');
 return true;
end $$;
revoke all on function public.akili_manage_user(uuid,uuid,text,text),public.akili_manage_book_access(uuid,uuid,uuid,boolean),public.akili_accept_author_link(uuid,text) from public,anon,authenticated;
grant execute on function public.akili_manage_user(uuid,uuid,text,text),public.akili_manage_book_access(uuid,uuid,uuid,boolean),public.akili_accept_author_link(uuid,text) to service_role;
commit;
