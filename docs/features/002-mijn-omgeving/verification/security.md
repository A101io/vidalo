# Security verification — 002 Mijn omgeving

*security · phase 4 (verify) · 2026-11-12 · branch `claude/002-mijn-omgeving` at `6b6446e`, diff
`ef14530..HEAD` · against my own phase-1 list `checklists/security.md` (SEC-01..SEC-59).*

Every run here used `DATABASE_URL=` empty or my own database `sec002` on the shared local Postgres 18
(port 54433, migrations 0001–0019 applied through `scripts/local-auth-shim.sql`). Nothing touched the
hosted Supabase project, Stripe or Cloudflare. No application code was edited. Probe scripts live in the
session scratchpad (`…/scratchpad/probe/{addon,guards,webhook,host,safenext}.mts`), not in the tree.

Runs of my own:
- core tests on MemDb: `safe-next`, `same-origin`, `auth-throttle`, `purge`, `deletion`, `export-secrets`,
  `google-revoke`, `session-life`, `report-access`, `db-membership`, `db-account`, `my-data`:
  **123 passed, 4 skipped**.
- the same db-backed files on PgDb (`TEST_DATABASE_URL=…/sec002`): `db-account` 30, `db-membership` 19,
  `purge` 9, `export-secrets` 6, `deletion` 13: **77 passed**.
- worker `purge-job` 7 + `retention` 6: **13 passed**.
- `scripts/rls/membership.sql` on `sec002`: `RLS-OK login1[business=2 … business_member=2] login2[… =1]
  anon[… =0]`; control `-v broken=1`: `RLS-FAIL login1 sees 5 business rows, expected 2` (5 = my probe rows).
- exhaustive guard probe (`guards.mts`): plan {none, setup, monitor} × status {scanned, trial, active,
  paused, churned} × cancel_at {null, future} × delete_at {null, past, future} × reason × guard: 300
  combinations, 68 refused by the CHECKs, **0 mismatches** between `purgeAllowed` and
  `PgDb.purgeBusiness`, **0 paying Monthly deleted**.
- webhook probe (`webhook.mts`, PgDb, through `handleStripeEvent`): cancel echo + owner date → undo echo
  clears `delete_at`; `customer.subscription.deleted` churns and dates it (churn + 120 d, `retention`);
  0 churned rows without a date.
- addon probe (`addon.mts`, MemDb and PgDb): **red**, see V-SEC-01.
- facts-host probe (`host.mts`, PgDb): **red**, see V-SEC-05.
- `safeNext` fuzz (18 extra inputs incl. 4-level encoding, fullwidth and division slashes, `/en//x`):
  every output resolves on our own host.
- client bundle `apps/web/.next/static` (the delivery-lead's production build of 06:56, `DATABASE_URL=`
  empty): no `sb_secret_…` value, `sk_/rk_/whsec_` value, `SERVICE_ROLE`, `VIDALO_AUTH_SECRET`,
  `STRIPE_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`, `postgres://` or JWT; built `middleware.js`: one
  `sb_secret_` hit, supabase-js's prefix check, no value.
- hidden characters: `grep -P` for C0 controls, zero-width and bidi over every added or modified file: none.
- `git log -p ef14530..HEAD` for key-shaped strings (`sb_secret_…`, service-role JWT, `sk_`, `whsec_`): none.

