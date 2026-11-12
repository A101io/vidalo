# Architecture — 002 Mijn omgeving: owner area, sign-in, account and subscription

*architect · 2026-11-11 · built against `01-brief.md` as approved by Julian on 11 Nov 2026
(Q1–Q7 as assumed; Q8–Q14 as assumed). Gaps are rows in `findings.md` (F-001 on).*

## Shared contract (both lanes code against this)

Two lanes build at the same time in separate worktrees: **lane A** (Opus: session, sign-in
link, export/delete, cancel/retention; AC-3, AC-4, AC-5, AC-6) and **lane B** (Sonnet: report
archive, business switcher, scale, accessibility; AC-1, AC-2, AC-7, AC-8). Before either
worktree is cut, ticket **C-00** commits the scaffold below on `claude/002-mijn-omgeving`:
every signature in this section exists in code, with a working minimal body (the behaviour of
today) or an empty module. After C-00 every file has exactly one owning lane
(`tickets/README.md`). Nothing in this section changes without a dated amendment here.

**Amendment 1 (11 Nov 2026, after the phase-1 security and compliance checklists, F-010…F-023):**
`requireVerifiedOwnerOf` added to §1 and the "business in the form" rule now covers every
changing action and route (F-020, §1a); `BusinessRecord.lastActiveAt` and two Scan-retention
Db methods added to §2 (F-012); 0016 also hides `channel.meta` from the anon client and makes
a verified facts host unique (F-017, F-019); C-00 also writes the `vidalo_business` cookie
row with a new legal date, moves `setLanguage` and `deleteMyData` into lane A's files, and
ships the safe `safeNext` (F-011, F-020, F-023); the purge's dry run covers retention only and
it asks Stripe first (F-010, F-021).

### 1. Who is calling, and which business (lane B implements; lane A consumes)

```ts
// apps/web/lib/session.ts — owned by lane A after C-00. Shape fixed here.
export interface Session {
  userId: string;
  email: string;
  /** Supabase JWT claim `session_id`; in mock auth the `sid` in the mock cookie. "" = unknown (C-00 stub only). */
  sessionId: string;
  /** auth_session.signed_in_at of this browser's sign-in, ISO. C-00 stub: "1970-01-01T00:00:00.000Z" (never fresh). */
  signedInAt: string;
}
export function getSession(): Promise<Session | null>;
/** @deprecated Alias of getActiveBusiness, kept so the nine existing callers need no edit. */
export const getOwnedBusiness: (session: Session) => Promise<BusinessRecord | null>;
```

```ts
// apps/web/lib/active-business.ts — NEW in C-00, owned by lane B.
/** The owner's choice of business. Value: a business uuid. HttpOnly, Secure on https, SameSite=Lax, Path=/, Max-Age 90 days.
 *  Never trusted: getActiveBusiness re-checks it against the membership list on every request. */
export const ACTIVE_BUSINESS_COOKIE = "vidalo_business";
/** Every business this login is a member of, newest first. First links businesses whose owner_email equals the
 *  login address and that have no owner yet (today's getOwnedBusiness behaviour, now for all of them), and moves
 *  owner_email to the login address where the login changed address. React cache(): one lookup per request. */
export function listMyBusinesses(session: Session): Promise<BusinessRecord[]>;
/** The business every owner page acts on: the cookie's id when it is in listMyBusinesses, else the newest; null when none. */
export function getActiveBusiness(session: Session): Promise<BusinessRecord | null>;
```
C-00 stub: `listMyBusinesses` returns `[today's getOwnedBusiness result]` (or `[]`);
`getActiveBusiness` is today's `getOwnedBusiness` body moved here. Correct for one business
per login, so lane A's pages work before B-01 merges.

```ts
// apps/web/lib/owner.ts — owned by lane B after C-00.
/** Unchanged signature: session + the ACTIVE business, or redirect to /inloggen. */
export function requireOwner(next?: string): Promise<{ session: Session; business: BusinessRecord }>;
/** For every action that changes or removes something: the business named in the form, only if this login is a member.
 *  Not a member, or unknown id: redirect(href("/app")) — same answer for both, nothing changed. */
export function requireOwnerOf(businessId: string, next?: string): Promise<{ session: Session; business: BusinessRecord }>;
/** Unchanged. */
export function requireVerifiedOwner(next?: string): Promise<{ session: Session; business: BusinessRecord }>;
/** requireOwnerOf, then isVerifiedOwner; not verified → redirect(href("/app/google?eerst=1")). (Amendment 1) */
export function requireVerifiedOwnerOf(businessId: string, next?: string): Promise<{ session: Session; business: BusinessRecord }>;
/** The business id a changing form carries: String(form.get("business") ?? ""). One reader, so the field name never drifts. */
export function businessFromForm(form: FormData): string;
```
C-00 stub of `requireOwnerOf`: `requireOwner(next)` then refuse unless `business.id === businessId`;
`requireVerifiedOwnerOf` likewise over `requireVerifiedOwner`.

### 1a. Every changing action names its business (Amendment 1, F-020)

Every server action and route handler that writes anything about a business takes the
business id from the request (`<input type="hidden" name="business" value={business.id}>`
in the form that renders it, or `?business=` on a GET) and passes `requireOwnerOf` /
`requireVerifiedOwnerOf` (or `isMember` in a route handler) before it reads or writes. Never
the cookie. Each lane adds the hidden field to the forms in its own pages; an action that
receives no `business` refuses like a non-member. One owner per file:

