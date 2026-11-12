# State — 002 Mijn omgeving: owner area, sign-in, account and subscription

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 3 build (both lanes merged into `claude/002-mijn-omgeving`; next: verify) |
| Started | 2026-11-11 |
| Design reviewed | <path and version under `designs/inbox/`, or none> |
| Design gate rounds used | 0 of 2 |
| Verify rounds used | 0 of 2 |
| Open P0s | none |
| Waiting on Julian | D1 Supabase dashboard before verify |

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

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|

## Decisions needed
**Retention for Vidalo Scan customers (F-012, F-015)** — DECIDED 2026-11-11 by Julian: 24 months and 60 days, as the default.
- What: Scan (€149 once) customers never churn, so the published retention rule never reaches them; their Google token has no end either.
- Default in the design: delete 24 months after the later of last sign-in and last payment, reminder 14 days before (`SCAN_RETENTION_MONTHS`); Google token revoked 60 days after the first full check unless a fix is open (`SCAN_GOOGLE_DAYS`).
- Alternatives: 12 months; or no automatic deletion (owner deletes themselves; privacy text then must say so).
- Build is not blocked: both are one constant; A-07 writes the privacy sentence from whatever is decided before lane A merges.

**Supabase Pro plan (F-022)**: without it a stolen refresh token outlives the app's 30/90-day rule at Supabase's own API. Default: stay on the free plan, accept the risk until go-live D2 (daily backups need Pro anyway).
