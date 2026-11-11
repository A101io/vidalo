# Security checklist — 002 Mijn omgeving

*security · phase 1 (shape) · 2026-11-11 · written against `02-architecture.md`, ADR-0001..0007,
tickets C-00, A-01..A-07, B-01..B-04, `01-brief.md` (approved), the standing list
`docs/process/checklists/security.md` and `_OS/playbook/SECURITY.md` (S1–S12). Code read to
confirm claims: `apps/web/middleware.ts`, `lib/session.ts`, `lib/owner.ts`, `lib/supabase.ts`,
`lib/env.ts`, `lib/reads.ts`, `lib/auth-confirm.ts`, `app/inloggen/actions.ts`,
`app/auth/uitloggen/route.ts`, `app/app/actions.ts`, `app/app/gegevens/actions.ts`,
`app/api/{checkout,domain/verify,google/callback}/route.ts`, `core/billing/index.ts`,
`core/publisher/{host,index}.ts`, `core/shared/{db,my-data,scan-limit}.ts`, `core/db/pg.ts`,
`apps/worker/src/cron.ts`, `supabase/migrations/0001_init.sql`.*

This is the list phase 4 verifies, item by item, with evidence. Each item names the ticket that
must satisfy it, what must be true, the proof that counts (with a control that must fail or a
red-then-green run), and the severity a failure found in phase 4 is filed as.

## P0 against the design

**None.** No designed path gives an attacker another login's data or money. Seven design defects
are filed as findings (F-017..F-023, `findings.md`; the dry-run gap on an owner's own
deletion is compliance's F-010, extended in SEC-45/46); two of them become **P0 if observed in
phase 4** and are flagged so here, so they are not capped by the foreseeability rule:

- **SEC-15 / F-018** — a response carrying a refreshed `sb-` `Set-Cookie` stored by any cache
  hands one owner's session to the next visitor (account takeover).
- **SEC-44 / F-021** — a business purged while Stripe still bills it (a customer charged for a
  deleted service).

Before build (cheap, each in a named ticket): F-023 `safeNext` must check the **normalised**
result (`/.//evil.example` passes the design as written, SEC-29); F-020 the changing actions
outside the architecture's list need `requireOwnerOf` too (SEC-05); F-017 `channel.meta` (Google
refresh token) must not be readable through PostgREST (SEC-10); F-019 the purge may delete only
a custom host this business holds verified (SEC-47).

## Trust boundaries in this feature

| # | Boundary | Untrusted input | Where it goes |
|---|---|---|---|
| T1 | Browser → edge middleware | any `sb-*` cookie value | GoTrue refresh call; `Set-Cookie` on the response; forwarded `cookie` header |
| T2 | Browser → `getSession()` | access token (JWT) and its `session_id` claim; `vidalo_mock_session` | `auth_session` read/touch/end; every owner decision |
| T3 | Mail link → `/auth/confirm` → `confirmSignInAction` | `token_hash`, `type`, `code`, `next` (URL, then form) | GoTrue verify; session cookies; `auth_session` row; redirect |
| T4 | Anyone → `sendMagicLink` | `email`, `next`, `business`, `session_id`, Turnstile token, IP header | `auth_throttle` insert; GoTrue OTP mail; redirect |
| T5 | Signed-in login → owner pages, actions, route handlers | `vidalo_business` cookie, hidden `business` field, finding/channel ids, archive cursor `?voor=` | service-role reads and writes (RLS bypassed) |
| T6 | Signed-in login's JWT + public anon key → PostgREST, **not through our app** | the JWT (valid up to 1 h after any app-side revocation, F-004; refresh token beyond, F-022) | every row the `member_*` policies allow, incl. `channel.meta` |
| T7 | Signed-in login → `GET /api/account/export?business=` | `business` uuid | streamed file: channel `meta`, events naming other people |
| T8 | Signed-in login → delete, call off, cancel, undo, pause, resume, portal, Google disconnect | `business`, `confirm` | Stripe calls, `setDeletion`, `purgeBusiness` (Cloudflare, Google, Supabase Admin, mail) |
| T9 | Cron / job queue → `purge`, `google_disconnect`, `deletion_reminder` | job payloads | irreversible deletes; outbound calls with secrets |
| T10 | Stripe webhook → `business.status` | signed event | `business_retention` trigger sets or clears `delete_at` |
| T11 | Owner → `POST /api/domain/verify` (existing) | `host` | `business.facts_host` (stored even when unverified) → later `deleteCustomHostname(host)` in the purge |

## A. Membership and IDOR (authorisation by membership, at the data layer)

- [ ] **SEC-01 · C-00** The `requireOwnerOf` stub refuses any id that is not the session's
  business: another login's business id, an unknown uuid and a malformed string all end in
  `redirect(/app)` with no 500 and nothing read beyond the membership check.
  *Proof:* a test calling a stub-guarded action with the control business's id, a random uuid and
  `'; drop`; control: the own id passes. *Sev if open:* P0 (write without authorisation).
