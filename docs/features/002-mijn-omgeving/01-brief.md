# Brief — 002 Mijn omgeving: owner area, sign-in, account and subscription

*analyst · 2026-11-11 · status: draft, waiting for Julian's approval*

## The one sentence
An owner signs in safely and stays signed in, finds every report Vidalo made for their
business in one place, and can stop, pause, download or delete everything themselves, on
every plan and for every business on their login, with nothing left behind that the
privacy statement says is gone.

## Why now
Most of what Julian asked for already exists: `/app` with the facts of the last check,
`/app/voortgang` with counts and dots over time, `/app/account` with export and delete,
`/app/abonnement` with cancel, undo, pause and resume. What is missing is the part that only
shows up with real customers on a real domain: the sign-in session is never refreshed where
it can be saved, the export file carries a live Google key, a Vidalo Scan customer can never
delete their own data, the privacy statement promises deletions nothing performs, an
owner's own first report disappears after 30 days, and a second business on the same login
is invisible and cannot be cancelled. None of it has been run against Stripe or Supabase end
to end (go-live A4, B5, C2 are "written", not verified). The site moved to vidalo.ai on
6 Nov and the first paying customers come next; this is the cycle that makes "degelijk en
veilig" and "volwaardig opzeggen" true rather than drafted. The cycle finishes and hardens
what exists; it adds one new page (the report archive) and one small control (a business
switcher).

## Who it is for
| Who | What they are trying to do | What they do today instead |
|---|---|---|
| Owner on Vidalo Monthly (€49/month) | See how AI answers changed, find any old report, pay, pause or stop without asking anyone | Uses `/app`, `/app/voortgang`, `/app/abonnement`; old free report is gone after 30 days; may be signed out without warning (inferred, see gap S1) |
| Owner on Vidalo Scan (€149 once) | See the result and the fixes, later delete everything | Cannot delete: "Zeg eerst je abonnement op" although there is no subscription (gap A2) |
| Owner with two businesses on one e-mail address | Manage and cancel each | Sees only the newest; the older one is billed and unreachable in the app (gap O3) |
| Former customer (churned) | Read old reports, download, delete; trust that data goes when promised | Can sign in and delete; automatic deletion after 90 + 30 days does not exist (gap A4) |
| Julian / support@ | Not handle cancellations, deletions and "I can't sign in" by hand | Would today, for each of the cases above |

## What is built today, and what is missing

Read in code on 11 Nov 2026 (branch `claude/001-business-profiles`). Anything marked
**inferred** was not observed running; it follows from reading the code and the library
defaults and must be confirmed by a test before it is treated as fact.

### 1. Owner area: statistics and reports
**Exists.** Navigation in `apps/web/app/app/layout.tsx` (Overzicht, Voortgang, Gegevens,
Domein, Google, Abonnement, Account, Uitloggen) with the yearly "Klopt dit nog?" banner.
`/app` (`app/app/page.tsx`, `lib/owner-data.ts`, `lib/owner-log.ts`): facts of the last
check, "Wat nu", one dot per AI system, open errors per question, a log with proof links,
rail with next check and plan. `/app/voortgang` (`packages/core/src/progress.ts`,
`lib/core.ts` `PROGRESS_MAX_SCANS = 30`): filters by period, AI system and bundle, counts
and dots, a row per check linking `/r/[id]`. `/app/fouten/[id]`, `/app/vermeldingen/[id]`,
`/app/gegevens` (+ `/versies`), `/app/domein`, `/app/google`. `/app/account` shows the last
finished report and the last 6 checks (no links). The report `/r/[id]` has "Print of bewaar
als PDF". Invoices: Stripe portal only (`/api/billing/portal`).

**Missing or weak.**
- **O1. No report archive.** The full list of reports exists only implicitly as rows in
  `/app/voortgang` (max 30, full checks only); `/app/account` lists 6 checks without links.
- **O2. The owner's own free report expires for the owner too.** `app/r/[id]/page.tsx`
  returns not-found for any `kind === "free"` report older than `FREE_REPORT_DAYS` (30),
  without checking who is looking; `/app/voortgang` and `/inloggen` ("Je controles") link
  to those reports. The privacy text says a customer's data follows the paid-plan terms.