| Action / route | File | Lane | Ticket |
|---|---|---|---|
| `saveFacts`, `reconfirmFacts`, `saveProfile` (verified for `saveFacts`/`saveProfile`) | `apps/web/app/app/gegevens/actions.ts` (+ `FactsForm.tsx`, `ProfileGroup.tsx`, `gegevens/page.tsx`, the layout's reconfirm form) | B | B-05 |
| `markFixed`, `dispute`, `approveChannelDiff`, `declineChannelDiff`, `checkNow` | `apps/web/app/app/actions.ts` (+ `app/app/page.tsx`, `fouten/[id]/page.tsx`, `vermeldingen/[id]/page.tsx`; finding and channel pages resolve the business from the finding/channel and pass `requireOwnerOf(its businessId)`) | B | B-05 |
| `POST /api/domain/verify` | `apps/web/app/api/domain/verify/route.ts` (+ `domein/page.tsx`) | B | B-05 |
| `POST /api/checkout` (`onlyOwnerMayBuy`: `isMember(session, business)` instead of "the active business") | `apps/web/app/api/checkout/route.ts` | B | B-05 |
| `GET /api/lang` (owner's language: only for `?business=` the login is a member of; otherwise just the redirect) | `apps/web/app/api/lang/route.ts` + `apps/web/components/LangSwitch.tsx` | B | B-05 |
| `setLanguage`, `saveMailPrefs`, `changeEmail`, `signOutEverywhere` | `apps/web/app/app/account/actions.ts` | A | A-02/A-03 |
| `deleteMyData`, `callOffDeletion` | `apps/web/app/app/account/verwijderen/actions.ts` | A | A-05 |
| `sendOwnerPhoneCode`, `checkOwnerPhoneCode`, `disconnectGoogle` | `apps/web/app/app/google/actions.ts` | A | A-04 |
| `GET /api/google/start` (`?business=`: a member's business, else the existing claim path, never the cookie) and `/api/google/callback` (unchanged: the state cookie binds the business) | `apps/web/app/api/google/start/route.ts`, `callback/route.ts` | A | A-04 |
| cancel, undo, pause, resume | `apps/web/app/app/abonnement/actions.ts` | A | A-05 |
| export, portal | their routes | A | A-03/A-04 |

C-00 moves `setLanguage` (unchanged body) from `app/app/actions.ts` to
`app/app/account/actions.ts`, and `deleteMyData` (unchanged body) to the new
`app/app/account/verwijderen/actions.ts`, so `app/app/actions.ts` is lane B's alone. Lane A's
account page keeps posting to `checkNow` (lane B's action) and adds the hidden `business`.

```ts
// packages/core/src/db/owner-area.ts — NEW in C-00, owned by lane B; exported from @vidalo/core/db.
// Functions over a Db, not methods on it: they branch on `db instanceof PgDb` (own SQL through db.sql)
// or `db instanceof MemDb` (derived from db.businesses). Lane B never edits mem.ts, pg.ts or types.ts.
export function listMemberBusinesses(db: Db, userId: string): Promise<BusinessRecord[]>; // newest first
export function listMemberUserIds(db: Db, businessId: string): Promise<string[]>;
export function isMember(db: Db, userId: string, businessId: string): Promise<boolean>;
/** Sets owner_user_id on every business with lower(owner_email) = email and owner_user_id null. Returns how many. */
export function linkBusinessesByEmail(db: Db, userId: string, email: string): Promise<number>;
```
C-00 stub: by `business.owner_user_id` (Pg: `select * from business where owner_user_id = $1
order by created_at desc`, no limit; Mem: filter `db.businesses`). B-01 moves Pg to
`business_member`; results are identical by construction (ADR-0001).

### 2. Db interface additions (lane A implements in MemDb and PgDb; lane B uses none of them)

`packages/core/src/db/types.ts`, `mem.ts`, `pg.ts` are lane A's after C-00.

```ts
// BusinessRecord gains (migration 0019):
lastActiveAt: string | null;       // last sign-in of a member or last payment (Scan retention clock; Amendment 1)
churnedAt: string | null;          // set by the trigger when status becomes churned
deleteAt: string | null;           // when this business is deleted; never null while status = churned
deleteReason: "owner" | "retention" | null;
deletionRemindedAt: string | null; // the 14-day reminder went out

export type PurgeGuard = "no_subscription" | "due";
export interface SignInRow { sessionId: string; userId: string; signedInAt: string; lastSeenAt: string; endedAt: string | null;
  endedReason: SignInEnd | null; browser: BrowserFamily; os: OsFamily; }
export type SignInEnd = "signed_out" | "signed_out_everywhere" | "idle" | "max_age" | "replaced" | "deleted";
export type BrowserFamily = "chrome" | "safari" | "firefox" | "edge" | "other";
export type OsFamily = "macos" | "windows" | "ios" | "android" | "linux" | "other";

interface Db {
  // sessions (0018)
  recordSignIn(row: { sessionId: string; userId: string; browser: BrowserFamily; os: OsFamily; at: Date }): Promise<void>; // upsert by sessionId; prunes ended/old rows beyond the user's 10 newest; sets business.last_active_at where owner_user_id = userId
  getSignIn(sessionId: string): Promise<SignInRow | null>;
  touchSignIn(sessionId: string, at: Date): Promise<void>;                       // only when last_seen_at < at - 1 h
  endSignIns(userId: string, reason: SignInEnd, opts?: { sessionId?: string }): Promise<number>; // one session, or all of the user's open ones
  listSignIns(userId: string, limit: number): Promise<SignInRow[]>;               // newest first
  deleteSignIns(userId: string): Promise<void>;
  // link throttle (0018)
  throttleAuth(keyHashes: string[], since: Date): Promise<number[]>;              // inserts one row per key, returns per key the count since `since` incl. this one; one round trip
  pruneAuthThrottle(before: Date): Promise<number>;
  // deletion and retention (0019)
  setDeletion(businessId: string, input: { at: string; reason: "owner" } | null): Promise<BusinessRecord>; // null = call off (a churned business falls back to churned_at + 120 d, reason retention)
  listDueDeletions(now: Date, limit: number): Promise<BusinessRecord[]>;          // delete_at <= now and status in (scanned, churned)
  listDeletionReminders(now: Date, limit: number): Promise<BusinessRecord[]>;     // reason retention, delete_at - 14 d <= now, not reminded
  claimDeletionReminder(businessId: string): Promise<boolean>;                    // sets deletion_reminded_at where null; true once
  countOverdueDeletions(now: Date): Promise<number>;                              // delete_at < now - 1 day
  listScanRetention(limit: number): Promise<BusinessRecord[]>;                    // plan setup, status trial (Amendment 1)
  setScanRetention(businessId: string, at: string | null): Promise<void>;         // delete_at, reason retention; clears deletion_reminded_at when the date moves later
  purgeBusiness(id: string, guard: PurgeGuard, now: Date): Promise<boolean>;      // conditional delete (+ unrun jobs) in one transaction; false = guard refused or gone
  deleteChannel(id: string): Promise<void>;
  // export paging
  listSamplesForRuns(scanRunIds: string[]): Promise<Sample[]>;                    // one query per page of runs
  listEventsPage(businessId: string, opts: { beforeId?: number; limit: number }): Promise<EventRow[]>; // newest first
}
```
`deleteBusiness(id)` stays (tests and the CLI use it); the owner path no longer calls it.

### 3. Migrations (numbers are fixed; each file is independent of the others)

| File | Lane | Ticket | Contents |
|---|---|---|---|
| `supabase/migrations/0016_business_member.sql` | B | B-01 | `business_member`, owner-sync trigger, backfill, RLS policies of 0001 rewritten to membership; `channel.meta` not selectable by `authenticated` (F-017); one verified holder per facts host (F-019) |
| `supabase/migrations/0017_run_summary.sql` | B | B-02 | `scan_run.summary jsonb` + CHECK on shape, partial index for the archive |
| `supabase/migrations/0018_auth_sessions.sql` | A | A-02 | `auth_session`, `auth_throttle` |
| `supabase/migrations/0019_deletion_retention.sql` | A | A-05 | business deletion columns incl. `last_active_at`, CHECKs that admit Scan retention, retention trigger, backfill, job index |

None of the four touches an object another creates. None is applied to the hosted project
until both lanes are merged into `claude/002-mijn-omgeving`; then 0016–0019 in number order
(the delivery-lead, with the ref check). `scripts/verify-pg.sh` applies them in name order.

### 4. Copy namespaces

| Namespace | NL file | EN file | Lane |
|---|---|---|---|
| `copy.ownerArea` (nav "Rapporten", archive page, switcher, report-kind words) | `packages/core/src/copy/owner-area.ts` exports `ownerAreaNl` | `owner-area.en.ts` exports `ownerAreaEn: CopyShape["ownerArea"]` | B |
| `copy.accountSecurity` (confirm page, sign-ins, "Overal uitloggen", re-sign-in, deletion page and schedule, Google disconnect, end state) | `packages/core/src/copy/account-security.ts` exports `accountSecurityNl` | `account-security.en.ts` exports `accountSecurityEn: CopyShape["accountSecurity"]` | A |
| Everything else in `copy/index.ts` and `en.ts` (`legal`, `mails`, `account`, `billing`, `auth`) | — | — | A |

C-00 wires both namespaces into `copy` (index.ts) and `en` (en.ts) as `{}`. A missing EN key
fails typecheck exactly as today. Lane B never edits `index.ts` or `en.ts` (F-001).
C-00 also adds the `vidalo_business` row to the cookie table in `copy.legal` (NL and EN,
wording of `checklists/compliance.md` §4.2), sets a new `copy.legal.updated` date in both
languages and runs `pnpm --filter @vidalo/core legal:lock`, because `legal.test.ts` fails
on any exported `…COOKIE` constant missing from the table (F-011). A-07 later sets a later
date again for its own privacy changes and re-locks.

### 5. Routes

| Route | Lane | Kind |
|---|---|---|
| `GET /app/rapporten` (EN `/en/app/rapporten`), `?voor=<cursor>` | B | page |
| `chooseBusiness(form: business, next)` | B | server action, `apps/web/app/app/business-actions.ts` |
| `/r/[id]` (free-report expiry rule) | B | page change |
| `GET /auth/confirm` | A | page (was a route handler), one button |
| `confirmSignInAction(form: token_hash, type, code, next)` | A | server action, `apps/web/app/auth/confirm/actions.ts` |
| `GET /auth/callback` | A | 303 to `/auth/confirm` with the same query |
| `POST /auth/uitloggen` | A | route handler: this browser only, Origin-checked |
| `signOutEverywhere()` | A | server action on `/app/account` |
| `GET /app/account/verwijderen` (EN `/en/app/account/verwijderen`) | A | page: the delete step |
| `deleteMyData(form: business, confirm)`, `callOffDeletion(form: business)` | A | server actions |
| `GET /api/account/export?business=<uuid>` | A | streamed JSON download |
| `POST /api/billing/portal` | A | Origin-checked |
| `disconnectGoogle(form: business)` | A | server action on `/app/google` |
| `/inloggen?opnieuw=1&next=…`, `?fout=wacht`, `?fout=verlopen`, `?uitgelogd=overal` | A | page states |

Every page above renders in mock mode (`VIDALO_MOCK=1`) for the demo owner, so lane B's axe
spec and scale harness can reach lane A's pages by URL after merge.

### 6. Seeds, barrels, scripts (C-00 writes the lines, then they are frozen)

- `apps/web/lib/core.ts` seed chain: `seedDemo → seedDomainStatus → seedOwnerArea (B, apps/web/lib/demo-owner-area.ts) → seedAccountLifecycle (A, apps/web/lib/demo-account.ts)`; both new seeds start as no-ops.
- `packages/core/src/shared/index.ts` gains `export *` lines for lane A's new modules
  `safe-next` (C-00 ships the full safe `safeNext` of "Sign-in link" as its body, so lane B's
  `chooseBusiness` is never an open redirect, F-023; A-03 owns its tests), `same-origin`, `session-life`, `auth-throttle`, `purge`, `google-revoke`,
  `export-stream`, `deletion` and lane B's `report-access`; each starts as an empty module.
- `packages/core/src/db/index.ts` gains `export * from "./owner-area"`.
- Root `package.json`: `"e2e:auth": "playwright test -c playwright.auth.config.ts"` (A),
  `"perf:owner": "tsx scripts/perf/owner-pages.mts"` (B).
- `scripts/verify-pg.sh`: the vitest line runs `test/db*.test.ts` (so `db-membership.test.ts`
  (B) and `db-account.test.ts` (A) run on PgDb without either lane editing the script).

---

## Shape

The owner area keeps its pages and gains two things around them. **Who is calling** is now two
questions answered in two places: the *session* (lane A) says which login this browser is, and
whether that browser's sign-in is still alive; the *membership* (lane B) says which businesses
that login may act on, and which one this request is about. The session is refreshed in the
edge middleware (no database there), and judged in `getSession()` against an app table
`auth_session` keyed by Supabase's `session_id` (idle 30 days, at most 90 days, ended by
sign-out here or everywhere). Membership is a table `business_member`, filled by a trigger
from `business.owner_user_id` in this cycle; every owner page resolves the active business
through `getActiveBusiness`, and every action that changes or removes something names its
business in the form and passes `requireOwnerOf`, so a cookie or a hand-edited value never
selects a business the login is not a member of.

Removal has one module. `purgeBusiness` (core/shared/purge.ts) is called inline by "Verwijder
alles" when no subscription runs, and by the worker's `purge` job when a scheduled date comes
(owner's request at period end, or retention 120 days after churn). The database guards it:
the delete is conditional on status and date, a churned business always carries a deletion
date (trigger + CHECK), and a business with a running or un-cancelled subscription cannot
carry one. Reports become cheap to list because each finished scan stores a small summary on
its `scan_run` row; the archive, `/app/voortgang` and the dashboard read summaries, not
samples, so their round trips do not grow with history.

```
browser ──► middleware (edge) ── refresh Supabase tokens, write Set-Cookie on the response,
   │                              forward fresh cookies in the request header (no DB)
   ▼
page / action ── getSession()  [A]  getClaims() → auth_session row → sessionVerdict(row, now)
             └─ getActiveBusiness / requireOwnerOf  [B]  business_member ∩ cookie vidalo_business
                     │
   "Verwijder alles" ─► deletionPlan(b) [A]
         now ──────────► purgeBusiness(deps, id, "no_subscription")  inline; on failure → purge job
         at period end ► cancelSubscription + setDeletion(at = cancel_at)  → trigger keeps it at churn
   cron (worker) ─► retention: reminders (−14 d), due → purge job (guard "due"), overdue count,
                    churn → google_disconnect job; dry run until VIDALO_PURGE=1
   scan finishes ─► saveRunSummary(run) [B] ─► archive / voortgang read one row per run
```

## Decisions

| ADR | Decision | Why | Alternative rejected |
|---|---|---|---|
| [ADR-0001](adr/0001-membership-table-filled-from-owner-for-now.md) | Authorisation by a `business_member` table, filled by a trigger from `owner_user_id` (one role, `owner`); RLS and the app check membership; the active business is a cookie re-checked every request; changing actions name their business and pass `requireOwnerOf` | Membership, not ownership (standing checklist); team access later adds rows without rewriting a policy; one writer of "who owns" stays `owner_user_id` | Keep `owner_user_id` and only drop `limit 1` (every policy rewritten again for team access); a membership table written directly by the app this cycle (two writers of the same fact) |
| [ADR-0002](adr/0002-session-refreshed-at-the-edge-judged-by-an-app-table.md) | Tokens refreshed in edge middleware with `@supabase/ssr` `getAll`/`setAll`; idle 30 d, max 90 d and revocation decided by `auth_session` in `getSession()`; cookies HttpOnly, Secure on https, SameSite=Lax, Max-Age 90 d; Supabase time-box/inactivity set too when on Pro | Fixes S1 where it happens; the lifetime holds on any Supabase plan; "Overal uitloggen" takes effect on the next page load, not at access-token expiry | Supabase's own time-box only (Pro plan, not readable here, enforced only at refresh); a signed meta cookie (a second secret and still no server-side revocation) |
| [ADR-0003](adr/0003-sign-in-link-confirmed-by-post.md) | The mail link opens a page with one button; the POST (a server action) calls `verifyOtp`; `/auth/callback` redirects there | A scanner's GET uses nothing up; server actions carry Next's Origin check; the Supabase template does not change | Verifying on GET with a bot heuristic (scanners imitate browsers); a code to type (more friction than one click) |
| [ADR-0004](adr/0004-sign-in-throttle-in-postgres-with-hashed-keys.md) | 5 per address and 20 per IP per rolling hour, counted in a Postgres table of HMAC-hashed keys, one round trip | Global across isolates and Workers; no address or IP stored readable | Per-isolate memory as in `waitlist.ts` (each isolate counts alone); Workers KV (eventually consistent); the Workers rate-limit binding (10 s / 60 s periods only) |
| [ADR-0005](adr/0005-one-purge-module-guarded-by-the-database.md) | One `purgeBusiness` for owner deletion and retention; conditional delete in SQL; deletion date carried on `business` with a trigger and CHECKs; dry run until `VIDALO_PURGE=1` | The irreversible step cannot run against a paying business even if the code is wrong; one place decides the order of side effects | A cron that computes dates from events (no invariant, not countable); separate code paths for owner and retention |
| [ADR-0006](adr/0006-export-by-allow-list-streamed-in-pages.md) | The export maps channel `meta` through an allow-list, is streamed in pages of runs, and a test fails if any stored token value appears anywhere in the file | A1 closed by construction, not by remembering to strip a key; whole history within Worker memory and time | Deleting known secret keys (a new key leaks by default); building the whole object in memory (36 checks × 500 answers is tens of MB) |
| [ADR-0007](adr/0007-a-summary-per-finished-scan.md) | Each finished scan stores `scan_run.summary` (dot, counts, the progress snapshot); lists read summaries; legacy runs backfilled by a script | Round trips stop growing with history (AC-7) | Recomputing snapshots per request (today: several queries per run, up to 30 runs); a materialised view (refresh timing, MemDb has no equivalent) |

## Data model

### 0016_business_member.sql (lane B)

```sql
create table business_member (
  business_id uuid not null references business(id) on delete cascade,
  user_id     uuid not null,
  role        text not null default 'owner' check (role in ('owner')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create unique index business_member_one_owner on business_member (business_id) where role = 'owner';
create index business_member_user_idx on business_member (user_id);
alter table business_member enable row level security;
create policy member_self on business_member for select using (user_id = (select auth.uid()));
revoke insert, update, delete on business_member from anon, authenticated;

create function public.sync_business_owner_member() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.owner_user_id is not distinct from new.owner_user_id then return new; end if;
  delete from public.business_member where business_id = new.id and role = 'owner';
  if new.owner_user_id is not null then
    insert into public.business_member (business_id, user_id, role) values (new.id, new.owner_user_id, 'owner')
    on conflict (business_id, user_id) do update set role = 'owner';
  end if;
  return new;
end $$;
revoke execute on function public.sync_business_owner_member() from public, anon, authenticated;
create trigger business_owner_member after insert or update of owner_user_id on business
  for each row execute function public.sync_business_owner_member();
insert into business_member (business_id, user_id, role)
  select id, owner_user_id, 'owner' from business where owner_user_id is not null on conflict do nothing;
```
Also in 0016 (Amendment 1):
```sql
-- F-017: Google tokens live in channel.meta; members read channel through the anon client (lib/reads.ts).
revoke select on channel from anon, authenticated;
grant select (id, business_id, type, name, external_id, url, status, last_synced_at) on channel to authenticated;
-- F-019: one verified holder per facts host (pre-check: no duplicates; production has none).
create unique index business_facts_host_verified_uniq on business (lower(facts_host)) where facts_host_verified_at is not null;
```
`lib/reads.ts` selects those named columns (no `meta`); anything that needs `meta` reads it
with the service handle after `requireOwner`/`requireOwnerOf` (as `lib/owner-data.ts` does).
`api/domain/verify` treats a unique violation as "taken" (`dns=nee`, `domain.refused`).
Then the seven `owner_*` policies of 0001 are dropped and recreated as `member_*` with
`exists (select 1 from business_member m where m.business_id = <table>.business_id and
m.user_id = (select auth.uid()))` (`fix` through `finding`, `business` on `business.id`).

| Rule | Enforced by |
|---|---|
| A login acts only on businesses it is a member of | RLS `member_*` policies (reads through the anon client, `lib/reads.ts`); `requireOwnerOf` / `getActiveBusiness` for service-role reads and writes; test with a third business on another login |
| Exactly one owner per business | `business_member_one_owner` partial unique index |
| Membership equals `owner_user_id` this cycle | the trigger (the only writer); no grant to anon/authenticated; MemDb derives membership from `ownerUserId`, so it cannot disagree |
| A client cannot make itself a member | `revoke insert, update, delete … from anon, authenticated`; RLS has no write policy |
| A member's JWT cannot read Google tokens | column grant on `channel` without `meta` (F-017); RLS block asserts `select meta` raises |
| One business holds a verified facts host | `business_facts_host_verified_uniq` (F-019) |

### 0017_run_summary.sql (lane B)

`alter table scan_run add column summary jsonb` with CHECK `scan_run_summary_shape`
(`summary is null or (summary ? 'v' and summary ? 'stip' and summary ? 'answered' and summary ? 'correct')`,
`jsonb_typeof(summary->'answered') = 'number'`), and
`create index scan_run_archive_idx on scan_run (business_id, created_at desc, id desc) where kind <> 'recheck'`.
`RunSummary` (in `owner-area.ts`): `{ v: 1; stip: "red" | "orange" | "green" | "grey"; answered: number;
correct: number; snapshot: ScanSnapshot }` — `answered`/`correct` are the numbers the report's
heading shows for that run (one function computes both, B-02).

### 0018_auth_sessions.sql (lane A)

```sql
create table auth_session (
  session_id   uuid primary key,              -- Supabase JWT claim session_id
  user_id      uuid not null,
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  ended_reason text check (ended_reason in ('signed_out','signed_out_everywhere','idle','max_age','replaced','deleted')),
  browser      text not null check (browser in ('chrome','safari','firefox','edge','other')),
  os           text not null check (os in ('macos','windows','ios','android','linux','other')),
  check ((ended_at is null) = (ended_reason is null)),
  check (last_seen_at >= signed_in_at)
);
create index auth_session_user_idx on auth_session (user_id, signed_in_at desc);
create table auth_throttle (key_hash text not null check (char_length(key_hash) = 64), at timestamptz not null default now());
create index auth_throttle_key_at_idx on auth_throttle (key_hash, at desc);
alter table auth_session enable row level security;  -- no policies
alter table auth_throttle enable row level security; -- no policies
revoke all on auth_session, auth_throttle from anon, authenticated;
```
No IP address, no user agent string: only the two families (Q9). No FK to `auth.users`
(the local Postgres of `verify:pg` has none; `deleteSignIns` runs in the purge).

### 0019_deletion_retention.sql (lane A)

```sql
alter table business
  add column churned_at timestamptz,
  add column delete_at timestamptz,
  add column delete_reason text check (delete_reason in ('owner','retention')),
  add column deletion_reminded_at timestamptz,
  add column last_active_at timestamptz,
  add constraint business_delete_reason_with_date check ((delete_at is null) = (delete_reason is null)),
  add constraint business_delete_only_when_ending check (
    delete_at is null
    or status in ('scanned','churned')
    or cancel_at is not null
    or (plan = 'setup' and status = 'trial' and delete_reason = 'retention')  -- Vidalo Scan retention (F-012)
  );
```
Trigger `business_retention` (BEFORE INSERT OR UPDATE on `business`, `security definer`,
`search_path = ''`, execute revoked from public):
1. status becomes `churned` (from anything else): `churned_at := now()`; when `delete_at` is
   null: `delete_at := now() + interval '120 days'`, `delete_reason := 'retention'`
   (90 days kept, one free check, deletion within 30 days after it). An owner's earlier date
   stays.
2. status is `churned` and `delete_at` is null (an owner called a deletion off after the end):
   `delete_at := coalesce(churned_at, now()) + interval '120 days'`, reason `retention`.
3. status is `trial`/`active`/`paused`, `cancel_at` is null and **not** (`plan = 'setup'`
   and status `trial` and reason `retention`) (undo of a cancel, a webhook echo, a new
   subscription, a Scan that upgrades to Monthly): `delete_at`, `delete_reason`,
   `deletion_reminded_at` := null; leaving `churned` also clears `churned_at`.
4. status becomes `trial` or `active` (a payment): `last_active_at := now()`.

**Vidalo Scan retention (F-012, default pending Julian).** A Scan business (`plan = 'setup'`,
status `trial`) is deleted `SCAN_RETENTION_MONTHS` after its `last_active_at` (the later of a
member's last sign-in, written by `recordSignIn`, and its payment, trigger rule 4), with the
same 14-day reminder. The period lives in one constant,
`export const SCAN_RETENTION_MONTHS: number | null = 24` in `core/shared/deletion.ts`; the
cron step `scanRetention` (A-06) sets `delete_at = last_active_at + SCAN_RETENTION_MONTHS`
through `setScanRetention` whenever the computed date differs (a sign-in moves it later and
re-arms the reminder). `null` (Julian chooses "none this cycle") makes the step set nothing
and the privacy text says "zolang je account bestaat; je verwijdert alles zelf". The CHECK
above admits only this case for a `trial` business, so a Monthly in trial can never carry a
retention date.
Backfill: `churned_at` from the newest `event` `business.status` → `churned`, else `now()`;
the trigger rule 2 then sets `delete_at` (an `update business set status = status where
status = 'churned'`). Index `job_unrun_business_idx on job ((payload->>'businessId')) where done_at is null`.

| Rule (brief) | Enforced by |
|---|---|
| A running, paused or un-cancelled subscription is never purged | `business_delete_only_when_ending` CHECK; trigger rule 3; `purgeBusiness` SQL `… where id = $1 and delete_at <= $now and (status in ('scanned','churned') or (plan = 'setup' and status = 'trial' and delete_reason = 'retention'))` (`due`) or `… and not (plan = 'monitor' and status in ('trial','active','paused'))` (`no_subscription`); and Stripe is asked first (`stripeLive`, F-021) |
| A churned business is always deleted at most 120 days after churn | trigger rules 1–2; `retention.overdue` counts any row past its date |
| Undoing a cancel calls the deletion off | trigger rule 3 (also when the change arrives from a Stripe webhook) |
| The purge is idempotent | conditional delete returns false the second time; side effects before it tolerate "already gone" (Cloudflare 404, Google `invalid_token`) |
| The reminder goes once | `claimDeletionReminder` = `update … set deletion_reminded_at = now() where id = $1 and deletion_reminded_at is null returning id` |

MemDb mirrors the trigger in `upsertBusiness` and the conditional delete in `purgeBusiness`
(lane A); `test/db-account.test.ts` runs the same cases on both.

## Authorisation model

Expressed at the data layer, membership not ownership (ADR-0001):

| Who | May | Enforced by |
|---|---|---|
| anon | nothing on any table of this feature | RLS on, no policy; grants revoked |
| a signed-in login (anon client, RLS) | read rows of businesses in its `business_member` rows; read its own `business_member` rows | `member_*` policies (0016) |
| a signed-in login (server, service role) | read and act on the active business, or the business named in a form, only after `getActiveBusiness` / `requireOwnerOf` checks membership | `apps/web/lib/owner.ts` (one module), test with the third business and a hand-edited `business` field |
| a verified owner | everything that publishes or spends (unchanged) | `requireVerifiedOwner`, `isVerifiedOwner` (`owner_user_id` = the owner member) |
| the worker (service role) | purge, reminders, Google disconnect | `purgeBusiness` guards in SQL; jobs re-read the business |

**The active business, per request:** `getActiveBusiness(session)` reads
`listMyBusinesses(session)` (membership), then the cookie `vidalo_business`; the cookie is
used only when its id is in that list, else the newest business. The cookie is written only
by `chooseBusiness`, after `isMember`. **Actions that change or remove** (delete, call off,
cancel, undo, pause, resume, Google disconnect, export) carry `<input type="hidden"
name="business">` with the id the page rendered, and pass `requireOwnerOf(id)`; a switch in
another tab can therefore never redirect a delete or a cancel to a different business. Pages
and read-only actions use `requireOwner()` (the active business).

## Session (lane A, ADR-0002)

**Refresh in `apps/web/middleware.ts`.** After today's language and gate decision (pure,
unchanged), and only when the request carries a cookie whose name starts with `sb-` and
Supabase is configured: `createServerClient(url, anonKey, { cookieOptions: AUTH_COOKIE,
cookies: { getAll: () => req.cookies.getAll(), setAll: (list) => { for (c of list)
req.cookies.set(c.name, c.value); pending.push(...list) } } })`, then
`await supabase.auth.getClaims()` (refreshes when the access token has expired). The
response (`NextResponse.next` or `.rewrite`, as today) is built **after** that await, with
the forwarded request headers' `cookie` set from `req.cookies` (so the page renders with the
new tokens and never refreshes again with the old refresh token), and every `pending`
cookie written on it with `AUTH_COOKIE` options forced, plus the headers `setAll` receives as
its second argument, and `Cache-Control: private, no-store` on every response that carries
an `sb-` `Set-Cookie` (F-018; the same in `lib/supabase.ts` where a route handler or action
writes one, and on `confirmSignInAction`'s and `/auth/uitloggen`'s responses). No database call, no core import
beyond `shared/gate` and the new edge-safe `apps/web/lib/auth-cookies.ts`.
On OpenNext a rewrite runs the middleware twice; the second pass receives the forwarded
cookie header, finds a fresh token and writes nothing. Whether the first pass's `Set-Cookie`
survives the rewrite on OpenNext is observed in workerd (A-01 done-when), not assumed.
`lib/supabase.ts` keeps swallowing the write in server components (now true: middleware did
it); route handlers and server actions persist their own writes, as today.

**Cookie options** (`apps/web/lib/auth-cookies.ts`, one module):
`AUTH_COOKIE = { httpOnly: true, secure: PUBLIC_BASE_URL starts with "https:", sameSite: "lax", path: "/", maxAge: 90 * 86400 }`.
No browser Supabase client exists, so HttpOnly costs nothing. The mock cookie and
`vidalo_business` use the same options.

**Lifetime and revocation in `getSession()`** (request scope, inside `withDb()`):
`getClaims()` → `{ sub, email, session_id }`; `db.getSignIn(session_id)`;
`sessionVerdict(row, now)` (`core/shared/session-life.ts`, pure) →
`"ok" | "missing" | "ended" | "idle" | "max_age"` with `IDLE_DAYS = 30`, `MAX_DAYS = 90`.
Not `ok` → `endSignIns(user, reason, { sessionId })` when the row was open,
`supabase.auth.signOut({ scope: "local" })` (revokes this refresh token at Supabase; the
cookie write may be dropped in a server component, the token is dead either way), return
null → `requireOwner` sends to `/inloggen?fout=verlopen&next=…`. `ok` → `touchSignIn` (at
most once an hour). Wrapped in React `cache()`. A session without a row fails closed
(F-005: everyone signed in before the deploy signs in once more).

**Sign-in recorded** by `confirmSignInAction` after `verifyOtp` succeeds: claims of the new
session, `uaFamily(userAgent)` (`session-life.ts`, pure: browser and OS family only),
`recordSignIn`. If the browser already carried another session, that one is ended with
`replaced`. Mock auth gets a `sid` (random uuid) in `vidalo_mock_session` and records too.

**Sign-out.** "Uitloggen" (`POST /auth/uitloggen`): `refuseCrossSite` first, then
`signOut({ scope: "local" })`, `endSignIns(user, "signed_out", { sessionId })`, clear the
mock cookie, 303 to `/`. "Overal uitloggen" (`signOutEverywhere`, `/app/account`):
`signOut({ scope: "global" })`, `endSignIns(user, "signed_out_everywhere")`, redirect to
`/inloggen?uitgelogd=overal`. A second browser fails `sessionVerdict` (`ended`) on its next
page load (AC-3e), even while its access token is still valid at Supabase (F-004).
**Known gap (F-022, accepted until Pro):** without Supabase's time-box, a refresh token
copied off a device is never ended at Supabase by our idle/90-day rule; it keeps minting
access tokens for PostgREST (member rows, `meta` excluded since F-017) until someone signs
out everywhere. Closed by the Pro plan's time-box and inactivity timeout (D1 item 5, go-live
D2), or later by a cron step that deletes the matching `auth.sessions` rows.

**The sign-in list** on `/app/account`: `listSignIns(user, 10)`, each line date, time
(Europe/Amsterdam), browser and system family in words (`copy.accountSecurity.signIns`),
"dit apparaat" on the current `sessionId`, ended ones marked as such; "Overal uitloggen" next
to it.

**Fresh sign-in for delete and address change** (AC-5c): `isFreshSignIn(session, now)` =
`now − signedInAt ≤ 15 min` (`session-life.ts`; `FRESH_MINUTES = 15`). The trusted timestamp
is `auth_session.signed_in_at`, written by our own `confirmSignInAction` at the moment
`verifyOtp` succeeded; a token refresh never changes it. `requireFreshSignIn(next)`
(`apps/web/lib/fresh-sign-in.ts`) redirects to `/inloggen?opnieuw=1&next=<next>`; that page
says why and pre-fills the address; the link returns to `next`: `/app/account/verwijderen`
(the delete step, its own page) or `/app/account?stap=email#inlog` (the address form open
and focused). Both actions call `requireFreshSignIn` again on POST.

**AC-3(b) failing first.** `e2e/fixtures/fake-gotrue.ts`: a small HTTP server on
`127.0.0.1:54399` with the GoTrue endpoints the app uses (`/auth/v1/verify`,
`/auth/v1/token?grant_type=refresh_token` with rotation and **reuse detection that revokes
the session**, `/auth/v1/user`, `/auth/v1/logout`, `/auth/v1/.well-known/jwks.json`),
HS256 tokens with a 5-second expiry. `playwright.auth.config.ts` runs `next dev --webpack`
on port 3102 against it (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, no `DATABASE_URL`, so MemDb).
`e2e/auth-session.spec.ts` signs in through the confirm page, then loads `/app`,
`/app/voortgang`, `/app/account` for 15 seconds (three expiries) and asserts it never lands
on `/inloggen`. Run on the branch before the middleware change: expected red (reuse
detected → revoked) — the result is written into `04-build.md` either way. A confirming run
against a real stack: local `supabase start` with `[auth] jwt_expiry = 60` if Docker runs on
Julian's Mac; never against the hosted project, which is production (F-003).

## Sign-in link (lane A, ADR-0003, ADR-0004)

**`safeNext(raw, fallback = "/app")`** (`core/shared/safe-next.ts`, one module; replaces
the inline checks in `inloggen/actions.ts` ×2 and `lib/auth-confirm.ts`): percent-decode up
to three times until stable; refuse when the result is empty, does not start with exactly
one `/`, contains `\`, a control character, or `//` at the start; then
`const u = new URL(decoded, "https://x.invalid")` must keep origin `https://x.invalid`;
then **check the normalised result again**: refuse when `u.pathname` starts with `//` or
`/\` or contains a backslash (F-023); return `u.pathname + u.search + u.hash`. Every
redirect is relative or prefixed with `env.baseUrl`. Test cases: the six of AC-4(c) plus
`/%252F%252Fevil.example`, `/\t/evil`, `/.//evil.example`, `/app/..//evil.example`,
`/%2e%2e//evil.example`, `/a/../%09/evil` (all refused), `/app?x=1#y`, `/en/app` (kept).
C-00 ships this body (lane B calls it from day one); A-03 owns the tests and the route table.

**Throttle** (`core/shared/auth-throttle.ts`): `throttleKeys(email, ip, secret):
Promise<[addressKey: string, ipKey: string]>`, each the 64-char hex HMAC-SHA256 of
`"addr:" + email` and `"ip:" + ip` (Web Crypto, works on Workers and Node); `LINK_LIMITS = { perAddress: 5,
perIp: 20, windowMs: 3_600_000 }`; `overLimit(counts)`. `sendMagicLink` order: address
format → Turnstile → `db.throttleAuth(keys, now − 1 h)` → over either limit:
`fout=wacht`, no call to Supabase, nothing mailed → else `signInWithOtp` → `sent=1`.
Secret: env `VIDALO_AUTH_SECRET` (required when Supabase is configured; `"vidalo-local"`
otherwise). The cron prunes rows older than 24 h. **Byte-identical (AC-4a):** for every
well-formed address under the limit the action ends in the same `303 /inloggen?sent=1`, and
the page it lands on reads no account or business state for that address; a test compares
the three responses and the rendered page bodies.

**Scanner-safe link (AC-4d).** `GET /auth/confirm` renders a page: Vidalo wordmark, one
sentence, one primary button "Inloggen" (EN "Sign in") in a form whose hidden fields carry
`token_hash`, `type`, `code`, `next`; `robots: noindex`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`, no third-party resource on the page. The language follows `next`
(`/en/…` → English). `confirmSignInAction` does `verifyOtp` (or `exchangeCodeForSession`),
records the sign-in, redirects to `safeNext(next)`; a failure goes to
`/inloggen?fout=link&next=…` as today. `/auth/callback` answers `303 /auth/confirm?<same
query>`. The mail template does not change (it links to `RedirectTo`, which is
`/auth/confirm?next=…`). In mock mode the page renders the same and the action redirects.

**Origin check for route handlers (AC-4e)** (`core/shared/same-origin.ts`):
`refuseCrossSite(req: Request, baseUrl: string): Response | null` — `null` when `Origin`
is present and `isOwnHost(new URL(origin).hostname)`, or `Origin` is absent and
`Sec-Fetch-Site` is `same-origin`; otherwise a `403` with no body change. Used first in
`POST /auth/uitloggen`, `POST /api/billing/portal`, and any new owner-area route handler.
Server actions keep Next's own check.

## Export (lane A, ADR-0006)

`GET /api/account/export?business=<uuid>`: `getSession` → `isMember` via `requireOwnerOf`
semantics in a route (401 `{error:"login_required"}`, 404 `{error:"not_found"}` for
non-member and unknown alike) → `streamMyData(db, businessId, { signedInAs })`
(`core/shared/export-stream.ts`) → `ReadableStream<Uint8Array>` of the same JSON shape as
today's `exportMyData`, written section by section; `scans` in pages of 6 runs with
`listSamplesForRuns` + `listClaims` per page; `events` with `listEventsPage` in pages of 500.
The handle is passed in once (`const db = await ready()`), never re-read with `getDb()`
inside the stream's `pull`, because the stream outlives the handler's async scope.
`exportChannel(c)` (`core/shared/my-data.ts`) keeps `id, type, name, externalId, url,
status, lastSyncedAt` and `meta` filtered by
`CHANNEL_META_EXPORT_KEYS = ["factsVersion","verified","lastSync","lastDiff","note","correction","pendingDiff","diffApproval","mode","domain","discovery","factsPageUrl","current","url","scope"]`;
anything else (refreshToken, accessToken, expiresAt, outputDir, any future key) is dropped.
Test: a business whose gbp channel holds `refreshToken: "rt-…"`, `accessToken: "at-…"` and
an unknown `apiSecret: "s-…"`; the whole streamed body must not contain any of the three
strings, nor any other person's address (as today). `exportMyData` stays as the
non-streamed form used by tests and calls the same mappers.

## Delete, disconnect, retention (lane A, ADR-0005)

`deletionPlan(b, now)` (`core/shared/deletion.ts`, replaces `canDeleteMyData`) →
`{ kind: "now" }` when no subscription runs (not `plan = "monitor"` with status `trial`,
`active` or `paused`, the same test as `subscriptionOptions`: Vidalo Scan, never paid,
churned), else `{ kind: "at_period_end", at: string | null, needsCancel: boolean }`
(cancelled already → `at = cancelAt`, `needsCancel = false`; otherwise `at` is known only
after `cancelSubscription` returns it).

**"Verwijder alles"** (`/app/account/verwijderen`, `deleteMyData(form)`):
`requireOwnerOf(form.business)` → `requireFreshSignIn` → `confirm === "ja"` →
`deletionPlan`: `now` → `purgeBusiness(webDeps, id, "no_subscription")` inline, then
redirect `/inloggen?verwijderd=1` (when a step before the delete fails, a `purge` job with
the same guard is queued and the page says the deletion is under way and a mail follows);
`at_period_end` → `cancelSubscription` when needed (refused → `?gegevens=fout#gegevens`,
nothing scheduled), then `setDeletion(id, { at, reason: "owner" })`, then at once the mail
`deletion_scheduled` (F-013: end date; everything deleted that day; facts page offline; no
90-day free check; download reports and invoices before then; "Toch bewaren" until then —
not `cancel_confirmed`), back to `/app/account?gegevens=gepland#gegevens`.
**The delete page states, before the button (F-014):** Monthly — the end date and that the
running month is not refunded; Scan — the amount is not refunded once Vidalo has started,
and if ownership could not be proven within 30 days a refund can be asked at support@
before deleting; all — invoices stay at Stripe for 7 years but cannot be downloaded from the
account after deletion, so download them first (link to the portal). `/app/account` and
`/app/abonnement` show "Je gegevens worden op {datum} verwijderd" with one button "Toch
bewaren" (`callOffDeletion`: `setDeletion(id, null)`; the cancel stays — undo it separately;
undoing the cancel also calls the deletion off, trigger rule 3).