- [ ] **SEC-02 · B-01** `getActiveBusiness` re-checks the `vidalo_business` cookie against
  `listMyBusinesses(session)` on **every** request; a forged cookie naming another login's
  business, a malformed value, or a business deleted since, falls back to the newest own business.
  *Proof:* e2e (mock) with the cookie hand-set to the control business id → every `/app` page shows
  the own business, never the control's name; control: the own second business id is honoured.
  *Sev:* P0.
- [ ] **SEC-03 · B-01** `chooseBusiness` calls `isMember` before it writes the cookie; a
  non-member or unknown id leaves the cookie unchanged (no `Set-Cookie: vidalo_business` in the
  response) and redirects to `/app`. The cookie carries HttpOnly, SameSite=Lax, Path=/, Max-Age
  90 d, Secure on https.
  *Proof:* action test reading the response headers for both cases. *Sev:* P1 (the read-side
  re-check of SEC-02 still holds).
- [ ] **SEC-04 · A-04, A-05, A-06, B-01** Every action the architecture lists as changing
  (delete, call off, cancel, undo, pause, resume, Google disconnect, billing portal, export) takes
  the hidden `business` field and calls `requireOwnerOf(business)` **first**, before any read,
  Stripe call or write; Stripe ids come from that business's row, never from the form.
  *Proof:* per action, a test posting the control business's id (another login): redirect to
  `/app` (404 for the export/portal), Stripe spy and Db unchanged, control business re-read
  identical; control: the own id acts. A grep listing every exported function in `"use server"`
  files under `apps/web/app/app/**` and every `POST` handler, each marked "requireOwnerOf" or
  "read-only", is pasted into `04-build.md`. *Sev:* P0 for any action reaching another login's
  business.
