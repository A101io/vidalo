# Compliance verification — 002 Mijn omgeving (phase 4)

*compliance · 2026-11-12 · against `claude/002-mijn-omgeving` at `6b6446e` (C-00, lane B, lane A
merged; diff `ef14530..HEAD`) and my phase-1 list `checklists/compliance.md`. Julian's decisions
of 2026-11-11 applied: Scan retention 24 months (`SCAN_RETENTION_MONTHS`), Scan Google token 60
days (`SCAN_GOOGLE_DAYS`). I am not a lawyer; items marked **lawyer** go to the ship report.
Sources: `[page]` read on the source today, `[snippet]` search result only, `[known]` settled
fact not re-read today. Nothing hosted was touched; no build was run.*

## Verdict

- **Legal hard stops observed: none.** COMP-30 (the dry run never holds back an owner's own
  deletion) passes in code and in tests. Two findings below become hard stops only if a
  condition occurs: V-COMP-01 (the worker deployed without its Stripe or Supabase Admin secret)
  and V-COMP-03 (20 or more retention rows overdue while `VIDALO_PURGE` is unset). Both are
  filed as P1 go-live gates, not P0, because neither has been observed.
- **Counts:** 28 PASS, 6 FAIL (one P1 for the delivery-lead, two P1 legal-text items, one P1
  release gate, two P2), 1 NOT VERIFIED (COMP-31, deploy time).
- **Legal texts:** the NL and EN privacy statements say the same thing and match the code on
  every point the caller listed. `legal.test.ts` passes (24/24). The terms did not change
  (COMP-25 is still open).

## Runs

| What | Result |
|---|---|
| `DATABASE_URL= pnpm --filter @vidalo/core exec vitest run test/legal.test.ts` | 24 passed |
| core `test/purge.test.ts test/deletion.test.ts test/db-account.test.ts test/export-secrets.test.ts test/google-revoke.test.ts` (MemDb; the PgDb halves skip without `TEST_DATABASE_URL`) | 45 passed, 1 skipped |
| worker `test/retention.test.ts test/purge-job.test.ts` | 13 passed |

The tree was left as it was. Two paths that were changed by other agents during this run
(`e2e/account.spec.ts`, `packages/core/test/db-purge-qa.test.ts`) are not mine.

## The caller's confirmations