**`purgeBusiness(deps, businessId, guard)`** (`core/shared/purge.ts`):
```ts
export interface PurgeDeps {
  db: Db; now: Date;
  /** VIDALO_PURGE unset. Applies only when guard = "due" and delete_reason = "retention" (F-010):
   *  an owner's own request (inline, fallback job, scheduled owner date) always deletes. */
  dryRunRetention: boolean;
  /** F-021: true when Stripe lists any subscription of this customer not canceled/incomplete_expired.
   *  Worker and web call Stripe with createFetchHttpClient; Stripe unreachable → throws (retried). Mock: false. */
  stripeLive(customerId: string): Promise<boolean>;
  revokeGoogle(token: string): Promise<void>;             // google-revoke.ts; invalid_token counts as done
  deleteCustomHostname(host: string): Promise<void>;      // publisher/host.ts (route + hostname); mock records the call
  deleteLogin(userId: string): Promise<void>;             // Supabase Admin API DELETE /auth/v1/admin/users/{id}
  sendDeletedMail(to: { email: string; language: "nl" | "en"; businessName: string }): Promise<void>;
}
export type PurgeOutcome =
  | { done: true; loginsDeleted: number; mailed: boolean }
  | { done: false; reason: "not_found" | "guard" | "stripe_live" | "dry_run" };
export function purgeAllowed(b: BusinessRecord, guard: PurgeGuard, now: Date): boolean; // the same rule as the SQL, for the early exit
```
Order: read the business (gone → `not_found`); `purgeAllowed` (else `guard`); when
`stripeCustomerId` is set, `stripeLive` (true → `stripe_live`, logged
`retention.stripe_live { businessId }` and counted with the overdue line; nothing deleted);
dry run (retention only) → stop; read members (`listMemberUserIds`), the mail target (login address of the requester,
else `ownerEmail`), language and name into memory; revoke the Google token (failure logged
as `google.revoke_failed`, continue: the token is deleted with the row); remove the custom
facts host only when this business holds it — `factsHostVerifiedAt` is set **and**
`getBusinessByFactsHost(factsHost)` returns this business — and it is not our own name
(`isOwnFactsHost`, `isOurName`); otherwise skip and log `purge.host_skipped` (F-019;
`deleteCustomHostname` itself also refuses `isOurName` hosts) (failure throws: retried by
the job, nothing deleted yet); `db.purgeBusiness(id, guard, now)` (false
→ `guard`); per member with no business left (`listMemberBusinesses` empty): `deleteLogin`,
`deleteSignIns`; `sendDeletedMail` (failure logged `account.deleted_mail_failed`, no
address); log `account.deleted` `{ guard, loginsDeleted }` with business null. The job
payload carries only `{ businessId, guard }`, never an address or token.

