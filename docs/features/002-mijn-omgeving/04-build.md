# 04 — Build log, 002 Mijn omgeving

## Lane A

Branch `claude/exciting-kirch-968156` (lane A worktree), cut from C-00 (`4cd414c`). Every run
below used `DATABASE_URL=` (empty) or a private local Postgres on port 54432 in the session's
scratchpad (`verify:pg`); nothing touched the hosted Supabase project, Stripe or Cloudflare.

### A-01 — Session refresh in middleware, safe auth cookies (2026-11-11)

**What.** `apps/web/lib/auth-cookies.ts` (new, edge-safe): `AUTH_COOKIE_MAX_AGE`,
`authCookieOptions(baseUrl)` (HttpOnly, SameSite=Lax, Path=/, 90 days, Secure only on https),
`forceAuthOptions` (ours over the library's, a removal stays a removal), `NO_STORE`.
`apps/web/middleware.ts`: when the request carries an `sb-` cookie and Supabase is configured,
a server client with `getAll`/`setAll` on the request refreshes the session; the response
(`next` or `rewrite`, language and gate logic unchanged) is built after that, with the
forwarded `cookie` header updated, every pending cookie written with the forced options, the
headers `setAll` passes applied, and `Cache-Control: private, no-store` when it carries an
`sb-` cookie. No database and no core import beyond `shared/gate`. `apps/web/lib/supabase.ts`:
`cookieOptions: authCookieOptions()` and forced options in `setAll`. `lib/auth-confirm.ts` and
`/auth/uitloggen` set `Cache-Control: private, no-store` on their responses (both write
session cookies). Tests: `e2e/fixtures/fake-gotrue.ts`, `playwright.auth.config.ts`
(`pnpm e2e:auth`), `e2e/auth-session.spec.ts`, `e2e/helpers-account.ts`.

**AC-3(b) failing first (required by the ticket).** `e2e/auth-session.spec.ts` "(b) stays
signed in across access-token expiries", run on the branch with `middleware.ts`,
`lib/supabase.ts`, `lib/auth-confirm.ts` and `/auth/uitloggen` as at C-00:
- **Red** (`FAKE_GOTRUE_ACCESS_SECONDS=95`, 2026-11-11 22:4x): `signed out on /app after 5
  loads: /app -> /app, /app/voortgang -> /app/voortgang, /app/account -> /app/account, /en/app
  -> /app, /app -> /inloggen`; fake GoTrue events `verify, session.start, refresh,
  refresh.reuse_tolerated ×n, refresh.reuse_revoked`. Every render refreshed with the same
  refresh token (the server component cannot save the new one) until the reuse revoked the
  session, as ADR-0002 inferred for production.
- An earlier red run (first version of the spec, same old code) signed out on the 3rd page with
  the same event trail. With the default 125-second fake tokens the old code is red on a
  different assertion: it does not refresh at all within 15 s (`refreshes` 0), because
  supabase-js only refreshes inside the last 90 s.
- **Green** after the change: 3 full `pnpm e2e:auth` runs in a row, 5/5 each; with 95-second
  tokens too. One refresh per expiry, no reuse event (SEC-16).

**Judgement calls, and one finding for the architect.**
1. *The fake's tokens live 125 s, not 5 s.* supabase-js (auth-js 2.118) refreshes any token
   within 90 s of expiry (`EXPIRY_MARGIN_MS`), so a 5-second token is refreshed on every call
   and no design can pass. 125 s with a 120-s refresh margin in the middleware gives the
   architecture's "a refresh 5 s after sign-in" (documented at the top of the fake).
2. *The middleware refreshes 120 s ahead of expiry with `getSession()` + `refreshSession()`,
   not with `getClaims()`.* With `getClaims()` (the contract's wording) the middleware refreshes
   only inside the same 90-s window as the page's own client; a token that crosses into that
   window while the page renders is refreshed again by the page, that refresh is lost, and the
   next request reuses the old refresh token: revoked after Supabase's 10-s reuse interval. Seen
   in the test as a flake on a cold dev server (one red run of 6 before the change). Refreshing
   30 s earlier closes it as long as a render takes under 30 s. The middleware decides nothing
   about trust; `getSession()` in `lib/session.ts` verifies the claims (A-02, SEC-19). It also
   saves one `/user` round trip per page on a project with HS256 keys, where `getClaims()` is a
   network call. **Finding for the architect (P2):** `02-architecture.md` "Session" says
   `getClaims()` in the middleware; the reason above says otherwise. Not filed in
   `findings.md` (delivery-lead's file); listed here and in the hand-over note.
3. *F-018 in `next dev`.* Next's dev server forces `Cache-Control: no-store` on every document
   over the middleware's value (`base-server.js`, "must not be stored in development"), so in
   dev the header reads `no-store` (still never cached). The spec asserts `no-store`; the
   workerd run below shows the full `private, no-store` value.

**Workerd run (local production build, `wrangler dev --env preview --local`, fake GoTrue).**
Built with `DATABASE_URL=` empty, `SUPABASE_URL=http://127.0.0.1:54399`. Read with curl:
- `/auth/confirm` (sign-in): `Cache-Control: private, no-store`; `Set-Cookie: sb-127-auth-token=…;
  Path=/; Max-Age=7776000; HttpOnly; SameSite=lax` (no Secure on http).
- `/en/pricing` after expiry (a pure rewrite, OpenNext's second pass): 200, `<html lang="en">`,
  the refreshed `Set-Cookie` delivered, `Cache-Control: private, no-cache, no-store,
  must-revalidate, max-age=0`. `/en/app` after expiry: refreshed cookie delivered (the header
  appears twice with the same value: both passes' headers merged by OpenNext; harmless), then
  307 to `/app` (the owner's language is Dutch, `lib/preferred-lang.ts`).
- `/` after expiry: refreshed cookie, `Cache-Control: private, no-cache, no-store, …`.
  Client B (no cookies) on `/`: no `sb-` Set-Cookie; `/app` → `/inloggen?next=%2Fapp` (F-018
  two-client).
- Fake GoTrue after four expiries: 4 refreshes, session not revoked (SEC-16).
- SEC-17: `.open-next/middleware/handler.mjs` has no `SERVICE_ROLE`, `VIDALO_AUTH_SECRET` or
  `DATABASE_URL`; the one `sb_secret_` hit is supabase-js's key-prefix check
  (`startsWith("sb_secret_")`), the `postgres` hits are Realtime's `postgres_changes` strings and
  OpenNext's `serverExternalPackages` list. No secret.

**Other checks.** SEC-18: a garbage `sb-` cookie and an expired JWT signed by another key with a
random refresh token both land on `/inloggen`, write no session cookie, and cost at most one
GoTrue call (auth spec). `authCookieOptions("https://vidalo.ai").secure === true`,
`("http://localhost:3000")` false (auth spec). `pnpm -r typecheck` green; `pnpm -r test` green
(core 1258 + 15 skipped, worker 24); `pnpm e2e:mock` OK; `e2e/signed-in.spec.ts` +
`e2e/auth-redirect.spec.ts` 12/12 (with `--workers=1`; a parallel cold-start run lost 4 to
Fast Refresh aborting the form, the known CLAUDE.md effect); `e2e/gate.spec.ts` in gate mode 8/8
(same note). `verify:pg` green on the C-00 baseline (49 db tests, 1963 samples).

**Not verified here.** Secure over https (delivery-lead on staging/production, SEC-14). Whether
Supabase applies per-IP auth limits to the Worker's egress (SEC-18's second half): not readable
from here; no per-IP cap added. supabase-js logs `AuthApiError: Invalid Refresh Token…` itself
when a refresh is refused; the line carries no token (seen in the dev log).

### A-02 — Sign-in confirmed by POST and recorded; lifetime; sign out here or everywhere; sign-in list (2026-11-11)

**What.** Migration `0018_auth_sessions.sql` (`auth_session`, `auth_throttle`; RLS on, no
policies, grants revoked; no IP and no user-agent column). `core/shared/session-life.ts`
(`IDLE_DAYS` 30, `MAX_DAYS` 90, `FRESH_MINUTES` 15, `sessionVerdict`, `isFreshSignIn`,
`uaFamily`). Db `recordSignIn`, `getSignIn`, `touchSignIn`, `endSignIns`, `listSignIns`,
`deleteSignIns` in `types.ts`, MemDb and PgDb (PgDb treats a non-uuid id as not found).
`apps/web/lib/session.ts`: `getSession()` (React `cache`) = verified claims (`getClaims`) →
row → verdict; not ok → row ended (idle/max_age), `signOut({ scope: "local" })`,
`auth.session_ended { reason }`, null; ok → `touchSignIn` (hourly). Mock auth: the cookie carries
`sid`; the same row rules apply and `signedInAt` comes from the row only (SEC-24); new mock users
get a uuid-shaped id so the rows also work on Postgres. `GET /auth/confirm` is a page with one
button (noindex, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag`
from the middleware; language follows `next`); `confirmSignInAction` allow-lists the type
(`email`, `magiclink`, `signup`, `email_change`), shape-checks `token_hash`/`code`, verifies,
records the sign-in, ends the browser's previous one as `replaced`, redirects to `safeNext(next)`.
`/auth/callback` answers 303 to `/auth/confirm` with the same query. `lib/auth-confirm.ts` and
`app/auth/confirm/route.ts` deleted. `POST /auth/uitloggen`: this browser only (`scope: "local"`,
row `signed_out`). `signOutEverywhere()` (`scope: "global"`, every row
`signed_out_everywhere`) → `/inloggen?uitgelogd=overal`. `/inloggen` states `uitgelogd=overal`
and `fout=verlopen` in one `role="status"` line. `/app/account`: "Waar je bent ingelogd" (an
`<ol>` of the last 10, browser and system in words, "dit apparaat", ended ones marked) and
"Overal uitloggen" (secondary button; the page keeps one primary). Every changing form on the
account page carries `<input type="hidden" name="business">` (F-020); `setLanguage` passes
`requireOwnerOf(businessFromForm(form))`. Copy in `copy.accountSecurity` NL and EN.

**Tests.** `packages/core/test/session-life.test.ts` (19, fake clock: 30 d + 1 min idle, 29 d
23 h ok, 90 d + 1 min max_age, 89 d ok, fresh at 14:59 / not at 15:01, seven user agents).
`packages/core/test/db-account.test.ts` (6 cases × MemDb and PgDb on `verify:pg`): record twice →
one row, a second record never reopens an ended row or moves `signed_in_at` (SEC-21), end one
leaves the other, end all, prune keeps the 10 newest ended plus every open row, touch only after an
hour and never an ended row, delete one user only, malformed ids not found; each with a control
user untouched. `e2e/auth-session.spec.ts` (fake GoTrue): AC-4(d) GET twice → 200, no `sb-`
cookie, no verify call, then the button signs in; SEC-27 `type=recovery`, a 10 000-char and a
malformed `token_hash` → `/inloggen?fout=link`, no verify call; SEC-26 a POST of the action with
`Origin: https://evil.example` → no cookie, no verify; control from our origin signs in; SEC-19
a token signed with another key and an `alg: none` token → `/inloggen`; (d) "Uitloggen" in A, B
keeps `/app`; (f) B's list shows "Firefox op Windows · dit apparaat" first, "Chrome op een Mac"
second; (e) "Overal uitloggen" in A → B's next load is `/inloggen` with the expired sentence,
GoTrue saw `logout.global`. `e2e/auth-redirect.spec.ts` rewritten for the one-click page (the
form carries `next=/app` for each bad value; `/auth/callback` stays on this host; headers; EN).

**Shown to fail without the change.** With `/auth/confirm` as the GET route of A-01 (and its
`uitloggen`) put back: AC-4(d) red (the GET wrote 2 `sb-` cookies and called verify); (d)/(e)/(f)
red (signed in by GET, no row recorded, `/app` → `/inloggen`). Restored, then green.

**Runs.** `pnpm e2e:auth` 10/10; `pnpm -r typecheck` green; `pnpm -r test` green (core 1283 + 15
skipped, worker 24); `pnpm e2e:mock` OK; `pnpm verify:pg` OK (61 db tests, 1963 samples); mock
Playwright desktop 96 passed + 3 cold-start aborts and 3 of my own over-strict asserts, then the
affected files serially 81/81 after the fix.

**Not done here / findings.** F-A1 (P1): the root layout still loads GA4/Meta after consent, the
chat widget, `ask.js` and `motion.js` on `/auth/confirm` (SEC-25); `app/layout.tsx` is outside
both lanes. F-A2: `scripts/site/snapshot.mjs` forges a mock cookie without `sid`, so the Pages
snapshot's owner pages now show the sign-in page. F-A4: `requireOwner` (lane B) does not add
`fout=verlopen`; `/inloggen` finds the ended row itself, and a session with no row (F-005) gets
the plain form. `signOutEverywhere` takes no `business` field: it acts on the login, not a
business. The Cache-Control of the confirm action's response (a server action that sets
cookies) was not read separately.

### A-03 — Link limits, safe `next`, Origin check, fresh sign-in (2026-11-11)

**What.** `core/shared/auth-throttle.ts`: `LINK_LIMITS` (5 per address, 20 per IP, rolling hour),
`throttleKeys` (HMAC-SHA256 hex under `VIDALO_AUTH_SECRET` of `addr:<trimmed lower-case
address>` and `ip:<ip>`, Web Crypto), `overLimit`, and `throttleIp` (only `cf-connecting-ip`;
no header → one shared `unknown` key, logged `auth.throttle_no_ip`; `x-forwarded-for` never
trusted in the real path, SEC-31). Db `throttleAuth` (insert + per-key count in one statement on
PgDb; MemDb the same, "this request included") and `pruneAuthThrottle`.
`core/shared/same-origin.ts`: `refuseCrossSite` + `isOwnOrigin` over the exact host list
(`vidalo.ai`, the three redirect hosts, `PUBLIC_BASE_URL`'s origin, the staging and preview
`workers.dev` hosts; never a suffix match). `env.authSecret` (throws when Supabase is configured
and the secret is missing; `"vidalo-local"` otherwise). `lib/fresh-sign-in.ts`
`requireFreshSignIn(next)`. `sendMagicLink`: format → Turnstile → limit → Supabase; over the limit
or a database error → no Supabase call; GoTrue errors logged with status and code only (SEC-34);
`auth.link_throttled { which }`; the limit runs only where a mail would go (Supabase configured),
not on mock sign-ins. `safeNext` replaces both inline checks (`sendMagicLink`, `claimBusiness`).
`/inloggen?opnieuw=1`: one sentence why, the form shown even while signed in, address pre-filled.
`POST /auth/uitloggen` and `POST /api/billing/portal`: `refuseCrossSite` first,
`auth.cross_site_refused { route }`; the portal takes the form's `business` (a member's
business, else 404; a form without it, like lane B's dashboard button until B-05, gets the
active business). `saveMailPrefs` → `requireOwnerOf(businessFromForm(form))`. `changeEmail` →
`requireFreshSignIn("/app/account?stap=email#inlog")`; "bezet" when the address owns any
business outside `listMyBusinesses(session)`; its confirmation link now goes straight to
`/auth/confirm` (the Change Email template appends `token_hash` and `type=email_change`).
`/app/account?stap=email` focuses the address field.

**Tests.** `safe-next.test.ts` (20: every AC-4(c) and F-023 input, `/%0d%0aSet-Cookie:x`, NUL,
kept paths), `auth-throttle.test.ts` (keys 64-hex, `A@X.nl` = `a@x.nl`, another secret → other
keys; 5th/20th go, 6th/21st do not; cf header beats x-forwarded-for), `same-origin.test.ts` (17:
the SEC-35 list), `db-account.test.ts` + limit cases on MemDb and PgDb (6th counted, another key
separate, 61 minutes later under again, prune keeps the last 24 h). `e2e/auth-session.spec.ts`:
AC-4(a) three addresses (with a business, with only an account, unknown) → identical action
answer (`303 /inloggen?sent=1`) and byte-identical `sent=1` page once the dev server's
`?v=<time>` asset stamp and Next's per-render `__next_r` id are taken out; AC-4(b) the 6th link
for one address → `fout=wacht`, the fake GoTrue received 5 mails, not 6; AC-4(e) foreign POSTs
to sign-out and the portal → 403, still signed in, control from our origin → 303; AC-5(c) a sign-in
older than the window → `/inloggen?opnieuw=1&next=/app/account?stap=email#inlog`, sentence and
address shown, a new sign-in through that link lands on the focused address form.
`e2e/auth-redirect.spec.ts` route table: eight bad `next` values through the sign-in form (mock)
all end on `/app` on this host.

**Judgement call.** The fresh window in the browser test: `requireFreshSignIn` honours
`VIDALO_TEST_FRESH_SECONDS` (20 in `playwright.auth.config.ts`) only when `NODE_ENV` is not
`production`, so a stale sign-in can be shown without waiting 15 minutes. Production builds
ignore it; the 15-minute rule itself is the unit test of `isFreshSignIn`.

**Shown to fail without the change.** With `inloggen/actions.ts`, `/auth/uitloggen` and the
portal route as at A-02: AC-4(b) red (the 6th request landed on `sent=1`), AC-4(e) red (a foreign
POST answered 303). Restored, green.

**Runs.** `pnpm e2e:auth` 14/14; `pnpm -r typecheck` green; `pnpm -r test` green (core 1329 +
15 skipped, worker 24); `pnpm e2e:mock` OK; `verify:pg` green; mock Playwright
(`auth-redirect`, `signed-in`, `forms`) 19/19. Two earlier full `e2e:auth` runs stopped at
AC-5(c): the address form's server action never answered and the run took 16 minutes; it passed
alone, in three subsets and in the next full run, with request logging left in the test. Cause
not found; noted for verify.

**Not verified.** SEC-33's timing medians (50 runs each) were not measured. SEC-31's "count is
global across two Db handles on one PgDb" is by construction (one table), not a separate test.
D1 items (Secure email change, rate limits) are Julian's.

### A-04 — Export without secrets, streamed; "Koppeling met Google verbreken" (2026-11-11)

**What.** `core/shared/my-data.ts`: `CHANNEL_META_EXPORT_KEYS` (the architecture's 15 keys) and
`exportChannel` (own fields + allowed meta only); `exportMyData` maps channels through it and
gains `signIns` (the login's last 10, COMP-18) via an optional `{ userId }`.
`core/shared/export-stream.ts`: `streamMyData(db, businessId, { signedInAs, userId?, now? })`, the
same JSON shape written section by section: runs 6 a page (`listSamplesForRuns` + `listClaims`),
events 500 a page (`listEventsPage`, newest first, by `business_id` in SQL), each event through
`ownAddressesOnly`; the Db handle is passed in once. `userId` is an optional addition to the
contract's options (needed for the sign-in list). Db `listSamplesForRuns`, `listEventsPage`,
`deleteChannel` (MemDb, PgDb). `GET /api/account/export?business=`: 401 `login_required`; 404
`not_found` for another login's, unknown or malformed ids alike (uuid checked before SQL, nothing
logged on them); else `account.exported {}` and the streamed attachment with `no-store`,
`nosniff`, no CORS header (SEC-36). The account page's link carries `?business=`.
`core/shared/google-revoke.ts`: `revokeGoogleToken` (POST, token in the form body, 10-s timeout;
200 or 400 `invalid_token` = done; else throws without the token) and `disconnectGoogle(db, id,
revoke, reason)` (refresh token, else access token; a revoke failure keeps the channel and
throws, except on `purge`; `google.revoke_failed { status, reason }`, `google.disconnected
{ reason }`). `/app/google`: "Koppeling met Google verbreken" (form with hidden `business`, one
secondary button) → `disconnectGoogle(form)` → `requireOwnerOf` → `?ontkoppeld=1|geen|fout` in a
`role="status"` line; in mock (`!env.hasGoogle`) the revoke is recorded as `google.revoke_mock`.
`sendOwnerPhoneCode` and `checkOwnerPhoneCode` take the form's `business` (F-020); the "Koppel
Google" link carries `?business=` and the page names the signed-in address next to it (SEC-26).
`GET /api/google/start?business=`: a business the login is a member of, else the existing claim
path for an id (Google's proof decides); never a slug. The callback is unchanged (the state
cookie binds the business).

**Tests.** `export-secrets.test.ts` on MemDb and PgDb: a gbp channel with `rt-<random>`,
`at-<random>` and an unknown `apiSecret: s-<random>`, plus other people's addresses on event
pages 1 and 2 → neither the streamed body nor `exportMyData` contains any of them, both contain
`pendingDiff`; the key order of the streamed object; 36 runs × 50 answers with another
business's runs interleaved → every own sample id exactly once, nothing of the other business,
`listSamplesForRuns` called `ceil(36/6)` = 6 times; an unknown business streams `null`.
`google-revoke.test.ts`: URL and body, `invalid_token` done, 503 throws without the token; only
the business's own gbp channel goes, the control business keeps its own, `ownerVerifiedAt`
stays; a failure keeps the channel (owner) but not on purge. `e2e/account.spec.ts` (mock):
download headers and content (no `refreshToken`/`accessToken`/`expiresAt` key, the sign-in list
present); another login's business, an unknown and a malformed id → the same 404 body; signed
out → 401; the disconnect button removes the connection and the ownership line stays.

**Timing (AC-7 export line).** 36 runs × 50 answers streamed end to end: MemDb 10 ms, PgDb 12 ms
(local Postgres 18 in the session scratchpad, `vidalo_verify` after `verify:pg`), far under 30 s.
The delivery-lead repeats it with B-03's full seed on a production build after merge.
`export-secrets.test.ts` is not matched by `verify:pg`'s `test/db*.test.ts` (frozen script), so
its PgDb half was run by hand with `TEST_DATABASE_URL`.

**Shown to fail without the change.** With `exportMyData`'s channel mapping taken out (today's
code), the token test is red: the export contained `rt-…`. Restored, green.

**Runs.** `pnpm -r typecheck` green; `pnpm -r test` green (core 1338 + 15 skipped, worker 24);
`pnpm e2e:mock` OK; `verify:pg` green (67 db tests); `e2e/account.spec.ts` 3/3.

**Not verified.** A real revoke at Google (no keys here). The mock demo's Google channel holds no
token, so the browser test shows the disconnect, not the recorded mock revoke (the unit test
covers the revoke).

### A-05 — "Verwijder alles" on every plan; one purge module guarded by the database (2026-11-12)

**What.** Migration `0019_deletion_retention.sql`: `churned_at`, `delete_at`, `delete_reason`,
`deletion_reminded_at`, `last_active_at`; CHECKs `business_delete_reason_with_date` and
`business_delete_only_when_ending` (admits a Scan's retention date, F-012); trigger
`business_retention` (security definer, `search_path = ''`, execute revoked) with rules 1–4;
backfill; `job_unrun_business_idx` and `business_delete_at_idx`. One change to the architecture's
rule 3: it fires only when the status or `cancel_at` changes. As written it also ran when
`delete_at` alone was set, so it silently cleared a date on a paying business instead of letting
the CHECK refuse it (the ticket's "setting `delete_at` on an active business without `cancel_at`
fails on PgDb" could never hold). The migration is not applied anywhere but the local test
database. `BusinessRecord` gains the five fields (written only by their own methods and the
trigger; `upsertBusiness` ignores them in both Dbs). Db `setDeletion`, `listDueDeletions`,
`listDeletionReminders`, `claimDeletionReminder`, `countOverdueDeletions`, `listScanRetention`,
`setScanRetention`, `purgeBusiness` (conditional delete + unrun jobs in one transaction); MemDb
mirrors the trigger and the CHECKs; `recordSignIn` sets `last_active_at` on the login's businesses.
`core/shared/deletion.ts`: `SCAN_RETENTION_MONTHS = 24`, `SCAN_GOOGLE_DAYS = 60` (Julian),
`deletionPlan`, `purgeAllowed` (lives here to avoid an import cycle through MemDb; re-exported
from `purge.ts`), `scanRetentionDate`; `canDeleteMyData` removed. `core/shared/purge.ts`:
`PurgeDeps`, `PurgeOutcome`, `purgeBusiness` in the architecture's order (read → guard → Stripe →
dry run for retention only → members/mail target → Google revoke (failure logged, continues) →
custom host only when this business is its verified holder and it is not ours → conditional
delete → logins with no business left → mail → `account.deleted { guard, loginsDeleted }` with
business null). `publisher/host.ts` `deleteCustomHostname` refuses our names (`vidalo.io`,
`*.vidalo.io`, `vidalo.ai`, `*.vidalo.ai`) and non-hostnames before any call.
`reporter/account-mails.ts`: `sendDeletedMail`, `sendDeletionScheduledMail` (logged
`mail.deletion_scheduled`); wording in `copy.mails.accountDeleted` and
`copy.mails.deletionScheduled` (NL, EN; company footer from `textToHtml`; no offer; no 90-day check
in the scheduled mail). Worker: job kinds `purge` and `google_disconnect` (`jobs/purge.ts`, neither
in `PAID_ONLY`); `VIDALO_PURGE` read at job time, armed only by `"1"`; `stripeLive` by fetch to the
Stripe API (subscriptions of the customer, `status=all`); `deleteLogin` by the Supabase Admin
API (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); without them: mock in mock mode, otherwise
Stripe refuses (throws). Web: `/app/account/verwijderen` (what goes, what stays, the money
sentence for Monthly or Scan and the invoice sentence with a portal button, all before one
primary button; fresh sign-in on GET and POST); `deleteMyData` in the order of SEC-52; `now` →
purge inline, then sign-out and the mock and `vidalo_business` cookies cleared →
`/inloggen?verwijderd=1`; a failing step → a `purge` job with the same guard and
`?gegevens=bezig`; `at_period_end` → `cancelSubscription` when needed (refused →
`?gegevens=fout`), `setDeletion(at from Stripe)`, the mail at once → `?gegevens=gepland`.
`callOffDeletion` ("Toch bewaren") on `/app/account` and `/app/abonnement`. The abonnement actions
(cancel, undo, pause, resume) take the form's `business` and pass `requireOwnerOf`, never a fresh
sign-in (COMP-02). `lib/demo-account.ts` seeds `scan-eigenaar@example.nl` (Scan) and
`maand-eigenaar@example.nl` (Monthly, verified custom facts host, Google channel).

**Tests.** `deletion.test.ts` (13: every plan, `purgeAllowed`, `scanRetentionDate`, the CHECK on
PgDb (Scan accepts a retention date, a Monthly in trial refuses one) and on MemDb).
`db-account.test.ts` (6 deletion cases × MemDb and PgDb, each with a control that survives):
`no_subscription` refuses a running Monthly, deletes a Scan owner, false the second time, unrun
jobs gone and the control's kept; churn → `churnedAt` + 120 days, `due` refuses at day 119 and for
an active control, deletes at 121, once; an owner's earlier date survives churn, calling off after
churn falls back to churn + 120 days; undoing the cancel clears the deletion, a date on a paying
business without a cancel is refused; reminders only for retention within 14 days, claimed once,
overdue counted; Scan retention re-arms on a later date, a sign-in moves `lastActiveAt`, a Monthly is
untouched. `purge.test.ts` (9): order of calls; F-010 one case per path (inline, fallback job,
scheduled owner date delete with the dry run on; retention does not, and does when armed); F-021
Stripe live → nothing called, Stripe unreachable → nothing deleted; a running Monthly refused by
both guards; F-019 an unverified host, one held verified by another business, and our own
fallback host are never sent to Cloudflare; Google failure continues; Cloudflare failure throws
before the delete; two businesses on one login (first keeps the login, second deletes it); a
failing mail is logged without the address; SEC-48 refusals. `apps/worker/test/purge-job.test.ts`
(7): `VIDALO_PURGE` unset, `"true"`, `"0"` → dry run; `"1"` → deleted; an owner's fallback job
deletes with it unset; `google_disconnect` skips a business that resubscribed (SEC-49).
`e2e/account.spec.ts` (mock, 7 with A-04's): a hand-edited `business` of another login → `/app`,
both businesses intact; the Monthly owner sees the money and invoice sentences before the button
(DOM order checked), schedules, sees the date on `/app/account` and `/app/abonnement`, the
`mail.deletion_scheduled` event is in their own download, "Toch bewaren" removes the date; the
English page (after switching the owner's language); the Scan owner deletes at once, lands on
`/inloggen?verwijderd=1`, is signed out, and a new sign-in finds no business.
`e2e/auth-session.spec.ts`: the delete step with a stale sign-in (refreshed tokens in between) →
`/inloggen?opnieuw=1&next=/app/account/verwijderen`, a new sign-in returns to the step.

**Shown to fail without the change.** Not re-run against C-00: its `deleteMyData` refused every
status but `scanned`/`churned` (`canDeleteMyData`, removed here), so the Scan owner's delete was
refused by construction, and every new Db method and module did not exist. Recorded as not run.

**Findings.** F-A5 (P1, lane B): the C-00 `owner-area.ts` stub throws in `next dev` server actions
(`instanceof MemDb` across module graphs) and maps `owner_user_id` where postgres.js returns
`ownerUserId`; `purge.ts` falls back to the business's own owner and keeps the login when
membership cannot be read. F-A6: one line added to `legal.test.ts` (outside both lanes' tables)
for `api.stripe.com`.

**Runs.** `pnpm -r typecheck` green; `pnpm -r test` green (core 1364 + 16 skipped, worker 31);
`pnpm e2e:mock` OK; `verify:pg` green (79 db tests); `e2e/account.spec.ts` 7/7; `pnpm e2e:auth` 15/15.

**Not verified / not built.** SEC-54 (a publish job running while its business is purged does not
re-add a hostname) has no test. COMP-17 (IndexNow ping and 410 on purge) not built (P2). The
worker's Stripe and Supabase Admin calls ran only as mocks; the real ones need the D1 secrets.
The Cloudflare removal is shown by the purge's recorded call in unit tests; in the browser run
the mock's `cloudflare.custom_hostname.delete.skip` line is not captured (Playwright drops the dev
server's stdout).

### A-06 — Retention runs by itself; churn removes Google at once; the end state (2026-11-12)

**What.** `core/shared/db.ts` `setBusinessStatus`: becoming `churned` queues `google_disconnect
{ businessId, reason: "churn" }` (the job re-reads the business, SEC-49). `apps/worker/src/cron.ts`
`retention(now)`, added to `cronTick` after `ownerSubscription`: (1) reminders for retention dates
within 14 days, claimed once, as an `email` job `{ template: "deletion_reminder", businessId }`;
(2) a `purge` job `{ businessId, guard: "due" }` per due business, at most one unrun per business;
(3) `google_disconnect` for churned businesses still holding a Business Profile channel
(backstop) and, for a Vidalo Scan, `scan_done` `SCAN_GOOGLE_DAYS` (60) after its first finished
`baseline`/`monthly` run when no finding is being fixed (`fixing`/`recheck`) and no channel holds a
`pendingDiff`; (3a) `setScanRetention` to `last_active_at` + `SCAN_RETENTION_MONTHS` (24) whenever
the date differs (a sign-in moves it and re-arms the reminder); (4) `pruneAuthThrottle(now − 24 h)`;
(5) `countOverdueDeletions` in every tick's result and once per Amsterdam day as
`retention.overdue { count }` (an event with business null marks the day). Returns `{ reminded,
purgeQueued, googleQueued, overdue, dryRun }`; `lifecycleTransitions` unchanged. New Db method
`hasUnrunJob(kind, businessId)` (MemDb, PgDb) for the "one purge per business" rule, which the
architecture names but gives no method for. `email` template `deletion_reminder` (`jobs/misc.ts`,
re-reads the business, skips one that no longer has a retention date) → `sendDeletionReminder`
(`reporter/account-mails.ts`; wording `copy.mails.deletionReminder`, NL/EN, a Scan and an ended
Monthly variant, informational only, how to keep the data, support@ for an earlier deletion).
`/app/abonnement` churned end state (`copy.accountSecurity.endState`): what stopped, the facts
page redirect, reports readable until the date, the date, the reminder line only for a retention
date, Google removed. `scripts/stripe-lifecycle-run.mts`: cancel → undo → cancel → undo → pause →
resume through `core/billing/lifecycle.ts` against the Stripe sandbox, one JSON line per step with
the app's and Stripe's state and the newest `customer.subscription.updated` event id; refuses a
non-test key and the Sitty and Sonable accounts (checked: a live-shaped key is refused before any
call). The ticket's "cancel → undo → cancel → pause → resume" needs an undo before the pause
(`canPause` refuses a cancelled subscription), so the script has one more step.
`docs/CANCEL-PAUSE.md`: section "After the end, and deleting". Mock seed: `eind-eigenaar@example.nl`
(an ended Monthly).

**Tests.** `apps/worker/test/retention.test.ts` (6), MemDb, fake clock counted from A's churn: day 0
→ `google_disconnect` queued, after it runs A has no gbp channel while B, C, D keep theirs; day 90
→ the free check; day 105 none, 106 exactly one reminder, 107 still one, the mail logged; day 119 no
purge, 120 one `purge` job with `{ businessId, guard: "due" }`, a second tick adds none; with
`VIDALO_PURGE` unset the job leaves A, armed it deletes A; B (cancel ahead), C (owner-paused), D
(cancel undone) never get a reminder or a purge and `overdue` is 0 on every tick; an owner deletion
on B's cancel date is purged on that date after the churn webhook, without a reminder and with the
flag unset (F-010); Vidalo Scan E: date = last activity + 24 months, a sign-in at month 20 moves it
and re-arms the reminder, purged on the date when armed; E2's Google token stays while a held
change and while an open fix exist, goes on day 61 after both are gone, one job not two;
`pruneAuthThrottle` keeps rows younger than 24 h; `retention.*` lines carry no address or token and
every job payload is exactly `{ businessId, guard }`, `{ businessId, reason }` or
`{ businessId, template }` (SEC-53). `e2e/account.spec.ts` (mock): the end state reads as above.

**Shown to fail without the change.** With `setBusinessStatus` as at A-05 (no churn → Google), the
first retention test is red at day 0. Restored, green.

**Runs.** `pnpm -r typecheck` green; `pnpm -r test` green (core 1364 + 16 skipped, worker 37);
`pnpm e2e:mock` OK; `e2e/account.spec.ts` 8/8.

**Not done here.** The sandbox run itself (D2: Julian's Mac with sandbox keys; recorded by the
delivery-lead in `05-verification.md`). COMP-16 (who reads `retention.overdue` daily) is the
delivery-lead's. F-022's cron step on `auth.sessions` stays open as accepted.

### A-07 — Privacy text, the new mails in the lab, auth docs (2026-11-12)

**What.** `copy.legal` privacy, NL and EN, as `checklists/compliance.md` §4.1 with Julian's
decisions filled in: P1 (the sign-in list without IP address, the link-limit codes kept at most a
day), P1b (legitimate interest for those two), P1c (a sign-in ends after 30 days unused or 90
days), P2 (the Google key revoked at Google and deleted on disconnect, at the end of a Monthly, for
Vidalo Scan 60 days after the first full check when nothing is open, and on deletion), P3 (end of
a Monthly: Google at once, 90 days, one free check, a reminder 14 days before, deletion at most 30
days after that check; Vidalo Scan: 24 months after the last sign-in or payment with a reminder;
what deletion means; invoices 7 years at Stripe), P4 (download without access keys, delete on
every plan, a running Monthly at the end date without a refund of the running month and
revocable until then, support@ for earlier deletion, the confirmation mail, the Google
disconnect), P5 (a customer keeps seeing the business's reports), P7 ("een inlog die vanzelf
vervalt"). The bracketed backup period of §4.1 P3 is left out (not looked up). Cookie table:
`sb-…-auth-token` "Tot je uitlogt; na 30 dagen zonder gebruik of 90 dagen na het inloggen log je
opnieuw in" and the code verifier "anders hoogstens 90 dagen": both now carry `Max-Age=7776000`
(the forced options of A-01, read back in the workerd run). New version "13 november 2026" /
"13 November 2026" (later than C-00's 12 November), then `legal:lock`. `scripts/mail-lab.mts`:
`deletion_scheduled`, `deletion_reminder`, `account_deleted` through their real senders for both
journeys (the three mails now tag the owner's language, which the lab checks).
`docs/auth-email/README.md`: Site URL `https://vidalo.ai`, the redirect list with vidalo.ai and
www.vidalo.ai, the one-button confirm page, a new section 4 with the D1 table (Change Email link,
Secure email change, sessions, JWT expiry, rate limit) and `VIDALO_AUTH_SECRET`.
`docs/records-of-processing.md` (compliance B8): the account row gains the sign-in list; new rows
for the link limit and Vidalo Scan retention; the ownership row gets the token end; the paid-service
row gets retention as built, and the "purge not built yet" note becomes "dry run until
`VIDALO_PURGE=1`, record that date here" (the note goes only when it is armed, §4.4).
`docs/processors.md`: Supabase (sign-in records, hashed limit keys), Google (tokens revoked),
Resend (the account mails; its log retention not looked up yet). No new outside host beyond
`api.stripe.com` (F-A6).

**Checks.** `legal.test.ts`: red after the wording and date change until the lock was refreshed
("new version: run legal:lock"), green after (24). `pnpm mail:lab`: OK, the three new kinds in
NL and EN with no problems (company line, branded HTML, owner's language, links resolve); a grep
of the three mails and the account-security copy finds no banned word, no score and no
exclamation mark. `pnpm -r typecheck` green; `pnpm -r test` green (core 1364 + 16 skipped, worker
37); `pnpm e2e:mock` OK; the legal pages in the mock browser suite 6/6.

**Not done here.** COMP-25 (one sentence in the terms on how long a Scan facts page stays online,
with 30-day notice to existing Scan customers): the terms were not changed; it needs Julian's
wording and the notice decision. COMP-26 (Supabase backup roll-off and Resend log retention)
not looked up. COMP-44 (the privacy text describes behaviour that ships in the same release):
the retention sentences describe the purge, which runs as a dry run until `VIDALO_PURGE=1`
(COMP-31 is a go-live gate for the delivery-lead). Compliance ticks its own checklist rows.

### F-A1, F-A2 — assigned to lane A after A-07 (2026-11-12)

Assigned by the shape session: `apps/web/app/layout.tsx` (A-03, only the `/auth/*` skip) and
`scripts/site/snapshot.mjs` (A-02). Commit b8a6772. **F-A1:** the root layout reads the route
(`getRoute()`, set by the middleware) and on `/auth/*` renders no `Trackers`, no `ChatWidget`, no
`motion.js` and no `ask.js`; nothing else in the file changed. Test in `e2e/auth-redirect.spec.ts`:
with the consent cookie at every category, `/auth/confirm` has no `googletagmanager`,
`connect.facebook.net`, `ask.js`, `motion.js` or chat button, and requests nothing from another
host; control: the same browser on `/` loads GA4, `motion.js` and the chat button. Red on the old
layout ("googletagmanager"), green after; with `pages.spec.ts` and `consent.spec.ts` 68/68.
**F-A2:** the snapshot no longer writes `vidalo_mock_session` by hand; `signIn()` posts the mock
sign-in form on `/inloggen` (its server action) as the demo owner and keeps the cookie it gets.
Checked against a mock dev server: exit 0, 64 pages, `app.html` and `app-account.html` show the
demo bakery, not the sign-in form. Not checked: the GitHub Actions run itself (`site.yml`, which
uses `next start`).