Not run by me (another agent's run is cited where it exists): `pnpm e2e:auth` and the Playwright owner
suites (they need `next dev` in this tree, which the QA agent is using), any workerd build, staging.

## Item by item

| SEC | Status | Evidence |
|---|---|---|
| 01 | PASS | `lib/owner.ts:37-43` `requireOwnerOf` = `listMyBusinesses(session).find(id)`, else `redirect(/app)`; no id reaches SQL. `e2e/owner-area.spec.ts` "every changing action names its business": control's id → `/en/app`, both businesses' text identical before/after (lane B run). |
| 02 | PASS | `lib/active-business.ts:40-44` re-checks the cookie against the list on every call; owner-area spec "forged option / forged cookies (control's id, malformed, all-zero uuid)". |
| 03 | PASS | `app/app/business-actions.ts:26` `isMember` before `cookies().set`, flags at :27-33 (HttpOnly, Lax, `/`, 90 d, Secure on https). Spec: no cookie set for a forged id. |
| 04 | PASS | My grep of every `"use server"` export and every POST handler (9 action files, 12 handlers): each changing action calls `requireOwnerOf`/`requireVerifiedOwnerOf(businessFromForm)` first (`abonnement/actions.ts:20`, `verwijderen/actions.ts:59,106`, `google/actions.ts:41,58,92`, `account/actions.ts:60,71`); export and portal check the named id against `listMyBusinesses` (`api/account/export/route.ts:22-23`, `api/billing/portal/route.ts:28-32`); Stripe ids come from the business row. `signOutEverywhere` and `changeEmail` act on the login. The SEC-04 table in `04-build.md` still shows lane A "as C-00 left them"; this row replaces it. |
| 05 | PASS | `gegevens/actions.ts:66,106,124`, `app/actions.ts:27,39,57,69,81`, `api/domain/verify/route.ts:22-25`, `api/checkout/route.ts:58-60` (membership of that business), `api/google/start/route.ts:31-32`. Two-tab e2e in owner-area spec (red on the old code: "Received: Harbour Bakery, Rotterdam"). |
| 06 | PASS | `api/account/export/route.ts:19-24`: 401, `isBusinessId` before SQL, one 404 for non-member/unknown/malformed, `account.exported` only after membership. `e2e/account.spec.ts` (lane A). |
| 07 | PASS | RLS block run by me (above), control red. |
| 08 | PASS | `0016:19-20,33`; the block asserts INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER absent and the function not executable (`membership.sql:53-62`). |
| 09 | PASS | Trigger `0016:22-35`; block: A → B → null moves/removes the member row. Billing's `ownerUserId: null` goes through the same trigger. |
| 10 | PASS | `0016:66-67` column grant without `meta`; block: `select meta` and `select *` denied, `id, status` readable, service side reads `meta`. `lib/reads.ts:44` named columns. |
| 11 | PASS | `db/owner-area.ts:77-93` `… and owner_user_id is null`, email from verified claims only (`active-business.ts:20`). `db-membership.test.ts` on Mem and Pg. |
| 12 | PASS | `owner-area.ts` `decodeCursor` (strict) and `where business_id = ${businessId}`; `r/[id]` uses `listMyBusinesses`. Archive tests incl. `'; select 1; --` on Pg (my run). |
| 13 | PASS | `app/actions.ts:18-24,50-54` resolve within the form's business; pages via `findingBusinessId`/`channelBusinessId` → `requireOwnerOf`. Spec: control's finding/channel pages → `/app`. |
| 14 | PASS | `lib/auth-cookies.ts` forced in middleware (`middleware.ts:63`) and `lib/supabase.ts:19`; mock cookie and `vidalo_business` use the same flags. Read back over http in lane A's workerd run (`Max-Age=7776000; HttpOnly; SameSite=lax`, no Secure). Secure over https: QA's TLS spec is in progress, staging not run. |
| 15 | FAIL (P2) | Middleware path correct: `middleware.ts:61-66` applies `setAll`'s headers and `private, no-store`; lane A's workerd two-client read of `/` and `/en/pricing`. Gap: `lib/supabase.ts` `setAll` drops the headers argument, and `/api/*` is outside the middleware matcher, so a refresh inside a route handler (`/api/lang` GET, `/api/billing/portal`, `/api/domain/verify`, `/api/checkout`) answers `Set-Cookie` without `no-store`. No cache layer stores those today (Worker responses, no cache rule), so **no P0 observed**. V-SEC-03. |
| 16 | PASS | Lane A, A-01: red with the old code, then 3 green `e2e:auth` runs, "one refresh per expiry, no reuse event"; `e2e:auth` 15/15 at A-05. Not re-run after the merge (lane B touched neither middleware nor session). |
| 17 | PASS | `middleware.ts:1-5` imports `next/server`, `@supabase/ssr`, `lang-paths`, `auth-cookies`, `shared/gate` only; built `middleware.js` grep (above). |
| 18 | PASS | Lane A auth spec: garbage cookie and a foreign-key JWT → `/inloggen`, no session cookie, ≤ 1 GoTrue call. Supabase's per-IP limit on Worker egress recorded as "not readable" (`04-build.md` A-01); no cap added. |
| 19 | PASS | `lib/session.ts:56-61` `getClaims()`; `sub`, `email`, `session_id` from the verified claims. Lane A spec: wrong key and `alg: none` → `/inloggen`. |
| 20 | PASS | Every surface goes through `getSession()` (`lib/session.ts:33-50`): missing row, other user's row, ended, idle, max age all null. `touchSignIn` SQL never sets `signed_in_at` (`pg.ts`). `session-life.test.ts` 19 (my run). |
| 21 | PASS | `confirm/actions.ts:44-50` records only after `verifyOtp`/`exchangeCodeForSession`; `on conflict (session_id) do nothing`; `0018` has no IP or UA column. `db-account.test.ts` "a second record never reopens an ended row" (Pg, my run). |
| 22 | PASS | `auth/uitloggen/route.ts:25` local; `account/actions.ts:93` global; `verwijderen/actions.ts:83` local. Lane A spec (d)(e). |
| 23 | FAIL (accepted) | Not built; F-022 stays open as an accepted risk (Pro time-box or a later cron step). No new finding. |
| 24 | PASS | `lib/session.ts:63` mock only when `!env.hasSupabase && env.allowMockAuth`; `allowMockAuth` false in a production build without `VIDALO_MOCK=1` (`lib/env.ts`); `signedInAt` from the row (`:49`). |
| 25 | PASS | `auth/confirm/page.tsx` no Supabase, no db; middleware headers `middleware.ts:55-60`; F-A1 fixed (`app/layout.tsx` `bare`), red-then-green spec in `auth-redirect.spec.ts` (lane A). |
| 26 | PASS | Server action (Next Origin check); `next.config.ts:63` adds no `allowedOrigins`. Spec: `Origin: https://evil.example` → no cookie, no verify. `/app/google` shows the signed-in address (`google/page.tsx:50`). |
| 27 | PASS | `confirm/actions.ts:13-14,36-38`: four types, `^[A-Za-z0-9_-]{8,128}$`; spec with `recovery` and 10 000 chars → no verify call. |
| 28 | PASS | Log lines carry status/code only (`confirm/actions.ts:44`, `inloggen/actions.ts:56`); redirect is `safeNext(next)`; `/auth/callback` 303 is `new URL('/auth/confirm'+search, env.baseUrl)`. |
| 29 | PASS | `shared/safe-next.ts:33-35` re-checks the normalised path; `safe-next.test.ts` 20 + my fuzz. |
| 30 | PASS | Every redirect target goes through `safeNext` or is a fixed path; `/api/lang` now uses `safeNext(…, "/")`. Owner-area spec `next=//evil.example/x` → `/app`. |
| 31 | PASS | `auth-throttle.ts:19-21` HMAC of `addr:<trim lower>` and `ip:<cf-connecting-ip>`; `inloggen/actions.ts:43` `throttleIp(h, false)` never trusts `x-forwarded-for`; `unknown` shared and logged. Test run by me. |
| 32 | PASS | `inloggen/actions.ts:28-52`: format → Turnstile → throttle (db error refuses) → `signInWithOtp`. Lane A spec: 6th link → `fout=wacht`, fake GoTrue got 5. |
| 33 | PASS | Byte-identical action answer and `sent=1` page for three address kinds (lane A spec). Timing medians not measured (P2 part, open). |
| 34 | PASS | `inloggen/actions.ts:56` status and code only. |
| 35 | FAIL (P2) | `refuseCrossSite` first in `auth/uitloggen` and `billing/portal`; **absent in `POST /api/domain/verify`**. `isOwnOrigin` exact list, `same-origin.test.ts` 17. V-SEC-02. |
| 36 | PASS | `api/account/export/route.ts:27-33`: json, attachment, nosniff, no-store, no CORS. |
| 37 | PASS | `lib/fresh-sign-in.ts` reads `session.signedInAt` (the row); GET `verwijderen/page.tsx:18`, `deleteMyData:60`, `changeEmail:27`. Test window override ignored when `NODE_ENV=production`. |
| 38 | FAIL (P2) | "bezet" uses `getBusinessByOwner({ email })`, which returns only the newest business with that address (`pg.ts:392`), not any business outside the list. Secure email change read-back (D1) not done. V-SEC-06. |
| 39 | PASS | `my-data.ts` allow-list; `export-secrets.test.ts` (Mem + Pg, my run): `rt-`, `at-`, `s-` absent from stream and `exportMyData`, `pendingDiff` present, foreign address on event page 2 dropped. |
| 40 | PASS | `export-stream.ts`: run ids from `listScanRuns(businessId)`, events by `business_id` in SQL; interleaved 36-run test on Pg (my run). |
| 41 | PASS | `account.exported {}`. |
| 42 | PASS | My exhaustive probe (0 mismatches, 0 paying deleted); `db-account.test.ts` controls. |
| 43 | FAIL (P0) | Trigger is `security definer`, `search_path = ''`, execute revoked (`0019:41,77`); Monthly undo/churn through `handleStripeEvent` correct (my probe). **But no test drives the webhook against a dated row, and a Vidalo Scan's retention date makes the upgrade webhook throw.** V-SEC-01. |
| 44 | FAIL (P1) | `purge.ts:58-61` asks Stripe before anything is touched; web and worker `stripeLive` refuse without a key outside mock; `purge.test.ts` (live → nothing called). Third F-021 path still open: an open `monitor_addon` Checkout completed after a "now" delete. V-SEC-04. |
| 45 | FAIL (P1) | Second purge `not_found`; Cloudflare failure throws before the delete (`purge.test.ts`). The job ceiling retires a failed `purge` job, but nothing logs `account.delete_failed`, and an owner's `no_subscription` fallback has no `delete_at`, so `countOverdueDeletions` never counts it. Already filed by compliance as **V-COMP-04** (I concur, P1); not filed twice. |
| 46 | PASS | `purge.ts:62-65` dry run only for `due` + `retention`; worker reads `VIDALO_PURGE` at job time; `purge-job.test.ts` unset/`"true"`/`"0"`/`"1"` and the owner fallback (my run). |
| 47 | FAIL (P1) | `purge.ts:77-82` deletes the host only for its verified holder. But "verified holder" can be obtained without any DNS: `api/domain/verify/route.ts:56` writes a new `factsHost` and keeps the old `factsHostVerifiedAt`. V-SEC-05. |
| 48 | PASS | `publisher/host.ts` `deleteCustomHostname` refuses our names and non-hostnames before fetch; `purge.test.ts` SEC-48 (my run). |
| 49 | PASS | `google-revoke.ts`: POST body to the fixed URL, 10-s timeout, `revoke_failed { status, reason }`; worker `googleDisconnect` re-reads (`jobs/purge.ts:64-70`); tests run. |
| 50 | PASS | `purge.ts:86-101`: per member, delete only when `listMemberBusinesses` is empty; uuid regex; `account.login_kept {}`. F-A5's two causes are fixed in the merged `owner-area.ts` (`db.kind`, `r.userId`). |
| 51 | FAIL (P1) | Worker reads the key from env only, not `vars` (`apps/worker/wrangler.jsonc`), errors log the status; no key in `git log -p`. **But `deleteLogin` (web `verwijderen/actions.ts:40-41`, worker `jobs/purge.ts:32-37`) fails open: without the key, mock or not, it logs `account.login_delete_mock` and `purge.ts:87-88` counts the login as deleted.** Already filed by compliance as **V-COMP-01** (I concur); not filed twice. `wrangler secret list` read-back (D1) not done. |
| 52 | PASS | `verwijderen/actions.ts:59-62` order; `cancelSubscription` on the row; `at` from Stripe; cookies cleared `:83-86`. `account.spec.ts` hand-edited business → `/app`. |
| 53 | PASS | `cron.ts` `retention`: retention-only reminders, `claimDeletionReminder`, `hasUnrunJob`; payload key sets asserted in `retention.test.ts` (my run). |
| 54 | NOT VERIFIED | No test. By reading: jobs re-read the business first, writes hit the FK, and only the cron poll creates hostnames, for existing rows. P2. |
| 55 | FAIL (P2) | `env.authSecret` throws with Supabase and no secret; no `NEXT_PUBLIC_`; bundle grep clean. `VIDALO_AUTH_SECRET` is in neither `secrets.manifest.json` nor `docs/secrets-and-keys.md`. V-SEC-07. |
| 56 | PASS | Every new `log.*`/`logEvent` call in the diff read (list above): reasons, counts, ids, a hostname, never an address, IP, hash, token, session or user id. |
| 57 | PASS | By reading: confirm page and middleware open no db; `sendMagicLink` opens it after Turnstile (`:32`); confirm action after verify (`:48`). No counter test. |
| 58 | PASS | Hidden-character grep (above). |
| 59 | FAIL (P0) | No new client-writable value; `core/billing` and the webhook route are unchanged. But the webhook's own write now fails on a dated Scan row (V-SEC-01). D2 sandbox run not done. |

**Counts:** 47 PASS, 11 FAIL (one of them, SEC-23, is the accepted F-022), 1 NOT VERIFIED.

## New findings

### V-SEC-01 · P0 · a Vidalo Scan customer who adds monitoring pays and gets nothing
On my list (SEC-43 "driven through `core/billing` on PgDb", SEC-59 "unchanged apart from what the
trigger does on its writes"), so not capped. It is a defect, not an attacker's exploit; the victim
and the money are real.

Path:
1. 0019 ships; the worker cron's `retention` step 3a (`cron.ts`, `setScanRetention`) gives **every**
   `plan = 'setup', status = 'trial'` business `delete_at = last_active + 24 months`,
   `delete_reason = 'retention'` on its first tick.
2. A verified Scan owner presses "add monitoring" on `/app/abonnement` (`monitor_addon`), or buys the
   Monthly on a report page; Stripe creates the subscription and charges.
3. `checkout.session.completed` → `activate()` → `upsertBusiness({ plan: "monitor", … })`. The row is now
   `plan monitor, status trial, cancel_at null, delete_at set`. Trigger rule 3 runs only on a change of
   status or `cancel_at`, so the date stays, and CHECK `business_delete_only_when_ending` raises.
4. The webhook answers 500; every Stripe retry fails the same way for 3 days, then stops.
5. The business stays `plan = setup` with no subscription id: `businessesDueForMonthlyScan` needs
   `plan = 'monitor'`, so no monthly check runs; cancel and pause in the app fail (no subscription id).
   Stripe bills €49 a month. A month later `invoice.paid` moves the status, rule 3 clears the date, but
   the checkout event is long gone.

Evidence: `addon.mts` on MemDb and PgDb: `THREW: new row for relation "business" violates check
constraint "business_delete_only_when_ending"`, after `{ plan: "setup", sub: null }`; control (same Scan
without the date) → `activated`, `plan: monitor`. The mock checkout (`api/checkout` without Stripe)
throws the same way.
Fix: in 0019's trigger, rule 3 also fires on `old.plan is distinct from new.plan` (a Scan becoming
Monthly loses its retention date); the same in MemDb; a test through `handleStripeEvent` on Mem and Pg:
dated Scan + `monitor_addon` → `activated`, `plan monitor`, `deleteAt null`, and the same for `plan
monitor` from a report. 0019 is applied nowhere hosted, so it can still be changed before the
delivery-lead applies it; otherwise 0020. Cost 45 min. Owner: lane A (0019, `db/mem.ts`).

### V-SEC-02 · P2 · `POST /api/domain/verify` has no Origin check (SEC-35)
Listed P1 at phase 1; filed P2 because the session cookies are `SameSite=Lax`, so a cross-site form
POST arrives signed out and the route redirects to `/inloggen`; no path to impact shown.
Fix: `refuseCrossSite(req, env.baseUrl)` first, `auth.cross_site_refused { route: "domain_verify" }`, a
route test. Cost 10 min. Owner: lane B (B-05).

### V-SEC-03 · P2 · route handlers write refreshed cookies without `no-store` (SEC-15)
`lib/supabase.ts` `setAll` ignores its headers argument; `/api/*` is outside the middleware matcher.
No cache stores those responses today, so not P0. Fix: `setAll(list, headers)` applies the headers;
route handlers that call `getSession()` set `Cache-Control: private, no-store` (or one wrapper). Cost
20 min. Owner: lane A (A-01).

### V-SEC-04 · P1 · an open checkout can bill a business that was just deleted (SEC-44, F-021 path 3)
Path: a Scan owner opens the `monitor_addon` Checkout in one tab, presses "Verwijder alles" in another
(no running subscription → purged at once, login deleted), then pays. Stripe creates and bills the
subscription; the webhook finds no business, logs `billing.no_business` and answers 200
(`api/stripe/webhook/route.ts:31`). Nobody cancels it and the customer has no account to do it from.
Fix: `purgeBusiness` expires the customer's open Checkout Sessions before the delete
(`checkout.sessions.list({ customer, status: "open" })` → `expire`), in `PurgeDeps.stripeLive`'s step.
Cost 1 h. Owner: lane A (A-05).

### V-SEC-05 · P1 · any verified owner can take a facts host without DNS (SEC-47)
Capped at P1: the route was on my phase-1 list (F-019), and I misread its failure branch as "stored
unverified". Not live: production has no custom facts hosts yet.
Path: attacker X verifies their own host H1 (normal flow). X posts `host = feiten.<victim domain>`
(the preferred name is guessable, `publisher/host.ts:47-48`); the CNAME check fails;
`route.ts:56` writes `factsHost = H2` and keeps H1's `factsHostVerifiedAt`. Effects: X is the
"verified holder" of H2 (unique index 0016); the victim's own correct verify returns `taken`
(`?dns=nee`); `pollFactsHost(X)` says verified; and X's purge would call `deleteCustomHostname(H2)`.
Evidence: `host.mts` on PgDb: `X after a FAILED check for H2: { factsHost: 'feiten.victim….nl',
factsHostVerifiedAt: '2026-11-12T07:32:32Z' }`, `factsHostTaken(H2, V): true`, `V's verify with a
correct CNAME: taken`, `pollFactsHost(X): { verified: true }`.
Fix: the failure branch writes `factsHostVerifiedAt: null` with the host (and `upsertBusiness` clears the
proof whenever `factsHost` changes without a new one), plus a test. Cost 30 min. Owner: lane B (B-05,
`api/domain/verify`).

### V-SEC-06 · P2 · "bezet" looks at one business only (SEC-38)
`changeEmail` refuses only when the **newest** business with that owner address is outside the list.
Supabase's confirmation mail to the new address is the real control (D1 "Secure email change", not
read back), hence P2. Fix: a Db query "any business with this owner address not in my ids". Cost 15 min.
Owner: lane A (A-03).