**Google disconnect** (`disconnectGoogle(db, businessId, revoke, reason)` in
`core/shared/google-revoke.ts`): for each `gbp` channel revoke the refresh token (else the
access token) at `https://oauth2.googleapis.com/revoke`, then `deleteChannel`; log
`google.disconnected { reason: "owner" | "churn" | "scan_done" | "purge" }`. `owner_verified_at` stays. Used by the
`/app/google` action, the `google_disconnect` job (queued by `setBusinessStatus` when the
status becomes `churned`, Q14) and the purge.

**Cron** (`apps/worker/src/cron.ts`, new step `retention`, after `ownerSubscription`):
1. `listDeletionReminders(now, 50)` → `claimDeletionReminder` → `email` job
   `{ template: "deletion_reminder", businessId }` (only reason `retention`; an owner's own
   request gets no reminder, F-007);
2. `listDueDeletions(now, 20)` → `purge` job `{ businessId, guard: "due" }`, deduplicated by
   an unrun-job lookup on the new index;
3. churned businesses still holding a `gbp` channel → `google_disconnect` job (backstop);
   and Vidalo Scan businesses whose first full check finished `SCAN_GOOGLE_DAYS` (60, in
   `core/shared/deletion.ts`) days ago, with no open fix and no held Business Profile change
   (`meta.pendingDiff`), still holding a token → `google_disconnect { reason: "scan_done" }`
   (F-015, default pending Julian);