- [ ] **SEC-05 · F-020 (architect assigns: lane A for `gegevens/actions.ts`, `account/actions.ts`,
  `api/domain/verify`, `api/checkout`; lane B for `app/actions.ts` finding/channel/checkNow)**
  The changing actions **not** in the architecture's list name their business too:
  `saveFacts`, `reconfirmFacts`, `saveProfile`, `checkNow`, `setLanguage`, `saveMailPrefs`,
  `changeEmail` (owner address), `sendOwnerPhoneCode` / `checkOwnerPhoneCode`, the Google
  connect start, `POST /api/domain/verify`; verified ones through a `requireVerifiedOwnerOf`.
  Checkout's `onlyOwnerMayBuy` uses `isMember`, not the active business.
  *Proof:* two-tab e2e: render `/app/gegevens` for business 1, switch to business 2 in a second
  page, submit the first form → business 1 gets the new facts version, business 2's facts are
  unchanged (red on the design as written). *Sev:* P1 (same login; AC-2 "act on that business
  only" not met).
- [ ] **SEC-06 · A-04** `GET /api/account/export?business=`: no session → 401
  `{error:"login_required"}`; non-member, unknown and malformed uuid → the **same** 404 body; no
  event is written on a business the caller is not a member of; the uuid is validated before it
  reaches SQL (no Postgres cast error, no 500).
  *Proof:* route test with the four cases and an event count on the control business before and
  after; control: member → 200. *Sev:* P0 if another login's data downloads; else P2.
- [ ] **SEC-07 · B-01** RLS after 0016, on `verify:pg` and (delivery-lead) on the hosted project,
  as one rolled-back `DO` block that sets role and `request.jwt.claims` per caller and asserts
  `auth.uid()` equals the intended id inside the block: login 1 (control, must see rows), login 2
  (only its own), anon (0) over `business`, `facts`, `finding`, `fix`, `channel`, `event`,
  `scan_run`, `business_member`; as `authenticated`, insert/update/delete on `business_member` and
  `update business set owner_user_id = auth.uid()` affect 0 rows or raise.
  *Proof:* `scripts/rls/membership.sql` output in `04-build.md`; **control that must fail:** the
  same block run once on `verify:pg` with `member_business` recreated as `using (true)` goes red.
  *Sev:* P0.
- [ ] **SEC-08 · B-01** Grants on `business_member` are `revoke all` (insert, update, delete,
  **truncate, references, trigger**) from `anon, authenticated`, then `grant select … to
  authenticated`; `sync_business_owner_member` is `security definer`, `set search_path = ''`,
  execute revoked from `public, anon, authenticated`.
  *Proof:* `has_table_privilege('authenticated','business_member','TRUNCATE')` false,
  `has_function_privilege('authenticated','public.sync_business_owner_member()','EXECUTE')` false,
  read back on `verify:pg`. *Sev:* P1.
- [ ] **SEC-09 · B-01** The trigger is the only writer of `business_member`; every write of
  `owner_user_id` (claim, Google callback, `app/google/actions.ts`, the billing replacement that
  sets it to null at `core/billing/index.ts:101`) moves or removes the owner row in the same
  statement, so the replaced login loses `/app` and PostgREST access on its next request.
  *Proof:* PgDb test: owner A → B → null; `isMember(A)` false after each step; e2e: the replaced
  login's next `/app` load has no business. *Sev:* P0 (a former owner keeps access).
- [ ] **SEC-10 · B-01 (F-017)** `channel.meta` (Google `refreshToken`/`accessToken`, stored by
  `api/google/callback/route.ts:118`) is **not** readable through PostgREST with a member's JWT:
  either the recreated channel policy is paired with a column grant that excludes `meta`, or the
  tokens move out of `meta` into a table with no policy. `lib/reads.ts` selects named columns.
  *Proof:* in the SEC-07 block, as login 1: `select meta from channel` raises (or returns no token
  key); control: the service role reads it. *Sev:* P1.
- [ ] **SEC-11 · B-01** `linkBusinessesByEmail` links only rows with `owner_user_id is null` whose
  `lower(owner_email)` equals the **verified** JWT email of the session; it never takes an address
  from a form or the mock cookie on real data, and never relinks a business owned by another login.
  *Proof:* db test: a business with `ownerUserId = login 2` and `owner_email = login 1's address`
  stays login 2's (control); an unowned one with that address links. *Sev:* P0 if an owned
  business can be relinked.
- [ ] **SEC-12 · B-02** The archive (`?voor=` cursor) and `/r/[id]`: the cursor is decoded with a
  strict parser (malformed → first page, no 500) and the query is bound to the active business id
  in SQL; `reportVisible` gets its business ids only from `listMyBusinesses(session)`.
  *Proof:* archive test with a cursor built from another business's run → that business's rows
  never appear; a forged cursor `'; select` → first page. *Sev:* P1.
- [ ] **SEC-13 · B-01** Id-addressed pages and actions (`/app/fouten/[id]`,
  `/app/vermeldingen/[id]`, `markFixed`, `dispute`, `approveChannelDiff`, `declineChannelDiff`)
  keep resolving the id **within** the active business (`ownFinding`/`ownChannel`); another
  login's finding or channel id → `/app`, nothing changed.
  *Proof:* e2e with the control business's finding id on each. *Sev:* P0.

## B. Session at the edge and its lifetime

- [ ] **SEC-14 · A-01** Every auth cookie the app writes — `sb-<ref>-auth-token`, its chunks
  `.0`/`.1`, `sb-<ref>-auth-token-code-verifier`, `vidalo_mock_session`, `vidalo_business` —
  carries HttpOnly, SameSite=Lax, Path=/, Max-Age ≤ 90 d, and Secure when `PUBLIC_BASE_URL` is
  https, in middleware **and** in route handlers and server actions (`lib/supabase.ts` `setAll`).
  *Proof:* auth spec over every `set-cookie`; workerd build; read back over https on staging by the
  delivery-lead; control: `http://localhost` → no Secure. *Sev:* P1.
- [ ] **SEC-15 · A-01 (F-018)** A response that carries a refreshed `sb-` `Set-Cookie` is never
  stored by any cache: middleware and `setAll` apply the headers `@supabase/ssr` passes as
  `setAll`'s second argument and set `Cache-Control: private, no-store` on that response,
  including static marketing pages (`/`, `/vak/[slug]`) that the matcher covers.
  *Proof:* on the workerd build and on staging: client A with an expired access token loads `/`,
  then client B (no cookies) loads `/` → B receives no `Set-Cookie` and A's response has
  `Cache-Control: private, no-store`; `cf-cache-status` is not `HIT` for A's response. *Sev:*
  **P0 if a cached Set-Cookie is observed**; else P1.
- [ ] **SEC-16 · A-01** One refresh per expiry, no refresh-token reuse: the fake GoTrue with reuse
  detection sees exactly one refresh per expiry per browser across `/app`, `/app/voortgang`,
  `/app/account`, `/en/app` (OpenNext's second pass on the rewrite writes nothing and calls
  nothing).
  *Proof:* AC-3(b) spec red before the change, green after; refresh-call count from the fake
  GoTrue per expiry = 1. *Sev:* P1.
- [ ] **SEC-17 · A-01** The middleware imports only `shared/gate` and `lib/auth-cookies.ts`: no
  database, no service key, no `VIDALO_AUTH_SECRET`.
  *Proof:* grep the built middleware chunk in `.open-next` for `postgres`, `SERVICE_ROLE`,
  `VIDALO_AUTH_SECRET`, `sb_secret_` → none. *Sev:* P0 if a secret is in an edge bundle served to
  the client; else P2.
- [ ] **SEC-18 · A-01, A-02** A forged `sb-` cookie (garbage, a JWT signed by another key, an
  expired JWT with a random refresh token) yields "signed out", no session `Set-Cookie`, and at
  most one GoTrue call per request. Record whether Supabase applies its per-IP auth limits to our
  Worker's egress (a flood of forged refreshes or confirm POSTs could then block everyone's
  refresh); if it does, add a per-IP cap before the GoTrue call.
  *Proof:* fake-GoTrue call counter; one line in `04-build.md` on Supabase's server-side limits.
  *Sev:* P2.