### V-SEC-07 · P2 · `VIDALO_AUTH_SECRET` is not in the secrets manifest (SEC-55)
`secrets.manifest.json` lists `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` but
not `VIDALO_AUTH_SECRET`; `docs/secrets-and-keys.md` lacks it too. A deploy that sets secrets from the
manifest leaves it out, `env.authSecret` throws, and every sign-in link is refused (fails closed: an
outage, not an exposure). Fix: a manifest entry targeting `web` (production and staging), a row in
`secrets-and-keys.md`, 32 random bytes hex. Cost 10 min. Owner: delivery-lead.

### V-SEC-08 · P2 · the first verified owner to submit a host whose CNAME points at us wins it
Existed before this feature; 0016's unique index now makes it permanent. Every customer points at the
same `feiten.vidalo.io`, so a verified owner who watches `feiten.<victim domain>` can submit it between
the victim's DNS change and the victim's own verify. Fix: a per-business TXT token (or a per-business
CNAME label) as the proof. Cost half a day. Owner: architect.

### Concurred, filed by compliance
- **V-COMP-01** (`deleteLogin` fails open, worker lacks `STRIPE_SECRET_KEY`): SEC-51. Security agrees.
- **V-COMP-04** (a failed owner deletion is never counted): SEC-45. Security agrees; add
  `account.delete_failed { businessId }` when a `purge` job is retired.

