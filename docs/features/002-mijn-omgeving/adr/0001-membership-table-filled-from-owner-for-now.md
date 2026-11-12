# ADR-0001 — Authorisation is by a `business_member` table, filled from `owner_user_id` for now

*2026-11-11 · status: accepted*

## Context
AC-2: a login with two businesses sees, switches and manages each; a business of another
login is never listed or reachable by changing a request value. Today one login has one
business: `PgDb.getBusinessByOwner` (`packages/core/src/db/pg.ts:360`) returns the newest by
`owner_user_id`, then by `owner_email`, `limit 1`. RLS (0001) grants select on
`owner_user_id = auth.uid()`; `lib/reads.ts` reads the dashboard through that RLS. The A101
standing checklist says authorisation is by membership, never by ownership; team access is a
LATER suggestion (brief #8) that needs exactly that. `owner_user_id` is written in four
places (`lib/session.ts` link by email, `shared/claim.ts`, the Google callback and
`app/google/actions.ts` on proof, `billing/index.ts` on replacement) and read by
`isVerifiedOwner`.

## Decision
- Table `business_member (business_id, user_id, role, created_at)`, primary key
  `(business_id, user_id)`, `role in ('owner')`, one owner per business (partial unique
  index). Migration `0016_business_member.sql`.
- In this cycle the table is **derived**: an `AFTER INSERT OR UPDATE OF owner_user_id`
  trigger on `business` keeps the owner row equal to `owner_user_id`. `owner_user_id` stays
  the single writer of "who owns"; nothing else writes `business_member`. Anon and
  authenticated have no write grant.
- Every RLS policy of 0001 is rewritten against membership. The app answers "may this login
  act on this business" in one module, `apps/web/lib/owner.ts`, through
  `listMemberBusinesses` / `isMember` (`packages/core/src/db/owner-area.ts`).
- The active business is the cookie `vidalo_business`, used only when its id is in the
  login's membership list (re-read every request), else the newest. It is written only by
  `chooseBusiness` after `isMember`. Every action that changes or removes something carries
  its business id in the form and passes `requireOwnerOf`.
- MemDb derives membership from `ownerUserId`; it has no separate store to drift.
- Membership grants rows, not every column: `channel.meta` (Google tokens) is not granted to
  `authenticated` (F-017).
- Every action that changes anything names its business (02-architecture §1a, F-020).

## Consequences
**Good:** the policies and the helper already speak membership, so team access adds rows and a
role, not a rewrite; the one-login-two-businesses case works on every page through one
resolver; a switch in another tab cannot redirect a delete or cancel.
**Bad:** one more table and a trigger that only mirrors a column; every request reads the
membership list (one indexed query, cached per request); `isVerifiedOwner` still compares
`owner_user_id` (equivalent this cycle because the owner member is that column).
**We can no longer:** give a second login access to a business without first deciding which of
`owner_user_id` and `business_member` is the writer, and a migration to widen `role`.

## Alternatives rejected
| Option | Why not |
|---|---|
| Keep `owner_user_id`, drop `limit 1`, list by it | Works today, but every policy and helper is rewritten again for team access; the standing checklist names this exact pattern |
| `business_member` written directly by the app, `owner_user_id` dropped | Four writers of `owner_user_id` and `isVerifiedOwner` change in the same cycle as a security-critical session rework; two places could answer "who owns" during the move |
| The chosen business in a signed cookie, trusted | A signature proves we wrote it, not that the login is still a member (a business can be transferred by a verified owner) |
| The business id in the URL (`/app/{id}/…`) | Every link, redirect and the language rewrite change; the cookie plus `requireOwnerOf` gives the same guarantee with no URL change |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
