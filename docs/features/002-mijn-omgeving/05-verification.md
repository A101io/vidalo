# 05 — Verification, 002 Mijn omgeving (round 1 of 2)

*delivery-lead · 2026-11-12 · merged from `verification/qa.md`, `verification/security.md`,
`verification/compliance.md` against `claude/002-mijn-omgeving` at `6b6446e` plus QA's
uncommitted test files. Rules: `_OS/playbook/PIPELINE.md` phase 4,
`templates/pipeline/SEVERITY.md`, applied literally. Every ID below is a row in `findings.md`.*

## 1. Verdict: FIX AND RE-VERIFY

One P0 is open and valid: **V-QA-03** (AC-5(d) fails). It costs about 1 h. Nothing needs a
decision from Julian before the fix round starts; the legal-text sentences (memo in
`state.md`) wait for his yes before merge to `main`, not before the fix round.

Round 2 re-verifies only the items in section 4. QA flips `it.fails` to `it` in
`facts-after-purge-qa.test.ts` and reruns AC-5. Security reruns `addon.mts` and `host.mts`, and
compliance rereads V-COMP-01..05. Nothing else is re-reviewed.

## 2. Failing acceptance criteria

| AC | Failing case | Finding |
|---|---|---|
| **AC-5(d)** "the facts page's hosts answer 'not found'" | Serve `https://bakkerij-weg-haarlem-feiten.vidalo.io/` → 200. Then run `purgeBusiness(…, "no_subscription")` → done. Serve again → **200 with the deleted business's page**, expected 404. This lasts up to 10 min per isolate, plus `cache-control: public, max-age=600` downstream. Test: `packages/core/test/facts-after-purge-qa.test.ts:52`, re-run by the delivery-lead on 12 Nov (the `it.fails` case passes because the AC still fails) | V-QA-03 |