## Checked beyond the list, no finding
- IDOR on every changing action and route (the SEC-04 grep); `/api/lang` writes only for a member's
  business; `/api/google/start` falls back to the Google-proof claim path for a non-member id.
- Login CSRF through `/auth/confirm` is accepted by design; framing is blocked (`frame-ancestors 'none'`,
  `X-Frame-Options: DENY`).
- `owner.verified` events keep an earlier claimant's address in `previous`; the export drops it
  (`ownAddressesOnly` walks nested values); the export still carries other logins' user ids in such
  payloads (P3, not filed).
- `scripts/stripe-lifecycle-run.mts` refuses non-test keys and the Sitty and Sonable accounts.
- F-A5 is fixed in the merged code (`owner-area.ts` branches on `db.kind`, reads `r.userId`); its row in
  `findings.md` still says open.

## Round 2 (2026-11-12, HEAD `675a778`, diff `dd7a889..HEAD`)

Runs: my own databases `sec002r2` (probes) and one fresh database per Pg test file, all on the shared
local Postgres (54433), migrations 0001–0019 through `scripts/local-auth-shim.sql`; `DATABASE_URL=`
empty everywhere; no builds, no Playwright, nothing hosted. Probes in the session scratchpad
(`probe/{addon,guards,webhook,host,host2}.mts`, `probe2/revoke.mts`).

