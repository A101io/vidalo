# Tickets — 002 Mijn omgeving

*architect · 2026-11-11 · contract: `../02-architecture.md` "Shared contract"*

## How the work runs
1. **C-00** (3 h) is committed on `claude/002-mijn-omgeving` first. It puts every shared
   signature into code with today's behaviour and gives each shared file one owner.
2. Two worktrees are cut from that commit: `claude/002-lane-a` (Opus) and
   `claude/002-lane-b` (Sonnet). They build at the same time. Inside a lane the tickets run
   in their number order; no ticket in one lane waits for the other lane.
3. Merge order into `claude/002-mijn-omgeving`: **lane B first, then lane A** (rebased onto
   it). The file sets are disjoint, so neither merge has a conflict; B first means lane A's
   purge and export tests run once more against the real membership table before A lands.
   After both:
   - remove the `test.fixme` marks in `e2e/owner-a11y.spec.ts` and run it whole (B-04);
   - `pnpm perf:owner` over all five pages including `/app/account` and `/app/abonnement` (B-03);
   - `pnpm -r typecheck && pnpm -r test && pnpm e2e:mock && pnpm verify:pg`, `pnpm e2e:auth`;
   - `scripts/rls/membership.sql` on `verify:pg`'s database;
   - then (delivery-lead, ref `bbynmqvaxpjdnkaasutd` checked on every call) apply 0016,
     0017, 0018, 0019 in that order to the hosted project and run the RLS block there.
   A finding on a page of the other lane goes to that lane; neither lane edits the other's files.

## Lanes
| Ticket | Lane | AC | Estimate | Files owned (summary; exact lists in each ticket) |
|---|---|---|---|---|
| C-00 | before the split | all | 3 h | scaffold, `vidalo_business` cookie row + legal lock, action moves, safe `safeNext`: see C-00 |
| A-01 | A | AC-3 a, b | 5 h | middleware, `lib/supabase.ts`, `lib/auth-cookies.ts`, fake GoTrue, auth Playwright config + spec |
| A-02 | A | AC-3 c–f, AC-4 d | 8 h | 0018, `session-life.ts`, `lib/session.ts`, Db session methods, `/auth/confirm` page + action, callback, uitloggen, account sign-ins |
| A-03 | A | AC-4 a, b, c, e; AC-5 c (address) | 6 h | `safe-next.ts`, `auth-throttle.ts`, `same-origin.ts`, `lib/fresh-sign-in.ts`, `lib/env.ts`, inloggen, portal |
| A-04 | A | AC-5 a, e; AC-7 export | 5 h | `my-data.ts`, `export-stream.ts`, `google-revoke.ts`, export route, `/app/google`, `api/google/start` + `callback` |
| A-05 | A | AC-5 b, c (delete), d | 10 h | 0019, `deletion.ts`, `purge.ts`, worker `purge` job, account mails, delete page + actions, abonnement actions, `publisher/host.ts` |
| A-06 | A | AC-6 | 7 h | worker cron `retention`, reminder mail, `setBusinessStatus`, abonnement end state, Stripe run script |
| A-07 | A | AC-5 f | 3 h | `copy.legal` + lock, mail lab, auth docs |
| B-01 | B | AC-2 | 8 h | 0016 (incl. `channel.meta` column grant, verified-host unique index), `owner-area.ts` membership, `active-business.ts`, `owner.ts`, switcher, layout, `reads.ts` |
| B-02 | B | AC-1 | 6 h | 0017, run summary, scanner hook, `/app/rapporten`, `report-access.ts`, `/r/[id]` |
| B-03 | B | AC-7 | 6 h | counting harness, `/app` and `/app/voortgang` reads, perf scripts |
| B-04 | B | AC-8 | 4 h | `e2e/owner-a11y.spec.ts`; fixes on B's pages only |
| B-05 | B | AC-2 (F-020) | 4 h | `gegevens/*`, `app/app/actions.ts`, `fouten/[id]`, `vermeldingen/[id]`, `domein`, `api/domain/verify`, `api/checkout`, `api/lang`, `LangSwitch` |

## File ownership (proof of disjointness)
Every file that either lane creates, changes or deletes, with its single owner. "C-00" means
created or wired by the scaffold and then frozen (neither lane edits it).

