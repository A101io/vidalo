-- Feature 006 AC6 (S-01, S-02, S-05): row level security of product_line and product_line_facts after 0020,
-- proven as one rolled-back block.
--
--   psql "$URL" -X -v ON_ERROR_STOP=1 -f scripts/rls/product-lines.sql             # expect: ERROR ... RLS-OK
--   psql "$URL" -X -v ON_ERROR_STOP=1 -v broken=1 -f scripts/rls/product-lines.sql  # control: expect RLS-FAIL
--
-- Runs on verify:pg's database (scripts/local-auth-shim.sql) and, by Julian after D4, on the hosted project once
-- 0020 is applied. Everything happens in one transaction that ends in `raise exception` carrying the counts, so
-- nothing stays behind. Only the final message is the result: RLS-OK <counts> or RLS-FAIL <what>.
-- `broken=1` first recreates both member policies as `using (true)`; the same block must then go red.
begin;

\if :{?broken}
drop policy member_product_line on product_line;
create policy member_product_line on product_line for select using (true);
drop policy member_product_line_facts on product_line_facts;
create policy member_product_line_facts on product_line_facts for select using (true);
\endif

do $$
declare
  u1 uuid := '11111111-1111-1111-1111-111111111111';  -- login 1: business A with two lines (the control that must see rows)
  u2 uuid := '22222222-2222-2222-2222-222222222222';  -- login 2: business B with one line
  bA uuid; bB uuid; lA1 uuid; lA2 uuid; lB1 uuid; rA uuid; rB uuid; fA uuid; fB uuid;
  d jsonb := jsonb_build_object('name', 'Tigris K5', 'category', 'persfittingsysteem', 'markets', jsonb_build_array('NL'),
    'useCases', '[]'::jsonb, 'specs', '[]'::jsonb, 'certificates', '[]'::jsonb, 'outlets', '[]'::jsonb, 'replaces', '[]'::jsonb, 'replacedBy', null);
  t text; n int; seen text := ''; denied boolean; me uuid; msg text;
