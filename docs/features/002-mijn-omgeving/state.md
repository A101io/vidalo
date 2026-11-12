# State — 002 Mijn omgeving: owner area, sign-in, account and subscription

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | **4 verify CLOSED, round 2 of 2: SHIP with release gates R1–R4** (`05-verification.md` Round 2); next: lane A gate fixes (2 h 15), delivery-lead ship-check of R1–R4, then 5 ship. Nothing deploys until R1–R4 and the §7 gates hold |
| Started | 2026-11-11 |
| Design reviewed | <path and version under `designs/inbox/`, or none> |
| Design gate rounds used | 0 of 2 |
| Verify rounds used | **2 of 2** (no third round; P1 fixes are checked at ship-check) |
| Open P0s | none. Open P1s: V2-SEC-01 (R1), V2-COMP-01 incl. V2-SEC-02 (R2), V2-COMP-02 (R3), V-COMP-07 (R4) are release gates before the production deploy; V2-COMP-03 decided by Julian 12 Nov ("Ja, na 002"), built as its own PR on top of #123, not a gate |
| Waiting on Julian | V2-COMP-03 PR review (lands after #123); D1 dashboard, D2 sandbox run, `VIDALO_PURGE` arming, worker/web secrets, hosted migrations and the deploy (`05-verification.md` §7 and R2.5) |

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-11 | 0 intake | Request recorded; analyst asked for the brief | Claude |
| 2026-11-11 | 0 intake | 01-brief.md written (8 acceptance criteria, Q1–Q14, D1–D5); reported to Julian, waiting for approval | analyst |
| 2026-11-11 | 0 intake | Julian approved the brief ("akkoord") with the assumed answers Q1–Q7 as written | Julian |
| 2026-11-11 | 1 shape | 02-architecture.md with shared contract, ADR 0001–0007, tickets C-00, A-01…A-07, B-01…B-05 and README with a disjoint file-ownership table | architect |
| 2026-11-11 | 1 shape | checklists/security.md (SEC-01…59, no P0 against the design; SEC-15, SEC-44 are P0 if observed in phase 4) and checklists/compliance.md (no hard stop; B2B cancel: terms already exceed the consumer standard) | security, compliance |
| 2026-11-11 | 1 shape | F-010…F-023 folded back into the design by the architect (new ticket B-05, C-00 ships safe `safeNext` and the cookie row); F-022 accepted risk, F-016 deferred | architect |
| 2026-11-11 | 1 shape | Julian decided: Scan retention 24 months (`SCAN_RETENTION_MONTHS`), Scan Google token 60 days (`SCAN_GOOGLE_DAYS`) | Julian |
| 2026-11-11 | 1 shape | Lane split checked: no file owned by both lanes; merge order lane B then lane A; C-00 must land on `claude/002-mijn-omgeving` before either lane worktree is cut | Claude |
| 2026-11-11 | 2 build | C-00 scaffold committed: shared-contract names in code, safe `safeNext` (base `http://localhost`, not `x.invalid`, so `legal.test.ts` does not read it as a recipient), `vidalo_business` cookie row, legal version 12 November 2026 + lock, `setLanguage`/`deleteMyData` moved. Typecheck, 1258 core + 24 worker tests, `e2e:mock`, `signed-in` + `auth-redirect` specs (12) green. Lanes are cut from this commit | Claude |
| 2026-11-12 | 3 build | Lane B then lane A merged into `claude/002-mijn-omgeving`; typecheck, tests, e2e:mock, verify:pg, RLS block with control, a11y spec whole (27/27) and perf:owner (all p95 < 30 ms) green after F-M1; see 04-build.md "After the merge" | Claude |
| 2026-11-12 | 4 verify | Round 1: qa, security, compliance merged into `05-verification.md`. Verdict FIX AND RE-VERIFY. P0 upheld: V-QA-03. Ruled P1: V-SEC-01 (not security's P0 form; SEC-43/59 say P1), V-COMP-01, V-COMP-03 (conditions not present). F-A5, V-QA-01/02/04 fixed. F-024 and `e2e/profile-correction.spec.ts` to lane B; `publisher/serve.ts`, `subscription-mails.ts`, `secrets.manifest.json`, `docs/secrets-and-keys.md`, `legal.test.ts` to lane A. Lane A ≈ 7 h 30 P0/P1 + 1 h 40 P2; lane B 1 h | delivery-lead |
| 2026-11-12 | 4 verify | Julian approved both legal sentences as committed in `bd497ea` ("Ja, zo publiceren": terms, Scan facts page online while the account exists; privacy, Supabase's sign-in record); the backup sentence is dropped (free plan, c73b739). He asked to merge the fix branches and run verify round 2 ("Ja, samenvoegen en verifiëren") | Julian |
| 2026-11-12 | 4 verify | Lane B then lane A round-1 fixes merged into `claude/002-mijn-omgeving`, then `origin/main` (feature 001, PR #120); migrations 0016–0019 do not collide; `legal.test.ts` 24/24 with the existing lock | Claude |
| 2026-11-12 | 4 verify | Round 2 (last): qa, security, compliance merged into `05-verification.md` Round 2. Verdict SHIP with release gates. No P0, no failing AC (AC-4(f), AC-6 Stripe run not verified: D1, D2). V2-SEC-02 merged into V2-COMP-01 at P1. Gates R1 V2-SEC-01, R2 V2-COMP-01, R3 V2-COMP-02 (lane A, 2 h 15) and R4 V-COMP-07 (delivery-lead, 30 min). V2-COMP-03 ruled P1, pre-existing on `main`, to Julian. P2s V2-COMP-04, V2-QA-03 (lane A), V-SEC-03 (lane B) ship past; V2-SEC-03 P3 deferred. V2-QA-01/02 fixed by QA's tests (uncommitted) | delivery-lead |
| 2026-11-12 | 5 ship | PR A101io/vidalo#123 opened against main (not merged, not deployed). Control Room: rows B6, B7, C11, C12 added to the baseline, Vidalo cells B6, B7, C2, C9, C11, C12, P5, S3 written, questions Q-20261112-01..03 in needs-you.md, build.py run (page not republished), LEARNINGS line. Gates R1–R4 open | Claude |
| 2026-11-12 | 5 ship | Release gates R1–R3 fixed by lane A (60848bc, af86e6d), merged into the PR branch; gate tests red on pre-fix source, green after; R4 met in the Control Room (overdue.py, forced red and back). All checks green incl. e2e:auth 15/15. PR #123 still open, not merged, not deployed | Claude |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 2026-11-12 | 4 verify | V2-COMP-03 decided by Julian ("Inlogs zonder bedrijf na 30 dagen verwijderen, met de nieuwe privacyzin?" → "Ja, na 002"). Built on `claude/orphan-logins-9c2f75`, base `claude/002-mijn-omgeving`: retention step 4a queues `login_delete` for a login with no business 30 days after its later of creation and last sign-in (only with `VIDALO_PURGE=1`, overdue count otherwise), privacy sentence NL + EN, version 13 November 2026. Typecheck, tests, `e2e:mock`, `verify:pg` green | Claude |

## Decisions needed
**Retention for Vidalo Scan customers (F-012, F-015)** — DECIDED 2026-11-11 by Julian: 24 months and 60 days, as the default.
- What: Scan (€149 once) customers never churn, so the published retention rule never reaches them; their Google token has no end either.
- Default in the design: delete 24 months after the later of last sign-in and last payment, reminder 14 days before (`SCAN_RETENTION_MONTHS`); Google token revoked 60 days after the first full check unless a fix is open (`SCAN_GOOGLE_DAYS`).
- Alternatives: 12 months; or no automatic deletion (owner deletes themselves; privacy text then must say so).
- Build is not blocked: both are one constant; A-07 writes the privacy sentence from whatever is decided before lane A merges.

```
DECIDED 12 Nov 2026 — 002 legal sentences (V-COMP-08, V-COMP-06 approved as in bd497ea; V-COMP-09 dropped, free plan)
Disagreement:  compliance wants three sentences added to published legal texts; legal text is yours to approve (AUTHORITY: ask every time)
Position A:    compliance wants them now: terms "Je feitenpagina bij Vidalo Scan blijft online tot we je gegevens verwijderen: 24 maanden na je laatste keer inloggen of je laatste betaling, met een herinnering 14 dagen vooraf."; privacy P1: Supabase records each sign-in's IP address and browser for security while that sign-in runs; privacy P3: "Uit onze back-ups verdwijnen ze binnen {N} dagen daarna" (N from the plan in use). Cost: 1 h 30 + 30 days' notice to any existing Scan customer (terms 2.7)
Position B:    ship without them: the code deletes as the texts already promise, but the terms stay silent on the Scan facts page's lifetime and the privacy text understates two copies. Cost: 0 now, an open transparency gap (AVG 13(2)(a)) at launch
Recommendation:A: the code already does what the sentences say; the texts should match before the first Scan customer
Default:       lane A writes them as drafted in the fix round; they wait for your yes before merge to `main` (no silence default for legal texts)
```

```
DECIDED 12 Nov 2026 by Julian, "Ja, na 002" — 002 Mijn omgeving: logins that never get a business (V2-COMP-03); built as its own change on top of 002 (branch claude/orphan-logins-9c2f75)
Disagreement:  a login made on /inloggen that never gets a business is kept for ever, and its owner cannot delete it (true on main today)
Position A:    compliance wants a daily step deleting such logins 30 days after creation or last sign-in, plus the privacy sentence "Hoort er na 30 dagen geen bedrijf bij je inlog, dan verwijderen we de inlog." (NL, EN), because the privacy text promises self-deletion (AVG 5(1)(e)). Cost: 2 h + your yes
Position B:    delivery-lead: ship 002 without it, as main behaves today, and keep it open as a P1. Cost: 0 now; a storage-limitation gap that predates 002 stays open
Recommendation:A, as its own small change right after 002 merges: cheap, and it makes the published privacy sentence true
Default:       nothing is deleted and no text changes until you answer (automatic deletion and legal text wait for your word); 002 ships without it — proceeding on your word
```

**Supabase Pro plan (F-022)**: without it a stolen refresh token outlives the app's 30/90-day rule at Supabase's own API. Default: stay on the free plan, accept the risk until go-live D2 (daily backups need Pro anyway).
