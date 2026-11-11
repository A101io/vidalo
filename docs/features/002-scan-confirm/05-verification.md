# 002 — Verification (11 Nov 2026)

Reports: `qa.md`, `security.md`, `compliance.md` (this folder). No phase-1 checklists existed for this feature (it went from request to build in one session); the lessons are in `docs/process/checklists/security.md`.

## Verdict: SHIP after round 2, with the P1s below open
Round 1 found two P0s. Both are fixed and verified on this branch.

| Id | Was | Fix | Evidence |
|---|---|---|---|
| SEC-01 = QA-01 (P0) | Parallel presses of one link started one check each (60 of 60 on MemDb; 5 of 5 on Postgres), past every cap | `Db.withLock` (PgDb: `pg_try_advisory_xact_lock` in a transaction, retried so a waiter never holds a pool connection; MemDb: a queue per key). `confirmOnce` claims the link, runs the caps and records the start under `FREE_CHECK_LOCK`; the confirmation mail's caps run under the same lock (also closes QA-03 for the confirm path) | `test/scan-confirm-race.test.ts`: 30 parallel presses → exactly 1 start, on MemDb and PgDb (local Postgres 18); the control without the lock starts more than one. Added to `verify:pg`. A first version with `pg_advisory_xact_lock` deadlocked the pool under the same test |
| QA-02 (P0, AC-4) | The link secret stayed in the `job` table (mail text/html) | The confirmation mail is sent from the web app directly (`sendMail`), no job row; the event keeps only mode and id | `apps/web/lib/scan-confirm.ts` |

Round 2: `pnpm -r typecheck`, `pnpm -r test` (core 1267, worker 24), `pnpm e2e:mock`, Playwright mock 113/113.

## Open, P1 (this cycle, not blocking the PR)
- CMP-01: legal basis sentence for the confirmation step and the abuse retention (art. 13(1)(c)/(d) AVG).
- CMP-02: art. 14 information in the mail's "not you" line, with a privacy link.
- CMP-03: whether 12 months of unconfirmed addresses passes the balancing test, or pseudonymise after 24 h. Needs counsel.
- CMP-05: no purge exists for the promised "at most 12 months" (joins go-live L1).
- CMP-06: `docs/records-of-processing.md`, `docs/processors.md` not yet updated.
- CMP-08 / SEC-04: GA4 and the Meta pixel see `?t=` after consent; strip it in `components/Trackers.tsx`.
- SEC-02: the site-wide confirmation-mail cap (4 × daily cap) lets 100 posts lock real visitors out for a day; raise to a backstop.

## Open, P2–P3
SEC-05 (unlisted business name in the mail), SEC-06 (500-row event window, lookup by hash), SEC-07 (Origin check on the confirm POST), SEC-08 (`X-Forwarded-For` fallback), SEC-09, CMP-07 (HMAC for counters), CMP-10 (report_email written before a daily-cap refusal), CMP-11 (Resend open/click tracking off), CMP-12, QA-04 (X9 dashboard link), QA-05 (NL · EN switch drops `?t=`), QA-06/SEC-10 (signed-in skip not built), mail lab does not include the new mail.

## Not checked
A real Resend mail and a real mailbox's link scanner; the Cloudflare rule itself; Hyperdrive under load; mobile layout of the two new pages.