| Question | Answer | Evidence |
|---|---|---|
| `legal.test.ts` passes | Yes | Run above |
| Privacy matches the code, NL = EN | Yes, with the gaps in V-COMP-05 and V-COMP-06 | Export contents (`my-data.ts`, `export-stream.ts`: business, profiles, facts, prompts, scans with samples and claims, findings, fixes, channels with allow-listed meta, googleIndex, signIns, events without other people's addresses; no token) = "Je rechten" ¶2. Delete on every plan = `deletionPlan`, `purgeAllowed`. Scheduled delete during Monthly = `verwijderen/actions.ts` `at_period_end`. 90 days + free check + deletion within 30 days = trigger 0019 rule 1 (`churned_at + 120 days`). Scan 24 months = `scanRetentionDate(last_active_at)`, trigger rule 4 (payment), `recordSignIn` (sign-in). Google at churn = `setBusinessStatus` → `google_disconnect {reason: churn}`, cron backstop. Scan Google 60 days = cron step 3. Sign-in list without IP = 0018 `auth_session` columns. Hashed throttle ≤ 1 day = 0018 `auth_throttle` and `pruneAuthThrottle(now − 24 h)`. Reminder and confirmation mails = `account-mails.ts`. EN `en.ts` lines 1009–1151 say the same thing |
| Cookie table has `vidalo_business` and the changed auth cookies | Yes, NL and EN | `index.ts` cookie rows; `auth-cookies.ts` `AUTH_COOKIE_MAX_AGE = 90 * 86400`, `active-business.ts` `ACTIVE_BUSINESS_MAX_AGE = 90 * 86400` |
| Delete page: no refund, where invoices stay | Yes, before the button | `account-security.ts` `deletion.monthlyAt`/`monthlyNext`/`scan`/`invoices`/`stays`; `verwijderen/page.tsx` renders them above the form |
| Cancel and delete mails keep the terms' promises | Yes for "Je krijgt direct een bevestiging per e-mail met de einddatum" on both routes. The unchanged `cancel_confirmed` no longer gives the full picture (V-COMP-12, P2) | `deletionScheduled` is sent on every `at_period_end` path (`actions.ts:99`), with the end date, no refund, no free check, how to call it off |
| Nothing keeps data longer than the text says, or deletes less | **No**, at the edges: V-COMP-01, -02, -03, -04, -06, -11 | Below |
| The dry run applies to retention only (F-010) | Yes | `purge.ts`: `guard === "due" && b.deleteReason === "retention" && deps.dryRunRetention`; the web passes `dryRunRetention: false`; `purge-job.test.ts` (an owner's fallback job deletes with the variable unset) and `purge.test.ts` F-010 cases green. Indirect hold-back: V-COMP-03 |

## Checklist, item by item

| ID | Status | Evidence |
|---|---|---|
| COMP-01 | PASS | Abonnement actions take the form's `business` and pass `requireOwnerOf`, so a second business is cancellable online (B-01/B-05). The two-click count was not measured by me |
| COMP-02 | PASS | `requireFreshSignIn` is only in `account/actions.ts` (address change) and `account/verwijderen/*`; none in `app/abonnement/` or `app/google/` |
| COMP-03 | PASS (unit) | `deletionPlan`: monitor + trial/active/paused → `at_period_end`; the date comes from Stripe (`cancelSubscription` `r.at`), never from the form. The sandbox run (D2) is still to come |
| COMP-04 | PASS | `account/page.tsx:329-334` and `abonnement/page.tsx:74-76`: date, "Toch bewaren", `keepNote` ("Draai je de opzegging terug, dan blijven je gegevens ook bewaard") |
| COMP-05 | PASS | `sendDeletionScheduledMail` at once; wording has the end date, no refund, facts page offline, "Er volgt geen gratis controle meer", download first, call-off link; NL = EN |
| COMP-06 | PASS | Monthly: end date and no refund of the running month; Scan: no refund once begun, plus the 30-day refund route at support@ before deleting |
| COMP-07 | PASS | `goes`/`stays`/`invoices` with a portal button; the mail repeats them |
| COMP-08 | PASS | No `refund`/`credit` call in `purge.ts`, `jobs/purge.ts` or `verwijderen/` |
| COMP-10 | PASS | `deletionPlan` → `now` for Scan, never-paid, churned; `e2e/account.spec.ts` Scan owner (build log) |
| COMP-11 | PASS | `Db.purgeBusiness` deletes the row (cascades) and unrun jobs in one transaction; `db-account.test.ts` with a control business, green |
| COMP-12 | PASS | `purge.ts` only lists subscriptions (`stripeLive`); nothing deletes the customer |
| COMP-13 | PASS | `disconnectGoogle` revokes first, `invalid_token` counts as done, a purge continues on failure; `google-revoke.test.ts` green. The mail's wording on failure: V-COMP-10 |
| COMP-14 | PASS (mock) | Host removed only for the verified holder (F-019); `purge.test.ts` records the call. Real Cloudflare: D3 |
| COMP-15 | PASS | `account.deleted { guard, loginsDeleted }` with business null; payload shapes tested (`retention.test.ts`, SEC-53) |
| COMP-16 | **FAIL** (P1) | `retention.overdue` is written to the event table and the log. Nothing in `A101/_OS/control-room` or `_OS/routines` reads it. → V-COMP-07 |
| COMP-17 | **FAIL** (P2) | No IndexNow ping and no 410 on purge (build log A-05 "not built"). → V-COMP-14 |
| COMP-18 | PASS | Export categories as above; `signIns` present; `export-secrets.test.ts` green (tokens, unknown secret, other addresses absent) |
| COMP-19 | **FAIL** (P2) | "Je gegevens" (`copy.account.myData.body`) does not say that invoices are in the Stripe portal. → V-COMP-13 |
| COMP-20 | PASS (unit) | `retention.test.ts` day 0 Google, day 90 check, day 106 reminder, day 120 purge, controls B/C/D never touched. Runs only once armed (COMP-31) |
| COMP-21 | PASS (unit), defect at scale | Cron step 3, 60 days, no open fix, no held change; tested. Beyond 200 Scan businesses it never runs: V-COMP-02 |
| COMP-22 | PASS | 0018 `key_hash` char 64 + `at` only; cron prune 24 h |
| COMP-23 | PASS, with a gap | No IP, no UA string (0018). Only **ended** rows beyond the newest 10 are pruned, so open rows can exceed 10: V-COMP-11 |
| COMP-24 | PASS, defect at scale | Decision recorded (F-012); 0019 CHECK and guard admit `setup`/`trial`/`retention`; privacy text = code. Same 200 cap: V-COMP-02 |
| COMP-25 | **FAIL** (P1, lawyer) | Terms have no sentence on how long a Scan facts page stays online; Scan retention now deletes it after 24 months without a sign-in. Build log A-07 "not done". → V-COMP-08 |
| COMP-26 | **FAIL** (P1) | Backup roll-off and Resend log retention not looked up; `processors.md` says "not looked up yet". → V-COMP-09 |
| COMP-30 | PASS | See F-010 above. Indirect path: V-COMP-03 |
| COMP-31 | NOT VERIFIED | Deploy-time: `VIDALO_PURGE=1` not set anywhere; `records-of-processing.md` carries the "record that date here" note |
| COMP-40 | PASS | Row in NL and EN; written only by `chooseBusiness` after `isMember`; `legal.test.ts` green |
| COMP-41 | PASS | 90-day forced `maxAge` in `auth-cookies.ts`; `Max-Age=7776000` read back in workerd by lane A (A-07). Not re-observed by me |
| COMP-42 | PASS | `legal.test.ts` (no storage, no unlisted host); `/auth/confirm` page sets no cookie on GET (only the POST action does); F-A1 fixed in `b8a6772` with a test under full consent |
| COMP-43 | PASS | P1, P1b, P1c, P2, P3, P4, P5, P7 in NL and EN with Julian's values; `updated` "13 november 2026" / "13 November 2026"; lock refreshed; `processors.md` and `records-of-processing.md` updated. The date is one day after today: V-COMP-15 |
| COMP-44 | **FAIL** (P1, release gate) | Published retention sentences describe a purge that runs as a dry run until `VIDALO_PURGE=1`, and the cron **sends the 14-day reminder** ("Op {datum} verwijderen we…") in dry run too (`cron.ts` step 1 does not check `dryRun`). → V-COMP-05 |
| COMP-45 | PASS | `account-mails.ts` `wrap` → `textToHtml` (company footer), reply-to support@, no offer; the "kies een plan" line in the ended-Monthly reminder is how to keep the data, not a promotion; mail lab NL/EN green (A-07) |
| COMP-46 | PASS | `/inloggen?verwijderd=1` ("Je gegevens zijn verwijderd") only after `out.done`; queued → "We verwijderen je gegevens…". For what happens when the queued job never succeeds, see V-COMP-04 |
| COMP-50 | PASS (scope) | Still B2B only (`consentSubmit`: "Vidalo is een dienst voor bedrijven, niet voor consumenten"). A101 headcount (< 10) and turnover (≤ €2M) were not re-confirmed: Julian confirms in the ship report. The EAA does not apply on either ground |

## New findings (beyond the checklist)

| ID | Sev | Claim | Foreseeable at phase 1? |
|---|---|---|---|
| V-COMP-01 | P1 (P0 if deployed so) | The worker purge without its secrets. `secrets.manifest.json` targets `STRIPE_SECRET_KEY` at **web only**, but the worker's `stripeLive` throws without it outside mock. Every worker purge would then fail: an owner's scheduled Monthly deletion, the fallback of a "now" deletion, and retention. Separately, `deleteLogin` in the worker (`jobs/purge.ts:33-37`) and on the web (`actions.ts:39-40`, `createAdminSupabase()` null) **logs "mock" and returns success when the Supabase Admin key is missing, outside mock mode too**. `purge.ts` then counts the login as deleted and the mail says it is | Partly (F-006 named the worker secrets); the manifest gap and the fail-open are build defects |
| V-COMP-02 | P1 | `listScanRetention(200)` orders by `created_at` with a fixed limit and does not page. From the 201st Vidalo Scan business onward, no retention date is set and no Google token is ever ended: data kept longer than the privacy statement says | No (a limit in the build) |
| V-COMP-03 | P1 (hard stop if it occurs) | `listDueDeletions(now, 20)` returns the 20 oldest due rows. Rows the job will not delete stay due and come back every tick: retention rows in dry run, and rows held by `stripe_live`. With 20 of them, an **owner's** scheduled deletion further down the list is never queued. The dry run then holds back an owner's request after all (F-010, AVG art. 17(1), 12(3)) | No (a limit in the build) |
| V-COMP-04 | P1 | Nobody sees an owner's immediate deletion that fails. If the inline purge fails, the person is told "We verwijderen je gegevens. Je krijgt een mail zodra het klaar is", and a `purge {guard: no_subscription}` job is queued. That business has no `delete_at`, so `countOverdueDeletions` never counts it. If the job keeps failing, the request is lost without anyone seeing it. The architecture's failure table promised "`retention.overdue` shows it" | The design said it was covered; the build does not cover it |
| V-COMP-05 | P1 (release gate) | With `VIDALO_PURGE` unset, the cron still sends the retention reminder, which says the data goes on {date}, and then nothing is deleted. Together with COMP-31, the published retention promise is not kept until the purge is armed | Yes (COMP-44); the reminder detail is new |
| V-COMP-06 | P1 | Supabase Auth keeps its own sign-in records: `auth.sessions` (`ip`, `user_agent`) and, if audit logs go to the database, `auth.audit_log_entries` (`ip_address`, the actor's e-mail in `payload`, no FK to the user, so it is **not removed** when the login is deleted) `[known, not re-read on the hosted project]`. The privacy text says "Je IP-adres bewaren we daarvoor niet" and that deleting removes "je inlog" | Yes, so capped at P1. Not a hard stop: the processing has a basis (6(1)(f) security); the gap is transparency and completeness of erasure |
| V-COMP-07 | P1 | COMP-16: nobody reads `retention.overdue` | Yes (on my list) |
| V-COMP-08 | P1, lawyer | COMP-25: terms sentence on the lifetime of a Scan facts page, with 30 days' notice under terms 2.7 if Scan customers already exist | Yes (on my list) |
| V-COMP-09 | P1 | COMP-26: backup and mail-log retention not recorded. `[snippet]`: Supabase Free has no automatic backups and Pro keeps 7 days of daily backups (supabase.com/docs/guides/platform/backups); Resend keeps email data 30 days (resend.com docs). To be read on the pages before any text changes | Yes (on my list) |
| V-COMP-10 | P2 | `accountDeleted` says the Google connection was "ook bij Google ingetrokken", even when the revoke failed (the purge goes on) or when no connection existed | No |
| V-COMP-11 | P2 | `recordSignIn` prunes only ended rows beyond the newest 10. Sessions abandoned while still open are never ended (F-022) and stay until the account is deleted, so a login can hold more than the "laatste 10" the privacy text names | Partly |
| V-COMP-12 | P2 | The unchanged `cancel_confirmed` mail (`subscription-mails.ts`) still says "Je facturen blijven te downloaden in je account" without "tot {deletion date}". It does not say that Google is disconnected on the end date, or that the data is deleted 120 days later with a reminder. Not false today, but incomplete next to the new privacy text | No |
| V-COMP-13 | P2 | COMP-19: "Je gegevens" does not point to the Stripe portal for invoices; its body says "over je bedrijf" while the file also holds the sign-in list | Yes (on my list, P2) |
| V-COMP-14 | P2 | COMP-17: no IndexNow ping or 410 on purge | Yes (on my list, P2) |
| V-COMP-15 | P2 | The legal version date is "13 november 2026", one day after today. A published date should be the day the version takes effect: set it on the day `main` is deployed and run `legal:lock` again | No |

Not findings, for the record:
- `copy.account.myData.deleteBody` and `.blocked` are no longer rendered anywhere. They hold
  sentences that are now false ("Zeg eerst je abonnement op…", "Dit kun je niet terugdraaien").
  This is dead copy. I mention it and did not remove it.
- F-A5 (lane B `owner-area.ts`) looks fixed in the merged code: it uses `db.kind` and reads
  `r.userId`. The row in `findings.md` still says `open`. The owner of that row closes it.
- No price, VAT presentation, invoice identity or consumer right changed in this feature.

## Needing a lawyer (ship report)

1. Data Act ch. VI: is Vidalo a "data processing service"? (Carried from phase 1; legal desk.)
2. Art. 17 timing for a Monthly owner's deletion at period end. (Carried; the privacy text offers
   earlier deletion through support@, as required.)
3. Reflexwerking of BW 6:236 j/o on the cancellation clauses. (Carried; expected fine.)
4. Deleting a Scan facts page after 24 months without a sign-in, while the terms are silent
   (V-COMP-08).

## Round 2

*compliance · 2026-11-12 · against `claude/002-mijn-omgeving` at `675a778` (lane B and lane A
round-1 fixes, `origin/main` with feature 001 / PR #120); changes read as `git diff dd7a889..HEAD`.
Julian's decisions applied: 11 Nov (Scan 24 months, Scan Google token 60 days); 12 Nov (the terms
and privacy sentences exactly as in `bd497ea`; free Supabase plan, no backup sentence). No code
edits, no builds, nothing hosted. I am not a lawyer.*

### Verdict

- **Legal hard stops observed: none.** No P0. One new finding (V2-COMP-01) becomes a hard stop
  only if it occurs (a failed login deletion reported as done); filed P1 like V-COMP-01.
- **Round-1 findings:** 12 of 15 fixed and verified (V-COMP-01, -02, -03, -04, -05, -06, -08,
  -09, -10, -11, -12, -13). V-COMP-07 still open (P1, delivery-lead). V-COMP-14 deferred (P2).
  V-COMP-15 is moot today (the date is now 12 November 2026, today), and is a deploy-day step only
  if `main` deploys later.
- **Round-1 COMP FAILs:** COMP-19, -25, -26, -44 now PASS (COMP-26 by Julian's free-plan
  decision; COMP-44 in code, the arming is still the COMP-31 release gate). COMP-16 still FAIL
  (= V-COMP-07). COMP-17 deferred (= V-COMP-14). COMP-31 still NOT VERIFIED (deploy time).
- **New:** V2-COMP-01, -02, -03 (P1), V2-COMP-04 (P2).

### Runs

| What | Result |
|---|---|
| `DATABASE_URL= pnpm --filter @vidalo/core exec vitest run test/legal.test.ts` | 24 passed |
| core `purge`, `deletion`, `db-account`, `export-secrets`, `google-revoke` tests (MemDb; PgDb halves skip) | 53 passed, 4 skipped |
| worker `retention`, `purge-job` tests | 19 passed |
| NL/EN parity script over `copy.legal` (array lengths per section, every number per string), scratchpad only | no differences |

### The caller's checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Round-1 V-COMP and COMP FAILs | See table below | |
| 2 | The two approved sentences, word for word | **PASS** | Each of the four strings from `bd497ea` (terms "Looptijd, opzeggen en pauzeren" NL/EN; privacy "Je account en inloggen" NL/EN) occurs exactly once in `index.ts` / `en.ts` at HEAD (`grep -F`, count 1 each). No other legal wording changed since round 1 (`git diff 6b6446e HEAD` on both copy files: only those two sentences and the date). `updated` "Versie van 12 november 2026" / "Version of 12 November 2026"; `legal.lock.json` carries the same dates and hashes `89de2336679af12b` / `09217c9d4c422757`; `legal.test.ts` green, so the lock matches the text |
| 3 | Feature 001 and 002 texts did not clash | **PASS** | The merge `285615f` brought no file change (its main parent `b5577b1` has the same tree as `d6266b6`, already in 002). Every line of `copy.legal` at 001's tip `d6266b6` that is not at HEAD was replaced by 002 on purpose (the date, the sign-in and account rows, Google, paid-plan retention, security, rights, the two Supabase cookie rows); 001's own sentences (no OpenAI search, a website the requester gives is a source, free check e-mail first) are all present. One `updated` date per language. Watch: branch `claude/scan-mail-confirm` (`00c87e9`, not on main) also edits `legal.lock.json` and the date; whichever lands second must set a new date and run `legal:lock`, never merge the lock by hand |
| 4 | NL and EN say the same | **PASS** | Parity script above; the two new sentences and `myData.body`, `accountDeleted`, `cancel_confirmed` read side by side |
| 5 | Nothing keeps data longer or deletes less than the texts say | **No, three gaps** | V2-COMP-01, -02, -03 below. Plus, unchanged: every retention promise (privacy, terms Scan sentence, `cancel_confirmed` "Op {datum} verwijderen we je gegevens") holds only once `VIDALO_PURGE=1` (COMP-31 release gate) |

### Round-1 findings, re-checked

| ID | Status | Evidence |
|---|---|---|
| V-COMP-01 | fixed | `cf2d829`: worker `deleteLogin` and web `deleteLogin` throw without the Admin key unless mock; `STRIPE_SECRET_KEY` targets `web`, `worker`; `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` target both. Residual: `purge.ts:105-110` catches that throw and the mail still says the login is gone (V2-COMP-01) |
| V-COMP-02 | fixed | `cron.ts` walks `listScanRetention(200, after)` by id until a short page; `pg.ts:946-952` keyset; 201-business tests green |
| V-COMP-03 | fixed | `pg.ts:915-921` orders `delete_reason = 'owner'` first; `cron.ts:291` passes `{ retention: !dryRun }`, so in dry run only owner rows are listed |
| V-COMP-04 | fixed | `pg.ts:935-944` counts purge jobs unfinished after a day or retired with an error; `loop.ts` logs `account.delete_failed` |
| V-COMP-05 | fixed (code) | `cron.ts:283` sends no reminder in dry run; `listDueDeletions` makes a retention row due only 14 days after its reminder, so arming reminds first. Arming itself: COMP-31 |
| V-COMP-06 | fixed (code + text), hosted not verified | `purge.ts:97-103` `deleteAuthAuditLog` (`pg.ts:857-863`, `actor_id` = user); approved sentence published. A failure is only a `warn`. Gap: V2-COMP-02. Hosted DELETE permission on `auth.audit_log_entries` still a §7 item |
| V-COMP-07 | **open** P1 | No reader of `retention.overdue`, `retention.would_purge`, `account.delete_failed` in `A101/_OS/control-room` or `_OS/routines` (grep, none) |
| V-COMP-08 | fixed | Terms sentence as approved; code matches it: `scanRetentionDate(lastActiveAt)`, sign-in writes `last_active_at` (`pg.ts:816`), the next tick moves `delete_at` and clears the reminder (`setScanRetention`) |
| V-COMP-09 | fixed per decision | Free plan, no backup sentence; `processors.md` records it |
| V-COMP-10 | fixed | `googleRevoked = disconnected > 0 && !revokeFailed`; sentence conditional, NL/EN |
| V-COMP-11 | fixed | `b202801`: prune keeps the newest 10 rows, open included |
| V-COMP-12 | fixed | `cancel_confirmed` NL/EN names the Google end, the deletion date (end + `CHURN_DELETE_DAYS`), the reminder, invoices at Stripe 7 years |
| V-COMP-13 | fixed | `myData.body` NL/EN names the sign-in and the customer portal under Abonnement (portal form on `abonnement/page.tsx:170`) |
| V-COMP-14 | deferred | unchanged |
| V-COMP-15 | moot today | date = 12 November 2026 = today; re-set and re-lock only if deployed later |

### New findings

| ID | Sev | Claim | Foreseeable at phase 1? |
|---|---|---|---|
| V2-COMP-01 | P1 (hard stop if it occurs unrepaired) | A login deletion that fails is reported as done and never retried. `purge.ts:105-110` catches `deleteLogin`'s throw (missing key outside mock since `cf2d829`, or any Supabase Admin error), logs `account.login_delete_failed`, and carries on; the business row is already gone, so nothing retries and no count shows it. The mail still says "Hoort er geen ander bedrijf bij je inlog, dan is ook je inlog verwijderd" (`copy.mails.accountDeleted`, NL/EN). The e-mail address in `auth.users` and the `auth.sessions` rows with IP and browser stay. AVG art. 17(1), 12(3) | Partly: round-1 V-COMP-01 named the mail; its fix covered the count only |
| V2-COMP-02 | P1 | Deleting the login writes a new Supabase audit row holding the deleted person's e-mail address, which nothing removes. Supabase Auth `adminUserDelete` records `UserDeletedAction` with traits `user_id`, `user_email`, `user_phone` and the admin as actor `[page: github.com/supabase/auth internal/api/admin.go, read today]`. `deleteAuthAuditLog` runs **before** `deleteLogin` and matches only `payload->>'actor_id' = userId` (`pg.ts:861`), so this row survives, against the approved "verwijder je alles, dan verwijderen we het mee" and the deletion mail. Only if audit logs are written to the database (hosted setting not read) | Partly: my own round-1 fix proposal missed it |
| V2-COMP-03 | P1 | A login with no business is kept for ever. `/inloggen` calls `signInWithOtp` with Supabase's default `shouldCreateUser: true` (`apps/web/app/inloggen/actions.ts:55`), so every address typed there gets an `auth.users` row and audit rows with IP, even an address of someone else. Without a business `requireOwner` sends the login to `/inloggen?fout=geen` (`apps/web/lib/owner.ts:16`), so "Verwijder alles" is out of reach, and the purge only removes logins of a business it deletes. Nothing ever deletes these. Privacy says "Hoe lang: zolang je account bestaat … Je verwijdert je account zelf", which such a person cannot do. AVG art. 5(1)(c), (e), 13(2)(a). Not a hard stop: the address was given to sign in, and the data is small; the gap is retention and the self-service promise | Yes (the security checklist named `shouldCreateUser`), so capped at P1 |
| V2-COMP-04 | P2 | The deletion mail says "zoals je vroeg" / "as you asked" after a **retention** purge too: the worker's purge uses the same `sendDeletedMail` for guard `due` with `delete_reason = 'retention'`. Not true there | No |

Not findings, for the record:
- `cron.ts` queues due purges (step 2) before it moves Vidalo Scan dates (step 3a). A sign-in in
  the last tick before a Scan's date leaves a queued purge with a stale date. The job re-reads the
  business and `purgeAllowed`/`Db.purgeBusiness` refuse it, so nothing is deleted; only a job run
  between the two steps could revoke Google or remove the custom host first. Swapping the steps
  costs minutes; QA or the lane decides.
- The 24-month Scan clock moves only on the recorded owner's sign-in (`pg.ts:816`,
  `owner_user_id`), matching ADR-0001 (membership filled from owner). Revisit when members other
  than the owner exist.

### Needing a lawyer (ship report), round 2

Unchanged from round 1 (items 1–3). Item 4 (deleting a Scan facts page while the terms were silent)
is closed by the approved terms sentence; whether a sentence plus the 14-day reminder suffices is
still worth one question to the lawyer, not a blocker.

Overlap with security's round 2 (read in `findings.md` after filing): V2-SEC-02 is the same defect
as V2-COMP-01 (security P2, compliance P1 because the mail states an erasure that did not happen);
one fix closes both. V2-SEC-01 (the worker's Google revoke gated on `GOOGLE_OAUTH_CLIENT_ID`,
which the manifest gives to web only, so the grant stays live while the mail says it was revoked)
is also a deletion-completeness gap in compliance terms; I agree with P1 and did not file it twice.
