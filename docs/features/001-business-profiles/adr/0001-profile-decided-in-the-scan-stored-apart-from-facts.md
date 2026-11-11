# ADR-0001 — The business profile is decided inside the scan and stored apart from the facts

*2026-11-11 · status: accepted*

## Context
Amendment A1: every check, free and paid, first works out what the business is (mode, offer,
audience, category, competitors) before any question is chosen. A free check today runs
`POST /api/scan` → `prepareBusiness` (facts v1 and, until now, the whole prompt set) in the web
request, then the scan itself on the `vidalo-scans` queue consumer on Cloudflare
(`apps/worker/src/cloudflare.ts`) or in `after()` locally. Paid scans run as `scan` jobs in the
worker; the CLI calls `runScan` directly. The understanding step makes one web-search call
(5–20 s). Facts are owner-asserted and versioned; a new version only by the owner's confirmation
(`docs/CONTRACT.md`). Owner corrections of the profile must never be overwritten by a later
automatic one. A report is rebuilt from stored rows (`buildReport`) long after the scan.

## Decision
- `ensureProfile()` runs at the start of `runScan`, before `loadPrompts`, for kinds `free`,
  `baseline`, `monthly` and `ondemand`; a `recheck` re-asks stored prompts by id and skips it.
  Every path that scans (queue consumer, `after()`, worker job, CLI) therefore gets it from one place.
- `prepareBusiness` stops inserting prompts; `loadPrompts` generates them once the profile is known.
- The automatic profile is stored in `business.profile_auto`, the owner's in
  `business.profile_owner` (migration 0015). `effectiveProfile()` lays the owner's fields over the
  automatic ones. `Db.setAutoProfile` writes only the first column, `Db.setOwnerProfile` only the
  second, `upsertBusiness` neither.
- The effective profile used by a scan is written to `scan_run.profile` at `createScanRun` and is
  what `buildReport` and `buildSnapshot` judge with.
- In the scanner the profile reaches compare and extraction as `facts.profile`, copied in by
  `withProfile()` like `withCountry()`; `insertFacts` strips it.

## Consequences
**Good:** the waiting page can show the step as it happens; the web request is as fast as today;
the CLI, the free check and paid scans behave the same; the owner's correction is safe by
construction; an old report keeps the profile it was asked with.
**Bad:** two nullable JSON columns on `business` and one on `scan_run`; the invariant "auto never
overwrites owner" rests on which column a method writes, not on a database rule (both writers are
the service role, so a trigger could not tell them apart). Each check is ~15 s longer.
**We can no longer:** show the profile before the scan has started (the pick page knows nothing
about it), or treat the profile as a fact that the facts page publishes.

## Alternatives rejected
| Option | Why not |
|---|---|
| Run the step in the `/api/scan` request | 5–20 s before the redirect to the waiting page; on Workers it shares the request's time budget; the waiting page could not show it |
| Store the profile inside facts JSON | A new facts version may only come from the owner; an automatic profile in facts would either break that rule or never update |
| One `profile` column with a `source` field and an update guard in SQL | Possible, but the guard is still code-enforced (same role); two columns make the rule impossible to break by a partial update and keep the automatic value visible next to the owner's |
| A separate `business_profile` table, versioned | History of profiles is not asked for; `scan_run.profile` already records what each scan used |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
