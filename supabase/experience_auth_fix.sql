-- The server verifies the bearer token and confirmed Auth email before these RPCs.
-- Service-role-only RPCs use the synchronized, server-owned profile instead of
-- granting application code access to the private auth.users table.
begin;
create or replace function public.akili_accept_author_link(p_user uuid,p_hash text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare invitation public.akili_author_links;
begin
 if not exists(select 1 from public.akili_profiles where user_id=p_user and email<>'' and status='active' and deleted_at is null)
 then raise exception 'Verified active account required' using errcode='42501'; end if;
 select * into invitation from public.akili_author_links where token_hash=p_hash for update;
 if invitation.id is null then raise exception 'Link not found'; end if;
 if exists(select 1 from public.akili_author_link_acceptances where link_id=invitation.id and user_id=p_user) then return true; end if;
 if invitation.revoked_at is not null or invitation.expires_at<=now() or invitation.uses>=invitation.use_limit then raise exception 'Link expired, revoked or full'; end if;
 insert into public.akili_author_link_acceptances(link_id,user_id) values(invitation.id,p_user);
 update public.akili_author_links set uses=uses+1 where id=invitation.id;
 update public.akili_profiles set role='author' where user_id=p_user;
 insert into public.akili_audit_logs(actor_id,action,target_id,details) values(p_user,'author.link_accepted',invitation.id::text,'{}');
 return true;
end $$;

create or replace function public.akili_accept_invitation(p_user_id uuid,p_token_hash text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare invite record; email_address text;
begin
 select lower(email) into email_address from public.akili_profiles
 where user_id=p_user_id and status='active' and deleted_at is null and email<>'';
 select * into invite from public.akili_author_invitations where token_hash=p_token_hash for update;
 if invite.id is null or invite.expires_at<=now() or invite.accepted_at is not null or lower(invite.email)<>email_address or email_address is null then raise exception 'Invitation invalid'; end if;
 update public.akili_author_invitations set accepted_by=p_user_id,accepted_at=now() where id=invite.id;
 update public.akili_profiles set role='author' where user_id=p_user_id and status='active' and deleted_at is null;
 return true;
end $$;
revoke all on function public.akili_accept_author_link(uuid,text),public.akili_accept_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.akili_accept_author_link(uuid,text),public.akili_accept_invitation(uuid,text) to service_role;
commit;
