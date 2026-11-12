-- Feature 002 (lane A, ADR-0005): when a business is deleted, carried on the business itself.
--
-- delete_at / delete_reason: the date this business is deleted and why ("owner": the owner asked,
-- at the end of a running Vidalo Monthly; "retention": the published retention rule). A churned
-- business always has a date (churn + 120 days: 90 days kept, one free check, deletion within 30
-- days after it), unless the owner's own date is earlier. A business that pays without a cancel
-- can never carry one (CHECK), except a Vidalo Scan's retention date (F-012, Julian 11 Nov 2026:
-- 24 months after the last sign-in or payment, set by the worker's cron).
-- churned_at: when the status became churned. deletion_reminded_at: the 14-day reminder went out.
-- last_active_at: a member's last sign-in (the app writes it) or the last payment (this trigger);
-- the Vidalo Scan retention clock.
--
-- The worker's purge deletes only with the same rule in its WHERE clause (core/shared/purge.ts).

alter table business
  add column churned_at timestamptz,
  add column delete_at timestamptz,
  add column delete_reason text check (delete_reason in ('owner', 'retention')),
  add column deletion_reminded_at timestamptz,
  add column last_active_at timestamptz,
  add constraint business_delete_reason_with_date check ((delete_at is null) = (delete_reason is null)),
  add constraint business_delete_only_when_ending check (
    delete_at is null
    or status in ('scanned', 'churned')
    or cancel_at is not null
    or (plan = 'setup' and status = 'trial' and delete_reason = 'retention')
  );

create function public.business_retention() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  -- 1. Becoming churned: remember when, and give it a date unless the owner's is already set.
  if new.status = 'churned' and (tg_op = 'INSERT' or old.status is distinct from 'churned') then
    new.churned_at := now();
    if new.delete_at is null then
      new.delete_at := now() + interval '120 days';
      new.delete_reason := 'retention';
    end if;
  end if;
  -- 2. Churned without a date (an owner called a deletion off after the end): the retention date.
  if new.status = 'churned' and new.delete_at is null then
    new.delete_at := coalesce(new.churned_at, now()) + interval '120 days';
    new.delete_reason := 'retention';
    new.deletion_reminded_at := null;
  end if;
  -- 3. Running again without a cancel (undo, webhook echo, new subscription, Scan → Monthly):
  --    no deletion. A Vidalo Scan's own retention date stays. Only on a change of status or
  --    cancel_at: a date written straight onto a paying business is refused by the CHECK instead.
  if (tg_op = 'INSERT' or old.status is distinct from new.status or old.cancel_at is distinct from new.cancel_at
      or old.plan is distinct from new.plan)  -- a Scan buying Monthly (V-SEC-01)
     and new.status in ('trial', 'active', 'paused') and new.cancel_at is null
     and not (new.plan = 'setup' and new.status = 'trial' and new.delete_reason = 'retention') then
    new.delete_at := null;
    new.delete_reason := null;
    new.deletion_reminded_at := null;
    if tg_op = 'UPDATE' and old.status = 'churned' then new.churned_at := null; end if;
  end if;
  -- 4. A payment starts or renews a subscription: the business is in use.
  if new.status in ('trial', 'active') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.last_active_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.business_retention() from public, anon, authenticated;
create trigger business_retention before insert or update on business
  for each row execute function public.business_retention();

-- Backfill: churned_at from the newest status event, else now; rule 2 then sets the date.
update business b set churned_at = coalesce(
  (select max(e.at) from event e where e.business_id = b.id and e.type = 'business.status' and e.payload->>'status' = 'churned'),
  now())
where b.status = 'churned';
update business set status = status where status = 'churned';
update business set last_active_at = coalesce(last_active_at, created_at) where plan = 'setup' and status = 'trial';

create index job_unrun_business_idx on job ((payload->>'businessId')) where done_at is null;
create index business_delete_at_idx on business (delete_at) where delete_at is not null;