| File | Owner |
|---|---|
| `supabase/migrations/0016_business_member.sql` | B |
| `supabase/migrations/0017_run_summary.sql` | B |
| `supabase/migrations/0018_auth_sessions.sql` | A |
| `supabase/migrations/0019_deletion_retention.sql` | A |
| `packages/core/src/db/types.ts` | A |
| `packages/core/src/db/mem.ts` | A |
| `packages/core/src/db/pg.ts` | A |
| `packages/core/src/db/owner-area.ts` | B |
| `packages/core/src/db/index.ts` | C-00 (frozen) |
| `packages/core/src/shared/index.ts` | C-00 (frozen) |
| `packages/core/src/shared/safe-next.ts` | A |
| `packages/core/src/shared/same-origin.ts` | A |
| `packages/core/src/shared/session-life.ts` | A |
| `packages/core/src/shared/auth-throttle.ts` | A |
| `packages/core/src/shared/purge.ts` | A |
| `packages/core/src/shared/google-revoke.ts` | A |
| `packages/core/src/shared/export-stream.ts` | A |
| `packages/core/src/shared/deletion.ts` | A |
| `packages/core/src/shared/my-data.ts` | A |
| `packages/core/src/shared/db.ts` | A |
| `packages/core/src/shared/report-access.ts` | B |
| `packages/core/src/scanner/index.ts` | B |
| `packages/core/src/progress.ts` (only if needed) | B |
| `packages/core/src/reporter/account-mails.ts` | A |
| `packages/core/src/reporter/index.ts` | A |
| `packages/core/src/copy/index.ts` | A |
| `packages/core/src/copy/en.ts` | A |
| `packages/core/src/copy/legal.lock.json` | A (first written by C-00) |
| `packages/core/src/copy/account-security.ts`, `account-security.en.ts` | A |
| `packages/core/src/copy/owner-area.ts`, `owner-area.en.ts` | B |
| `packages/core/test/session-life.test.ts`, `safe-next.test.ts`, `auth-throttle.test.ts`, `same-origin.test.ts`, `export-secrets.test.ts`, `google-revoke.test.ts`, `deletion.test.ts`, `purge.test.ts`, `db-account.test.ts`, `my-data.test.ts` | A |
| `packages/core/test/db-membership.test.ts`, `report-access.test.ts`, `run-summary.test.ts`, `owner-area-scale.test.ts`, `helpers/counting-db.ts` | B |
| `apps/web/middleware.ts` | A |
| `apps/web/lib/auth-cookies.ts` | A |
| `apps/web/lib/supabase.ts` | A |
| `apps/web/lib/session.ts` | A |
| `apps/web/lib/env.ts` | A |
| `apps/web/lib/fresh-sign-in.ts` | A |
| `apps/web/lib/auth-confirm.ts` (deleted) | A |
| `apps/web/lib/demo-account.ts` | A |
| `apps/web/lib/active-business.ts` | B |
| `apps/web/lib/owner.ts` | B |
| `apps/web/lib/core.ts` | B |
| `apps/web/lib/reads.ts` | B |
| `apps/web/lib/owner-data.ts` | B |
| `apps/web/lib/owner-log.ts` | B |
| `apps/web/lib/report.ts` (only if the counting moves) | B |
| `apps/web/lib/demo-owner-area.ts` | B |
| `apps/web/components/BusinessSwitcher.tsx` | B |
| `apps/web/app/app/layout.tsx` | B |
| `apps/web/app/app/page.tsx` | B |
| `apps/web/app/app/voortgang/page.tsx` | B |
| `apps/web/app/app/rapporten/page.tsx` | B |
| `apps/web/app/app/business-actions.ts` | B |
| `apps/web/app/r/[id]/page.tsx` | B |
| `apps/web/app/app/actions.ts` (after C-00 moves `setLanguage` and `deleteMyData` out) | B |
| `apps/web/app/app/gegevens/actions.ts`, `page.tsx`, `FactsForm.tsx`, `ProfileGroup.tsx` | B |
| `apps/web/app/app/fouten/[id]/page.tsx`, `apps/web/app/app/vermeldingen/[id]/page.tsx` | B |
| `apps/web/app/app/domein/page.tsx`, `apps/web/app/api/domain/verify/route.ts` | B |
| `apps/web/app/api/checkout/route.ts` | B |
| `apps/web/app/api/lang/route.ts`, `apps/web/components/LangSwitch.tsx` | B |
| `apps/web/app/app/account/page.tsx` | A |
| `apps/web/app/app/account/actions.ts` | A |
| `apps/web/app/app/account/verwijderen/page.tsx`, `actions.ts` (created by C-00) | A |
| `apps/web/app/app/abonnement/page.tsx`, `actions.ts`, `opzeggen/page.tsx`, `pauzeren/page.tsx` | A |
| `apps/web/app/app/google/page.tsx`, `actions.ts` | A |
| `apps/web/app/inloggen/page.tsx`, `actions.ts` | A |
| `apps/web/app/auth/confirm/page.tsx`, `actions.ts` (new), `route.ts` (deleted) | A |
| `apps/web/app/auth/callback/route.ts` | A |
| `apps/web/app/auth/uitloggen/route.ts` | A |
| `apps/web/app/layout.tsx` (only: skip trackers, chat widget, `ask.js`, `motion.js` on `/auth/*`; A-03, SEC-25, F-A1; assigned 12 Nov 2026) | A |
| `apps/web/app/api/account/export/route.ts` | A |
| `apps/web/app/api/billing/portal/route.ts` | A |
| `apps/web/app/api/google/start/route.ts`, `apps/web/app/api/google/callback/route.ts` | A |
| `packages/core/src/publisher/host.ts` | A |
| `apps/worker/**` (cron, jobs, tests) | A |
| `scripts/mail-lab.mts` | A |
| `scripts/stripe-lifecycle-run.mts` | A |
| `scripts/site/snapshot.mjs` (A-02, F-A2; assigned 12 Nov 2026) | A |
| `scripts/backfill-run-summaries.mts` | B |
| `scripts/perf/seed-history.mts`, `scripts/perf/owner-pages.mts` | B |
| `scripts/rls/membership.sql` | B |
| `scripts/verify-pg.sh` | C-00 (frozen) |
| root `package.json` | C-00 (frozen) |
| `playwright.auth.config.ts` | A |
| `e2e/fixtures/fake-gotrue.ts`, `e2e/auth-session.spec.ts`, `e2e/account.spec.ts`, `e2e/helpers-account.ts`, `e2e/auth-redirect.spec.ts`, `e2e/signed-in.spec.ts` | A |
| `e2e/owner-area.spec.ts`, `e2e/owner-a11y.spec.ts`, `e2e/helpers-owner-area.ts` | B |
| `docs/auth-email/README.md`, `docs/CANCEL-PAUSE.md`, `docs/processors.md` (if needed), `docs/records-of-processing.md` | A |