Not failing, not verified (section 6): AC-4(f) (real mail, D1) and the AC-6 Stripe sandbox run (D2).
Every other AC passes with a control that was observed red (QA's table).

## 3. P0 claims and rulings

| ID | Claimed by | Path or citation | Ruling |
|---|---|---|---|
| **V-QA-03** | qa, P0 | AC-5(d) is not met. The failing case is written down and runs as a test (above). `publisher/serve.ts:16,92` caches the rendered page per host for 10 min and never re-reads the database on a hit. The purge does not clear it, and a clear could not reach other isolates anyway | **P0 stands.** It is QA's defined form: an acceptance criterion from the brief that demonstrably fails, with the failing case written down. The foreseeability cap binds security and compliance only, so it does not apply. **It was foreseeable**: the brief names `publisher/serve.ts` as the facts-page path (01-brief §4, line 175), yet the architecture's purge order did not trace AC-5(d) through it, and `tickets/README.md` listed `publisher/**` except `host.ts` as "not touched by either lane". That is an architecture miss, routed back below. The alternative was to amend AC-5(d) to "within 10 minutes", which is the analyst's call plus Julian's approval. I rejected it because the fix costs 1 h, less than the brief change. `serve.ts` is assigned to **lane A** (A-05 owns the purge and AC-5(d)) |
| **V-SEC-01** | security, P0 | Cron step 3a dates every `setup/trial` business (`retention`). On the `monitor_addon` webhook, `upsertBusiness({plan:"monitor"})` violates CHECK `business_delete_only_when_ending` (0019:22-27), because trigger rule 3 (0019:49) fires only on a change of status or `cancel_at`. The webhook then answers 500 on every retry while Stripe bills €49/month. Read by the delivery-lead in 0019 and confirmed: after the write the row is `plan monitor, status trial, cancel_at null, delete_at set`, which no CHECK branch admits | **Demoted to P1.** It falls outside security's P0 form, which is a plausible *exploit* path. Security's own text says "a defect, not an attacker's exploit". Its own phase-1 rows set the severity for this case: SEC-43 "*Sev:* P1", and SEC-59 "P0 if a client-written value changes what is billed; else P1". No client writes a value here. The foreseeability rule does not apply because the item was on the list. **Security's disagreement goes to Julian at ship time**: "a customer billed for a service that never starts is money lost, whatever the cause." The ruling does not weaken the fix. It is item 1 of lane A's list, and the delivery-lead will **not apply 0019 to the hosted project** until it is fixed, because the harm only exists once 0019 and the cron run in production. Fix by amending 0019 rather than adding 0020. 0019 is applied only to local verify databases and is not on `main`, so the "migrations are never edited" convention, which protects applied ledgers, is not engaged. Drop and recreate `vidalo_verify` and `sec002` |
| **V-COMP-01** | compliance, "P0 if deployed so" | Two problems. (1) `secrets.manifest.json` targets `STRIPE_SECRET_KEY` at web only, so the worker's `stripeLive` throws and no worker purge runs. (2) `deleteLogin` (worker `jobs/purge.ts:33-37`, web `verwijderen/actions.ts:39-40`) logs "mock" and **returns success** without the Admin key outside mock mode; `purge.ts` counts the login as deleted and the mail says so. AVG art. 17(1), 12(3) | **P1, not P0.** Nothing is deployed, so no erasure has been reported falsely. The condition is a deploy configuration that a release gate prevents. The fail-open code is still a defect: lane A makes `deleteLogin` fail closed outside mock mode. The manifest targets are a release gate (section 7). If the worker is ever deployed without either secret, it becomes a hard stop at once |
| **V-COMP-03** | compliance, "hard stop if it occurs" | `listDueDeletions(now, 20)` (`cron.ts:287`, `pg.ts:900-905`) can fill with retention rows that a dry run skips, or with `stripe_live` holds, and starve an owner's own scheduled deletion. AVG art. 17(1), 12(3) | **P1, not P0.** It has not occurred. It needs 20 or more overdue held rows, and production has no businesses with retention dates (0019 is not applied hosted). It is a real defect at scale: 30 min in lane A, together with V-COMP-05, so the dry run sends no reminders |

Open P0s after this ruling: **V-QA-03**.

## 4. Fix lists, one per lane, in order

### Lane A (A-01…A-07 files, plus `publisher/serve.ts`, `reporter/subscription-mails.ts`, `secrets.manifest.json`, `docs/secrets-and-keys.md`, assigned 12 Nov 2026)

| # | ID | Sev | Fix | Cost | Files |
|---|---|---|---|---|---|
| 1 | V-QA-03 | **P0** | On a cache hit, re-read the business by primary key. If it is gone, drop the entry and answer the existing 404. If its status changed, drop it and resolve again (this also makes the AC-6 churn redirect immediate). Call `clearServeCache(host)` in the purge after the delete. Set the page `cache-control` to `public, max-age=60`. Flip `it.fails` → `it` | 1 h | `packages/core/src/publisher/serve.ts`, `packages/core/src/shared/purge.ts`, `packages/core/test/facts-after-purge-qa.test.ts` |
| 2 | V-SEC-01 | P1 (claimed P0) | Trigger rule 3 also fires on `old.plan is distinct from new.plan`, so a Scan becoming Monthly loses its retention date. Mirror it in MemDb. Tests through `handleStripeEvent` on Mem and Pg: a dated Scan + `monitor_addon` → `activated`, `plan monitor`, `deleteAt null`; the same for a `monitor` checkout from a report | 45 min | `supabase/migrations/0019_deletion_retention.sql`, `packages/core/src/db/mem.ts`, a test in `packages/core/test/deletion.test.ts` |
| 3 | V-COMP-01 | P1 | `deleteLogin` (worker and web) throws when URL or key is missing, unless in mock mode, as `stripeLive` already does. Add `worker` to the `STRIPE_SECRET_KEY` targets. Test: key unset, not mock → throws, `loginsDeleted` 0 | 30 min | `apps/worker/src/jobs/purge.ts`, `apps/web/app/app/account/verwijderen/actions.ts`, `secrets.manifest.json` |
| 4 | V-SEC-07 | P2 (release gate) | Manifest entry `VIDALO_AUTH_SECRET` targeting web (production, staging), plus a row in `secrets-and-keys.md` (32 random bytes, hex) | 10 min | `secrets.manifest.json`, `docs/secrets-and-keys.md` |
| 5 | V-COMP-03 + V-COMP-05 | P1 | Pass `dryRun` into the cron's retention step. While it is on, skip retention rows in `listDueDeletions` and send no `deletion_reminder`. Order `delete_reason = 'owner'` first. Test: 25 overdue retention rows with the flag unset plus one owner row → the owner row is queued and deleted, and no reminder is sent | 45 min | `apps/worker/src/cron.ts`, `packages/core/src/db/pg.ts`, `packages/core/src/db/mem.ts`, `packages/core/src/db/types.ts`, `apps/worker/test/retention.test.ts` |
| 6 | V-COMP-04 | P1 | `countOverdueDeletions` also counts unfinished or retired `purge` jobs older than a day. Log `account.delete_failed { businessId }` when a purge job is retired (SEC-45). Test: a failing fallback job → overdue 1 the next day | 30 min | `packages/core/src/db/pg.ts`, `mem.ts`, `apps/worker/src/jobs/purge.ts`, `apps/worker/test/purge-job.test.ts` |
| 7 | V-COMP-02 | P1 | `listScanRetention` selects only the rows that need work, or pages until done. Test with 201 Scan businesses on Mem and Pg | 1 h | `packages/core/src/db/pg.ts`, `mem.ts`, `apps/worker/src/cron.ts` |
| 8 | V-SEC-04 | P1 | Before the delete, expire the customer's open Checkout Sessions (`checkout.sessions.list({customer,status:"open"})` → `expire`), next to `stripeLive`, with fetch on Workers. Test with a fake Stripe holding an open session | 1 h | `packages/core/src/shared/purge.ts`, `apps/worker/src/jobs/purge.ts`, `apps/web/app/app/account/verwijderen/actions.ts`, `packages/core/test/purge.test.ts` |
| 9 | V-COMP-06 | P1 | The purge deletes `auth.audit_log_entries` where `payload->>'actor_id'` = the user id, skipped when the `auth` schema is absent. Add the privacy P1 sentence (NL and EN) on Supabase's per-sign-in IP and browser record. The sentence waits for Julian's yes (memo) | 1 h | `packages/core/src/shared/purge.ts`, `packages/core/src/db/pg.ts`, `packages/core/src/copy/index.ts`, `en.ts`, `legal.lock.json` |
| 10 | V-COMP-09 | P1 | Read the Supabase backup and Resend retention pages and record them in `processors.md`. Add the privacy P3 backup sentence (NL and EN), with N per the plan in use. Waits for Julian's yes (memo) | 30 min | `docs/processors.md`, `copy/index.ts`, `en.ts` |
| 11 | V-COMP-08 | P1 | Add the terms sentence on how long a Scan facts page stays online (NL and EN), worded as Julian approves (memo) | 30 min | `copy/index.ts`, `en.ts`, `legal.lock.json` |
| 12 | V-SEC-03 | P2 | `lib/supabase.ts` `setAll(list, headers)` applies the headers. Route handlers that call `getSession()` answer `private, no-store` | 20 min | `apps/web/lib/supabase.ts`, route handlers of lane A |
| 13 | V-COMP-10 | P2 | `sendDeletedMail` gets `googleRevoked`; the revoke clause appears only when it is true | 20 min | `packages/core/src/reporter/account-mails.ts`, `copy/index.ts`, `en.ts`, `shared/purge.ts` |
| 14 | V-COMP-12 | P2 | `cancel_confirmed`: add the Google end on the end date, deletion 120 days later with a reminder, and "tot {datum}" (NL and EN) | 20 min | `packages/core/src/reporter/subscription-mails.ts`, copy |
| 15 | V-COMP-11 | P2 | When pruning, end and delete open rows outside the newest 10 | 20 min | `packages/core/src/db/pg.ts`, `mem.ts` |
| 16 | V-SEC-06 | P2 | "bezet" becomes one query: any business with this owner address outside my ids | 15 min | `apps/web/app/app/account/actions.ts`, `db/pg.ts`, `mem.ts`, `types.ts` |
| 17 | V-COMP-13 | P2 | `myData.body` wording and the portal pointer (NL and EN) | 10 min | `copy/index.ts`, `en.ts` |
| 18 | V-COMP-15 | P2 | Set `copy.legal.updated` to the day `main` is deployed and run `legal:lock`. **Deploy day, not this round** | 5 min | `copy/index.ts`, `en.ts`, `legal.lock.json` |

**Lane A total:** P0 + P1 (items 1–3, 5–11) ≈ **7 h 30 min**. P2 items 4 and 12–18 ≈ 1 h 40 min,
of which item 4 is required as a release gate and the rest ship past if the round runs long.
Items 9–11 code first. Their copy merges to `main` only after Julian's yes.

### Lane B (B-01…B-05 files, plus `e2e/profile-correction.spec.ts`, assigned 12 Nov 2026)

| # | ID | Sev | Fix | Cost | Files |
|---|---|---|---|---|---|
| 1 | V-SEC-05 | P1 | The CNAME-failed branch writes `factsHostVerifiedAt: null` together with the new `factsHost`. Route test: a verified owner submitting a foreign host loses verified status and does not block the victim's verify | 30 min | `apps/web/app/api/domain/verify/route.ts`, its test |
| 2 | F-024 | P2 | `setLang()` adds `&business=<id>` from the hidden `business` input on `/app/gegevens`. It is the only failing test in the app's Playwright suites | 5 min | `e2e/profile-correction.spec.ts` (feature 001, in neither lane; assigned to B because B-05 changed `/api/lang`) |
| 3 | V-QA-05 | P2 | Count only the block's own `rls-%` rows in every global count. Needed **before** the delivery-lead runs the block on the hosted project | 15 min | `scripts/rls/membership.sql` |
| 4 | V-SEC-02 | P2 | `refuseCrossSite(req, env.baseUrl)` first, plus `auth.cross_site_refused {route:"domain_verify"}` and a route test | 10 min | `apps/web/app/api/domain/verify/route.ts` |

**Lane B total:** P1 30 min, P2 30 min, **1 h**. Items 2 and 3 are needed for a green suite and a clean hosted run.

### Outside both lanes

| ID | Sev | Fix | Cost | Owner |
|---|---|---|---|---|
| V-COMP-07 | P1 | Daily `retention.overdue` (plus V-COMP-04's failed jobs) in the Vidalo Control Room cell, red when > 0 | 30 min | delivery-lead, `A101/_OS/control-room` (fix slot) |
| V-SEC-08 | P2 | Per-business TXT or CNAME-label proof for facts hosts | half a day | architect. **Deferred** to the facts-host work (go-live D6): pre-existing, needs a design, and no custom hosts exist in production |
| V-COMP-14 | P2 | IndexNow ping and 410 for purged facts URLs | 1 h | lane A. **Deferred**: P2, on compliance's own list as P2, ships past |

QA's new test files get owners for future edits. Lane A: `db-purge-qa.test.ts`,
`facts-after-purge-qa.test.ts`, `retention-qa.test.ts`, `owner-forged-billing-qa.spec.ts`,
`auth-cookie-https.spec.ts`, `playwright.https.config.ts`, `e2e/fixtures/tls-proxy.ts`. Lane B:
`owner-area-scale-qa.test.ts`, `owner-keyboard-qa.spec.ts`. `packages/core/test/legal.test.ts`
goes to lane A (F-A6, confirmed).

## 5. Checked and passed

- **AC-1, AC-2, AC-3, AC-7, AC-8 pass**, each with a control observed red. AC-4(a)–(e) pass.
  AC-5(a)(b)(c)(e)(f) pass. The worker part of AC-6 passes (QA table).
- `pnpm -r typecheck` green. `pnpm -r test`: core 1387 passed / 19 skipped, worker 39.
  `verify:pg` OK (0001–0019, 98 db tests). PgDb by hand 45/45. Playwright desktop on the
  production build: 163 passed, F-024 the only failure. `e2e:auth` 15/15 after V-QA-01.
  AC-3(a) Secure/HttpOnly/Lax and `no-store` observed over https.
- Security: 47 of 59 items PASS. The 300-combination guard probe gave 0 mismatches and 0 paying
  Monthly deleted. Webhook cancel/undo/churn dating is correct. The client bundle and git history
  hold no secrets. No hidden characters. The `safeNext` fuzz (44 inputs between QA and security)
  gave 0 off-site results.
- Compliance: 28 PASS. The dry run applies to retention only (F-010, COMP-30). Privacy NL = EN and
  matches the code. `legal.test.ts` 24/24. The cookie table holds `vidalo_business`. The delete
  page states refund and invoices before the button.
- **F-A5 fixed**, verified by the delivery-lead in `packages/core/src/db/owner-area.ts`:
  `isPg`/`isMem` branch on `db.kind` (lines 15-21) and `listMemberUserIds` reads `r.userId`
  (line 53). QA's PgDb run of `db-purge-qa.test.ts` ("sign-ins and login gone") exercises it.
- **V-QA-01, V-QA-02, V-QA-04 fixed**, read by the delivery-lead. All three are test-code only:
  `e2e/fixtures/fake-gotrue.ts` `FIXED_USER_IDS`, `e2e/account.spec.ts:73` `filter({hasText})`,
  and `apps/worker/test/retention-qa.test.ts`, re-run on 12 Nov with 2/2 green. No application
  file changed.
- F-A1, F-A2, F-M1 fixed, confirmed by SEC-25 and the post-merge runs.

## 6. Explicitly not checked

| What | Why | When |
|---|---|---|
| **D1, real mail**: AC-4(f), the magic link on vidalo.ai; Supabase "Secure email change" (SEC-38) | An agent cannot send the mail; the dashboard settings were not read back | After D1, Julian's click |
| **D2, Stripe sandbox**: AC-6 recorded run, confirmation mails per step, the portal offering no cancel; real `stripeLive` | `api.stripe.com` is unreachable from here | Julian's Mac or the staging Worker |
| **Hosted migrations** 0016–0019 and the RLS block on `bbynmqvaxpjdnkaasutd` | Held: 0019 waits for V-SEC-01, the RLS block for V-QA-05 | Delivery-lead, after round 2 |
| **`VIDALO_PURGE` arming** (COMP-31) | Deploy-time; arms only after one day of `retention.would_purge` counts | Section 7 |
| Hosted `auth.audit_log_entries` and the audit-log setting (V-COMP-06) | Not read on the hosted project | Before deploy |
| Real Google revoke, Cloudflare hostname removal, Supabase login delete | Mocks and recorded calls only (D3) | When those go live |
| `wrangler secret list` on `vidalo-worker` / `vidalo-web` | Nothing deployed | Section 7 |
| AC-7 on real Workers (CPU and wall time) | Local only (177 ms full stream) | Staging |
| AC-8 at 320 px / 400 % zoom, screen-reader output, touch targets; mobile and WebKit Playwright projects | Desktop project only | P2, next a11y pass |
| Two concurrent purges of one business; SEC-54 | Safe by construction, not shown | P2 |
| A101 headcount and turnover (COMP-50 scope) | Julian confirms at ship | Ship report |
| Lawyer questions (Data Act ch. VI; art. 17 timing at period end; BW 6:236 reflexwerking; Scan facts page after 24 months) | Compliance is not a lawyer | Ship report |

## 7. Release gates that are not code (Julian, or the delivery-lead with his go)

| Gate | What must happen | Who |
|---|---|---|
| `STRIPE_SECRET_KEY` on `vidalo-worker` | After lane A item 3 lands, in `apps/worker`: `npx wrangler secret put STRIPE_SECRET_KEY` (top-level config = production), value = the Vidalo key `vidalo-web` uses (https://dashboard.stripe.com/apikeys). Or paste it at https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-worker/production/settings → Variables and Secrets. Read back: `npx wrangler secret list` lists it | delivery-lead if the value is in the vault (AUTHORITY §1), else Julian |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on `vidalo-worker` (and `vidalo-web`) | `SUPABASE_URL` = `https://bbynmqvaxpjdnkaasutd.supabase.co`; the service_role key from https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/settings/api-keys (check the ref: Sitty and Sonable sit in the same org). Same page or `wrangler secret put`; read back with `wrangler secret list` on both Workers. Without them, after item 3 the purge refuses instead of reporting a false deletion | as above |
| `VIDALO_AUTH_SECRET` on `vidalo-web` | Value = output of `openssl rand -hex 32`; `npx wrangler secret put VIDALO_AUTH_SECRET` in `apps/web`, or https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-web/production/settings. Without it every sign-in link is refused (V-SEC-07) | delivery-lead |
| D1 Supabase dashboard | All seven pages of `02-architecture.md` "Hand-off D1 for Julian" (URL configuration, Custom SMTP, templates incl. Change Email `type=email_change`, Secure email change `on`, sessions reuse detection, JWT expiry `3600`, email rate limit `30`), each with its direct link and values there. Julian reports "D1 done"; the delivery-lead reads back what is readable | Julian |
| Supabase audit logs (V-COMP-06) | Read Auth → Audit logs and `select count(*) from auth.audit_log_entries` without changing anything | delivery-lead (read only) |
| Hosted migrations 0016–0019 + RLS block | Apply in order after round 2, ref checked on every call. Run `scripts/rls/membership.sql` with the owner control | delivery-lead |
| `VIDALO_PURGE=1` | After deploy, read one day of `retention.would_purge` counts, then arm the purge. This is an automatic deletion of customer data, so it needs **Julian's word**; record the date in `docs/records-of-processing.md` | Julian decides, delivery-lead sets |
| Legal texts (V-COMP-06, -08, -09) and version date (V-COMP-15) | Julian approves the three sentences (memo in `state.md`). On deploy day the date is set and `legal:lock` is run | Julian |
| Production deploy | It is the launch (no coming-soon gate on vidalo.io) | Julian, always |
| D2 sandbox run | Run `scripts/stripe-lifecycle-run.mts` from Julian's Mac with the sandbox key (`acct_1UR4RAELCe3OOCe2`); event ids and screenshots go here | Julian runs it, delivery-lead records |

## 8. Waste routed back

- **Architecture missed V-QA-03.** The brief named `publisher/serve.ts` as the facts-page path, yet the
  purge was designed without it, and the ownership table froze `publisher/**`. Lesson: every
  file between the data and an AC's observable outcome is in a lane, including caches. Added
  to `docs/process/checklists/compliance.md` (erasure reaches every cache of a public surface).
  It is also proposed for the playbook's architecture template, as a question for Julian to
  promote, not done here.
- **V-SEC-01 was on security's own list as P1 (SEC-43), and the build had no webhook test on a
  dated row.** Security has already added the plan-transition rule to its standing list.
- **V-COMP-01, -02, -03** come from fixed batch limits and a fail-open dependency. Compliance and
  security have already added both to their standing lists.

## 9. Waiting on Julian: three legal sentences (lane A drafts, 12 Nov 2026)

**Outcome (12 Nov 2026):** Julian said "proceed with the legal part". Sentences 1 and 2 are in
`copy.legal` (NL, EN) with the version date set to 12 November 2026 and `legal:lock` run (the
legal test refuses a wording change under the old date). Sentence 3 is not added: the project is
on the Supabase free plan (F-022), which takes no automatic backups; Julian confirmed on 12 Nov 2026
that it stays on free. On a later move to Pro it goes in.
The version date is set again on deploy day (V-COMP-15).

Drafted by lane A, **not in the code**: `copy.legal` and `legal.lock.json` are unchanged by them,
and `legal:lock` was not run for them (no test forced it). Each needs Julian's yes ("ja" / a
change) before it goes into `packages/core/src/copy/index.ts` and `en.ts`. Then lane A adds them,
the version date is set on deploy day (V-COMP-15) and `legal:lock` runs once for all of them.

**1. Terms, "Looptijd, opzeggen en pauzeren": how long a Vidalo Scan facts page stays online (V-COMP-08, COMP-25).**
Matches the code (`SCAN_RETENTION_MONTHS = 24`, cron step 3a, reminder 14 days before).

- NL: "Bij Vidalo Scan blijft je feitenpagina online zolang je account bestaat: tot je zelf alles verwijdert, of tot we je gegevens verwijderen 24 maanden na je laatste keer inloggen of je laatste betaling. 14 dagen daarvoor krijg je een herinnering per e-mail; log je in, dan schuift die datum op."
- EN: "With Vidalo Scan your facts page stays online as long as your account exists: until you delete everything yourself, or until we delete your data 24 months after your last sign-in or your last payment. You get a reminder by email 14 days before; if you sign in, that date moves on."
- Note for Julian: terms 2.7 asks for 30 days' notice of a change to existing customers. Production has no Vidalo Scan customers today (go-live A1), so no notice mail is needed if this ships before the first one.

**2. Privacy, "Je account en inloggen": Supabase's own record of each sign-in (V-COMP-06).**
Matches the code since 45a7d87 (the purge deletes `auth.audit_log_entries` of a deleted login).
Whether the worker's database role may delete from that table on the hosted project is not
verified (§7 "Supabase audit logs", read only).

- NL: "Supabase, dat het inloggen voor ons regelt, legt bij elke keer inloggen ook je IP-adres en je browser vast, om het inloggen te beveiligen. Dat bewaren we zolang je account bestaat; verwijder je alles, dan verwijderen we het mee."
- EN: "Supabase, which handles signing in for us, also records your IP address and your browser each time you sign in, to keep signing in secure. We keep that as long as your account exists; if you delete everything, we delete it too."

**3. Privacy, "Een betaald plan", end of "Hoe lang": backups (V-COMP-09, §4.1 P3 bracket).**
Source read 12 Nov 2026 (https://supabase.com/docs/guides/platform/backups, recorded in
`docs/processors.md`): Free plan no automatic backups; Pro keeps daily backups 7 days. Which
variant is true depends on the plan at launch (F-022, go-live D2):

- On Pro (7 days), NL: "Uit de back-ups van onze database verdwijnen ze uiterlijk 7 dagen daarna." EN: "They disappear from our database backups at the latest 7 days after that."
- On Free: no sentence needed (no automatic backups exist); compliance's bracket is then left out, as now.

Resend (sent mail and logs, 30 days on every non-Enterprise plan, https://resend.com/pricing) is
recorded in `docs/processors.md`; compliance did not ask for a privacy sentence on it.

---

# Round 2 of 2

*delivery-lead · 2026-11-12 · merged from the "Round 2" sections of `verification/qa.md`,
`verification/security.md`, `verification/compliance.md` against `claude/002-mijn-omgeving` at
`675a778` plus QA's uncommitted test files. Rules: `_OS/playbook/PIPELINE.md` rules 1, 2, 5;
`templates/pipeline/SEVERITY.md`, applied literally. This is the last round; there is no third.*

## R2.1 Verdict: SHIP, with four code/ops release gates before the production deploy

The gate closes. **No P0 is open and no acceptance criterion fails** (QA: none failing; AC-4(f) and
the AC-6 Stripe run are NOT VERIFIED, both waiting on Julian's D1/D2, which were never agent-runnable).
Under PIPELINE rule 1 and SEVERITY only a P0 stops a gate; a P1 is "fixed this cycle, blocks
nothing". So the open P1s do not hold the verdict, and no decision memo is needed for the gate.

What makes this honest rather than a loophole: nothing deploys from this PR. The P1s that make the
deletion mail claim something that did not happen are turned into **named release gates R1–R4**
(R2.5) that must be true before the production deploy, which is Julian's step anyway. They are
fixed this cycle, not after launch. Their fixes are checked by the delivery-lead at ship-check
(diff read, the named test run, one control observed red with only the fix removed), the same way
F-A5 was checked in round 1. That is not a third verify round: no reviewer re-opens the feature.

## R2.2 P0 claims and severity rulings

No agent claimed a P0 in round 2. Rulings on the open P1s and the one severity tie:

| ID | Filed | Ruling | Grounds (one line) |
|---|---|---|---|
| V2-SEC-01 | security P1, QA P1 + release gate, compliance agrees | **P1, release gate R1** | Not an exploit (our token copy is gone, the host 404s) and AC-5(d) is checked in mock per the brief (D3), so not P0; but as the manifest deploys it, worker purges leave the Google grant live and the web purge leaves the Cloudflare hostname, while the mail says both were done |
| V2-COMP-01 + V2-SEC-02 | compliance P1, security P2 | **One row, P1, release gate R2** | Same defect. Severity by consequence: when it occurs the mail states an erasure that did not happen and nothing retries it. Security's P2 recorded as the losing position |
| V2-COMP-02 | compliance P1 | **P1, release gate R3** | The approved privacy sentence says "verwijderen we het mee"; Supabase's own `user_deleted` audit row keeps the address. Evidence (Supabase source), fix and cost present. Fix in code, so the gate does not wait on a dashboard read |
| V2-COMP-03 | compliance P1 (foreseeable, capped) | **P1, not a release gate; question to Julian** | Pre-existing on `main` (`signInWithOtp` without `shouldCreateUser: false`; the "Je verwijdert je account zelf" sentence is on `main` too); 002 does not widen it. Its fix is a new automatic deletion of personal data plus a legal sentence, both "ask every time" (AUTHORITY §1) |
| V-COMP-07 | compliance P1, open since round 1 | **P1, release gate R4** | Owner deletions run from the first deploy whether or not `VIDALO_PURGE` is armed; a failed one is counted but nobody reads the count. The Control Room step **counts only once the cell exists and has been seen red** on a forced overdue count; a planned step after SHIP does not close it |
| V2-COMP-04 | compliance P2 | P2 | Wording; fixed in the same change as R2 because it is the same function signature |
| V-SEC-03 | security P2, partly fixed | P2, ships past | Three lane-B route handlers lack `private, no-store`; no cache stores them today |
| V2-QA-03 | qa P2 | P2 | A missing test, not a defect; done with R1 because it gives the web half of R1 its seam |
| V2-SEC-03 | security P3 | P3, deferred | Millisecond window |

Demotion rule: every round-2 row carries evidence, a concrete fix and a cost; none demoted.
Foreseeability: only binds P0s; V2-COMP-03 is self-capped at P1 by compliance; V2-SEC-01 is
security's own round-1 miss (SEC-48/49 passed on code, not on deployed config), recorded in R2.7.

## R2.3 Failing acceptance criteria

None. AC-1, -2, -3, -7, -8 PASS; AC-4 (a)–(e) PASS; AC-5 (a)–(f) PASS in mock as the brief
checks it (V-QA-03 closed, with QA's new other-isolate control); AC-6 worker part PASS.

## R2.4 Open items per lane, in order, with cost

### Lane A (one change, worktree from `claude/002-mijn-omgeving`)

| # | ID | Sev | Fix | Cost | Gate |
|---|---|---|---|---|---|
| 1 | V2-SEC-01 | P1 | Worker: revoke at Google unless `VIDALO_MOCK=1` (the revoke endpoint needs no client id); same for the web's `env.hasGoogle` gate. `deleteCustomHostname` throws when Cloudflare is not configured outside mock, so the web purge fails before the row delete and falls back to the worker job (existing path). Tests with `VIDALO_MOCK` unset for both | 45 min | **R1** |
| 2 | V2-COMP-01 (+V2-SEC-02) | P1 | On a `deleteLogin` failure enqueue `login_delete { userId }` (re-checks no membership, retries to the job ceiling, `account.delete_failed` when retired, counted in `countOverdueDeletions`); `sendDeletedMail` gets `loginDeleted`; when false the mail says "Je inlog verwijderen we zo snel mogelijk" (NL, EN). Test: throwing `deleteLogin` → mail without the done-sentence, job queued, overdue 1 next day | 1 h | **R2** |
| 3 | V2-COMP-02 | P1 | After a successful `deleteLogin`, delete `auth.audit_log_entries` where `payload->>'actor_id' = $1 or payload->'traits'->>'user_id' = $1` (MemDb no-op); PgDb test with a seeded `user_deleted` row | 30 min | **R3** |
| 4 | V2-COMP-04 | P2 | `sendDeletedMail` gets `retention`; retention wording "Zoals aangekondigd …" (NL, EN); mail-lab case | 20 min | — |
| 5 | V2-QA-03 | P2 | Move `webPurgeDeps`' closures to `apps/web/lib/purge-deps.ts`; vitest with `env.mock` false: no keys → `deleteLogin`, `expireOpenCheckouts` throw; fake Stripe → `expire` once per open session | 45 min | — |
| 6 | V2-SEC-03 | P3 | Ask `stripeLive` again after expiring a session | 10 min | backlog |

**Lane A:** gates 2 h 15 min; P2 1 h 05 min. Commit QA's three round-2 test files with this change
(or with the round-2 docs), not separately edited.

### Lane B

| # | ID | Sev | Fix | Cost |
|---|---|---|---|---|
| 1 | V-SEC-03 | P2 | `private, no-store` on `api/checkout`, `api/lang`, `api/domain/verify` when they read the session | 20 min |

Ships past if not done.

### Outside both lanes

| ID | Sev | Fix | Cost | Owner |
|---|---|---|---|---|
| V-COMP-07 | P1 | Vidalo Control Room cell reading daily `retention.overdue` (incl. stuck/retired purge and login_delete jobs), red when > 0; seen red once on a forced count; registered in `_OS/TASK_REGISTRY.md` if a routine changes | 30 min | delivery-lead (fix slot), gate **R4** |
| V2-COMP-03 | P1 | Cron step deleting Supabase users with no membership and no owned business after 30 days, with their sessions and audit rows; privacy sentence (NL, EN), new date, `legal:lock` | 2 h after Julian's yes | Julian decides (memo in `state.md`), then lane A |
| QA's `question_use` note | — | Whether "all its rows are gone" needs a word on anonymous question statistics (0015, feature 001) | — | compliance, next legal-desk run; not a finding |

## R2.5 Release gates (before the production deploy)

New this round, all must be true before `vidalo-web`/`vidalo-worker` go to production:

| Gate | What must be true | Who |
|---|---|---|
| **R1** V2-SEC-01 | With `VIDALO_MOCK` unset and the manifest's env per Worker: a worker purge calls Google's revoke endpoint (or fails and says so in the mail); a web purge of a verified custom host without Cloudflare keys deletes nothing and queues the worker job. Tests green, control red | **Fixed in 60848bc** (lane A, 12 Nov): lane A fixes; delivery-lead verifies at ship-check  |
| **R2** V2-COMP-01 | A failing `deleteLogin` leaves a `login_delete` job, an overdue count of 1 the next day, and a mail without "dan is ook je inlog verwijderd" | **Fixed in af86e6d** (lane A, 12 Nov): lane A; delivery-lead verifies  |
| **R3** V2-COMP-02 | After a purge on PgDb no `auth.audit_log_entries` row carries the user id as actor or trait | **Fixed in af86e6d** (lane A, 12 Nov): lane A; delivery-lead verifies. The hosted DELETE permission on that table is still the §7 read  |
| **R4** V-COMP-07 | The Vidalo Control Room cell shows `retention.overdue` and is observed red on a forced count | delivery-lead |

Still standing from round 1 §7, unchanged: `STRIPE_SECRET_KEY` on `vidalo-worker`;
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on both Workers; `VIDALO_AUTH_SECRET` on `vidalo-web`;
D1 Supabase dashboard (AC-4(f) verified after it); Supabase audit-log setting and DELETE permission
(read only); hosted migrations 0016–0019 + RLS block (now unblocked: V-SEC-01 and V-QA-05 fixed);
D2 sandbox run (AC-6) before `VIDALO_PURGE=1`; `VIDALO_PURGE=1` on Julian's word; legal version
date on deploy day if not 12 Nov (V-COMP-15); the production deploy itself, Julian's, always.

## R2.6 Checked and passed in round 2

- QA: whole desktop Playwright on the production build **171 passed, 0 failed** (32 skipped,
  each run separately: `e2e:auth` 15/15, https 1/1, a11y + keyboard 49/49). `pnpm -r test` core
  1401 passed / 22 skipped, worker 45. PgDb by hand 162/162. `perf:owner` every p95 under budget.
  RLS block `RLS-OK` on a database holding 28 other businesses, control `RLS-FAIL`.
- Every round-1 fix has a control observed red (QA table); two fixes had non-discriminating tests,
  now closed by QA's V2-QA-01 (other isolate) and V2-QA-02 (owner-first order).
- Security: 8 of 9 round-1 items fixed; 300-combination guard probe 0 mismatches, 0 paying deleted;
  every `"use server"` export and route checks ownership first; no secret or hidden character in
  the diff; feature 001's merged surfaces keep the 002 guards.
- Compliance: 12 of 15 round-1 findings fixed; the two approved sentences in the code word for
  word, once each, NL = EN; `legal.test.ts` 24/24; feature 001 and 002 legal texts do not clash.
- Delivery-lead, 12 Nov: read `shared/purge.ts:97-111` (the swallowed `deleteLogin` throw, mail
  sent regardless), `apps/worker/src/jobs/purge.ts` (`revoke` gated on `GOOGLE_OAUTH_CLIENT_ID`),
  `publisher/host.ts` `deleteCustomHostname` (`delete.skip`, no throw), `secrets.manifest.json`
  targets (Google web only, Cloudflare worker only), `copy.mails.accountDeleted` (both sentences
  unconditional except Google), `inloggen/actions.ts` (no `shouldCreateUser`, same on `main`).
  Re-ran `facts-after-purge-qa`, `db-due-order-qa`, `db-purge-race-qa`, `purge`, `legal` (42/42,
  MemDb; PgDb halves skipped here) and the worker suite (45/45).

## R2.7 Not checked

| What | Why | When |
|---|---|---|
| AC-4(f) real mail; AC-6 Stripe sandbox run | D1, D2 are Julian's | Before deploy / before arming |
| Real Google revoke, Cloudflare removal, Supabase Admin delete | Mocks and probes only (D3) | When those go live |
| Purge race on PgDb with a forced interleaving | QA's PgDb run did not hit the window; MemDb is the proof | P2, not filed |
| V-SEC-04 against real Stripe | No key in reach | D2 |
| Mobile, WebKit, 320 px / 400 %, screen reader; AC-7 on real Workers | As round 1 | Next a11y pass; staging |
| Hosted migrations, RLS, audit-log setting | Not run in round 2 | §7, delivery-lead |

## R2.8 Waste routed back

- **V2-SEC-01**: security passed SEC-48/49 on the code, not on the config each Worker actually gets.
  Security has added the rule to `docs/process/checklists/security.md` (uncommitted; commits with
  these docs). It is general to every venture with a secrets manifest: proposed for
  `templates/pipeline/checklists/security.md`, Julian to promote.
- **V2-COMP-01 is partly my miss.** Round-1 fix list item 3 asked for "throws, `loginsDeleted` 0"
  and did not name the mail that reports the result. Rule I apply from now on: a fix-list item for
  a failing step names every downstream claim of that step (mail, page, count).
- **V2-COMP-02**: an erasure call to a third party can itself write a new record. Routed to
  compliance to add to `docs/process/checklists/compliance.md` at its next pass.
- **V2-QA-01/02**: a fix's test must be shown red with only that fix removed. QA did this in
  round 2; it goes in every lane's definition of done.