- **O3. One business per login.** `getOwnedBusiness` → `PgDb.getBusinessByOwner`
  (`packages/core/src/db/pg.ts:360`) returns the newest business for the user id or
  address, `limit 1`. A second business bought with the same address is invisible in
  `/app`, so it cannot be paused, cancelled, exported or deleted in the app.
- **O4. Scale is untested.** Pages and the export read whole histories per request
  (`exportMyData` loops every scan run and its samples; `listEvents(…, 1000)` in several
  places). Nothing measures a business with years of monthly checks.

**What the feature adds.** A "Rapporten" archive with every finished check; the owner's
reports never expire for the signed-in owner; a business switcher for a login with more
than one business; a measured bound on owner-page and export cost. No new statistics:
`/app/voortgang` already answers "is it getting better" in counts (see suggestions).

### 2. Sign-in
**Exists.** Supabase magic link (`app/inloggen/actions.ts` `sendMagicLink`), Turnstile
before any mail, Supabase's send limit surfaced as "wacht" (`fout=wacht`), same "sent" page
whether or not the address has an account (no enumeration of businesses). The link lands on
`/auth/confirm` (`lib/auth-confirm.ts`, `token_hash` + `type`, works in any browser, one
hour, single use per the template doc); `/auth/callback` kept for old links. `safeNext`
refuses `//host` and `/\host`; the redirect is prefixed with `env.baseUrl`. Server actions
get Next's built-in Origin check. Ownership is proven separately (Google or phone code,
`core/shared/ownership.ts`, `requireVerifiedOwner`); cancel deliberately needs only a
signed-in owner. RLS: select-only policies on `owner_user_id = auth.uid()` (migration
0001); writes go through the service role after `requireOwner`.

**Missing or weak.**
- **S1. The session is never refreshed where it can be saved.** `lib/supabase.ts` swallows
  the cookie write in server components with the comment "cookies are refreshed by
  middleware instead", but `apps/web/middleware.ts` does no Supabase refresh at all.
  **Inferred consequence:** once the one-hour access token expires, each page render
  refreshes with the stored refresh token and cannot save the new one; the next render
  reuses the old refresh token, which Supabase's reuse detection treats as compromised and
  revokes. Expected symptom: owners signed out about an hour after signing in. Must be
  reproduced by a test before it is fixed.
- **S2. Cookie flags are library defaults.** No `cookieOptions` are passed;
  `@supabase/ssr` 0.12.7 defaults are `httpOnly: false`, `sameSite: "lax"`, no `secure`,
  `maxAge` 400 days. There is no browser Supabase client in the app (no
  `createBrowserClient`), so nothing needs script access to the auth cookie.
- **S3. No lifetime policy.** Nothing ends a session after inactivity or a maximum age.
  Supabase's time-box and inactivity timeout are paid-plan settings (**inferred**: the
  project's plan is not readable here; go-live D2 "paid plan" is blocked on Julian).
- **S4. Sign-out is "everywhere" by accident.** `supabase.auth.signOut()` is called without
  a scope (`app/auth/uitloggen/route.ts`, `deleteMyData`); auth-js 2.118 defaults to
  `scope: 'global'`, so signing out on a phone also signs out the laptop. There is no
  deliberate "sign out everywhere" and no list of recent sign-ins.
- **S5. The link is used up by a GET.** `/auth/confirm` calls `verifyOtp` on the GET
  request. **Inferred:** a mail security scanner that opens links (Outlook Safe Links and
  similar) consumes the single-use link before the owner clicks, who then sees
  "link verlopen".
- **S6. Rate limits are Supabase's alone.** No app-level limit per address or per IP on
  link requests; go-live A2 lists "auth rate limits" and custom SMTP as open.
- **S7. Route handlers have no Origin check.** `POST /auth/uitloggen` and
  `POST /api/billing/portal` accept a cross-site POST (server actions are protected by
  Next; route handlers are not). Low impact today (sign-out, opening a portal session),
  but it is the class to close.