- [ ] **SEC-19 · A-02** `getSession` trusts only verified claims: `auth.getClaims()` (signature
  checked), never `auth.getSession()`'s cookie decode; `userId`, `email`, `sessionId` all come
  from the verified claims.
  *Proof:* auth spec with a token signed by a wrong key and with `alg: none` → `/inloggen`.
  *Sev:* P0.
- [ ] **SEC-20 · A-02** `sessionVerdict` is enforced on **every** surface that reads the session —
  pages, server actions and route handlers (export, billing portal, domain verify, sign-out) —
  because they all go through `getSession()`; missing row, ended, idle > 30 d, older than 90 d
  all fail closed; `touchSignIn` never moves `signed_in_at`.
  *Proof:* unit table with a fake clock (29 d 23 h / 30 d 1 min; 89 d / 90 d 1 min); an ended
  row calling the export → 401 and a server action → `/inloggen?fout=verlopen`; control: an open
  row passes. *Sev:* P0 if an ended session reaches owner data; else P1.
- [ ] **SEC-21 · A-02** `recordSignIn` runs only after `verifyOtp` / `exchangeCodeForSession`
  succeeded; its upsert never clears `ended_at` and never moves an existing row's
  `signed_in_at`; no IP and no user-agent string are stored (families only).
  *Proof:* db test on MemDb and PgDb: record, end, record the same id → still ended; control: a
  new id → open. Migration and `recordSignIn` read for IP/UA columns. *Sev:* P1.
- [ ] **SEC-22 · A-02** Sign-out scopes: "Uitloggen" calls `signOut({scope:"local"})` and ends
  this row only (the other browser keeps `/app`); "Overal uitloggen" calls `scope:"global"` (the
  fake GoTrue sees it), ends every open row, and the other browser's next load lands on
  `/inloggen` while its access token is still valid. Today's scope-less `signOut()` in
  `auth/uitloggen/route.ts` and `deleteMyData` is gone.
  *Proof:* AC-3 (d)(e) spec; control: B calling PostgREST directly with its access token still
  reads until expiry, recorded as F-004 (accepted). *Sev:* P1.
- [ ] **SEC-23 · A-02 or A-06 (F-022)** A refresh token whose app session is idle > 30 d or
  older than 90 d is also revoked at Supabase (not only refused by our app): the cron ends such
  `auth_session` rows and deletes the matching `auth.sessions` row, or the Pro time-box is set.
  *Proof:* worker test on PgDb with an `auth` shim: a row idle 31 d → ended and its
  `auth.sessions` row gone; control: a row idle 29 d untouched. *Sev:* P2.
- [ ] **SEC-24 · A-02** `vidalo_mock_session` (now carrying `sid`/`signedInAt`) is ignored
  whenever Supabase is configured, and in a production build without `VIDALO_MOCK=1`
  (`env.allowMockAuth`); freshness never reads `signedInAt` from that cookie, only from the
  `auth_session` row.
  *Proof:* production build with Supabase env and a forged mock cookie → `/inloggen`; mock mode:
  a cookie claiming `signedInAt = now` over a row signed in 20 min ago → not fresh. *Sev:* P0
  (anyone can write that cookie).

## C. Sign-in link: scanner-safe, CSRF, token handling

- [ ] **SEC-25 · A-02** `GET /auth/confirm` uses nothing up and leaks nothing: no GoTrue call, no
  `sb-` `Set-Cookie`, no database call; headers `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag`/meta `noindex`; no third-party resource, **no
  GA4 or Meta pixel even with full consent**, no chat widget (`ask.js`).
  *Proof:* route test, twice, fake-GoTrue counter 0; HTML read with the consent cookie set to all
  categories → no `googletagmanager`, `facebook`, `connect.facebook.net`. *Sev:* P1.
