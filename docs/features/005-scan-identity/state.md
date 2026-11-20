# State — 005 Scan identity: never pick a business by name alone

*Written by the think run of 21 Nov 2026 from `01-brief.md`, `05-verification.md` and `git log`; the feature was built and verified by Julian's own sessions, so no delivery-lead ran it. An unattended run re-reads this file at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 5 ship: code on main, verdict SHIP; deploy is Julian's (manual); open P1/P2 follow-ups listed in 05-verification.md |
| Started | 2026-11-16 (Julian's request, verbatim in `01-brief.md`, then "Ja, bouw het") |
| Design reviewed | none recorded |
| Design gate rounds used | 0 of 2 (skipped: one extra form field and a pick page in existing design G components; no design review recorded) |
| Verify rounds used | 3 per `05-verification.md` (round 1 16 Nov SHIP, round 2 17 Nov SHIP, round 3 17 Nov SHIP) |
| Open P0s | none (QA-01 fixed in round 1) |
| Waiting on Julian | CMP-10 option (a): a real recheck before the day-21 mail costs a scan per non-customer; option (b), copy that stops claiming it, is built (his call whether to add (a)). QA-R2-06: whether the grey neutral note should mention namesakes (wording choice). CMP-06: deploy on or after 17 Nov 2026 (the legal version date); deploy is manual |

Control Room rows: none

## Open follow-ups (from 05-verification.md; ids copied exactly)
- P2: QA-04 (street-first and "nr." forms refused), QA-05 (e-mail retyped after `fout=herken` or `fout=mail`), SEC-04 (pre-existing, `localhost.localdomain` passes the website check), QA-R2-01 and QA-R3-01 (mail lab has no local unlisted journey or follow-up line), QA-R2-04 (closed in round 3 by AC-10), QA-R2-02 and QA-R3-02 (page and follow-up read today's business record)
- P3: QA-07, CMP-07, CMP-05 (pre-existing, no `Secure` flag on `vidalo_check`), CMP-06
- Closed: QA-01, QA-02, QA-03, SEC-01, SEC-02 / CMP-01, CMP-02, CMP-03, SEC-03, QA-06, CMP-04, CMP-08, CMP-09, QA-R2-05, CMP-10 (b), CMP-11, CMP-12

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-13 | 0 intake | First wrong-business free check ("Vidalo" ran on "Voila ! Damesmode"); repeated 16 Nov | Julian |
| 2026-11-16 | 0 intake | Request and `01-brief.md` (AC-1 to AC-8) | Julian's session |
| 2026-11-16 | 3 build, 4 verify | Round 1: QA, security, compliance; one P0 and the P1s fixed; core 1464, worker 52, Playwright 71 passed, 10 skipped; SHIP | Julian's session |
| 2026-11-16 | 5 ship | Merged to main as PR #139, commit b92675c (18:46 +0100) | Julian |
| 2026-11-17 | 4 verify | Round 2: AC-9 namesake line; core 1475; SHIP. Merged as PR #141, commit 5f28df6 (11:00 +0100) | Julian's session |
| 2026-11-17 | 4 verify | Round 3: AC-10 follow-up mails, CMP-10/11/12; core 1537; SHIP. Merged as PR #142, commit f2a3134 (14:44 +0100) | Julian's session |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 1 shape (architecture, checklists) | Not recorded as run; the feature went from Julian's request to build in one session, with QA, security and compliance review run concurrently in phase 4 |
| 2 design gate | One required field with label, hint and error (AC-8) and a pick page in existing components; accessibility wiring covered by AC-8 and the Playwright specs |

## Decisions needed
None to merge. Optional: CMP-10 (a) versus the shipped (b) (Julian's call).