begin
  -- Fixture as the connecting (owner) role.
  insert into business (slug, name, place, owner_user_id) values ('rls-pl-a', 'A', 'Haarlem', u1) returning id into bA;
  insert into business (slug, name, place, owner_user_id) values ('rls-pl-b', 'B', 'Zwolle', u2) returning id into bB;
  insert into product_line (business_id) values (bA) returning id into lA1;
  insert into product_line (business_id) values (bA) returning id into lA2;
  insert into product_line (business_id) values (bB) returning id into lB1;
  insert into product_line_facts (product_line_id, version, data) values (lA1, 1, d), (lA2, 1, d), (lB1, 1, d);
  insert into scan_run (business_id, kind, engines, samples_per_prompt, status, product_line_id, product_line_version, market)
    values (bA, 'monthly', '{chatgpt}', 1, 'done', lA1, 1, 'NL') returning id into rA;
  insert into scan_run (business_id, kind, engines, samples_per_prompt, status, product_line_id, product_line_version, market)
    values (bB, 'monthly', '{chatgpt}', 1, 'done', lB1, 1, 'NL') returning id into rB;
  insert into finding (business_id, scan_run_id, fact_key, engine, wrong_value, correct_value, frequency, sample_count)
    values (bA, rA, 'spec', 'chatgpt', 'PN10', 'PN16', 1, 1) returning id into fA;
  insert into finding (business_id, scan_run_id, fact_key, engine, wrong_value, correct_value, frequency, sample_count)
    values (bB, rB, 'spec', 'chatgpt', 'PN10', 'PN16', 1, 1) returning id into fB;
  insert into prompt (business_id, category, text_nl, product_line_id, market) values (bA, 'spec', 'Welke drukklasse heeft Tigris K5?', lA1, 'NL');
  if (select count(*) from business_member where business_id in (bA, bB)) <> 2 then raise exception 'RLS-FAIL the trigger did not fill business_member'; end if;

  -- What Supabase grants by default on tables 0020 does not touch (the local shim has no default privileges): the Data
  -- API roles can in principle read and write them, and only row level security (or its absence of policies) says no.
  grant select, insert, update, delete on finding, scan_run, prompt, sample to anon, authenticated;
  begin
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  exception when others then null;
  end;

  -- S-01: the Data API roles hold SELECT on the two new tables and nothing else; the trigger functions are not callable.
  foreach t in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.product_line', t) or has_table_privilege('anon', 'public.product_line', t)
       or has_table_privilege('authenticated', 'public.product_line_facts', t) or has_table_privilege('anon', 'public.product_line_facts', t) then
      raise exception 'RLS-FAIL % is granted on product_line or product_line_facts', t;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.product_line', 'SELECT') or has_table_privilege('anon', 'public.product_line_facts', 'SELECT') then
    raise exception 'RLS-FAIL anon can select product_line or product_line_facts';
  end if;
  if has_function_privilege('authenticated', 'public.inherit_line_scope()', 'EXECUTE') or has_function_privilege('anon', 'public.inherit_line_scope()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refuse_update()', 'EXECUTE') or has_function_privilege('anon', 'public.refuse_update()', 'EXECUTE') then
    raise exception 'RLS-FAIL a trigger function is executable by the Data API roles';
  end if;

  -- Counts per caller. Login 1 first (control: must see rows), then login 2, then anon.
  for who in 1..3 loop
    if who = 3 then set local role anon; perform set_config('request.jwt.claim.sub', '', true);
    else
      me := case who when 1 then u1 else u2 end;
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', me::text, true);
      if auth.uid() is distinct from me then raise exception 'RLS-FAIL auth.uid() is %', auth.uid(); end if;
    end if;
    seen := seen || case who when 1 then ' login1[' when 2 then ' login2[' else ' anon[' end;
    foreach t in array array['product_line', 'product_line_facts'] loop
      begin
        execute format('select count(*) from public.%I', t) into n;
      exception when insufficient_privilege then n := 0;  -- anon has no grant: nothing readable
      end;
      seen := seen || t || '=' || n || ' ';
      if who = 1 and n <> 2 then raise exception 'RLS-FAIL login1 sees % % rows, expected 2', n, t; end if;
      if who = 2 and n <> 1 then raise exception 'RLS-FAIL login2 sees % % rows, expected 1', n, t; end if;
      if who = 3 and n <> 0 then raise exception 'RLS-FAIL anon sees % % rows', n, t; end if;
    end loop;
    if who <> 3 then
      -- the join path of member_product_line_facts: no version of the other business's lines, by id
      select count(*) into n from product_line_facts where product_line_id = case who when 1 then lB1 else lA1 end;
      seen := seen || 'others_versions=' || n || ' ';
      if n <> 0 then raise exception 'RLS-FAIL login % reads % versions of another business', who, n; end if;
      select count(*) into n from product_line where business_id = case who when 1 then bB else bA end;
      if n <> 0 then raise exception 'RLS-FAIL login % reads % lines of another business', who, n; end if;
      -- the line rows on the shared tables follow the business's own policies (member_scan, member_finding); prompt stays internal
      select count(*) into n from scan_run where product_line_id is not null;
      seen := seen || 'line_runs=' || n || ' ';
      if n <> 1 then raise exception 'RLS-FAIL login % sees % line runs, expected 1 (its own)', who, n; end if;
      select count(*) into n from finding where product_line_id is not null;
      if n <> 1 then raise exception 'RLS-FAIL login % sees % line findings, expected 1 (its own)', who, n; end if;
      select count(*) into n from prompt;
      seen := seen || 'prompt=' || n || ' ';
      if n <> 0 then raise exception 'RLS-FAIL login % reads % prompts (internal table)', who, n; end if;
    end if;
    seen := seen || ']';
    reset role;
  end loop;

  -- Writes as a signed-in login (login 2 against business A, and login 1 against its own): denied on both tables.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  foreach t in array array['product_line', 'product_line_facts'] loop
    denied := false;
    begin
      if t = 'product_line' then insert into product_line (business_id) values (bA);
      else insert into product_line_facts (product_line_id, version, data) values (lA1, 2, d); end if;
    exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception 'RLS-FAIL login 2 inserted into %', t; end if;
    denied := false;
    begin execute format('update public.%I set %I = now()', t, case t when 'product_line' then 'created_at' else 'confirmed_at' end); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception 'RLS-FAIL login 2 updated %', t; end if;
    denied := false;
    begin execute format('delete from public.%I', t); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception 'RLS-FAIL login 2 deleted from %', t; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  denied := false;
  begin update product_line set status = 'discontinued' where id = lA1; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'RLS-FAIL the owner updated its own line through the Data API'; end if;

  -- S-02: the new columns on shared tables add no write path: another business's and its own rows stay as they were.
  perform set_config('request.jwt.claim.sub', u2::text, true);
  update finding set product_line_id = lB1, market = 'BE' where id = fA;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FAIL login 2 updated business A finding (% rows)', n; end if;
  update scan_run set product_line_id = null, market = null, product_line_version = null where id = rA;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FAIL login 2 updated business A scan_run (% rows)', n; end if;
  reset role;
  if (select product_line_id from finding where id = fA) is distinct from lA1 or (select market from scan_run where id = rA) is distinct from 'NL' then
    raise exception 'RLS-FAIL a line row of business A changed through the Data API';
  end if;

  -- S-05: a confirmed version is never changed, not even by the table owner.
  begin
    update product_line_facts set data = d where product_line_id = lA1;
    raise exception 'RLS-FAIL a stored version was updated';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg like 'RLS-FAIL%' then raise; end if;
    if msg not like '%never changed%' then raise exception 'RLS-FAIL wrong error on updating a version: %', msg; end if;
  end;

  raise exception 'RLS-OK%', seen;
end $$;
rollback;
