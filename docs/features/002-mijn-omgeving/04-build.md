# Build log — 002 Mijn omgeving

*Each lane writes only under its own heading.*

## Lane B (membership, archive, scale, accessibility)

Branch `claude/nice-kepler-ff2f14`, cut from C-00 (`4cd414c`). Local Postgres 18 for `verify:pg` (`PG_ADMIN_URL=postgresql://postgres@localhost:55432/postgres`, a throwaway cluster in the session scratchpad). Root `.env` untouched; every run with `DATABASE_URL=` empty. Hosted Supabase, Stripe and Cloudflare were not touched; 0016 and 0017 are applied nowhere hosted.

Ticket numbers follow the ticket files (B-01 = membership and switcher, B-02 = archive), not the order in the hand-over message.

### B-01 — membership, active business, switcher
Built to the ticket: `0016_business_member.sql` (table, one-owner index, user index, `member_self`, `revoke all` then `grant select`, `sync_business_owner_member` security definer with empty `search_path` and execute revoked, backfill, the seven `owner_*` policies recreated as `member_*` with `(select auth.uid())`, `channel` column grant without `meta` (F-017), `business_facts_host_verified_uniq` (F-019; the duplicate pre-check query is in the migration's comment, to be run by the delivery-lead before applying)); `db/owner-area.ts` (Pg through `business_member`, Mem derived from `ownerUserId`); `lib/active-business.ts` (`listMyBusinesses` = `linkBusinessesByEmail` + `listMemberBusinesses` + owner address follows the login, `cache()` keyed on the two strings; `getActiveBusiness` = cookie if in the list, else newest); `lib/owner.ts` (`requireOwner` on the active business; `requireOwnerOf`/`requireVerifiedOwnerOf` on `listMyBusinesses`, same redirect for non-member, unknown and malformed ids); `business-actions.ts` (`chooseBusiness`); `BusinessSwitcher` + `SwitchStatus` in the layout; `lib/reads.ts` selects named `channel` columns; demo seed (Haarlem stays the newest so it is the default; Amsterdam; control Utrecht on `ander@example.nl`; an English login `owner@harbour.example` with two English businesses so the EN checks do not touch the shared demo owner, whose pages follow `business.language`).

Findings while building:
- `instanceof MemDb/PgDb` is false across Next's per-route module graphs (dev) and OpenNext bundles; `owner-area.ts` branches on `db.kind`, as the demo seed already does.
- `postgres.camel` makes `user_id` arrive as `userId`; the first PgDb run caught it.
- The old `getOwnedBusiness` returned a business found by owner e-mail even when another login owned it; `linkBusinessesByEmail` links only unowned rows (SEC-11), so that path is gone.
- The switcher first overflowed the header at 375 px (caught by `profile-correction.spec.ts` "@mobile"); it now wraps, and `owner-area.spec.ts` has its own 375 px check.

Evidence:
- `pnpm verify:pg` on the local Postgres: migrations 0001–0016 apply, `db-membership.test.ts` (7 tests, Mem + Pg) and the other db tests green, `e2e-mock` on PgDb green ("OK verify:pg — 1963 samples").
- `scripts/rls/membership.sql` (SEC-07/08/09/10, F-019), one rolled-back block, final message:
  `RLS-OK login1[business=2 facts=2 finding=2 fix=2 channel=2 event=2 scan_run=2 business_member=2 ] login2[business=1 facts=1 finding=1 fix=1 channel=1 event=1 scan_run=1 business_member=1 ] anon[business=0 facts=0 finding=0 fix=0 channel=0 event=0 scan_run=0 business_member=0 ]`
  Control: the same block with `-v broken=1` (`member_business` recreated as `using (true)`) ends `RLS-FAIL login1 sees 7 business rows, expected 2`. Nothing stays behind (0 rows with slug `rls-%`). The block also asserts: no insert/update/delete/truncate/references/trigger on `business_member` for anon/authenticated, the trigger function not executable by them, `select meta from channel` and `select * from channel` denied while `select id, status` works, the service side still reads `meta`, a second verified holder of the same facts host raises a unique violation, and owner A → B → null moves the member row. The block grants Supabase's default table privileges inside the transaction because the local shim has none; on the hosted project those grants are already there.
- `e2e/owner-area.spec.ts` (production build, `E2E_SERVER=start`): 7 tests green — one business has no switcher; NL and EN switch + every nav page + reload + status line; forged option / forged cookies (control's id, malformed, all-zero uuid) leave the own business and set no cookie; cookie is HttpOnly, SameSite=Lax, Path=/, ~90 days; `next=//evil.example/x` ends on `/app`; 375 px. Fails without the change (restoring C-00's resolver and layout: "Expected: 1, Received: 0" for the switcher).
- `e2e/signed-in.spec.ts`, `auth-redirect.spec.ts`, `a11y.spec.ts`, `profile-correction.spec.ts` green on the production build.

Not done in B-01 (by design): `requireOwnerOf` is not yet called by the changing actions (B-05); `/r/[id]` still uses the active business (B-02).
