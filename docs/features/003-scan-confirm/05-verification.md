# 003 — Verification (11 Nov 2026)

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

## Round 3 (14 Nov 2026): signed-in skip
A signed-in visitor whose check address equals the session's e-mail (case-insensitive) skips the mail link: the sign-in link already proved it (`apps/web/app/api/scan/route.ts`, `startSignedIn`). Same lock, daily cap and per-IP allowance, plus the per-address daily allowance of the mail path (`CONFIRM_MAILS_PER_ADDRESS`), so one account runs no more checks a day than one mailbox (security P2 from the narrow review, fixed). Another address still gets the mail. Mock sessions cannot reach real engines (`allowMockAuth` only with `VIDALO_MOCK=1` or outside production). Privacy text NL + EN says so; version 15 November 2026 relocked against main's published 14 November lock. Closes QA-06 / SEC-10. Tests: owner-fixes e2e (same address starts at once; other address gets `/scan/mail`; other capitals still skip), signed-in, account, free-check, scan-confirm: 48 passed.

## Round 4 (14 Nov 2026): the remaining brakes
- **Euro ceiling for free checks**: `FREE_AI_CAP_CENTS` (default 1500 a UTC day; 0 stops them), via `Db.freeScanCentsSince`. A running free check counts at least `FREE_SCAN_ESTIMATE_CENTS` (60), so a burst counts before it is spent, and a failed scan now stores what it spent (`scanner/index.ts`; also makes the paid R-11 ceiling honest). Kept apart from the paid ceiling on purpose: an attack on the free check must not make paying customers wait.
- **Alert**: `apps/web/lib/abuse-alert.ts`. The daily count, the euro ceiling and the confirmation-mail backstop log every refusal and, once per brake per UTC day, an event `alert.free_check.*` and a mail to `VIDALO_ALERT_EMAIL` (`hello@vidalo.io`, production vars). Detail holds only cap and spent. No lock on the dedup (it runs inside FREE_CHECK_LOCK; a nested lock costs a second of three Worker connections), so a race can send a rare duplicate (P3, accepted).
- **Mail backstop** 20 × the daily cap (was 4 ×): 100 posts no longer lock real visitors out (SEC-02). Up to 500 confirmation mails a day to strangers remain possible with ~100 IPs and paid Turnstile solving (P2, accepted; the alert makes it visible).
- **Origin check** on POST `/api/scan/bevestigen` (`refuseCrossSite`, SEC-07). The confirm page's referrer policy is `same-origin` (was `no-referrer`, which made Chrome send `Origin: null` and the check refuse our own button); the link still never reaches another site.
- **No X-Forwarded-For in production** (`clientIp`, SEC-08): without `cf-connecting-ip` every request shares the bucket `unknown`; Turnstile then gets no remote IP. Cloudflare always sets the header on the Worker; a local `next start` shares one bucket (P2, local only).
- Probe: web with real-engine caps, no keys, Postgres, `FREE_AI_CAP_CENTS=0`: two posts → two `/scan/druk`, one `alert.free_check.spend_cap` event, one alert mail.
- Narrow security review: no P0; its two P1s (in-flight and failed spend) fixed above.
- Checks: typecheck, core 1440 + worker 52, e2e:mock, verify:pg 133, Playwright scan specs 57/57.