- **S8. No re-authentication for the irreversible.** "Verwijder alles" and "E-mailadres
  wijzigen" need only a checkbox / a field on a session that may be 400 days old.
- **S9. vidalo.ai may not be an allowed redirect.** go-live A2 and `docs/auth-email`
  list Site URL `https://vidalo.io` and Redirect URLs `https://vidalo.io/**`; the site is
  vidalo.ai since 6 Nov. If `PUBLIC_BASE_URL` is vidalo.ai and vidalo.ai is not on the
  list, Supabase replaces the link target with the bare Site URL and the link breaks.
  **Unverified**: the Supabase dashboard is not readable from here.

**What "degelijk en veilig" means here, testably.** The owner stays signed in while they
use the site and is signed out after a stated idle time and maximum age; the auth cookie
cannot be read by script or sent over http; one sign-out ends this browser, a separate
"Overal uitloggen" ends all; the owner can see when and on what browser their account was
signed in; link requests are limited per address and per IP and say the same thing for
every address; no `next`/return value can send anyone off-site; a cross-site POST changes
nothing; a link opened by a scanner is not used up; deleting everything or changing the
address needs a sign-in from the last 15 minutes. **No passwords:** a password adds a
secret to store, reset and leak, and the reset would still be a mail link, so the mailbox
stays the root of trust either way. Every sign-in already passes through the owner's own
inbox, which is also why a separate "new sign-in" mail adds little; the visible sign-in list
covers it. A second factor (passkey) is a suggestion for later (Q1).

### 3. Account
**Exists.** `/app/account` (`app/app/account/page.tsx`, `actions.ts`, `app/app/actions.ts`):
login address, change address (`supabase.auth.updateUser`, owner address follows on next
visit in `lib/session.ts`), ownership status, language, the business as known, last report,
plan, mail preferences, "Je gegevens": JSON download (`GET /api/account/export` →
`core/shared/my-data.ts` `exportMyData`, other people's addresses stripped) and "Verwijder
alles" (`deleteMyData`: `Db.deleteBusiness` cascades every child row and unrun jobs, deletes
the Supabase user, signs out, logs `account.deleted` without id). Privacy text (copy.legal)
says: invoices 7 years at Stripe; after a subscription ends data is kept 90 days, one free
check, then deleted within 30 days; Google data "until you disconnect Google".

**Missing or weak.**
- **A1. The export contains live Google keys.** `exportMyData` includes
  `channels: db.listChannels(…)`; `mapChannel` (`pg.ts:191`) returns `meta` whole, and
  `/api/google/callback` stores `meta.refreshToken` and `meta.accessToken`
  (`business.manage` scope) there. A downloaded file is a credential.
- **A2. A Vidalo Scan customer can never delete.** `canDeleteMyData` allows only
  `scanned` and `churned`; a one-off `setup` checkout sets `trial` and nothing ever moves it
  on (only subscription events do, `core/billing/index.ts`). A Monthly owner must cancel and
  wait for the period end, then come back.
- **A3. Deletion leaves things behind.** The Cloudflare custom hostname and its Worker
  route stay (`publisher/host.ts` `deleteCustomHostname` exists and is never called outside
  a test); the Google token is deleted with the row but not revoked at Google; no
  confirmation mail.
- **A4. Retention is promised, not enforced.** `apps/worker/src/cron.ts`
  `lifecycleTransitions` enqueues the free re-check 90 days after churn and stops there;
  nothing deletes. Google tokens of a churned business stay. `SETUP_STATUS.md` (privacy
  row) records the same gap.
- **A5. No "disconnect Google".** The privacy text offers it; `/app/google` has no such
  control.
- **A6. Address change not observed for real** (go-live A4: mock only).

