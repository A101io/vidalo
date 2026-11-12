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

## Round 2

*qa · 2026-11-12 · tree `claude/002-mijn-omgeving` at `675a778` (round-1 fixes of both lanes, `origin/main` with feature 001 merged in `285615f`) plus the test files listed below; no application code changed. Every mutation below was made in the working tree, run, and restored with `git checkout -- <file>` (or, for the 0019 trigger, by re-creating the function from the committed file); `git status` showed only the QA test files afterwards. Postgres: my own database `vidalo_qa2` on :54433 (shim + migrations 0001–0019), so security's `vidalo_verify` was never touched. Production build: `DATABASE_URL= next build --webpack` at 14:20 (BUILD_ID `vmiDZT1V_LK016gbmURim`); `grep pooler.supabase.com apps/web/.next` empty.*

### Verdict per acceptance criterion

| AC | Verdict | Evidence (round 2) |
|---|---|---|
| **AC-1** | **PASS** | Desktop suite on the new build: `owner-area.spec.ts` (Rapporten NL/EN, seven-month-old free report; signed out and another login 404) green. `report-access.test.ts`, `run-summary.test.ts` green on MemDb and PgDb (`vidalo_qa2`). Feature 001's `r/[id]/page.tsx` still calls `reportVisible` (merge `285615f` kept it). |
| **AC-2** | **PASS** | `owner-area.spec.ts` incl. the B-05 block and the new V-SEC-05 test, `owner-forged-billing-qa.spec.ts` green. RLS: `membership.sql` on `vidalo_qa2` **holding 28 other businesses** (db tests + `seed-history.mts`) → `RLS-OK login1[business=2 …] login2[business=1 …] anon[business=0 …]`; control `-v broken=1` → `RLS-FAIL login1 sees 31 business rows, expected 2`; the pre-fix block (`3436fa9^`) on the same database → `RLS-FAIL the trigger did not fill business_member (5)` (V-QA-05 closed). Feature 001's `/app/gegevens` actions go through `requireVerifiedOwnerOf(businessFromForm(form))`. |
| **AC-3** | **PASS** | `npx playwright test -c playwright.https.config.ts` 1/1 (every `sb-` cookie `Secure; HttpOnly; SameSite=lax`, `Max-Age=7776000`, response not cacheable). `pnpm e2e:auth` **15/15**. `session-life.test.ts` in `pnpm -r test`. |
| **AC-4** | **PASS (a)–(e); (f) NOT VERIFIED** | `pnpm e2e:auth` 15/15 (limits, scanner-safe link, foreign Origin 403); `safe-next.test.ts`, `auth-redirect.spec.ts` green. (f) needs a real mail after D1. |
| **AC-5** | **PASS** (a)–(f) in mock mode, as the brief checks it | (d) V-QA-03 closed, see controls. `facts-after-purge-qa.test.ts` 4/4 incl. a new case for another isolate whose cache the purge never clears. `db-purge-qa.test.ts`, `export-secrets.test.ts`, `purge.test.ts` (V-SEC-04) green on MemDb and PgDb; new `db-purge-race-qa.test.ts`: two purges at once delete once, mail once, delete the login once, control survives. (b)(c)(e) `account.spec.ts` 8/8 and `e2e:auth` in the full runs. (f) `legal.test.ts` green. Real Google revoke and Cloudflare removal stay mock-only (D3); see V2-SEC-01 below. |
| **AC-6** | **NOT VERIFIED** as a whole (Stripe sandbox run, D2); worker part **PASS** | `apps/worker` 45/45: `retention.test.ts`, `retention-qa.test.ts`, `purge-job.test.ts` incl. the V-COMP-01/-02/-03/-04/-05 cases; controls below. `deletion.test.ts` V-SEC-01 (dated Scan buying Monthly) on MemDb and PgDb. |
| **AC-7** | **PASS** | `pnpm perf:owner` on the new production build against `vidalo_qa2` after `seed-history.mts`, p95 of 20 loads: groot `/app` 31, `/app/voortgang` 17, `/app/rapporten` 9, `/app/account` 18, `/app/abonnement` 4 ms; klein 12 / 7 / 6 / 12 / 4 ms; "OK: every page p95 under budget". `owner-area-scale-qa.test.ts` green on PgDb. |
| **AC-8** | **PASS** | `OWNER_A11Y_LANE_A=1 E2E_SERVER=start npx playwright test --project=desktop e2e/owner-a11y.spec.ts e2e/owner-keyboard-qa.spec.ts` **49/49** (27 axe + 22 keyboard). |

