-- support@vidalo.io auto-replies: the decision log (A101 kit, adopt/support/support_autoreply_log.sql).
--
-- One row per message arriving at support@vidalo.io, with the responder's
-- decision and why, including the exact text that went out — or the draft the
-- content scan refused. It is the audit trail and the mail-loop counter: before
-- answering, the endpoint asks it "did we already reply on this thread?" and
-- "how many replies has this sender had today?".
--
-- Only the server writes and reads it (DATABASE_URL / Hyperdrive, the table
-- owner). RLS on with no policies and no grants for the Data API roles, like
-- waitlist (0009). Columns = SupportLogRow in packages/core/src/support/kit-support.ts.
create table if not exists support_autoreply_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Gmail's own id for the inbound message; the unique index makes a re-run of
  -- the mailbox poller idempotent rather than a second reply.
  provider_message_id text,
  provider_thread_id text,
  from_email text not null check (char_length(from_email) <= 320),
  subject text not null default '' check (char_length(subject) <= 400),
  -- Clipped to 2000 characters by the caller: reviewable, not a second mailbox.
  body_excerpt text not null default '',
  action text not null check (action in ('replied', 'escalated', 'ignored')),
  reason text not null,
  topic text,
  language text not null default 'nl' check (language in ('en', 'nl')),
  platform_related boolean,
  flagged_for_human boolean not null default false,
  reply_subject text,
  reply_body text,
  guard_violations text[] not null default '{}',
  -- The business the sender owns, when known: { businessId, status }. Never a secret.
  matched jsonb,
  -- Model calls this decision made (0, 1 or 2); the daily budget sums these.
  model_calls smallint not null default 0 check (model_calls between 0 and 2)
);

create unique index if not exists support_autoreply_log_provider_message_id_key
  on support_autoreply_log (provider_message_id) where provider_message_id is not null;
create index if not exists support_autoreply_log_thread_idx
  on support_autoreply_log (provider_thread_id) where provider_thread_id is not null;
create index if not exists support_autoreply_log_sender_recent_idx
  on support_autoreply_log (from_email, created_at desc);
create index if not exists support_autoreply_log_recent_idx
  on support_autoreply_log (created_at desc);

alter table support_autoreply_log enable row level security;
revoke all on table support_autoreply_log from anon, authenticated;
