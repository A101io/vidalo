-- Feature 006 (product lines, ADR-0010..0014). A product line is a scan subject next to the business:
-- versioned owner facts, and line rows on the existing scan tables with a nullable product_line_id + market.
-- Not applied to the hosted project by the feature itself (D4): pnpm verify:pg applies it to a local database.

-- 1. New fact keys (criteria 13-16). Not used in this file, so the enum additions may commit with it.
alter type fact_key add value if not exists 'spec';
alter type fact_key add value if not exists 'certificate';
alter type fact_key add value if not exists 'outlet';
alter type fact_key add value if not exists 'successor';

-- 2. The line: identity and status only. What it is lives in its versions.
create table product_line (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'discontinued')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_line_id_business unique (id, business_id)
);
create index product_line_business_idx on product_line (business_id);

-- 3. Versions: one row per owner confirmation, never changed afterwards.
create table product_line_facts (
  product_line_id uuid not null references product_line(id) on delete cascade,
  version         int  not null check (version >= 1),
  data            jsonb not null,           -- ProductLineData (packages/core/src/types.ts)
  confirmed_at    timestamptz not null default now(),
  primary key (product_line_id, version),
  -- Backstop bounds, looser than PRODUCT_LINE_LIMITS (which change with D2): they cap what one version can cost
  -- and what a later path that skips parseProductLine (an import, a script) can store (S-07).
  constraint product_line_facts_shape check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'name') = 'string'     and char_length(data ->> 'name') between 2 and 80
    and jsonb_typeof(data -> 'category') = 'string' and char_length(data ->> 'category') between 2 and 60
    and jsonb_typeof(data -> 'markets') = 'array'   and jsonb_array_length(data -> 'markets') between 1 and 10
    and not jsonb_path_exists(data, '$.markets[*] ? (@.type() != "string")')
    and not jsonb_path_exists(data, '$.markets[*] ? (!(@ like_regex "^[A-Z]{2}$"))')
    and jsonb_typeof(data -> 'useCases') = 'array'     and jsonb_array_length(data -> 'useCases') <= 10
    and jsonb_typeof(data -> 'specs') = 'array'        and jsonb_array_length(data -> 'specs') <= 20
    and jsonb_typeof(data -> 'certificates') = 'array' and jsonb_array_length(data -> 'certificates') <= 10
    and jsonb_typeof(data -> 'outlets') = 'array'      and jsonb_array_length(data -> 'outlets') <= 50
    and jsonb_typeof(data -> 'replaces') = 'array'     and jsonb_array_length(data -> 'replaces') <= 10
    -- an outlet url is null or an http(s) address, nothing else (no javascript:, data:, file:)
    and not jsonb_path_exists(data, '$.outlets[*].url ? (@.type() != "null" && (@.type() != "string" || !(@ like_regex "^https?://" flag "i")))')
    and octet_length(data::text) <= 32768
  )
);

create function public.refuse_update() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are never changed', tg_table_name;
end $$;
revoke execute on function public.refuse_update() from public, anon, authenticated;
create trigger product_line_facts_immutable before update on product_line_facts
  for each row execute function public.refuse_update();

-- 4. Line rows on the scan tables. Null line = the business itself (every row before this migration).
alter table prompt
  add column product_line_id uuid,
  add column market text,
  add constraint prompt_line_with_market check ((product_line_id is null) = (market is null)),
  add constraint prompt_market_code check (market is null or market ~ '^[A-Z]{2}$'),
  add constraint prompt_line_same_business foreign key (product_line_id, business_id)
    references product_line (id, business_id) on delete cascade;
create index prompt_line_idx on prompt (product_line_id, market) where product_line_id is not null;

alter table scan_run
  add column product_line_id uuid,
  add column product_line_version int,
  add column market text,
  add constraint scan_run_line_all_or_none check (
    (product_line_id is null) = (market is null) and (product_line_id is null) = (product_line_version is null)),
  add constraint scan_run_market_code check (market is null or market ~ '^[A-Z]{2}$'),
  add constraint scan_run_line_same_business foreign key (product_line_id, business_id)
    references product_line (id, business_id) on delete cascade,
  add constraint scan_run_line_version foreign key (product_line_id, product_line_version)
    references product_line_facts (product_line_id, version) on delete cascade;
create index scan_run_line_idx on scan_run (product_line_id, market, created_at desc) where product_line_id is not null;

alter table sample
  add column product_line_id uuid,
  add column market text;
alter table finding
  add column product_line_id uuid,
  add column market text;
create index finding_line_idx on finding (product_line_id, market, status) where product_line_id is not null;

-- A sample's and a finding's line and market are their scan run's, set here and nowhere else.
-- A sample must also answer a question of that same business, line and market; a finding belongs to its run's
-- business (S-03). A finding never moves to a run of another line or market (upsertFindings moves scan_run_id to
-- the latest run that saw it). Security invoker (S-04): every writer is the service role or the table owner,
-- which already reads scan_run and prompt; the function needs no more than its caller has.
create function public.inherit_line_scope() returns trigger
  language plpgsql set search_path = '' as $$
declare
  run_business uuid; run_line uuid; run_market text; p_business uuid; p_line uuid; p_market text; found_run boolean;
begin
  select business_id, product_line_id, market, true into run_business, run_line, run_market, found_run
    from public.scan_run where id = new.scan_run_id;
  if not coalesce(found_run, false) then return new; end if;  -- the foreign key on scan_run_id says so
  if tg_op = 'UPDATE' and (run_line, run_market) is distinct from (old.product_line_id, old.market) then
    raise exception 'a % row cannot move to another product line or market', tg_table_name;
  end if;
  new.product_line_id := run_line;
  new.market := run_market;
  if tg_table_name = 'finding' then
    if new.business_id is distinct from run_business then
      raise exception 'finding: business differs from its scan run''s business';
    end if;
  elsif tg_table_name = 'sample' then
    select business_id, product_line_id, market into p_business, p_line, p_market from public.prompt where id = new.prompt_id;
    if p_business is distinct from run_business then
      raise exception 'sample: prompt and scan run belong to different businesses';
    end if;
    if (p_line, p_market) is distinct from (run_line, run_market) then
      raise exception 'sample: prompt and scan run belong to different product lines or markets';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.inherit_line_scope() from public, anon, authenticated;
create trigger sample_line_scope before insert or update of scan_run_id, prompt_id, product_line_id, market on sample
  for each row execute function public.inherit_line_scope();
create trigger finding_line_scope before insert or update of scan_run_id, business_id, product_line_id, market on finding
  for each row execute function public.inherit_line_scope();

-- 5. RLS: members read their own lines; nothing but select for the Data API roles (as business_member, 0016).
alter table product_line enable row level security;
alter table product_line_facts enable row level security;
create policy member_product_line on product_line for select using (
  exists (select 1 from business_member m where m.business_id = product_line.business_id and m.user_id = (select auth.uid())));
create policy member_product_line_facts on product_line_facts for select using (
  exists (select 1 from product_line l join business_member m on m.business_id = l.business_id
          where l.id = product_line_facts.product_line_id and m.user_id = (select auth.uid())));
revoke all on table product_line, product_line_facts from anon, authenticated;
grant select on table product_line, product_line_facts to authenticated;
-- prompt and sample stay internal (0004: no policies). finding and scan_run keep member_finding / member_scan
-- from 0016, so a member sees the line rows of their own business and nothing else.
