-- The coming-soon list: e-mail addresses left on /binnenkort (EN /coming-soon)
-- by people who want to hear when Vidalo opens. One row per address.
--
-- Only the server writes and reads it (the web app's DATABASE_URL / Hyperdrive,
-- i.e. the table owner). RLS is on with no policies and the Data API roles have
-- no grants, so the anon key that ships in the browser can neither list the
-- addresses nor add rows by itself.
--
-- consent_text keeps the exact sentence the person agreed to, in their language,
-- as proof of consent (AVG art. 7(1)). unsubscribed_at ends every use of the row;
-- a removal request deletes it.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (char_length(email) between 3 and 254 and email = lower(email) and position('@' in email) > 1),
  language text not null default 'nl' check (language in ('nl', 'en')),
  source text not null default 'coming_soon' check (char_length(source) between 1 and 40),
  consent_text text not null check (char_length(consent_text) between 1 and 500),
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

alter table waitlist enable row level security;
revoke all on table waitlist from anon, authenticated;