### 4. Subscription
**Exists, and largely right.** `core/billing/lifecycle.ts`, `app/app/abonnement/**`,
`docs/CANCEL-PAUSE.md`: cancel online two clicks from any `/app` page, one confirming
button, reason optional, no notice period, `cancel_at_period_end`, undo until the end
date, pause 1–3 months (`pause_collection`, invoices voided), resume early, a confirmation
mail for each, portal cancelling switched off so every cancel goes through this flow,
webhook echo (`syncOwnerChoices`), close two days after `cancel_at` if Stripe never says so,
`churned` → facts page 302 to the own website (`publisher/serve.ts`). Scan → Monthly upgrade
via `monitor_addon`. Invoices and payment method in the Stripe portal. Terms
(`copy.legal.terms`, "Looptijd, opzeggen en pauzeren") promise: cancel any time online
under Abonnement, no notice period, the paid month runs out, no refund of the running
month, confirmation mail, undo until the end date, also by mail to support@.

**Law, briefly (not legal advice; compliance verifies in phase 1).** For consumers,
art. 6:236 BW (black list, the "Wet van Dam", in force since 1 Dec 2011) requires that a
contract can be ended the way it was made (online made, online ended) and that a tacitly
renewed contract is monthly cancellable; the ACM enforces "online afsluiten is online
opzeggen". The EU withdrawal button (art. 6:230oa BW, from 19 June 2026) applies to consumer
contracts with a withdrawal right. Vidalo sells B2B only (checkout B2B confirmation), so
these do not bind directly; **inferred**: they may still colour how a court reads terms
against a small business. Vidalo's flow already meets the consumer standard, and its terms
promise more (no notice period, any month). Nothing in this brief changes the promise.

**Missing or weak.**
- **B1. Never run against Stripe.** go-live B5: no run against a sandbox subscription;
  `docs/CANCEL-PAUSE.md` "Not verified: the Stripe calls … the English pages in the
  browser".
- **B2. The end state is not explained to the owner.** After the end date `/app/abonnement`
  shows status "Opgezegd" but not what happens next (facts page redirects, reports readable,
  when data goes); the purge it would announce does not exist (A4).
- **B3. A second business's subscription cannot be cancelled in the app** (O3).
- **B4. Vidalo Scan owners see nothing to end, which is right, but no route to delete** (A2).

## Acceptance criteria
QA tests exactly these. "Mock mode" means `VIDALO_MOCK=1` (`pnpm dev`, `pnpm e2e:mock`).
"Owner" means a signed-in user whose login is linked to the business. Every page and mail
named below exists in Dutch and English (`/en/...`), with every new string in
`packages/core/src/copy/index.ts` and `en.ts` (typecheck enforces it), no score,
percentage or banned word (MESSAGING), and one primary button per view.

1. **AC-1: every report in one place, and the owner's reports do not expire for the
   owner.** Given an owner whose business has a free check from before paying (older than
   30 days), a baseline check, 3 monthly checks and 1 on-demand check, when they open the
   new "Rapporten" item in the owner navigation, then all 6 finished checks are listed
   newest first, each with its date, its kind in words, the dot colour and "n van m
   antwoorden klopten", and each links to its report; the free report opens for this
   owner, while the same link opened signed out (or by another login) still shows the
   not-found page, as today. Rechecks are not listed (as in `/app/voortgang`). A failed or
   running check shows its state without a link.
   *Checked by:* a browser test in mock mode (NL and EN) with a seeded history, and a unit
   test of the expiry rule for owner, other login and anonymous.

2. **AC-2: a login with more than one business can see, switch and manage each.** Given a
   login linked to two businesses (each bought with the same address), when the owner opens
   `/app`, then a business switcher shows both by name and place; choosing one makes every
   owner page, the export, the delete, the pause and the cancel act on that business only;
   the choice survives page loads. A login with one business sees no switcher. A business
   whose owner is someone else is never listed or reachable by changing a value in the
   request.
   *Checked by:* a browser test in mock mode with two seeded businesses on one login and a
   third business on another login (control: the third must never appear or be acted on,
   including by a hand-edited form value), and the RLS test pattern of `CLAUDE.md` on
   PgDb with the owner as the control that must see rows.

