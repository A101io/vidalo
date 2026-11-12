-- Feature 002 (Mijn omgeving), B-01: who may act on a business is a table, not a column.
-- business_member is filled by a trigger from business.owner_user_id this cycle (ADR-0001),
-- so one login can hold more than one business and a second role can be added later without
-- rewriting a policy. Also: Google tokens in channel.meta are no longer readable with a
-- member's JWT (F-017), and one business at most holds a verified facts host (F-019).

create table business_member (
  business_id uuid not null references business(id) on delete cascade,
  user_id     uuid not null,
  role        text not null default 'owner' check (role in ('owner')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create unique index business_member_one_owner on business_member (business_id) where role = 'owner';
create index business_member_user_idx on business_member (user_id);
alter table business_member enable row level security;
create policy member_self on business_member for select using (user_id = (select auth.uid()));
-- SEC-08: nothing but select for the Data API roles; the trigger below is the only writer.
revoke all on table business_member from anon, authenticated;
grant select on table business_member to authenticated;

create function public.sync_business_owner_member() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.owner_user_id is not distinct from new.owner_user_id then return new; end if;
  delete from public.business_member where business_id = new.id and role = 'owner';
  if new.owner_user_id is not null then
    insert into public.business_member (business_id, user_id, role) values (new.id, new.owner_user_id, 'owner')
    on conflict (business_id, user_id) do update set role = 'owner';
  end if;
  return new;
end $$;
revoke execute on function public.sync_business_owner_member() from public, anon, authenticated;
create trigger business_owner_member after insert or update of owner_user_id on business
  for each row execute function public.sync_business_owner_member();

insert into business_member (business_id, user_id, role)
  select id, owner_user_id, 'owner' from business where owner_user_id is not null on conflict do nothing;

-- The seven owner_* policies of 0001 become member_*; auth.uid() inside (select …) so it is evaluated once per statement.
drop policy owner_business on business;
drop policy owner_facts on facts;
drop policy owner_finding on finding;
drop policy owner_fix on fix;
drop policy owner_channel on channel;
drop policy owner_event on event;
drop policy owner_scan on scan_run;

create policy member_business on business for select using (
  exists (select 1 from business_member m where m.business_id = business.id and m.user_id = (select auth.uid())));
create policy member_facts on facts for select using (
  exists (select 1 from business_member m where m.business_id = facts.business_id and m.user_id = (select auth.uid())));
create policy member_finding on finding for select using (
  exists (select 1 from business_member m where m.business_id = finding.business_id and m.user_id = (select auth.uid())));
create policy member_fix on fix for select using (
  exists (select 1 from finding f join business_member m on m.business_id = f.business_id
          where f.id = fix.finding_id and m.user_id = (select auth.uid())));
create policy member_channel on channel for select using (
  exists (select 1 from business_member m where m.business_id = channel.business_id and m.user_id = (select auth.uid())));
create policy member_event on event for select using (
  exists (select 1 from business_member m where m.business_id = event.business_id and m.user_id = (select auth.uid())));
create policy member_scan on scan_run for select using (
  exists (select 1 from business_member m where m.business_id = scan_run.business_id and m.user_id = (select auth.uid())));

-- F-017: Google tokens live in channel.meta and members read channel through the anon client
-- (apps/web/lib/reads.ts). Named columns only; anything that needs meta uses the service role.
revoke select on channel from anon, authenticated;
grant select (id, business_id, type, name, external_id, url, status, last_synced_at) on channel to authenticated;

-- F-019: one verified holder per facts host. Pre-check, run before applying (must return no rows):
--   select lower(facts_host), count(*) from business where facts_host_verified_at is not null
--   group by 1 having count(*) > 1;
create unique index business_facts_host_verified_uniq on business (lower(facts_host)) where facts_host_verified_at is not null;