3a. `scanRetention`: for `listScanRetention(200)` set `delete_at` from `last_active_at` and
   `SCAN_RETENTION_MONTHS` (F-012);
4. `pruneAuthThrottle(now − 24 h)`;
5. `countOverdueDeletions(now)` → in `cron.tick` and once per Amsterdam day as
   `log.info("retention.overdue", { count })`.
The `purge` job reads `VIDALO_PURGE`; unset, `dryRunRetention` is true and a retention
purge logs `retention.would_purge { businessId }` (owner deletions are never held back, F-010); the first real purge happens after the
delivery-lead has read a day of those counts and set `VIDALO_PURGE=1` (brief risk table).
Neither new job kind is in `PAID_ONLY`; `paid.ts` is unchanged. `lifecycleTransitions`
keeps the 90-day free check.

**End state on `/app/abonnement`** (AC-6, B2): when `churned`: what stopped (checks, fixes,
syncs, facts page sends visitors to the own website), that reports stay readable until the
deletion date, the date (`deleteAt`), and the Google connection removed.

## Report archive and the owner's own reports (lane B)

`listReportArchive(db, businessId, { limit: 24, before?: string })` (`owner-area.ts`): one
query on `scan_run_archive_idx`, `kind <> 'recheck'`, newest first, keyset cursor
`(created_at, id)` encoded opaque; returns `{ id, kind, status, createdAt, summary:
RunSummary | null }`. Done runs link to `/r/{id}`; `queued`/`running`/`failed` show their
state in words without a link. `saveRunSummary(db, runId, summary)` is called by the
scanner right after it marks a run `done` (`scanner/index.ts`), computed from the same
`ScanReport` the report page shows. `scripts/backfill-run-summaries.mts` fills old runs
(run once per database; the page shows a run without summary with its date and kind and no
counts, never computes in the request).

