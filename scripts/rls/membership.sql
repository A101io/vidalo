-- Feature 002 B-01, SEC-07/08/10 and F-019: row level security after 0016, proven as one rolled-back block.
--
--   psql "$URL" -X -v ON_ERROR_STOP=1 -f scripts/rls/membership.sql        # expect: ERROR ... RLS-OK
--   psql "$URL" -X -v ON_ERROR_STOP=1 -v broken=1 -f scripts/rls/membership.sql   # control: expect RLS-FAIL
--
-- Runs on verify:pg's database (scripts/local-auth-shim.sql) and, by the delivery-lead, on the hosted
-- project after 0016 is applied. Everything happens in one transaction that ends in `raise exception`
-- carrying the counts, so nothing stays behind (CLAUDE.md: RLS tests on the hosted project). Only the
-- final message is the result: RLS-OK <counts> or RLS-FAIL <what>.
-- `broken=1` first recreates member_business as `using (true)`; the same block must then go red.
begin;

\if :{?broken}
drop policy member_business on business;
create policy member_business on business for select using (true);
\endif

do $$
declare
  u1 uuid := '11111111-1111-1111-1111-111111111111';  -- login 1: two businesses (the control that must see rows)
  u2 uuid := '22222222-2222-2222-2222-222222222222';  -- login 2: one business
  b1 uuid; b2 uuid; b3 uuid; r1 uuid; f1 uuid;
  t text; n int; seen text := '';
  denied boolean; unique_hit boolean; me uuid;
  expect_u1 constant int := 2; expect_u2 constant int := 1;
  tabs text[] := array['business','facts','finding','fix','channel','event','scan_run','business_member'];