- Core on MemDb (`purge`, `deletion`, `db-account`, `facts-after-purge-qa`, `db-purge-qa`, `google-revoke`,
  `safe-next`, `same-origin`, `export-secrets`, `db-membership`): **103 passed, 7 skipped**.
- Core on PgDb, fresh database per file: `purge` 12, `db-account` 36, `db-purge-qa` 2,
  `facts-after-purge-qa` 4, `db-membership` 19: **73 passed**. (On a database already holding my probe
  rows three of these fail on their own global counts; test hygiene, not a product defect.)
- Worker `purge-job`, `retention`, `retention-qa`: **21 passed**.
- `scripts/rls/membership.sql` on `sec002r2` (which holds foreign probe businesses, the V-QA-05 case):
  `RLS-OK login1[…=2] login2[…=1] anon[…=0]`; control `-v broken=1`: `RLS-FAIL login1 sees 4 business rows`.
- `git diff dd7a889..HEAD`: no key-shaped string, no hidden or bidi character in any touched file.

### Round-1 findings against the code

| ID | Verdict | Evidence; does a control fail without the fix |
|---|---|---|
| V-SEC-01 | **fixed** | `0019:49-50` rule 3 fires on `old.plan is distinct from new.plan`; MemDb mirrors it. `addon.mts`, Mem and Pg: dated Scan + `monitor_addon` webhook → `activated`, `plan monitor`, `sub_probe`, `deleteAt null` (round 1 on the same probe: `THREW … business_delete_only_when_ending`). Re-ran `guards.mts`: 300 combos, 0 mismatches, 0 paying deleted; `webhook.mts`: undo clears the date, churn dates it, 0 churned without a date. The new rule never clears an owner's own date on a running Monthly (that has `cancel_at` set). |
| V-SEC-02 | **fixed** | `api/domain/verify/route.ts:21-25` `refuseCrossSite` first, logs `auth.cross_site_refused {route}`. Lane B's route test red before, green after (not re-run by me: needs `next dev`). |
| V-SEC-03 | **partly fixed, P2 stays open** | Portal, Google start and callback wrap their answer in `private, no-store`; export and sign-out already did. Still without it while reading the session: `api/checkout`, `api/lang`, `api/domain/verify` (my grep of every route handler that reads the session). No cache stores them today. |
| V-SEC-04 | **fixed** | `shared/purge.ts:60-64` `expireOpenCheckouts` after `stripeLive`, before anything is touched; a throw deletes nothing (`purge.test.ts` V-SEC-04, my run). Every Checkout of a business with a customer id is created with `customer:` (`api/checkout/route.ts:126`), so the list finds it. Web: an expire error throws → job queued → the worker's retry sees the subscription (`stripe_live`). Worker: a 400 is swallowed, see V2-SEC-03 (P3). |
| V-SEC-05 | **fixed** | `route.ts:64` writes `factsHostVerifiedAt: null` with the unproven host. `host2.mts` on Pg: X after a failed check `factsHostVerifiedAt: null`, `factsHostTaken(H2, V): false`, the victim's verify `ok`, `pollFactsHost(X)` not verified. Control `host.mts` (the old branch): still `taken` / verified. The other writers of `factsHost` (`markFactsHostVerified`, `ensureFactsHost`, `pollFactsHost`) each set the proof with the host, so the "clear on any change" half was not needed. |
| V-SEC-06 | **fixed** | `account/actions.ts:36-37` → `Db.ownerEmailTakenOutside` (`pg.ts:850-855`: parameterised, `lower()`, uuid-filtered ids, an empty list counts every business). `db-account.test.ts` on Mem and Pg. |
| V-SEC-07 | **fixed** | `secrets.manifest.json` `VIDALO_AUTH_SECRET` targets web; row in `docs/secrets-and-keys.md`. Setting it stays §7. |
| V-COMP-01 | **fixed at the dependency, a gap stays** | Web `verwijderen/actions.ts:49-53` and worker `jobs/purge.ts:53-56` throw without the Admin key unless mock (web: `VIDALO_MOCK=1` or no `DATABASE_URL`; the Worker entry sets the latter from Hyperdrive); `STRIPE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` now target the worker. `purge-job.test.ts` V-COMP-01 passes. But `purgeBusiness` swallows that throw after the row is gone: V2-SEC-02. And the same fail-open shape remains in two other steps: V2-SEC-01. |
| V-COMP-04 | **fixed** | `countOverdueDeletions` counts unfinished/retired purge jobs; `loop.ts:61-62` logs `account.delete_failed { businessId }` (no address, asserted in `purge-job.test.ts:135-138`, my run). |

