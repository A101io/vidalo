# QA verification — 002 Mijn omgeving

*qa · 2026-11-12 · tree `claude/002-mijn-omgeving` at `6b6446e` (C-00, lane B, lane A merged) plus the test files listed at the end; no application code changed.*

Standard: `01-brief.md` AC-1 to AC-8. Every run used `DATABASE_URL=` (empty) or the local Postgres 18 cluster on port 54433 (`vidalo_verify`). Nothing touched the hosted Supabase project, Stripe or Cloudflare. The production build is the one in `apps/web/.next` (built 06:56, after the merge; no application file changed since).

## Verdict per acceptance criterion

| AC | Verdict | Command and result | Control (guarantee removed → red) |
|---|---|---|---|
| **AC-1** reports in one place; own old free report stays | **PASS** | `E2E_SERVER=start npx playwright test --project=desktop` → `owner-area.spec.ts` "NL/EN: Rapporten lists…" and "the owner opens their seven-month-old free report; signed out and another login get 404" green. `report-access.test.ts` 5/5 (owner, other login, anonymous, 30-day edge). `run-summary.test.ts` 8/8 on MemDb and PgDb. | `reportVisible` returning true for any signed-in login (`viewerBusinessIds.length > 0`) → `report-access.test.ts` red: "a free report older than 30 days opens for a member of its business only". Restored by `git checkout`. |
| **AC-2** several businesses: switch, act on the chosen one only | **PASS** | `owner-area.spec.ts` 7/7 + B-05 serial block green on the production build. New `e2e/owner-forged-billing-qa.spec.ts` (cancel and pause with a hand-edited `business` of another login → sent to `/app`, the target's `/app/abonnement` text identical before and after; positive control: the same form with the own id cancels, then undo) green. RLS: `psql … -f scripts/rls/membership.sql` → `RLS-OK login1[business=2 …] login2[business=1 …] anon[business=0 …]`. | (1) `abonnement/actions.ts` `requireOwnerOf(businessFromForm(form))` → `requireOwner()` (dev server, source change, restored): the QA spec red, `Received: "/en/app/abonnement"` (the forged cancel was accepted on the open business). (2) `membership.sql -v broken=1` → `RLS-FAIL login1 sees 3 business rows, expected 2`. |
| **AC-3** session stays, ends, cookie safe | **PASS** | (a) new `playwright.https.config.ts` + `e2e/auth-cookie-https.spec.ts`: production build (`next start`) behind a local TLS proxy on `https://localhost:3443`, fake GoTrue. Every `sb-` Set-Cookie (sign-in on `/auth/confirm`, middleware refresh on `/app/account`): `Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=lax`, response `Cache-Control: private, no-cache, no-store, …`; the browser stored them `secure: true, httpOnly: true, sameSite: Lax`. (b)(d)(e)(f) `pnpm e2e:auth` **15/15** after V-QA-01 (first run: 10/15, see V-QA-01). (c) `session-life.test.ts` 19/19, fake clock. | (a) `secure:a.startsWith("https:")` → `secure:!1` patched into the built `.next/server` files (backup, restored, `cmp` clean): spec red, `Expected pattern: /;\s*Secure/i`. (c) the 90-day line commented out → `session-life.test.ts` red "signed in 90 days and 1 minute ago → max_age". (b) failing-first run recorded by lane A (04-build A-01). |
| **AC-4** link requests and use cannot be abused | **PASS for (a)–(e); (f) NOT VERIFIED** | `pnpm e2e:auth`: AC-4(a) identical answer for three addresses, (b) 6th link refused and not mailed, (d) GET twice → no sign-in, nothing used, button signs in, (e) foreign Origin on `/auth/uitloggen` and `/api/billing/portal` → 403, still signed in. (c) `safe-next.test.ts` 20/20, `auth-redirect.spec.ts` green; extra fuzz of 26 inputs (tab, newline, NUL, full-width solidus, 4× encoding, `/./`, `..`) through `safeNext`: 0 off-site. (f) needs Julian's real mail after D1. | (c) the normalised re-check in `safeNext` removed → `safe-next.test.ts` red on `/.//evil.example`, `/app/..//evil.example`, `/%2e%2e//evil.example`. (b)(d)(e) controls by lane A (04-build A-02, A-03), not repeated. |
| **AC-5** download and delete on every plan | **FAIL** (d), see V-QA-03; (a)(b)(c)(e)(f) PASS | (a) `export-secrets.test.ts` 6/6 Mem + Pg; new `db-purge-qa.test.ts` checks the streamed download holds every category the privacy text names (address, account number, sign-ins, facts, profile, checks with answers, findings, correction requests, connections without keys, events) and no token, Mem + Pg. (b) `account.spec.ts` 8/8 (Scan owner deletes at once; Monthly owner schedules, date on both pages, "Toch bewaren"); before V-QA-02 five of these did not run in the full suite. (c) `e2e:auth` "AC-5(c)" and "A-05 / SEC-37" green. (d) new `db-purge-qa.test.ts` on MemDb and PgDb: target gone from business, business_member, facts, prompt, scan_run, sample, finding, channel, event, google_index; unrun jobs gone; sign-ins and login gone; Google revoke, Cloudflare host, mail called; control business on another login: export byte-identical and every row count equal. **But** `facts-after-purge-qa.test.ts`: a facts host served shortly before the deletion keeps answering 200 with the deleted business's page (V-QA-03). (e) `account.spec.ts` disconnect + `google-revoke.test.ts`. (f) `legal.test.ts` green in `pnpm -r test`. | (a) `exportChannel` returning the whole `meta` → `export-secrets.test.ts` red. (d) `delete from job …` removed from `PgDb.purgeBusiness` → `db-purge-qa.test.ts` PgDb red "expected true to be false" (MemDb stays green: `deleteBusiness` removes unrun jobs a second time). |
| **AC-6** cancel, pause, end, retention | **NOT VERIFIED** as a whole (Stripe sandbox run is D2); worker part PASS | `apps/worker/test/retention.test.ts` 6/6, `purge-job.test.ts` 7/7, fake clock. New `retention-qa.test.ts` 2/2: an owner's deletion date that passed while the churn webhook is late (status still `active`, or `paused` after a failed payment) queues no purge and an armed purge job forced in deletes nothing. | `purgeAllowed` "due" branch reduced to `return true` → `retention-qa.test.ts` red ("day 21: expected 1 to be +0") **while `retention.test.ts` stayed green**: that guard had no test before (V-QA-04). Lane A's own control (no churn → Google) recorded in 04-build A-06. |
| **AC-7** fast as history grows | **PASS** | New `owner-area-scale-qa.test.ts` at the brief's numbers (36 checks × 10 questions × 6 AI systems × 10 answers = 21,600 answers, 500 findings, 2,000 events) against 3 checks, reads of all five pages: **PgDb 17 = 17 round trips, MemDb 14 = 14**; the download streams all 36 checks, 21,600 answers, 500 findings, 2,000 events in **177 ms** (PgDb) / 72 ms (MemDb), budget 30 s. `pnpm perf:owner` on the production build after `seed-history.mts`, p95 of 20 loads: groot `/app` 29, `/app/voortgang` 18, `/app/rapporten` 9, `/app/account` 20, `/app/abonnement` 5 ms; klein 14 / 8 / 6 / 12 / 4 ms. B-03's `owner-area-scale.test.ts` on Pg: 15 = 15 (old progress view 17 → 152). | `runSummaries` given one extra query per check → `owner-area-scale-qa.test.ts` PgDb red: `{"small":20,"big":47}`, "expected 47 to be 20". |
| **AC-8** accessible | **PASS** | `OWNER_A11Y_LANE_A=1` `owner-a11y.spec.ts` **27/27** (axe WCAG 2.2 A/AA, no serious or critical, 11 pages × NL/EN, keyboard switch, announced status, dots in words). New `owner-keyboard-qa.spec.ts` **22/22**: the keyboard pass against `docs/process/checklists/a11y.md` on the same 11 pages × NL/EN — every visible control reached by Tab (a radio group as one stop, arrow key moves within it), focus not trapped, a visible ring on every stop, no stop hidden under a fixed or sticky element (SC 2.4.11), every stop has an accessible name, no horizontal scroll at 375 px. | Focus rings removed by an injected style on `/app/account` → keyboard spec red "focused without a visible ring" (a scratch copy of the spec, deleted after). |

**Failing AC: AC-5, part (d)** (V-QA-03, P0). AC-4(f) and AC-6's sandbox run are not verified (known out of reach).

## Whole-suite runs

| Run | Result |
|---|---|
| `pnpm -r typecheck` | green |
| `pnpm -r test` | before the QA files: core 1383 passed / 19 skipped, worker 37; with them: core 87 files, 1387 passed / 19 skipped, worker 39 |
| `PG_ADMIN_URL=…:54433/postgres pnpm verify:pg` | migrations 0001–0019 apply; 98 db tests; `OK verify:pg — 1963 samples` |
| PgDb by hand (`TEST_DATABASE_URL=…/vidalo_verify`): `deletion`, `export-secrets`, `owner-area-scale`, `run-summary`, `report-access`, `purge` | 45/45; export timing 36 × 50 answers: PgDb 10 ms |
| **Playwright desktop, whole suite, production build** (`E2E_SERVER=start npx playwright test --project=desktop`) | first run: 135 passed, **2 failed**, 31 skipped, 9 did not run. The failures: F-024 (`profile-correction.spec.ts` "English…", known) and `account.spec.ts` "A-04: Koppeling met Google verbreken" (V-QA-02), whose serial file then skipped 5 tests (AC-5(b) and AC-6 end state). After the V-QA-02 fix and with the QA specs: 163 passed, F-024 the only failure of the app's suites, 4 did not run (the rest of `profile-correction.spec.ts` after F-024). |
| `pnpm e2e:auth` | first run **10/15** (V-QA-01); after the fixture fix **15/15** |
| `scripts/rls/membership.sql` | `RLS-OK` on a clean database; control `RLS-FAIL`. On a database holding other businesses it fails falsely (V-QA-05) |

**F-024 confirmed, and it is the only failure left in the app's own Playwright suites:** `profile-correction.spec.ts:140` "English: the group and its errors in the page's language" times out in `setLang()` waiting for `/en/app/gegevens` (`/api/lang?to=en` without `&business=`). Both full runs.

## Tests added or fixed (uncommitted; the delivery-lead commits)

Added:
- `packages/core/test/db-purge-qa.test.ts` — AC-5(a)(d), MemDb + PgDb (picked up by `verify:pg`'s `db*.test.ts` glob).
- `packages/core/test/owner-area-scale-qa.test.ts` — AC-7 at the brief's numbers; PgDb by hand with `TEST_DATABASE_URL`.
- `packages/core/test/facts-after-purge-qa.test.ts` — AC-5(d) facts host after deletion; the AC case is `it.fails` while V-QA-03 is open (flip to `it` with the fix).
- `apps/worker/test/retention-qa.test.ts` — AC-6 late churn webhook.
- `e2e/owner-forged-billing-qa.spec.ts` — AC-2 cancel and pause with a forged business.
- `e2e/owner-keyboard-qa.spec.ts` — AC-8 keyboard pass.
- `e2e/auth-cookie-https.spec.ts`, `playwright.https.config.ts`, `e2e/fixtures/tls-proxy.ts` — AC-3(a) on the production build over https (`npx playwright test -c playwright.https.config.ts`; skipped under the other configs).

Fixed (test code only):
- `e2e/fixtures/fake-gotrue.ts` — the demo owner's address gets the user id the mock seed gives its businesses (V-QA-01).
- `e2e/account.spec.ts:73` — the disconnect status line located by its text (V-QA-02).

## Not tested, and why

- **AC-4(f)** a real link on vidalo.ai: needs Julian's click after D1.
- **AC-6 sandbox run** (states in Stripe, confirmation mails, the portal offering no cancel): D2, `api.stripe.com` from Julian's Mac. Mails per step are covered only by the existing unit tests of `sendSubscriptionMail`, not observed here.
- **Hosted migrations** 0016–0019 and the RLS block on the hosted project: delivery-lead, out of my scope.
- **AC-3(c) end to end**: the 30/90-day rule is a unit test with a fake clock, as the brief asks; no browser waits 30 days.
- **AC-5(d) real Google revoke, Cloudflare removal and Supabase login delete**: mocks and recorded calls only (no keys).
- **AC-7 on Workers**: CPU and wall-time limits of a real Worker were not measured; the local stream of the full history takes 177 ms.
- **AC-8**: reflow measured at 375 px, not at 320 CSS px / 400 % zoom; the OS large-text setting, screen-reader output and touch-target size (≥ 44 px, policy) were not measured; contrast only through axe.
- **Mobile Playwright project** and WebKit: not run (only `--project=desktop`, as asked).
- **Concurrency on the purge**: two purges of one business at once were not raced (the conditional delete makes the second a no-op by construction; not shown).
- Outside my lane: `POST /api/domain/verify` and `POST /api/checkout` have no `refuseCrossSite`; security filed the first as V-SEC-02. AC-4(e) names only new route handlers, and the `SameSite=Lax` session cookie is not sent on a cross-site POST, so it is not an AC failure.
