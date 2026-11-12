-- Feature 002 (lane A, ADR-0002, ADR-0004): sign-ins and the sign-in link limit.
--
-- auth_session: one row per sign-in (a Supabase session, keyed by the JWT claim
-- session_id). getSession() judges it on every request: ended, idle 30 days or
-- older than 90 days signs the browser out. Written only by the app after
-- Supabase accepted a sign-in link. Holds no IP address and no user-agent string:
-- only the browser and system family (Q9). At most the 10 newest rows per login
-- are kept (the app prunes on every sign-in). No foreign key to auth.users: the
-- purge deletes a login's rows itself, and verify:pg has no auth.users.
--
-- auth_throttle: one row per sign-in link request per key, where a key is the
-- HMAC-SHA256 (hex) of "addr:<address>" or "ip:<ip>" under VIDALO_AUTH_SECRET.
-- No address or IP is stored readable. The cron deletes rows older than 24 hours.
--
-- Only the server reads and writes both (the table owner through DATABASE_URL /
-- Hyperdrive): RLS on, no policies, no grants for the Data API roles.

create table auth_session (
  session_id   uuid primary key,
  user_id      uuid not null,
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  ended_reason text check (ended_reason in ('signed_out', 'signed_out_everywhere', 'idle', 'max_age', 'replaced', 'deleted')),
  browser      text not null check (browser in ('chrome', 'safari', 'firefox', 'edge', 'other')),
  os           text not null check (os in ('macos', 'windows', 'ios', 'android', 'linux', 'other')),
  check ((ended_at is null) = (ended_reason is null)),
  check (last_seen_at >= signed_in_at)
);
create index auth_session_user_idx on auth_session (user_id, signed_in_at desc);

create table auth_throttle (
  key_hash text not null check (char_length(key_hash) = 64),
  at       timestamptz not null default now()
);
create index auth_throttle_key_at_idx on auth_throttle (key_hash, at desc);

alter table auth_session enable row level security;
alter table auth_throttle enable row level security;
revoke all on auth_session, auth_throttle from anon, authenticated;