3. **AC-3: the session stays while used, ends when it should, and its cookie is safe.**
   Given a real Supabase sign-in (local or staging), then: (a) every auth cookie the app
   sets is `HttpOnly`, `Secure` on https, `SameSite=Lax`; (b) with the access-token
   lifetime shortened for the test, an owner who keeps loading `/app` pages across two
   expiries stays signed in and is never sent to `/inloggen`; (c) a session unused for 30
   days, or older than 90 days, sends the owner to `/inloggen` (values per Q2);
   (d) "Uitloggen" ends this browser only: a second browser signed in as the same owner
   still reaches `/app`; (e) "Overal uitloggen" on `/app/account` ends every session: the
   second browser lands on `/inloggen` on its next page load; (f) `/app/account` lists the
   last 10 sign-ins with date, time and browser and system family, newest first, and
   "Overal uitloggen" next to it.
   *Checked by:* a Playwright test against a Supabase instance with a short JWT expiry for
   (b), (d), (e); a header check for (a) on a production build over https; a unit test with
   a fake clock for (c); a browser check for (f). (b) is first run before the fix and must
   fail if gap S1 is real; the result is recorded in `04-build.md` either way.

4. **AC-4: requesting and using a link cannot be abused.** Given `/inloggen` (NL and EN),
   then: (a) the page after "Stuur inloglink" is byte-for-byte the same for an address with
   a business, an address with only an account, and an unknown address; (b) more than 5
   link requests for one address in an hour, or more than 20 from one IP in an hour, get
   the existing "wacht even" message and send no mail; (c) for every `next` value in
   `//evil.example`, `/\evil.example`, `/%2F%2Fevil.example`, `/%5Cevil.example`,
   `https://evil.example`, `javascript:alert(1)`, passed to `/inloggen`, `/auth/confirm`,
   `/auth/callback` and the link-business button, every `Location` the app answers with is
   on the site's own host; (d) a plain GET of the link from the mail (as a mail scanner
   does) signs nobody in and does not use the link up; the owner who opens it then signs in
   with one more click; (e) a POST with a foreign `Origin` to `/auth/uitloggen`,
   `/api/billing/portal` and any new owner-area route handler changes nothing and is
   refused; (f) a link requested on the production host (vidalo.ai) completes on that host
   and lands on `/app`.
   *Checked by:* unit tests for (a)–(c) and (e); a route test for (d) (GET then GET
   again: the second still works, nobody signed in after the first); (f) observed once by
   Julian with a real mail (an agent cannot send it), after D1.

5. **AC-5: download and delete work on every plan, and delete leaves nothing promised
   gone.** Given an owner of a business with a Google connection, a verified facts host,
   checks and findings, then: (a) the download from "Je gegevens" contains every data
   category the privacy statement names and no access or refresh token, no secret and no
   other person's e-mail address (a test fails if any value under `channels` or elsewhere
   matches a stored token); (b) "Verwijder alles" works for a Vidalo Scan owner (today
   refused) and for a churned or never-paid business at once; for a running Vidalo Monthly
   it cancels at period end and schedules the deletion for the end date, shown on
   `/app/account` and `/app/abonnement` with a way to call it off until then (per Q3);
   (c) deleting and changing the e-mail address need a sign-in from the last 15 minutes,
   otherwise the owner is asked to sign in again and returns to the same step; (d) after a
   deletion: the business and all its rows are gone, the login is gone, the facts page's
   hosts answer "not found" and the custom hostname and its route are removed from
   Cloudflare (in mock mode: the removal call is recorded), the Google token is revoked at
   Google and gone, unrun jobs are gone, a confirmation mail goes to the login address, and
   signing in again with that address shows no business; invoices stay at Stripe;
   (e) "Koppeling met Google verbreken" on `/app/google` revokes and deletes the token and
   marks the Google channel as not connected; ownership proof stays; (f) the privacy
   statement (NL and EN) says what (a)–(e) do, with a new `updated` date and
   `pnpm --filter @vidalo/core legal:lock`, in the same PR.
   *Checked by:* unit tests on MemDb and PgDb (with a control business that must survive
   every deletion), `packages/core/test/legal.test.ts`, and a browser run in mock mode for
   a Scan owner and a Monthly owner.

