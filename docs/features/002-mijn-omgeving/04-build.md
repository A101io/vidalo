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