### New code, for regressions
- **Checkout expiry in the purge**: correct order and fail-closed on web; worker race, V2-SEC-03 (P3).
- **deleteLogin failing closed**: holds at the dependency; swallowed by the purge (V2-SEC-02, P2).
- **Facts host 404 after purge** (`publisher/serve.ts`): a cached entry is re-read by id on every hit and
  dropped when gone, re-statused or re-hosted; `clearServeCache` for both hosts after the row delete;
  downstream `max-age=60`. `facts-after-purge-qa` 4/4 on Pg. No path serves one business's page on
  another's host: a changed `factsHost` drops the entry and `resolve` reads by host again.
- **domain/verify**: see V-SEC-02 and V-SEC-05. Side effect, no security impact: a verified owner who
  tries a new host loses the proof on the old one and the old Cloudflare hostname is left behind (P3, not filed).
- **no-store**: see V-SEC-03.
- **ownerEmailTakenOutside**: see V-SEC-06.
- **Secrets manifest**: the new entries are right, but reading every target against the code that runs
  there found V2-SEC-01: `GOOGLE_OAUTH_CLIENT_ID` is web-only while the worker gates its revoke on it, and
  `CLOUDFLARE_*` is worker-only while the web's "now" purge removes hostnames. Probe `probe2/revoke.mts`
  (VIDALO_MOCK unset): worker purge `done`, `googleRevoked: true` in the mail, 0 outbound calls; web
  `deleteCustomHostname` → `delete.skip`, no error.