6. **AC-6: cancel, pause and the end of a subscription work against Stripe, and data goes
   when the privacy statement says.** Given a Stripe sandbox subscription on a
   Vidalo Monthly business, when the owner cancels, undoes, cancels again, then pauses and
   resumes another one, then each step shows on `/app/abonnement` and in the Stripe
   sandbox as the same state (`cancel_at_period_end`, `pause_collection`), each sends its
   confirmation mail, and the Stripe portal offers no cancel. When the period ends: status
   `churned`, the facts page redirects to the own website, no check, fix or sync runs, the
   Google token is deleted, and `/app/abonnement` says what stopped, that reports stay
   readable, and the date the data will be deleted. 90 days after the end the one free check
   runs; a reminder mail goes 14 days before deletion; at most 30 days after that check the
   business is deleted as in AC-5 (d), with invoices kept at Stripe. A business with a
   running subscription, a scheduled pause or an undone cancel is never deleted by this.
   *Checked by:* one recorded sandbox run (the event ids and screenshots in
   `05-verification.md`, D2), and worker unit tests with a fake clock for the end state,
   the reminder, the deletion and the controls that must survive.

7. **AC-7: owner pages and the export stay fast as history grows.** Given a business seeded
   with 36 monthly checks (10 questions × 5 AI systems × up to 10 answers each), 500
   findings and 2,000 events on PgDb, then `/app`, `/app/voortgang`, the report archive,
   `/app/account` and `/app/abonnement` each answer in under 1 second at the 95th percentile
   over 20 loads on a local production build, and each makes the same number of database
   round trips as with 3 checks; the download completes within the Worker's limits (no
   timeout, under 30 seconds) and returns the whole history.
   *Checked by:* a scripted run on `pnpm verify:pg`'s database with a query counter,
   timings recorded in `05-verification.md`.

