# ADR-0004 — Sign-in links are throttled in Postgres, keyed by HMAC hashes

*2026-11-11 · status: accepted*

## Context
AC-4(b): more than 5 link requests per address per hour, or 20 per IP per hour, get "wacht
even" and no mail (Q10). The web app runs as a Cloudflare Worker: many isolates, no shared
memory. The precedent `core/shared/waitlist.ts` counts per IP in isolate memory and site-wide
in the database; the isolate counter is only a best effort. Postgres is already reached per
request through Hyperdrive inside `withDb()`. An address or IP stored for this purpose is
personal data the privacy text would have to name.

## Decision
- Table `auth_throttle (key_hash char(64), at timestamptz)`, index `(key_hash, at desc)`,
  RLS on, no policies, no grants to anon/authenticated (migration 0018).
- Keys are HMAC-SHA256 (Web Crypto) with `VIDALO_AUTH_SECRET` of `"addr:" + address` and
  `"ip:" + cf-connecting-ip`, hex. Neither the address nor the IP is stored.
- `Db.throttleAuth(keys, since)` inserts one row per key and returns the counts in the window
  in one round trip; `sendMagicLink` checks it after the address format and Turnstile and
  before Supabase. Every attempt counts, including refused ones.
- The worker cron deletes rows older than 24 hours.
- A database error refuses the request (no mail without a count).

## Consequences
**Good:** one global count across isolates; nothing readable kept; a test can drive it on
MemDb and PgDb with a fake clock.
**Bad:** one insert and one count per link request; the HMAC secret is one more Worker secret
to set and rotate (rotating resets the counts, which is harmless).
**We can no longer:** show an operator which address was throttled, or throttle by anything we
did not hash at request time.

## Alternatives rejected
| Option | Why not |
|---|---|
| Isolate memory (`makeLimiter` in `waitlist.ts`) | Each isolate counts alone; 5 per hour per address becomes 5 per isolate |
| Workers KV | Eventually consistent: a burst passes before the count arrives |
| Workers Rate Limiting binding | Periods of 10 or 60 seconds only; an hourly window does not fit |
| A Durable Object counter | New infrastructure and deploy path for one counter |
| Plain SHA-256 of the address | A dictionary of addresses reverses it |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