- New log lines (`account.delete_failed`, `purge.checkouts_expired`, `auth.cross_site_refused`,
  `account.audit_log_delete_failed`): ids, counts, a route word, an error name; no address, token or user id.
- `deleteAuthAuditLog` (`pg.ts:857-863`): uuid check, parameterised, only `payload->>'actor_id'`.

### Feature 001 and the business check (F-020, B-05)
Feature 001 was already in this branch's history before 002 began (`d6266b6` precedes `4f6cd2e`); the
merge `285615f` brought only the PR merge commit. Its changing surfaces: `saveProfile` now opens with
`requireVerifiedOwnerOf(businessFromForm(form))` (`gegevens/actions.ts:123-124`) and its form carries
the hidden `business` (`ProfileGroup.tsx:50`); `POST /api/scan` and `GET /api/scan/[id]/status` are the
public free check (no owner data; the status body is an allow-list, `scanStatusBody`). My grep of every
`"use server"` export: each business-changing action calls `requireOwnerOf` / `requireVerifiedOwnerOf`
first; `changeEmail` and `signOutEverywhere` act on the login, `chooseBusiness` checks membership,
`claimBusiness`, `sendMagicLink` and `confirmSignInAction` are pre-business. **No action or route skips the check.**

### Counts
Round-1 items: 8 fixed (V-SEC-01, -02, -04, -05, -06, -07, V-COMP-04, V-COMP-01 at its dependency),
1 partly fixed (V-SEC-03, P2 open), V-SEC-08 deferred as recorded. New: **V2-SEC-01 (P1)**,
**V2-SEC-02 (P2)**, **V2-SEC-03 (P3)**. **No P0.** V2-SEC-01 means AC-5(d) is not met with the
manifest as it stands (Google revoke on worker paths, Cloudflare removal on the web path); that is not
an exploit, so I file it P1 and leave it to QA and compliance to rate it against the AC and the mail.
SEC-43/59 (V-SEC-01) and SEC-44 (V-SEC-04) and SEC-47 (V-SEC-05) now PASS; SEC-35 now PASSES; SEC-15 stays
FAIL (P2); SEC-48/49 reopen as V2-SEC-01.