- [ ] **SEC-26 · A-02** The confirm POST is a server action: Next's Origin check refuses a foreign
  `Origin` before `verifyOtp`; `next.config.ts` adds no `serverActions.allowedOrigins` beyond our
  own hosts. Login CSRF through our own page (a victim tricked into pressing "Inloggen" on an
  attacker's link) stays possible by design; so `/app` and `/app/google` show the signed-in
  address next to "Koppel Google", where a victim would otherwise attach their Google token to the
  attacker's account.
  *Proof:* POST with `Origin: https://evil.example` → refused, fake GoTrue saw no verify; page
  read for the address line. *Sev:* P1 (CSRF); P2 (address line).
- [ ] **SEC-27 · A-02** `type` is allow-listed to `email`, `magiclink`, `signup`, `email_change`
  (today's list also has `recovery` and `invite`); `token_hash` and `code` are shape-checked
  (charset, length) before any GoTrue call; a malformed value → `/inloggen?fout=link` with no
  outbound call.
  *Proof:* action test with `type=recovery` and a 10 KB `token_hash` → no GoTrue call. *Sev:* P2.
- [ ] **SEC-28 · A-02** The token is never logged and never forwarded: no log line carries the
  query string or form; the redirect after the POST is `safeNext(next)` with no `token_hash`/`code`;
  `/auth/callback`'s 303 keeps the query only towards `/auth/confirm` on our own host.
  *Proof:* run the auth spec, grep the captured server output for the seeded token → none;
  `Location` headers read. *Sev:* P1.
- [ ] **SEC-29 · A-03 (F-023)** `safeNext` refuses every case of AC-4(c) and the architecture's
  extra cases **and** checks the normalised result: after `new URL(decoded, base)`, a
  `pathname` starting with `//` or `/\` is refused. As written, `/.//evil.example`,
  `/app/..//evil.example`, `/%2e%2e//evil.example` and `/a/../%09/evil` pass every pre-check and
  return `//evil.example` (checked with Node's `URL` on 11 Nov 2026); `chooseBusiness` redirects
  to it relatively, which is off-site.
  *Proof:* `safe-next.test.ts` with those four plus `/%0d%0aSet-Cookie:x` → `"/app"`; red on the
  algorithm as written. *Sev:* P1.
- [ ] **SEC-30 · A-03, B-01** Every `Location` the app answers is relative-and-not-`//` or on
  `PUBLIC_BASE_URL`'s host, for each bad `next` sent to `/inloggen`, the confirm POST,
  `/auth/callback`, the link-business button, `chooseBusiness` and `requireFreshSignIn`.
  *Proof:* the A-03 route table extended with `chooseBusiness` (B-01's e2e) and the SEC-29 inputs.
  *Sev:* P1.

## D. Link throttle and enumeration

- [ ] **SEC-31 · A-03** Throttle keys are HMAC-SHA256 under `VIDALO_AUTH_SECRET` of the
  **normalised** address (trim + lowercase, the same string Supabase receives) and of
  `cf-connecting-ip` only: with Supabase configured, `x-forwarded-for` is never used (today's
  `clientIp`, `scan-limit.ts:17`, falls back to it, and it is client-set off Cloudflare); a
  missing header uses one shared `ip:unknown` key and logs that. No address, IP or hash in any
  log.
  *Proof:* `auth-throttle.test.ts`: `A@X.nl` and `a@x.nl` count together; a request with
  `cf-connecting-ip: 1.2.3.4` and `x-forwarded-for: 9.9.9.9` keys on 1.2.3.4; keys are 64-hex
  and differ under another secret. *Sev:* P1.
- [ ] **SEC-32 · A-03** Order is format → Turnstile → throttle → Supabase; over either limit (6th
  per address, 21st per IP in a rolling hour) → `fout=wacht` and the Supabase client is not
  called; a database error refuses (no mail without a count); the count is global (two Db handles
  on one PgDb see each other's rows).
  *Proof:* spy on `signInWithOtp` = 0 calls when over; after 61 min under again (fake clock);
  control: the 5th goes out. *Sev:* P1.
- [ ] **SEC-33 · A-03** No enumeration: for an address with a business, with only an account,
  and unknown, the action's response and the rendered `/inloggen?sent=1` are byte-identical, and
  the median response time of 50 runs each is recorded (fake GoTrue, plus a note on Supabase:
  `shouldCreateUser` stays default, so every address gets a user and a 60-s resend limit, which
  says nothing about existence).
  *Proof:* AC-4(a) test; timings in `04-build.md`. *Sev:* P1 for a byte difference; P2 for a
  timing gap > 50 ms.
- [ ] **SEC-34 · A-03** Sign-in error logging carries `status` and `code` only: today's
  `console.error("sign-in link refused", …, error.message)` (`inloggen/actions.ts:41`) can echo
  the address (GoTrue's "Email address "…" is invalid").
  *Proof:* grep of the changed file; test with an invalid address on the fake GoTrue → log line
  without it. *Sev:* P2.

## E. Origin checks on route handlers

- [ ] **SEC-35 · A-03** `refuseCrossSite` runs first in `POST /auth/uitloggen`,
  `POST /api/billing/portal`, `POST /api/domain/verify` (an owner write today without it) and any
  new owner-area route handler. `isOwnHost` is the exact canonical set (`vidalo.ai`,
  `www.vidalo.ai`, `vidalo.io`, `www.vidalo.io`, the host of `PUBLIC_BASE_URL`, the staging and
  preview `workers.dev` hosts), **not** "ends with vidalo.io": facts hosts serve owner-controlled
  pages.
  *Proof:* `same-origin.test.ts` refuses `Origin: null`, `https://x-feiten.vidalo.io`,
  `https://feiten.klant.nl`, `https://vidalo.ai.evil.example`, `https://evilvidalo.ai`,
  `http://vidalo.ai`, absent Origin with `Sec-Fetch-Site: cross-site` or none; accepts the own
  host and absent Origin with `same-origin`. Route tests: a foreign POST to `/auth/uitloggen`
  leaves the session usable; to the portal creates no Stripe session (spy). *Sev:* P1.
- [ ] **SEC-36 · A-04** The export (a GET) answers `Content-Type: application/json`,
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`
  and no `Access-Control-Allow-*` header, so a cross-site page can trigger a download to the
  owner's own disk but read nothing.
  *Proof:* header read in the route test. *Sev:* P2.

## F. Fresh sign-in for the irreversible

- [ ] **SEC-37 · A-03, A-05** `isFreshSignIn` reads `auth_session.signed_in_at` for the
  `session_id` of the verified claims — never the JWT `iat`, a refreshed token, or a cookie — and
  is checked on the GET of `/app/account/verwijderen` **and** again on the `deleteMyData` and
  `changeEmail` POSTs. A token refresh does not make a session fresh.
  *Proof:* fake clock 14:59 / 15:01; auth spec: sign in, wait past 15 min with refreshes (5-s
  tokens), POST delete → `/inloggen?opnieuw=1`; control: a new sign-in passes and returns to the
  same step. *Sev:* P1.
- [ ] **SEC-38 · A-03, A-07** Address change: Supabase "Secure email change" is on (D1 item 4),
  read back on the dashboard by the delivery-lead; the "bezet" check refuses any address that is
  `owner_email` of a business outside `listMyBusinesses(session)` (not only the newest one);
  owner addresses follow only after confirmation (the JWT email changes).
  *Proof:* action test with two businesses on another login holding the address; D1 read-back
  line in `05-verification.md`. *Sev:* P1.

## G. Export

- [ ] **SEC-39 · A-04** `exportChannel` keeps only `CHANNEL_META_EXPORT_KEYS`; the token-match
  test seeds `rt-<random>`, `at-<random>` and an unknown `apiSecret: s-<random>` and fails if any
  appears anywhere in the streamed body **or** in `exportMyData`; the events mapper
  (`ownAddressesOnly`) runs on every page of 500, with another person's address seeded on
  page 2.
  *Proof:* `export-secrets.test.ts` red on today's code, green after; control: `pendingDiff` is
  present. *Sev:* P0 if a token appears in a file the owner downloads (a live Google
  `business.manage` credential); else P1.
- [ ] **SEC-40 · A-04** The stream is bound to one business: run ids for `listSamplesForRuns` come
  only from that business's runs read inside the stream; event paging is scoped by `business_id`
  in SQL; the Db handle is passed in once; no request value reaches a query after the membership
  check.
  *Proof:* PgDb test with interleaved runs of two businesses → the export holds only its own
  sample ids. *Sev:* P0 if another business's rows appear.
- [ ] **SEC-41 · A-04** `account.exported` is logged on the business with no address and no
  token.
  *Proof:* key-set assertion. *Sev:* P2.

## H. Delete, purge, retention

- [ ] **SEC-42 · A-05** Guards: `purgeAllowed` and the SQL in `Db.purgeBusiness` agree for every
  combination of plan × status × `cancel_at` × `delete_at` vs now (exhaustive table on PgDb); a
  running Monthly (`plan = monitor`, status `trial`/`active`/`paused`) is never deleted by
  `no_subscription`; `due` refuses before the date and for any status but `scanned`/`churned`;
  CHECK `business_delete_only_when_ending` refuses a date on an active business without
  `cancel_at`. Every test has a control business that must survive.
  *Proof:* `db-account.test.ts` and `purge.test.ts`. *Sev:* **P0** if a paying business can be
  purged.
- [ ] **SEC-43 · A-05, A-06** The trigger `business_retention` is `security definer`,
  `search_path = ''`, execute revoked; a Stripe-webhook status change that undoes a cancel clears
  `delete_at` (driven through `core/billing` on PgDb, not only by SQL); after the backfill, no
  churned row lacks `delete_at`.
  *Proof:* PgDb test through `handleStripeEvent`; `select count(*) from business where status =
  'churned' and delete_at is null` = 0 on `verify:pg` after 0019. *Sev:* P1.
- [ ] **SEC-44 · A-05 (F-021)** The purge confirms at Stripe that nothing bills before it deletes
  a business with a `stripe_customer_id`: no subscription of that customer in a status other
  than `canceled` / `incomplete_expired`; otherwise outcome `guard` with reason `stripe_live`,
  logged and counted with the overdue line. Today the database can say `churned` while Stripe
  still bills (`cron.ts:126-133` churns `paused` after 60 days and `cron.ts:256-258` after a
  lost webhook, neither asks Stripe; a `monitor_addon` checkout can complete after a Scan owner's
  "now" delete).
  *Proof:* `purge.test.ts` with a fake Stripe returning an `active` subscription → nothing
  deleted, no Cloudflare/Google call; control: `canceled` → purged. *Sev:* **P0 if a business is
  purged while a live subscription bills**; else P1.
- [ ] **SEC-45 · A-05, A-06** Idempotence and order: a second purge returns `not_found`/`guard`
  with no second mail and no error; a Cloudflare failure throws before the delete and nothing is
  deleted; the job's attempts ceiling retires the row (no endless reclaim, standing list); a
  retired `purge` job logs `account.delete_failed { businessId }` and is part of the daily
  overdue count (F-010).
  *Proof:* `purge.test.ts` with fake deps; worker test with a Cloudflare fake failing 6 times.
  *Sev:* P1.
- [ ] **SEC-46 · A-05, A-06 (F-010)** Dry run: `VIDALO_PURGE` is read in the worker at job time,
  armed only by exactly `"1"`; unset, a `due` job logs `retention.would_purge { businessId }` and
  deletes nothing, calls no Cloudflare, Google or Supabase Admin. An owner's own "now" deletion
  that fell back to a job is **not** held by the dry run (the owner was told it is under way).
  *Proof:* worker test with the flag unset, `"true"`, `"1"`; control: the owner-fallback job
  deletes with the flag unset. *Sev:* P1.
- [ ] **SEC-47 · A-05 (F-019)** The purge removes a custom facts host only when this business
  holds it **verified** (`factsHostVerifiedAt` set) and no other business holds the same host
  verified; otherwise it skips the Cloudflare call and logs `purge.host_skipped`. Today
  `api/domain/verify/route.ts:44` stores any typed host unverified for any verified owner.
  *Proof:* `purge.test.ts`: business X with unverified `feiten.klant.nl`, business Y holding it
  verified → purging X makes no `deleteCustomHostname` call and Y's host stays; control: X
  verified alone → called once. *Sev:* P1.
- [ ] **SEC-48 · A-05** `deleteCustomHostname` refuses our own names and non-hostnames before any
  API call (the same guard `ensureWorkerRoute` has, `host.ts:206`): `vidalo.io`,
  `www.vidalo.io`, `x-feiten.vidalo.io`, `*`, `a/b` throw; only the exact route pattern
  `${host}/*` is deleted.
  *Proof:* unit test with a fetch spy → 0 calls for each. *Sev:* P1.
- [ ] **SEC-49 · A-04, A-06** Google revoke posts the token in the form body to the fixed
  `https://oauth2.googleapis.com/revoke` (never in a URL), with a timeout; a failure is logged
  without the token or Google's response body. The `google_disconnect` job re-reads the business
  and disconnects only when the status is still `churned` (or the reason is `owner`/`purge`).
  *Proof:* fake fetch asserts URL and body; worker test: churn, then a resubscribe before the job
  runs → the channel stays; control: still churned → removed. *Sev:* P1.
- [ ] **SEC-50 · A-05** The login is deleted only when `listMemberBusinesses(userId)` is empty
  after the business delete; the user id is a uuid from our database (regex-checked) placed in
  `/auth/v1/admin/users/{id}`; afterwards every browser of that login fails closed (no row). Two
  purges of one login's two businesses at once may leave the login: that case logs
  `account.login_kept` (no id) so support can see it.
  *Proof:* `purge.test.ts` (two businesses, one login: first keeps, second deletes); auth spec:
  browser B after A's delete → `/inloggen`. *Sev:* P1.
- [ ] **SEC-51 · A-05, D1** The Supabase admin key in `vidalo-worker` is a Worker secret only
  (not a `vars` entry in `wrangler.jsonc`, not `.env` committed), preferably a dedicated
  `sb_secret_…` key named for the worker so it is revocable alone; it is used only by
  `deleteLogin`; its error path logs the status code only. (Option for the architect: delete the
  user by SQL on the worker's existing `DATABASE_URL` and add no key.)
  *Proof:* `wrangler secret list` read back; grep of the worker bundle and `git log -p` for
  `sb_secret_`, `service_role` JWTs → none. *Sev:* P0 if the key reaches a bundle, log or the
  repo; else P2.
- [ ] **SEC-52 · A-05** `deleteMyData` order is `requireOwnerOf(form.business)` →
  `requireFreshSignIn` → `confirm === "ja"` → `deletionPlan`; `cancelSubscription` acts on that
  business's own subscription id; `at` comes from Stripe's answer, never the form; after a "now"
  purge the browser's `sb-`, mock and `vidalo_business` cookies are cleared.
  *Proof:* A-05 e2e (hand-edited `business` → `/app`, nothing changed; missing `confirm` → nothing
  scheduled); response headers read. *Sev:* P0 for the first; P1 for the rest.
- [ ] **SEC-53 · A-06** Retention cron: reminders only for reason `retention`, claimed once
  (`claimDeletionReminder`); one unrun `purge` job per business; payloads exactly
  `{ businessId, guard }`, `{ businessId, reason }`, `{ template, businessId }` (no address,
  token or host).
  *Proof:* `retention.test.ts` with the A-06 controls B, C, D; payload key-set assertion.
  *Sev:* P1.
- [ ] **SEC-54 · A-05** A job running while its business is purged (publish, sitecheck, scan,
  sync) neither recreates rows nor re-adds a Cloudflare hostname or route for the gone business.
  *Proof:* worker test: claim a `publish` job, purge, run it → no `ensureCustomHostname` call, no
  business row. *Sev:* P2.

## I. Secrets and logging

- [ ] **SEC-55 · A-03, A-05, D1** New secrets and where they live: `VIDALO_AUTH_SECRET` (32 random
  bytes, hex) as a secret on `vidalo-web` production and staging only; `SUPABASE_URL` and the
  admin key on `vidalo-worker`. `env.authSecret` throws when Supabase is configured and the secret
  is missing (`"vidalo-local"` only without Supabase). Neither is `NEXT_PUBLIC_*`.
  *Proof:* unit test of `env.authSecret`; build as CI ships it (`DATABASE_URL=` empty) with
  canary values, then grep `.next/static`, `.open-next/assets` and the worker bundle for the
  canaries → none; control: a canary planted in a client component is found. `docs/secrets-and-keys.md`
  lists both. *Sev:* P0 if found in a client bundle; else P1.
- [ ] **SEC-56 · all lane A tickets** Logging without personal data, and the S11 events exist:
  `auth.link_throttled { which }`, `auth.cross_site_refused { route }`,
  `auth.session_ended { reason }`, `account.exported`, `account.deleted { guard, loginsDeleted }`,
  `account.deleted_mail_failed {}`, `google.revoke_failed { status }`,
  `google.disconnected { reason }`, `retention.*` (counts and business ids). None carries an
  address, IP, hash, token, `session_id` or user id.
  *Proof:* key-set assertions per event; grep of new `log.`/`console.` calls with each hit
  accounted for. *Sev:* P2 (P1 for a token).
- [ ] **SEC-57 · A-02, A-03** Unauthenticated entry points and the database: `GET /auth/confirm`
  opens no connection; `sendMagicLink` opens one only after Turnstile; `confirmSignInAction` only
  after a successful verify; middleware never.
  *Proof:* MemDb call counter in route tests for each path with a failing Turnstile / bad token.
  *Sev:* P2.
- [ ] **SEC-58 · all** No literal control, bidi or zero-width character in any new file (the
  `safeNext` and throttle fixtures use `\u`/`%` escapes).
  *Proof:* the standing `grep -rP` over the diff. *Sev:* P2.

## J. The money path

- [ ] **SEC-59 · A-05, A-06** The abonnement actions (cancel, undo, pause, resume) and the
  billing portal act on the Stripe ids of the business `requireOwnerOf` returned; nothing in this
  feature lets a client write `plan`, `status`, `cancel_at`, `delete_at` or an amount; the
  Stripe webhook handler is unchanged apart from what the trigger does on its writes.
  *Proof:* `git diff --stat` over `core/billing`, `api/stripe/webhook`, `api/checkout` read and
  explained in `04-build.md`; the A-06 sandbox run (D2). *Sev:* P0 if a client-written value
  changes what is billed; else P1.

## Standing items that do not apply here, and why

- Capacity under lock, amounts in minor units, rates snapshotted: no scarce capacity and no new
  price in this feature; SEC-59 proves the money path is untouched.
- Webhook signature scope: no new webhook; the existing Stripe handler is unchanged (SEC-59).
- SSRF guard: the only new outbound URLs are fixed (`oauth2.googleapis.com/revoke`,
  `api.cloudflare.com`, `<SUPABASE_URL>/auth/v1/admin/users/{uuid}`); none comes from a user.
- AI surfaces: none added.
- Static hosting and DNS: no new zone or redirect; SEC-29/30 cover open redirects in the app.