Not touched by either lane (they keep working through the `getOwnedBusiness` alias, which
resolves the active business, and none of them writes about a business):
`apps/web/app/feiten/[slug]/page.tsx`, `apps/web/app/app/gegevens/versies/page.tsx` (read only),
`apps/web/lib/demo.ts`, `apps/web/lib/lang-paths.ts`, `packages/core/src/types.ts`,
`packages/core/src/billing/**`, `packages/core/src/publisher/**` except `host.ts`,
`playwright.config.ts`, `e2e/a11y.spec.ts`, `e2e/helpers.ts`. If a lane finds it must edit one
of these, it stops and files a finding; the architect assigns it.

## Interfaces each lane consumes from the other
| Consumer | Name | Provided by | Stub until merge |
|---|---|---|---|
| A | `getActiveBusiness`, `listMyBusinesses`, `ACTIVE_BUSINESS_COOKIE` | B (`apps/web/lib/active-business.ts`) | C-00: today's single-business resolver |
| A | `requireOwnerOf`, `requireVerifiedOwnerOf`, `businessFromForm`, `requireOwner` | B (`apps/web/lib/owner.ts`) | C-00: id must equal the one business |
| B | `checkNow` posted from lane A's account page with the hidden `business` | A adds the field (A-02) | until A merges, the account page's "Controleer nu" is refused on the feature branch; nothing ships between the two merges |
| A | `listMemberBusinesses`, `listMemberUserIds`, `isMember` | B (`packages/core/src/db/owner-area.ts`) | C-00: by `owner_user_id`, no limit (already correct for two businesses on one owner id) |
| B | `Session` (`userId`, `email`, `sessionId`, `signedInAt`), `getSession` | A (`apps/web/lib/session.ts`) | C-00: placeholders for the two new fields |
| B | `safeNext` | A (`packages/core/src/shared/safe-next.ts`) | C-00 ships the final safe body (F-023) |
| B | routes of lane A's pages, rendering in mock mode | A | B-04 marks them `fixme` until merge |
