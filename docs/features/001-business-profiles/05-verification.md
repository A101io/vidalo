# 05 — Verification, round 1 — 001 Business profiles

*delivery-lead (Claude) · 2026-11-15, unattended night run · branch `claude/verify-2026-11-15-001-business-profiles`.
Merges `reviews/qa-r1.md`, `reviews/security-r1.md`, `reviews/compliance-r1.md`. Verify rounds used: 1 of 2.*

## Verdict: FIX AND RE-VERIFY

No P0 from any lane. Three P1s are open, each with evidence, a fix and a cost, and all three are small (about 2 h
together). Round 2 of 2 is still available, so none of this needs a decision to ship as it is. One P1 fix
(V1-COMP-01) changes customer copy, so it waits on Julian's yes to the new sentence (J-1 below).

| Lane | P0 | P1 | P2 | Criteria / items |
|---|---|---|---|---|
| qa | 0 | 2 (V1-QA-02, V1-QA-03) | 2 | 18 criteria: 10 pass, 2 pass as amended, 1 fail (AC-A3), 5 partly or not verifiable here |
| security | 0 | 0 | 7 | 40 items: 32 pass, 4 fail (all P2), 3 moot, 1 not verified |
| compliance | 0 | 1 (V1-COMP-01) | 5 | 47 items: 36 pass, 6 fail (4 defects), 2 moot, 3 not verified |

Severity was applied as written: only qa, security or compliance may declare a P0, and none did; every finding
below has evidence, a fix and a cost, so none was lowered to P2 for missing them.

## Counts observed this round (qa run, 15 Nov 2026)

- `pnpm -r typecheck`: core, web, worker clean.
- `pnpm -r test`: core 96 files, **1431 passed, 23 skipped**; worker 7 files, **52 passed**.
- `pnpm e2e:mock`: **OK** (60 jobs; baseline rood with 34 findings; online case mode online, 12 answers).
- AC-3 snapshot regenerated from `5a1a40e` independently: **21 of 21** question sets identical.
- Playwright (four feature specs, mock): **16 passed, 1 fixme** after QA's own spec was corrected.

## What blocks SHIP

1. **V1-QA-02 (P1, AC-A3 fails).** A business without a listing whose name holds a word like "prompt" or "systeem"
   is asked the shop-front questions with the town, and gets a coloured dot. That is the exact failure this feature
   was built to end.
2. **V1-QA-03 (P1).** After the first retired template in a category, every later scan's library write throws and
   logs a false `library.record_failed`. A second retirement is never logged.
3. **V1-COMP-01 (P1).** "Zo lazen wij je bedrijf, uit Google en je website" is shown even when Google was not read
   (Sonable). That breaks "say only what the code does".

Round 2 re-checks these three, plus whatever P2s the lanes fix, and re-runs the full gate.

## Routed work, in order

The ledger rows are in `findings.md` (status, owner, fix). Each lane works top to bottom.

**Backend**
1. V1-QA-03 (P1, 15 min): build `wasRetired` before use, and log only new retirements.
2. V1-QA-02 (P1, 30–45 min): an online profile with no surviving template falls back to the neutral set, never to
   the door set. Security re-checks S-07/S-08.
3. V1-SEC-01 (P2, 1–2 h): a typed website belongs to the check, not to the business, until the owner confirms it.
4. V1-SEC-02 (P2, 1–2 h): the SSRF guard decodes embedded-IPv4 IPv6 forms and refuses IP literals on every hop.
5. V1-SEC-04 (P2, 20 min): rebuild nested objects in `scanStatusBody`.
6. V1-COMP-06 (P2, 15 min code): do not send a page that does not name the business (J-4).
7. V1-QA-04 (P2, 20 min): drop quotes that are only the name.
8. V1-SEC-05 (P2, 1 h): migration 0020 with the missing CHECKs. It is written and tested locally; applying it on
   the hosted project is Julian's step.
9. V1-SEC-06 (P2, 30 min): `\u` escapes instead of literal hidden characters, and a CI grep that fails on exit 2.
10. V1-COMP-02 (P2, 20 min): CRITERIA.md:10 and :96, ARCHITECTURE.md:5 in line with ADR 0007.
11. V1-COMP-05 (P2, 5 min): processors.md rows for paid online questions.
12. V1-COMP-04 (P2, 15 min): the round-2 PR carries the surface table.

**Frontend**
1. V1-COMP-01 (P1, 1 h, after J-1): three source sentences picked from the profile's basis.
2. V1-COMP-03 (P2, 30 min): an online self-help block without address, hours or directories.
3. V1-SEC-03 (P2, 30 min): the status route checks the token's shape and returns 404 before any query.
4. V1-SEC-07 (P2, 30 min plus a build): import `SECTOR_LIST` from a leaf module, then grep the client build.
5. V1-QA-01 (P2, 1 h): a mock delay switch so the waiting page can be seen in a browser, then un-fixme its check.

