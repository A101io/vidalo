-- Business profiles (feature 001, ADR-0001 and ADR-0004).
--
-- business.profile_auto  : what the understanding step decided (the scanner writes it, never the owner).
-- business.profile_owner : the owner's correction from /app/gegevens. A later automatic profile never
--                          touches this column; which column a Db method writes is the whole rule.
-- scan_run.profile       : the effective profile that scan was asked with, so an old report keeps it.
-- prompt.template_key    : the online-template a question came from (prompts/online.ts).
--
-- The shape check on each profile column is a second line of defence behind sanitizeSlot in the code:
-- a slot is later put into a question sent to AI systems, so no markup, quote, slash or other
-- control character may be stored, whatever wrote the row. A profile without a valid mode is refused
-- (coalesce, because a CHECK that evaluates to NULL passes).
alter table business add column if not exists profile_auto jsonb;
alter table business add column if not exists profile_owner jsonb;
alter table scan_run add column if not exists profile jsonb;
alter table prompt add column if not exists template_key text;
-- A random reference per business, used only by question_use to count DISTINCT businesses (ADR-0004,
-- S-23). It lives on the business row and nowhere else, so deleting the business destroys the only
-- key that could link a ledger row back to it. Not derived from the id or any fact.
alter table business add column if not exists question_ref uuid not null default gen_random_uuid();

alter table prompt drop constraint if exists prompt_template_key_len;
alter table prompt add constraint prompt_template_key_len
  check (template_key is null or char_length(template_key) <= 80);

alter table business drop constraint if exists business_profile_auto_shape;
alter table business add constraint business_profile_auto_shape check (
  profile_auto is null or (
    coalesce(profile_auto->>'mode', '') in ('door', 'visit', 'online')
    and char_length(coalesce(profile_auto->>'offer', '')) <= 120
    and char_length(coalesce(profile_auto->>'audience', '')) <= 80
    and char_length(coalesce(profile_auto->>'category', '')) <= 60
    and jsonb_typeof(coalesce(profile_auto->'competitors', '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(profile_auto->'competitors', '[]'::jsonb)) <= 3
    and coalesce(profile_auto->>'offer', '') || coalesce(profile_auto->>'audience', '') || coalesce(profile_auto->>'category', '')
        !~ '[<>{}\[\]"`\\/@#$%^*=|~;:]'
  )
);

alter table business drop constraint if exists business_profile_owner_shape;
alter table business add constraint business_profile_owner_shape check (
  profile_owner is null or (
    coalesce(profile_owner->>'mode', '') in ('door', 'visit', 'online')
    and char_length(coalesce(profile_owner->>'offer', '')) <= 120
    and char_length(coalesce(profile_owner->>'audience', '')) <= 80
    and char_length(coalesce(profile_owner->>'category', '')) <= 60
    and jsonb_typeof(coalesce(profile_owner->'competitors', '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(profile_owner->'competitors', '[]'::jsonb)) <= 3
    and coalesce(profile_owner->>'offer', '') || coalesce(profile_owner->>'audience', '') || coalesce(profile_owner->>'category', '')
        !~ '[<>{}\[\]"`\\/@#$%^*=|~;:]'
  )
);

alter table scan_run drop constraint if exists scan_run_profile_shape;
alter table scan_run add constraint scan_run_profile_shape check (
  profile is null or (
    coalesce(profile->>'mode', '') in ('door', 'visit', 'online')
    and char_length(coalesce(profile->>'offer', '')) <= 120
    and char_length(coalesce(profile->>'audience', '')) <= 80
    and char_length(coalesce(profile->>'category', '')) <= 60
    and jsonb_typeof(coalesce(profile->'competitors', '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(profile->'competitors', '[]'::jsonb)) <= 3
    and coalesce(profile->>'offer', '') || coalesce(profile->>'audience', '') || coalesce(profile->>'category', '')
        !~ '[<>{}\[\]"`\\/@#$%^*=|~;:]'
  )
);

-- The question library: an append-only ledger, one row per (scan run, template), written once at the
-- end of a scan. Never updated; the view sums it. Thresholds (proven, retired) live in code (ADR-0004).
--
-- Only the server writes and reads it (the table owner / service role). RLS is on with no policies and
-- the Data API roles have no grants, so the anon key in the browser can neither read how Vidalo asks
-- questions nor add rows. scan_run_id goes null when its business (and so its runs) is deleted: the
-- counts stay, nothing personal is in the row: only the template key, family, mode, category and counts,
-- plus business_ref, a random uuid that means nothing once its business row is gone. (scan_run_id, template_key) is unique, and a retried
-- insert does nothing; null run ids are distinct to Postgres, which is fine because the code always
-- writes a run id.
create table if not exists question_use (
  id bigserial primary key,
  scan_run_id uuid references scan_run(id) on delete set null,
  business_ref uuid not null,
  category text not null check (char_length(category) between 1 and 60),
  mode text not null check (mode in ('door', 'visit', 'online')),
  template_key text not null check (char_length(template_key) between 1 and 80),
  template_nl text not null check (char_length(template_nl) between 1 and 300),
  family text not null check (family in ('existence', 'hours', 'address', 'payment', 'phone', 'what', 'website', 'rec_town', 'rec_category', 'alternative', 'other')),
  intent text,
  asked int not null check (asked >= 0),
  usable int not null check (usable >= 0 and usable <= asked),
  at timestamptz not null default now(),
  unique (scan_run_id, template_key)
);
create index if not exists question_use_category_mode_idx on question_use (category, mode);
alter table question_use enable row level security;
revoke all on table question_use from anon, authenticated;
-- the sequence behind id is not granted to the Data API roles either
revoke all on sequence question_use_id_seq from anon, authenticated;

-- security_invoker: the view runs with the caller's rights, so it cannot be used to get round the
-- table's RLS and grants.
create or replace view question_library with (security_invoker = true) as
  select category, mode, template_key, max(template_nl) as template_nl, family, max(intent) as intent,
         sum(asked)::int as asked, sum(usable)::int as usable,
         count(distinct business_ref)::int as businesses,
         round(sum(usable)::numeric / nullif(sum(asked), 0), 2) as usable_share
  from question_use group by category, mode, template_key, family;
revoke all on question_library from anon, authenticated;
