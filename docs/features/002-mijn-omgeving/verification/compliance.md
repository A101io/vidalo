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
