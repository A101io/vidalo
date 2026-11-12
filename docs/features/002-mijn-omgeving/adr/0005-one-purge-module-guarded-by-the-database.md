# ADR-0005 — One purge module, guarded by the database, dry run until armed

*2026-11-11 · status: accepted*

## Context
"Verwijder alles" refuses every status but `scanned` and `churned`, so a Vidalo Scan owner
can never delete (A2). Deletion leaves the Cloudflare custom hostname and route, an
unrevoked Google token and no confirmation mail (A3). The privacy statement promises
deletion at most 30 days after the free check that runs 90 days after churn; nothing
performs it (A4). Julian chose: deleting during a running Monthly cancels at period end and
deletes on the end date, revocable until then (Q3); the promise is kept with a reminder 14
days before (Q6). The brief's risk table asks for a control business that must survive and a
dry-run count before the first real purge. With several businesses per login, the login is
deleted only when no business remains.

## Decision
- `purgeBusiness(deps, businessId, guard)` in `core/shared/purge.ts` is the only code that
  removes a business for an owner or for retention. It is called inline by the web action
  (guard `no_subscription`) and by the worker's `purge` job (guard `due`, or the web's
  fallback). Its order: read, check, revoke Google, remove the custom host, conditional
  delete, delete logins with no business left, mail, log without identity.
- The delete is conditional in SQL (`Db.purgeBusiness`): `due` requires `delete_at <= now`
  and status `scanned`/`churned`; `no_subscription` requires not (`plan = 'monitor'` and
  status `trial`/`active`/`paused`). The same rule exists as `purgeAllowed` for the early
  exit, tested against the SQL on PgDb.
- The deletion date lives on `business` (`delete_at`, `delete_reason`, `churned_at`,
  `deletion_reminded_at`, migration 0019). A trigger gives every churned business a date
  (churn + 120 days unless the owner's is earlier) and clears it when a subscription runs
  again without a cancel; a CHECK forbids a date on a business that pays without a cancel.
- The dry run covers **retention only**: a purge with guard `due` and `delete_reason =
  'retention'` deletes only when `VIDALO_PURGE=1`, otherwise it logs `retention.would_purge`.
  An owner's own request (inline `no_subscription`, the fallback job, a scheduled owner date)
  always deletes, because the page and the mail have told the owner it happens (F-010). The
  cron logs `retention.overdue` daily.
- Before any delete, when the business has a Stripe customer, the purge asks Stripe
  (`stripeLive`): any subscription not `canceled`/`incomplete_expired` stops it with reason
  `stripe_live` (F-021). The database's `churned` can be wrong (a lost webhook, the 60-day
  paused rule); Stripe's own list is the source for "still billing".
- The custom facts host is removed only when this business is its verified holder
  (`getBusinessByFactsHost` returns it); a unique index allows one verified holder (F-019).
- Vidalo Scan businesses get a retention date too: `SCAN_RETENTION_MONTHS` (24, one constant,
  pending Julian) after the last sign-in or payment; the CHECK admits a date on a `trial`
  business only for `plan = 'setup'` with reason `retention` (F-012).
- Payloads carry `{ businessId, guard }` only.

## Consequences
**Good:** a bug in the caller cannot delete a paying business; one order of side effects for
both paths; "data past its date" is a count, not a hope; idempotent by construction.
**Bad:** the trigger acts on every writer of `status`, including tests and scripts; a
Cloudflare outage delays deletion (retried, visible as overdue); the confirmation mail is
best effort after the delete (a failure is logged, not retried, because the address is
gone).
**We can no longer:** keep a churned business without a deletion date, or delete a paying
business through this module, without a migration; purge while Stripe is unreachable.

## Alternatives rejected
| Option | Why not |
|---|---|
| Cron computes dates from `business.status` events each tick | No invariant to test or count; the events table grows; a missing event means data kept forever |
| Separate owner-delete and retention code | Two orders of side effects, two places to forget the Cloudflare host |
| Immediate stop without refund for a running Monthly | Julian chose period end (Q3) |
| Delete the Google token only with the business | The contract has ended at churn; Q14 chose at once |
| Arm the purge from the first deploy | The brief requires a dry-run count first; production data has never been through this |
| Dry run for every purge | An owner told "deleted" would keep their data (F-010, AVG art. 17 and 12(3)) |
| A local subscription-state guard instead of asking Stripe | The local state is exactly what is wrong in the failure cases (F-021) |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
