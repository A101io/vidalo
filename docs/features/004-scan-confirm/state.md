# State — 004 Free check starts only after the e-mail is confirmed

*Written by the think run of 21 Nov 2026 from `01-brief.md`, `05-verification.md` and `git log`; the feature was built and verified by Julian's own sessions, so no delivery-lead ran it. An unattended run re-reads this file at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 5 ship: code on main, verdict SHIP; deploy is Julian's (manual); open P1/P2 follow-ups listed in 05-verification.md |
| Started | 2026-11-11 (Julian's request, verbatim in `01-brief.md`) |
| Design reviewed | none recorded |
| Design gate rounds used | 0 of 2 (skipped: Julian's own session built it straight from his request; no design review recorded) |
| Verify rounds used | 4 per `05-verification.md` (round 1 two P0s, round 2 SHIP, round 3 signed-in skip 14 Nov, round 4 remaining brakes 14 Nov) |
| Open P0s | none (SEC-01 = QA-01 and QA-02 fixed and verified in round 2) |
| Waiting on Julian | X9: set the Cloudflare rate-limit rule (`docs/go-live-checklist.md` row X9; AC-9 passes as written down). CMP-03: counsel on whether 12 months of unconfirmed plaintext addresses passes the balancing test. CMP-11: Resend open and click tracking off, then note it in `docs/mail.md`. A real Resend mail and a real mailbox link scanner (not checked). Deploy (manual) |

Control Room rows: none

## Open follow-ups (from 05-verification.md; ids copied exactly)
- P1: CMP-01, CMP-02, CMP-03 (counsel), CMP-05, CMP-06, CMP-08 / SEC-04
- P1 reduced in round 4: SEC-02 (mail backstop raised to 20 x the daily cap; residual 500 mails a day accepted as P2)
- P2-P3: SEC-05, SEC-06, SEC-09, CMP-07, CMP-10, CMP-11, CMP-12, QA-04, QA-05; the mail lab does not include the new mail
- Closed since: SEC-07, SEC-08, QA-06 / SEC-10

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-11 | 0 intake | Julian's request: stop bots running thousands of scans; mail confirmation; build points 1-3. `01-brief.md` with AC-1 to AC-10 | Julian's session |
| 2026-11-11 to 2026-11-15 | 3 build, 4 verify | Round 1: two P0s (SEC-01 = QA-01, QA-02), fixed; round 2: core 1267, worker 24, e2e:mock, Playwright mock 113/113, verdict SHIP; round 3 (14 Nov): signed-in skip; round 4 (14 Nov): euro ceiling, alert mail, Origin check; core 1440, worker 52, verify:pg 133, Playwright scan specs 57/57. Per-day dates of rounds 1-2 not recorded | Julian's sessions |
| 2026-11-15 | 4 verify | Last main merged into the branch (15f31f5, 23:49 +0100) | Julian's session |
| 2026-11-16 | 5 ship | Merged to main as PR #121, commit 9de90f1 (11:40 +0100). Deploy not recorded; deploys are manual | Julian |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 1 shape (architecture, checklists) | `05-verification.md`: no phase-1 checklists existed; it went from request to build in one session. Lessons are in `docs/process/checklists/security.md` |
| 2 design gate | Two small pages (`/scan/mail`, `/scan/bevestigen`) in existing design G components; not reviewed separately. Mobile layout of both is listed under "Not checked" |

## Decisions needed
None unless Julian wants them: CMP-03 (counsel; preferred fix is hashing unconfirmed addresses after 24 h with the purge job CMP-05, minimum is shortening the text to 3 months).