8. **AC-8: the owner area is accessible.** Given the owner navigation (with the business
   switcher), `/app/rapporten` (or its final name), `/app/account` (sign-ins, "Overal
   uitloggen", Je gegevens, the delete confirmation), `/app/abonnement` with its cancel and
   pause pages, `/app/google` (disconnect) and `/inloggen` including the new one-click
   confirm page, then they meet WCAG 2.2 AA: every control is operable by keyboard alone
   with visible focus, the switcher and confirmations have accessible names, status changes
   after an action are announced (`aria-live`), the dot colour is never the only carrier of
   meaning, and an axe run on each page, NL and EN, in mock mode reports no serious or
   critical violations.
   *Checked by:* Playwright + axe-core on each page, and a keyboard-only pass by QA against
   `docs/process/checklists/a11y.md`.

## Suggested core functionality (Julian asked for suggestions)
In priority order. IN means this cycle (already in the criteria above); LATER means not now.

| # | Suggestion | When | Why |
|---|---|---|---|
| 1 | Session that survives use, safe cookie, idle and maximum lifetime, sign-out here or everywhere, recent sign-ins | IN (AC-3) | The likely silent sign-out (S1) makes every other owner feature feel broken |
| 2 | Delete and export that work for every plan and remove what the privacy statement says, export without keys, disconnect Google | IN (AC-5) | Two concrete defects (A1, A2) and promises in a published legal text |
| 3 | Retention that runs by itself after the end of a subscription | IN (AC-6) | The privacy statement already promises it; nothing performs it |
| 4 | Report archive, with the owner's own first report kept | IN (AC-1) | "Rapporten zichtbaar" was the first thing asked; the before-report is the owner's proof of progress |
| 5 | Business switcher for a login with more than one business | IN (AC-2) | Otherwise a paying business can be unreachable and uncancellable in the app |
| 6 | Link hardening: per-address and per-IP limits, scanner-safe link, Origin check on route handlers, re-sign-in for the irreversible | IN (AC-4, AC-5c) | Cheap, closes the known classes before customers arrive |
| 7 | Passkey as an optional second step | LATER | Magic link already proves the mailbox; re-sign-in plus the sign-in list cover the high-impact actions; revisit with the first support case or a customer asking (Q1) |
| 8 | Team access (an accountant, a colleague) by invitation | LATER | Needs a membership model, which the standing security checklist prefers over `owner_user_id`; worth one ADR, not this cycle |
| 9 | More locations under one account with a price | LATER | Pricing for 2–10 locations is undecided (go-live P4); the switcher in AC-2 is the foundation |
| 10 | "Wie haalde je feitenpagina op": visits of AI crawlers to the facts page, as counts per month | LATER | Real proof the facts page is read, and the first statistic that is ours rather than AI's; needs logging in the facts Worker and a privacy check |
| 11 | Monthly report as a PDF attachment and a CSV of findings | LATER | Print-to-PDF exists; no owner has asked |
| 12 | In-app invoice list instead of the Stripe portal | LATER | The portal already lists and downloads invoices with the right company details |

## Success metric
| Metric | Today | Target | How it is measured |
|---|---|---|---|
| Owners sent to `/inloggen` from an `/app` page within 24 h of a sign-in (unwanted sign-outs) | not measured (S1 suggests most) | under 5% of sign-ins | sign-in events joined to later redirects to `/inloggen` with `next=/app…`, from launch |
| Cancellations, pauses and deletions done in the app, not by mail to support@ | none yet | 95% or more of the first 30 | events `subscription.*` and `account.deleted` vs support@ threads tagged cancel/delete |
| Businesses past their stated deletion date still in the database | every churned business, eventually (no purge) | 0, every day | a daily query in the worker log (`retention.overdue`) |
| Vidalo Monthly owners who open the owner area at least once a month | not measured | 60% (directional; no baseline) | an `owner.visit` event, at most one per business per day, no personal data |
| Support mails about "ik kan niet inloggen" | not measured | at most 1 per 20 paying businesses per month | support@ threads tagged sign-in |

## Explicitly not in this cycle
- **Passwords, and "Inloggen met Google" as a sign-in method.** Google stays the ownership
  proof only.
- **A second factor / passkeys** (suggestion 7), **team members and roles** (8), **prices
  for more locations** (9), **facts-page crawler statistics** (10), **PDF/CSV exports** (11),
  **an in-app invoice list** (12).
- **New statistics or a redesign of `/app` and `/app/voortgang`.** Design G stays; only the
  new archive page, the switcher, the sign-in list and the end-of-subscription state are new
  surfaces.
- **Plan changes beyond today's Scan → Monthly**, refunds, coupons, annual billing.
- **A consumer withdrawal button** (art. 6:230oa BW): Vidalo sells B2B only.
- **Deleting free-check data of non-customers after 12 months** (also promised in the
  privacy text, also unenforced): a separate compliance fix, filed as a finding (D5), because
  it concerns people without an account.
- **A back-office for support** to delete or cancel on someone's behalf.
- **Saving this in the Control Room.** Julian's last sentence is a ship task for the
  delivery-lead at `/ship`: add the session, deletion and retention rows to the Control
  Room baseline and the Vidalo cell (see the memory note "Control Room: every step").

## Dependencies and open questions
Q1–Q7 change the work if answered differently; Julian decides them. From Q8 on they are
low-stakes; the assumed answer is used unless Julian says otherwise.

| # | Question | Blocks | Who answers | Assumed answer if silent |
|---|---|---|---|---|
| Q1 | A second factor (passkey) in this cycle? | AC-3 | Julian | No. Magic link + sign-in within 15 minutes for delete/address change + the visible sign-in list. Passkey later, optional, when an owner asks or support sees an account taken over |
| Q2 | How long does a session last? | AC-3 | Julian | Ends after 30 days without use and at most 90 days after the sign-in. If Supabase's own setting needs the paid plan, that plan is also what daily backups need (go-live D2); otherwise the app enforces it. The architect chooses how |
| Q3 | "Verwijder alles" while Vidalo Monthly runs | AC-5 | Julian | Allowed: it cancels at period end (no refund, as the terms say) and deletes on the end date, shown and revocable until then. Alternatives: stop at once without refund (harsher), or keep today's refusal (owner must come back) |
| Q4 | Two businesses on one login | AC-2 | Julian | A switcher, each business billed and managed on its own. Alternative: refuse a second business on an address that already owns one (simpler, but loses a sale and still leaves today's cases) |
| Q5 | One extra click on the sign-in link ("Inloggen" on the page the link opens) to make it scanner-safe | AC-4 | Julian | Yes. The cost is one click; the gain is that links work for owners behind Microsoft 365 and similar filters (**inferred** risk, see S5) |
| Q6 | Retention after the end: keep the published promise (90 days, one free check, deletion within 30 days after), with a reminder 14 days before | AC-6 | Julian | Yes, keep the promise as published; the reminder is new and is a service mail |
| Q7 | Invoices: is the Stripe portal enough? | — | Julian | Yes (suggestion 12 later) |
| Q8 | Does "Uitloggen" end only this browser? | AC-3 | analyst | Yes; "Overal uitloggen" is a separate control on `/app/account` (today every sign-out is global, S4) |
| Q9 | What the sign-in list shows and keeps | AC-3 | analyst | Date, time, browser and system family; no IP address shown or kept for it; the last 10, kept as long as the account |
| Q10 | Link limits | AC-4 | analyst | 5 per address per hour, 20 per IP per hour, on top of Supabase's 60 seconds per address |
| Q11 | Re-sign-in window | AC-5 | analyst | 15 minutes |
| Q12 | Does the archive list rechecks? | AC-1 | analyst | No; rechecks stay on the finding pages, as in `/app/voortgang` |
| Q13 | Confirmation mail after a deletion | AC-5 | analyst | Yes, to the login address, a service mail with no business data beyond the name |
| Q14 | Does churn delete the Google token at once, or at the deletion date? | AC-6 | analyst | At once: the contract has ended (standing compliance checklist, OAuth row) |
| D1 | Supabase dashboard: vidalo.ai in Site URL and Redirect URLs, custom SMTP through Resend (go-live A2) | AC-4 (f) | Julian, by hand | Done before verification; the architect writes the exact fields and values |
| D2 | A Stripe sandbox key usable for the recorded run (sandbox `acct_1UR4RAELCe3OOCe2` exists; this container cannot reach api.stripe.com) | AC-6 | Julian / delivery-lead | Run from Julian's Mac or a staging Worker with the sandbox secrets |
| D3 | Cloudflare for SaaS and Google Basic API access are not live (go-live D6, A3) | AC-5 (d, e) | — | Verified in mock mode by the recorded call; observed for real when those go live |
| D4 | Feature 001 is in flight on the same branch family and touches `/app/gegevens` and reports | AC-1 | delivery-lead | 002 branches from main after 001 merges, or rebases onto it |
| D5 | Free-check data purge after 12 months (privacy text) | — | compliance | Filed as a finding in this folder's `findings.md` at phase 1, fixed separately |

## Risks
| Risk | Likelihood | If it happens | What we do about it now |
|---|---|---|---|
| Fixing the session refresh changes the auth path of every page | Medium | Owners locked out or mock sign-in broken | AC-3 (b) runs before and after; `e2e/signed-in.spec.ts` and `auth-redirect.spec.ts` stay green |
| A deletion or purge removes the wrong business or a paying one | Low | Irreversible loss of a customer's history | AC-5 and AC-6 require a control business that must survive; purge never touches a running, paused or undone-cancel subscription; a daily dry-run count before the first real purge |
| The scope is at the upper edge (8 criteria over four areas) | Medium | The cycle runs long | If the architect's tickets do not fit one cycle, split into 002a (AC-3, AC-4, AC-5, AC-8 for those pages) and 002b (AC-1, AC-2, AC-6, AC-7); AC-3 and AC-5 go first |
| AC-2 pushes the data model from one owner per business towards membership | Medium | A larger change than a switcher | The architect decides and records it as an ADR; the brief asks only for the behaviour |
| Supabase cannot express a lifetime or scope we need on the current plan | Medium | AC-3 (c) or (e) needs app-side handling | Q2 assumption allows either; the architect checks the project's plan first |
| Scanner-safe link adds friction and lowers sign-in completion | Low | Fewer owners reach `/app` | The extra page has one button and nothing else; the first metric watches it |
| Copy drifts from the terms and privacy text | Medium | A published promise the code does not keep, again | AC-5 (f) changes privacy in the same PR; compliance's phase-1 checklist lists every sentence touched |