**Failing AC: none.** NOT VERIFIED: AC-4(f) (real mail after D1), AC-6's Stripe sandbox run (D2), hosted migrations and the RLS block on the hosted project.

### Controls for the findings fixed since round 1

| Finding | Test | What I did to make it fail | Red result |
|---|---|---|---|
| **V-QA-03** (P0, AC-5(d)) | `facts-after-purge-qa.test.ts` | (1) cache re-read off (`if (false && entry && reread)` in `serve.ts`) | churn case red `expected 200 to be 302`; **the AC case stayed green** because `purgeBusiness` clears this isolate's cache. Gap: deletion seen from another isolate had no test → added (V2-QA-01), now red `/ in the other isolate: expected 200 to be 404` |
| | | (2) re-read ignores a missing business (`if (current && (…))`) | new other-isolate case red `expected 200 to be 404` |
| | | (3) re-read off **and** `clearServeCache` removed from `shared/purge.ts` | AC case red `/ after the deletion: expected 200 to be 404` |
| **V-SEC-01** | `deletion.test.ts` "Scan → Monthly through the Stripe webhook" | MemDb: `|| old.plan !== b.plan` removed in `mem.ts`. PgDb: `business_retention()` re-created without `or old.plan is distinct from new.plan`, then the committed one restored | MemDb and PgDb, `monitor_addon` and `monitor`: red `violates check constraint business_delete_only_when_ending`; 17/17 after restore |
| **V-SEC-04** | `purge.test.ts` "V-SEC-04 …" | `expireOpenCheckouts` call replaced by `const expired = 0` | red |
| **V-SEC-05** | `owner-area.spec.ts` "domain verify: a failed check does not keep the verified date …" (dev server) | `factsHostVerifiedAt: null` removed from the failure branch of `api/domain/verify/route.ts` | red `Expected "/app/domein?dns=ok" Received "/app/domein?dns=nee"`; green after restore |
| **V-COMP-01** | `purge-job.test.ts` "V-COMP-01 …" | worker `deleteLogin`'s `if (!mock()) throw` removed | red. The web side (`verwijderen/actions.ts`) has no test (V2-QA-03) |
| **V-COMP-02** | `retention.test.ts` "201 Scan businesses", `db-account.test.ts` "201 … pages of 200" | cron: `break` after the first page; db: `after` ignored in `mem.ts` and `pg.ts` | worker red; MemDb and PgDb red |
| **V-COMP-03** | new `db-due-order-qa.test.ts`; `retention.test.ts` | (1) owner-first sort removed and the dry run listing retention rows again (`mem.ts`) | `retention.test.ts` red. (2) **owner-first sort alone removed: every existing test stayed green** (the lane's owner row was dated before the retention rows) → added V2-QA-02 test: 25 due retention rows dated earlier, owner row dated last, page of 20; MemDb and PgDb red `the owner's own deletion comes first` |
| **V-COMP-04** | `purge-job.test.ts` "V-COMP-04 …", `retention.test.ts` | stuck/retired purge jobs no longer added in `mem.ts countOverdueDeletions` | both red |
| **V-COMP-05** | `retention.test.ts` "V-COMP-03, V-COMP-05 …" | `dryRun ? [] :` removed from the reminder loop in `cron.ts` | 2 red |
| **F-024** | `profile-correction.spec.ts` "English: …" | `setLang` from `3436fa9^` (no `&business=`) on the production build | red, `page.waitForURL` timeout; green in the full suite with the fix |
| **V-QA-05** | `scripts/rls/membership.sql` | pre-fix block on a database holding 28 businesses | `RLS-FAIL the trigger did not fill business_member (5)`; fixed block `RLS-OK`, its `broken=1` control `RLS-FAIL` |
| Purge race (round-1 gap) | new `db-purge-race-qa.test.ts` | `shared/purge.ts` ignores `db.purgeBusiness`'s false | MemDb red `expected … to have a length of 1 but got 2`. PgDb stayed green: on Postgres the second call's `getBusiness` already saw the row gone, so the window was not hit; the MemDb case is the proof |

### Whole-suite runs

| Run | Result |
|---|---|
| `pnpm -r test` (with the QA files) | core 90 files, **1401 passed / 22 skipped**; worker **45** |
| PgDb by hand (`TEST_DATABASE_URL=…/vidalo_qa2`): `db*`, `deletion`, `facts-after-purge-qa`, `owner-area-scale-qa`, `report-access`, `run-summary`, `export-secrets`, `purge` | 14 files, **162/162** |
| **Playwright desktop, whole suite, production build** (`DATABASE_URL= E2E_SERVER=start npx playwright test --project=desktop`) | **171 passed, 0 failed**, 32 skipped (15 `auth-session` need `e2e:auth`, 1 https needs its config, 16 lane-A `owner-a11y` fixmes run separately). F-024 green |
| `pnpm e2e:auth` | **15/15** |
| `npx playwright test -c playwright.https.config.ts` | **1/1** |
| `OWNER_A11Y_LANE_A=1` a11y + keyboard | **49/49** |
| `pnpm perf:owner` | OK, every p95 under 1 s (table above) |
| `scripts/rls/membership.sql` | `RLS-OK` on a database with 28 other businesses; control `RLS-FAIL` |

### Feature 001 against the 002 ACs

Merge `285615f` brought feature 001 (profiles, website step, question library, migration 0015). Its web changes touching 002 surfaces keep the 002 guards: `/app/gegevens` actions use `requireVerifiedOwnerOf(businessFromForm(form))` (AC-2), `r/[id]/page.tsx` keeps `reportVisible` (AC-1). The export (AC-5(a)) carries 0015's profiles (`export-stream.ts` `"profiles"`). The whole desktop suite (001's `profile-correction`, `scan-website` specs and every 002 spec) is green on the merged build, and the migrations apply in order 0015 → 0019. One observation for compliance, not an AC failure: 0015's `question_use` rows survive a purge by design (`scan_run_id` set null, `business_ref` is the deleted `business.question_ref`, so nothing links them back; the stored text is the template, never the business name). Whether "all its rows are gone" in the privacy text needs a word about anonymous question statistics is compliance's call.

### Security's V2-SEC-01 and AC-5(d)

Security asked QA to rate it. Confirmed in code: the worker revokes only when `GOOGLE_OAUTH_CLIENT_ID` is set (`apps/worker/src/jobs/purge.ts:63`), which `secrets.manifest.json` gives to web only, and `deleteCustomHostname` returns without error when Cloudflare is not configured (`publisher/host.ts:228-231`), which the manifest gives to the worker only. AC-5(d) is checked, per the brief, in mock mode with the removal recorded, and D3 puts the real observation after Google and Cloudflare go live, so this is not an AC failure today. It is a release gate: as the manifest deploys it, AC-5(d) will not hold for a worker purge (Google) or a web purge (Cloudflare). P1. Fix as security proposes, with tests that run with `VIDALO_MOCK` unset.

### Tests added or changed in round 2 (not committed)

- `packages/core/test/facts-after-purge-qa.test.ts`: new case "another isolate … answers not found at once too" (V2-QA-01).
- `packages/core/test/db-due-order-qa.test.ts` (new): owner-first order of due deletions, MemDb + PgDb (V2-QA-02).
- `packages/core/test/db-purge-race-qa.test.ts` (new): two purges at once, MemDb + PgDb.
Both new files match `verify:pg`'s `db*.test.ts` glob.

### Not tested in round 2, and why

- AC-4(f), AC-6 sandbox run, hosted migrations, hosted RLS: as in round 1 (D1, D2, delivery-lead).
- V-COMP-01 and V-SEC-04 on the **web** side (`verwijderen/actions.ts`: `deleteLogin` fail-closed, `expireOpenCheckouts` through the SDK): a server action with no unit seam; no test, no control (V2-QA-03).
- V-SEC-04 against real Stripe (`checkout.sessions.list/expire`): no key in reach; fake only.
- The purge race on PgDb did not hit the window (see the controls table); a true interleaving on Postgres was not forced.
- Mobile project and WebKit: not run (desktop only, as in round 1). Reflow at 320 px / 400 % zoom and screen-reader output: not measured.
- AC-7 on real Workers CPU limits: not measured.
