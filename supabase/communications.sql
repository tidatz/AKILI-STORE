-- Additive communications schema. All access goes through the authenticated server API.
begin;
alter table public.akili_profiles add column if not exists email text not null default '';
update public.akili_profiles p set email=lower(u.email) from auth.users u where u.id=p.user_id and p.email is distinct from lower(u.email);
alter table public.akili_author_invitations add column if not exists email_sent_at timestamptz;

create table if not exists public.akili_sms_campaigns (
 id uuid primary key, actor_id uuid not null references auth.users(id),
 name text not null default '', message text not null check(length(message) between 1 and 640),
 recipients text[] not null check(cardinality(recipients) between 1 and 1000), fingerprint text not null,
 status text not null default 'draft' check(status in ('draft','submitting','accepted','unknown','failed')),
 provider_campaign_id uuid unique, total_cost numeric check(total_cost>=0),
 submitted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.akili_sms_messages (
 provider_message_id uuid primary key, campaign_id uuid references public.akili_sms_campaigns(id),
 phone text not null check(phone~'^255[67][0-9]{8}$'),
 status text not null default 'queued' check(status in ('queued','sent','delivered','failed')),
 error text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.akili_message_deliveries (
 key text primary key, recipient text not null,
 status text not null check(status in ('queued','sending','accepted','unknown','failed')),
 provider_message_id uuid, created_at timestamptz not null default now()
);
create index if not exists akili_sms_messages_campaign on public.akili_sms_messages(campaign_id);
create index if not exists akili_sms_campaigns_created on public.akili_sms_campaigns(created_at desc);
create or replace view public.akili_sms_delivery_totals with (security_invoker=true) as
 select campaign_id,count(*) filter(where status='delivered') as delivered,count(*) filter(where status='failed') as failed
 from public.akili_sms_messages where campaign_id is not null group by campaign_id;
revoke all on public.akili_sms_delivery_totals from public,anon,authenticated;
grant select on public.akili_sms_delivery_totals to service_role;
do $$ declare t text; begin
 foreach t in array array['akili_sms_campaigns','akili_sms_messages','akili_message_deliveries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
commit;