**Expiry rule (AC-1):** `reportVisible({ kind, checkedAt, businessId }, viewerBusinessIds,
now)` (`core/shared/report-access.ts`): a free report older than `FREE_REPORT_DAYS` is
visible only when `viewerBusinessIds` contains its business; `r/[id]/page.tsx` passes the
ids of `listMyBusinesses(session)` (empty when signed out).

## Scale (lane B, AC-7, ADR-0007)

| Page | Today | After |
|---|---|---|
| `/app/voortgang` | `buildSnapshot` per run, up to 30 runs | one `runSummaries(db, businessId, 30)` query; snapshot from `summary.snapshot` |
| `/app/rapporten` | — | one archive query, limit 24 |
| `/app` | `listFindings` unbounded, `listEvents(…,1000)` in places | findings `limit 500` per status group, events `limit 200` (owner log) — B-03 measures and names each |
| `/app/account`, `/app/abonnement` (lane A's pages) | | budget: no unbounded list; checks `limit 6`, sign-ins `limit 10`, events ≤ `200`; lane A keeps to it, B-03 measures after merge |

Measurement: `countingDb(db)` (B-03, `packages/core/test/helpers/counting-db.ts`) is a Proxy
counting Db method calls and `sql` tagged-template calls; the page loaders are called with
3 and with 36 seeded checks and the counts must be equal. Timings: `scripts/perf/owner-pages.mts`
against a local production build on `verify:pg`'s database (20 loads per page, p95 < 1 s),
recorded in `05-verification.md`. Seed: `scripts/perf/seed-history.mts` (36 monthly checks,
10 questions × 5 AI systems × up to 10 answers, 500 findings, 2,000 events).

## Accessibility and language (AC-8)

Each lane owns the markup of its own pages and builds to these rules: every control a
native `button`/`a`/`select`/`input` with a visible label or `aria-label`; visible focus
(the site's existing focus ring); status after an action in one `<p role="status"
aria-live="polite">` per page fed by the query-string state; dots `aria-hidden` with the
state in words next to them; the switcher a `<form>` with a labelled `<select
name="business">` and a submit button (works without JavaScript); confirmations as their own
page with one primary button and a text link back. Lane B owns `e2e/owner-a11y.spec.ts`
(axe, WCAG 2.2 AA tags as `e2e/a11y.spec.ts`, NL and EN, mock mode) over **all** pages of
AC-8, lane A's included, by URL; it does not own lane A's files. Before merge it runs green on
B's pages; after both merge the delivery-lead runs it whole, and a violation on an A page is
a finding routed to lane A. Every string in `copy.ownerArea` / `copy.accountSecurity` (or
existing namespaces for lane A), NL and EN; no score, percentage or banned word.

## Interface contract

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| `GET /app/rapporten` | `?voor=<cursor>` | page: up to 24 rows newest first, "Oudere rapporten" link when more | not signed in → `/inloggen?next=/app/rapporten` | member (active business) |
| `chooseBusiness` | `business` uuid, `next` path | sets `vidalo_business`, 303 `safeNext(next)` | not a member / unknown → `/app`, cookie unchanged | signed-in login |
| `GET /r/{id}` | run id | report | free > 30 d and viewer not a member → not-found page | anyone with the link; old free report: members only |
| `GET /auth/confirm` | `token_hash`, `type`, `code`, `next` | page with one button; uses nothing up | — | anyone |
| `confirmSignInAction` | same, as form fields | session cookies, `auth_session` row, 303 `safeNext(next)` | bad/used link → `/inloggen?fout=link&next=…` | anyone holding the link (Next Origin check) |
| `sendMagicLink` | `email`, `next`, `business`, `session_id`, Turnstile | 303 `/inloggen?sent=1` | `fout=1` (format), `fout=check` (Turnstile), `fout=wacht` (5/address/h, 20/IP/h, Supabase 429) | anyone |
| `POST /auth/uitloggen` | — | this browser signed out, 303 `/` | foreign Origin → 403, nothing changed | signed-in browser |
| `signOutEverywhere` | — | all sessions ended, `/inloggen?uitgelogd=overal` | — | signed-in login |
| `GET /api/account/export?business=` | uuid | streamed `application/json` attachment | 401 `login_required`; 404 `not_found` (non-member or unknown) | member |
| `deleteMyData` | `business`, `confirm=ja` | `now`: `/inloggen?verwijderd=1`; `at_period_end`: `/app/account?gegevens=gepland#gegevens` | not fresh → `/inloggen?opnieuw=1&next=/app/account/verwijderen`; cancel refused → `?gegevens=fout#gegevens` | member, signed in ≤ 15 min |
| `callOffDeletion` | `business` | `/app/account?gegevens=bewaard#gegevens` | nothing scheduled → same page unchanged | member |
| `changeEmail` | `email` | as today | not fresh → `/inloggen?opnieuw=1&next=/app/account?stap=email%23inlog`; address owns a business outside this login → `bezet` | member, signed in ≤ 15 min |
| `disconnectGoogle` | `business` | `/app/google?ontkoppeld=1` | no connection → `?ontkoppeld=geen` | member |
| abonnement actions (cancel, undo, pause, resume) | + `business` | as today | not a member → `/app` | member |
| `POST /api/billing/portal` | `business` | 303 to Stripe portal | foreign Origin → 403 | member |
| worker `purge` job | `{ businessId, guard }` | `PurgeOutcome` | Cloudflare failure → retried | cron / web fallback |
| worker `google_disconnect` job | `{ businessId, reason }` | channel gone | Google 5xx → retried | `setBusinessStatus`, cron |

## Failure modes

| What fails | Detected how | What the user sees | What we do |
|---|---|---|---|
| Middleware `Set-Cookie` lost on an OpenNext rewrite | A-01 workerd check; AC-3(b) on the production build | signed out after an hour on `/en/…` pages | write cookies on the rewrite response and forward them; if workerd drops them, refresh also in a route handler hop (A-01 records which) |
| Supabase unreachable during refresh | `getClaims` error | treated as signed out, `/inloggen` | no retry loop; the session row stays open |
| `auth_session` row missing for a valid token | `sessionVerdict` = `missing` | `/inloggen?fout=verlopen` once | fail closed (F-005) |
| Throttle table unreachable | DB error in `sendMagicLink` | `fout=1` | fail closed: no mail without a count |
| Cloudflare refuses the hostname delete | exception in purge | "wordt verwijderd, je krijgt een mail" | job retries (5×); nothing deleted until it succeeds; after the last attempt `retention.overdue` shows it |
| Google revoke fails | non-2xx other than `invalid_token` | nothing | `google.revoke_failed` logged; token deleted with the row |
| Purge guard refuses (subscription came back) | `purgeBusiness` false | — | job completes with `guard`; date already cleared by the trigger |
| Supabase admin delete fails | non-2xx | mail still says deleted (business data is gone) | `account.login_delete_failed` logged; the next purge of that login retries; support |
| A second business's cookie choice is stale (business deleted) | not in membership list | the newest business | `getActiveBusiness` falls back |

## Work split

| Ticket | Lane | Depends on | Estimate |
|---|---|---|---|
| C-00 contract scaffold | either (run before the split) | — | 3 h |
| A-01 session refresh in middleware, safe auth cookies (failing test first) | A | C-00 | 5 h |
| A-02 sign-in confirmed by POST and recorded; lifetime; sign-out here/everywhere; sign-in list; 0018 | A | A-01 (same lane) | 8 h |
| A-03 link limits, safe `next`, Origin check, fresh sign-in, address change | A | A-02 (same lane) | 6 h |
| A-04 export without secrets, streamed; Google disconnect | A | C-00 | 5 h |
| A-05 delete on every plan; purge module; 0019 | A | A-03, A-04 (same lane) | 10 h |
| A-06 retention cron, reminder, churn → Google, Scan retention and Scan Google end, end state, Stripe sandbox run | A | A-05 (same lane) | 7 h |
| A-07 privacy text, mails in the lab, auth docs | A | A-04, A-05, A-06 (same lane) | 3 h |
| B-01 membership, switcher, active business, RLS, `channel.meta` grant, verified-host index | B | C-00 | 8 h |
| B-02 report archive, run summary, owner's free reports | B | C-00 | 6 h |
| B-03 scale: counting harness, summaries in voortgang and `/app`, perf run | B | B-02 (same lane) | 6 h |
| B-04 accessibility spec over the owner area | B | B-01, B-02 (same lane) | 4 h |
| B-05 every changing action names its business (F-020) | B | B-01 (same lane) | 4 h |

Lane A ≈ 44 h, lane B ≈ 28 h (Amendment 1). If the cycle must shrink, the brief's own split applies:
002a = C-00, A-01…A-05, A-07 (AC-3, AC-4, AC-5); 002b = A-06, B-01…B-04 (AC-1, AC-2, AC-6,
AC-7, AC-8 including lane A's pages).

No ticket in one lane waits for a ticket in the other. Merge order: `tickets/README.md`.

## Hand-off D1 for Julian (Supabase dashboard and secrets)

Done before verification; each is one page. The project ref is `bbynmqvaxpjdnkaasutd`
(Vidalo) — the Sitty and Sonable projects sit in the same organisation.

1. **URL configuration** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/url-configuration
   - Site URL: `https://vidalo.ai`
   - Redirect URLs, add: `https://vidalo.ai/**` and `https://www.vidalo.ai/**`; keep
     `https://vidalo.io/**`, `https://vidalo-web-staging.julian-devriend.workers.dev/**`,
     `https://vidalo-web-preview.julian-devriend.workers.dev/**`, `http://localhost:3000/**`
2. **Custom SMTP** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/smtp
   (exactly as `docs/auth-email/README.md` §1): Enable Custom SMTP `on`; Sender email
   `inloggen@vidalo.io`; Sender name `Vidalo`; Host `smtp.resend.com`; Port `465`; Username
   `resend`; Password: a new Resend key with sending access for `vidalo.io`, made at
   https://resend.com/api-keys (Permission `Sending access`, Domain `vidalo.io`).
3. **Templates** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/templates:
   Magic Link and Confirm signup as in `docs/auth-email/README.md` §2 (unchanged by this
   feature); Change Email Address: the button's link must be
   `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email_change`.
4. **Email provider** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/providers
   (Email): Secure email change `on`.
5. **Sessions** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/sessions:
   Detect and revoke potentially compromised refresh tokens `on`; Refresh token reuse
   interval `10`; only if the project is on Pro: Time-box user sessions `2160` (hours = 90
   days), Inactivity timeout `720` (hours = 30 days). The app enforces both either way.
6. **JWT expiry** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/settings/jwt:
   Access token expiry time `3600`.
7. **Rate limits** — https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/rate-limits:
   Rate limit for sending emails `30` per hour (the app limits per address and IP before it).
8. **Secrets** (the agent can set these with `wrangler secret put`; Julian only when the
   permission layer stops it) — https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-web/production/settings
   (Variables and Secrets): `VIDALO_AUTH_SECRET` = the output of `openssl rand -hex 32`.
   https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-worker/production/settings:
   `SUPABASE_URL` = `https://bbynmqvaxpjdnkaasutd.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY` =
   the service_role key from https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/settings/api-keys.
   `STRIPE_SECRET_KEY` = the same Vidalo live key `vidalo-web` uses (the purge's
   `stripeLive`, F-021).
   `VIDALO_PURGE` stays unset until a day of `retention.would_purge` has been read.

## What this makes harder later

- **Every page render now costs one indexed read of `auth_session`**, and a missing row signs
  the owner out. Any new way to sign in (passkey, Google sign-in) must go through
  `confirmSignInAction`'s recording or it will produce sessions that fail closed.
- **The membership table is a mirror of `owner_user_id` this cycle.** Team access must first
  decide which of the two becomes the writer; until then a second role is not possible
  without a migration (the CHECK allows only `owner`).
- **Destructive actions must carry the business id in the form.** A new action written with
  only `requireOwner()` would act on whichever business the cookie names at that moment.
- **The deletion date lives on `business` with a trigger.** Any code that sets
  `status = 'churned'` gets a deletion date whether it wants one or not; a "churned but keep
  forever" case needs a migration.
- **The export's allow-list means a new channel `meta` key is invisible to the owner** until
  someone adds it, which is the safe default and also a way to forget art. 15.
- **Summaries are written by the scanner.** A change in how the report counts answers must
  also change `summary.v` and re-run the backfill, or the archive and the report disagree.
- **Every changing action needs the business in its form** (§1a); a new action without it refuses.
- **The purge needs Stripe, Cloudflare, Google and Supabase Admin to answer**; a long outage of any
  one shows up as `retention.overdue`, not as a silent miss — but someone must read it.
