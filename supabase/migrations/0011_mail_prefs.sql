-- Mail preferences per business (packages/core/src/shared/mail-prefs.ts).
-- Keys are the optional groups (report, resolution, reminder, followup); an
-- absent key means on. Required service mails are not stored here: they always go.
alter table business add column if not exists mail_prefs jsonb not null default '{}'::jsonb;

-- Who already used the unsubscribe link keeps every optional mail off.
update business b
   set mail_prefs = '{"report": false, "resolution": false, "reminder": false, "followup": false}'::jsonb
 where exists (select 1 from event e where e.business_id = b.id and e.type = 'email.unsubscribed');