begin
  -- Fixture as the connecting (owner) role: three businesses, one row of each kind per business.
  insert into business (slug, name, place, owner_user_id) values ('rls-een', 'Een', 'Haarlem', u1) returning id into b1;
  insert into business (slug, name, place, owner_user_id) values ('rls-twee', 'Twee', 'Amsterdam', u1) returning id into b2;
  insert into business (slug, name, place, owner_user_id) values ('rls-drie', 'Drie', 'Utrecht', u2) returning id into b3;
  foreach t in array array['b1','b2','b3'] loop
    declare b uuid := case t when 'b1' then b1 when 'b2' then b2 else b3 end; begin
      insert into facts (business_id, version, data) values (b, 1, '{}');
      insert into scan_run (business_id, kind, engines, samples_per_prompt, status) values (b, 'free', '{chatgpt}', 1, 'done') returning id into r1;
      insert into finding (business_id, scan_run_id, fact_key, engine, wrong_value, correct_value, frequency, sample_count) values (b, r1, 'phone', 'chatgpt', 'x', 'y', 1, 1) returning id into f1;
      insert into fix (finding_id, action, target) values (f1, 'manual', 'x');
      insert into channel (business_id, type, name, meta) values (b, 'gbp', 'Google', '{"refreshToken":"secret"}');
      insert into event (business_id, type) values (b, 'rls.test');
    end;
  end loop;
  if (select count(*) from business_member) <> 3 then raise exception 'RLS-FAIL the trigger did not fill business_member (%)', (select count(*) from business_member); end if;

  -- What Supabase grants by default on tables 0016 does not touch (the local shim has no default privileges).
  -- business_member and channel keep exactly what the migration gave them.
  grant select, insert, update, delete on business, facts, finding, fix, event, scan_run to anon, authenticated;
  -- ... and the right to call auth.uid() inside a policy (Supabase has it; the shim does not). Already true on the hosted project.
  begin
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  exception when others then null;
  end;

  -- SEC-08: no truncate/references/trigger/dml on business_member for the Data API roles; the trigger function is not callable.
  foreach t in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.business_member', t) or has_table_privilege('anon', 'public.business_member', t) then
      raise exception 'RLS-FAIL % is granted on business_member', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.sync_business_owner_member()', 'EXECUTE') or has_function_privilege('anon', 'public.sync_business_owner_member()', 'EXECUTE') then
    raise exception 'RLS-FAIL sync_business_owner_member() is executable by the Data API roles';
  end if;

  -- SEC-07: counts per caller. Login 1 first (control: must see rows), then login 2, then anon.
  for who in 1..3 loop
    if who = 3 then set local role anon; perform set_config('request.jwt.claim.sub', '', true);
    else
      me := case who when 1 then u1 else u2 end;
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', me::text, true);
      if auth.uid() is distinct from me then raise exception 'RLS-FAIL auth.uid() is %', auth.uid(); end if;
    end if;
    seen := seen || case who when 1 then ' login1[' when 2 then ' login2[' else ' anon[' end;
    foreach t in array tabs loop
      begin
        execute format('select count(*) from public.%I', t) into n;
      exception when insufficient_privilege then n := 0;  -- anon has no grant on business_member/channel: nothing readable
      end;
      -- channel is readable by the named columns only; count through one of them
      if t = 'channel' and who <> 3 then select count(id) into n from channel; end if;
      seen := seen || t || '=' || n || ' ';
      if who = 1 and n <> expect_u1 and t <> 'business_member' then raise exception 'RLS-FAIL login1 sees % % rows, expected %', n, t, expect_u1; end if;
      if who = 1 and t = 'business_member' and n <> 2 then raise exception 'RLS-FAIL login1 sees % member rows, expected 2', n; end if;
      if who = 2 and n <> expect_u2 then raise exception 'RLS-FAIL login2 sees % % rows, expected %', n, t, expect_u2; end if;
      if who = 3 and n <> 0 then raise exception 'RLS-FAIL anon sees % % rows', n, t; end if;
    end loop;
    seen := seen || ']';
    reset role;
  end loop;

  -- Writes as a signed-in login: no member row can be inserted, and nobody takes a business over.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  denied := false;
  begin insert into business_member (business_id, user_id) values (b1, u2); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'RLS-FAIL login 2 inserted itself into business_member'; end if;
  denied := false;
  begin update business_member set user_id = u2 where business_id = b1; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'RLS-FAIL login 2 updated business_member'; end if;
  update business set owner_user_id = u2 where id = b1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FAIL login 2 took over business 1 (% rows)', n; end if;
  delete from business where id = b1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS-FAIL login 2 deleted business 1 (% rows)', n; end if;

  -- SEC-10 (F-017): Google tokens are not selectable; the allowed columns are.
  perform set_config('request.jwt.claim.sub', u1::text, true);
  denied := false;
  begin perform meta from channel; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'RLS-FAIL login 1 can select channel.meta'; end if;
  denied := false;
  begin perform * from channel; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'RLS-FAIL login 1 can select channel.*'; end if;
  select count(*) into n from (select id, status from channel) c;
  if n <> 2 then raise exception 'RLS-FAIL login 1 cannot read channel id, status (% rows)', n; end if;
  reset role;
  if (select meta ->> 'refreshToken' from channel where business_id = b1) is distinct from 'secret' then raise exception 'RLS-FAIL the service side lost channel.meta'; end if;

  -- F-019: a second business cannot mark the same facts host verified.
  update business set facts_host = 'feiten.voorbeeld.nl', facts_host_verified_at = now() where id = b1;
  unique_hit := false;
  begin update business set facts_host = 'Feiten.Voorbeeld.nl', facts_host_verified_at = now() where id = b2; exception when unique_violation then unique_hit := true; end;
  if not unique_hit then raise exception 'RLS-FAIL two businesses hold the same verified facts host'; end if;

  -- SEC-09: owner A -> B -> null moves the member row at once.
  update business set owner_user_id = u2 where id = b1;
  if exists (select 1 from business_member where business_id = b1 and user_id = u1) or not exists (select 1 from business_member where business_id = b1 and user_id = u2) then
    raise exception 'RLS-FAIL the member row did not follow owner_user_id'; end if;
  update business set owner_user_id = null where id = b1;
  if exists (select 1 from business_member where business_id = b1) then raise exception 'RLS-FAIL the member row survived owner_user_id = null'; end if;

  raise exception 'RLS-OK%', seen;
end $$;
rollback;
