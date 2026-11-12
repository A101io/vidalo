# ADR-0002 — The session is refreshed in edge middleware and judged by an app table

*2026-11-11 · status: accepted*

## Context
Gap S1: `lib/supabase.ts` swallows cookie writes in server components ("refreshed by
middleware instead") while `apps/web/middleware.ts` does no refresh. Inferred: after an hour
each render refreshes with the stored refresh token and cannot save the new one; the reuse
is detected and the session revoked. S2: cookies use `@supabase/ssr` defaults (not HttpOnly,
no Secure, 400 days). S3: Julian chose 30 days idle and 90 days maximum (Q2); Supabase's
time-box and inactivity timeout are Pro-plan settings and, per Supabase's sessions guide,
are enforced only when a token is refreshed. S4: sign-out is global by accident. AC-3(e)
needs "Overal uitloggen" to take effect on the other browser's next page load, while that
browser may hold an access token valid for up to an hour. The middleware runs on the edge
under OpenNext, twice on a rewrite, and must not open a database connection (`withDb()`
scope lives in the Worker entry; CLAUDE.md "Things that cost an hour").

## Decision
- **Refresh in middleware.** When a `sb-` cookie is present, `createServerClient` with
  `getAll` from the request and `setAll` that writes into the request cookies and a pending
  list; `await supabase.auth.getClaims()`; then the existing `next`/`rewrite` response is
  built with the forwarded `cookie` header updated and the pending cookies set on it. No
  database, no core import beyond `shared/gate`.
- **Cookie options in one module** (`apps/web/lib/auth-cookies.ts`): HttpOnly, Secure when
  `PUBLIC_BASE_URL` is https, SameSite=Lax, Path=/, Max-Age 90 days; forced on every
  Supabase cookie the app writes.
- **Lifetime and revocation in `getSession()`**, against table `auth_session` keyed by the
  Supabase `session_id` claim (migration 0018): `signed_in_at`, `last_seen_at` (touched at
  most hourly), `ended_at`/`ended_reason`. `sessionVerdict(row, now)` is pure
  (`core/shared/session-life.ts`): missing, ended, idle > 30 d, or older than 90 d → signed
  out (`signOut({ scope: "local" })` at Supabase, row ended). Rows are written only by
  `confirmSignInAction` after `verifyOtp` succeeds.
- **Sign-out**: "Uitloggen" is `scope: "local"` and ends this row; "Overal uitloggen" is
  `scope: "global"` and ends every open row of the login.
- **Fresh sign-in** (15 minutes) reads `auth_session.signed_in_at`, which a token refresh
  never moves.
- When the project is on Pro, Supabase's time-box (2160 h) and inactivity timeout (720 h) are
  set as well (D1); the app does not depend on them.

## Consequences
**Good:** the refresh happens where the cookie can be saved, once per request even with
OpenNext's second pass; the lifetime holds on any plan; "Overal uitloggen" and deletion end
other browsers on their next page, not at token expiry; the sign-in list (AC-3f) is the same
table; no new secret for sessions.
**Bad:** one indexed read per render and an hourly write per active browser; every session
that existed before the deploy has no row and signs out once (F-005); the access token
remains valid at Supabase's own REST API until it expires after a global sign-out, since our
table only binds our app (F-004); and without the Pro plan a stolen refresh token is never
ended at Supabase by the idle/90-day rule, only by "Overal uitloggen" (F-022, noted, open
until the plan decision); a test needs a fake GoTrue because the hosted project is
production.
**We can no longer:** add a sign-in path that does not pass through `confirmSignInAction`
without it failing closed; read sessions in middleware for decisions (it has no database).

## Alternatives rejected
| Option | Why not |
|---|---|
| Supabase time-box and inactivity timeout only | Pro plan (go-live D2 blocked on Julian's billing), enforced only at refresh, and no answer for AC-3(e) within the access-token hour |
| A signed session-meta cookie checked in middleware | A second secret, and still no server-side revocation for "Overal uitloggen"; the cookie can be dropped by the browser and we cannot tell that from tampering |
| Refresh in a route-handler hop (`/auth/refresh` redirect) | One extra round trip per expiry and a redirect loop risk on POSTs |
| Middleware reads the database | `withDb()` scope and Hyperdrive belong to the Worker entry; the edge runtime should not open Postgres connections per asset-less page |
| `getUser()` instead of `getClaims()` | A network call to Supabase on every render; our table already answers revocation |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