## Not verified in round 1 (carried)

- A real free check of Sonable and the real understanding step (no keys in an unattended run; compliance C-39).
- The hosted project: migration 0015 is not applied on `bbynmqvaxpjdnkaasutd`, and RLS and grants were proven only on
  a local Postgres (security S-19/S-20).
- The client bundle (S-37), the full Playwright suite, and the waiting page in a browser.
- Lawyer items from phase 1 (compliance "For Julian" 5), unchanged.

## Waiting on Julian

See `state.md` "Waiting on Julian". J-1 is the only item that holds up a fix. J-2 to J-4 are needed before SHIP,
not before round 2 starts.

---

# Round 2 of 2 — 001 Business profiles

*delivery-lead (Claude) · 2026-11-16, unattended stopgap run (03:30 verify slot) · branch
`claude/fix-2026-11-16-001-business-profiles` (PR #137) with the round-1 reports (PR #135 branch) and current `main`
(`b92675c`) merged in. Merges `reviews/qa-r2.md`, `reviews/security-r2.md`, `reviews/compliance-r2.md`.
Verify rounds used: **2 of 2**.*

## Verdict: SHIP

No P0 from any lane. The two P1s that blocked in round 1 and were fixed (V1-QA-02, V1-QA-03) are closed, each
proven by a control (fix reverted: its test red; restored: green). The third P1, V1-COMP-01, is customer copy that
waits on Julian's word (J-1); by this run's rules it does not block the merge and stays an **open release gate** for
the feature. PR #137 itself changes no customer string and does not touch that sentence (on `main` since #120).
All other open items are P2.

| Lane | P0 | P1 open | P2 open | Closed this round |
|---|---|---|---|---|
| qa | 0 | 0 | 2 (V1-QA-01, new V2-QA-01) | V1-QA-02, V1-QA-03, V1-QA-04 |
| security | 0 | 0 | 6 (V1-SEC-01, -02, -03, -05, -06, -07) | V1-SEC-04; S-07/S-08 re-check passed |
| compliance | 0 | 1 (V1-COMP-01, J-1 gate) | 5 (V1-COMP-02..06) | none (none was in scope of #137) |

## Counts observed this round

- `pnpm -r typecheck`: core, web, worker `Done` (branch alone and with `main`).
- `pnpm -r test`, branch alone: core **96 files, 1433 passed, 23 skipped**; worker **52 passed**.
- `pnpm -r test`, branch + `main`: core **102 files, 1478 passed, 23 skipped**; worker **7 files, 52 passed**.
- `pnpm e2e:mock`: **OK** both times (60 jobs; baseline rood, 34 findings; online case mode online, 12 answers).
- Feature tests by name: **12 files, 269 passed**, no `it.fails` left.
- Controls: QA-03 3 red, QA-02 2 red, SEC-04 1 red, QA-04 1 red on the reverted code.
- Playwright `qa-001-online.spec.ts` (desktop, mock): **4 passed, 1 fixme** after updating the spec to `main`'s
  free-check flow (postcode field from #139, confirmation link from #121; test-only, commit `bbb6898`).

## Surfaces (V1-COMP-04, for this PR)

| Surface | Changed by #137 |
|---|---|
| Landing, FAQ, plan panel, `result.checkedAs`, `result.more`, mails | no |
| Privacy (NL/EN), terms, cookie table, processors, records of processing | no |
| CRITERIA.md, MESSAGING.md, ARCHITECTURE.md | no |
| Pricing, checkout, Stripe | no |
| Questions sent to AI systems | yes, internal: a business without a listing whose name the slot cleaner refuses gets the neutral 3 questions with its name instead of the shop-front 6 with the town |
| Report "Wat AI over jou schreef" | fewer quotes: a line that is only the name is no longer quoted |
| Waiting-page status JSON | same fields, nested objects rebuilt from named fields |

## Open after this round (none blocks the merge)

- **Release gate J-1 / V1-COMP-01 (P1):** the source line under "Gecontroleerd als". Feature 001 is not done until it
  is closed.
- P2s, routed as in round 1: backend V1-SEC-01, -02, -05, -06, V1-COMP-02, -05, -06 (a waits on J-4), V2-QA-01;
  frontend V1-COMP-03, V1-SEC-03, V1-SEC-07, V1-QA-01. They go to a ticket, not a third round.
- Not verified (carried): a real Sonable check, the hosted project (migration 0015, RLS), the client bundle, the
  waiting page in a browser.
