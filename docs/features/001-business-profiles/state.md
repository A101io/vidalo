# State — 001 Business profiles: questions per kind of business, and competition

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 4 verify, round 1 done 2026-11-15: **FIX AND RE-VERIFY** (05-verification.md). 3 P1 (V1-QA-02, V1-QA-03, V1-COMP-01), 14 P2, routed per lane in findings.md. Next: round-2 fixes (backend #1–#12, frontend #1–#5), then verify round 2. Shape and build done 2026-11-11, merged to main in A101io/vidalo#120 |
| Started | 2026-11-11 |
| Design reviewed | <path and version under `designs/inbox/`, or none> |
| Design gate rounds used | 0 of 2 |
| Verify rounds used | 1 of 2 |
| Open P0s | none (qa, security and compliance each declared none in round 1) |
| Waiting on Julian | **J-1** (holds V1-COMP-01): may the source line under "Gecontroleerd als" become one of three, chosen by what was read: "Zo lazen wij je bedrijf, uit Google." / "…, uit je website." / "…, uit Google en je website.", each followed by "Het is onze lezing, geen feit over je bedrijf."? Suggested answer: **Ja**. **J-2**: did you read the customer-facing lines (04-build FE-04) and the privacy change before #120 was merged from your account 59 s after it opened? Suggested answer: **Ja** (if not, you read them in the round-2 PR). **J-3**: does A101 B.V. still have fewer than 10 people and at most €2M turnover or balance sheet (EAA micro-exemption)? Suggested answer: **Ja**. **J-4**: when the website Google lists does not name the business (a directory site), stop sending its text to OpenAI, with no privacy-text change? Suggested answer: **Stop**. Lawyer items from phase 1 unchanged (reviews/compliance-r1.md, For Julian 5) |

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-11 | 0 intake | Request recorded; analyst asked for the brief | Claude |
| 2026-11-11 | 0 intake | 01-brief.md written (8 acceptance criteria, Q1–Q11 with assumed answers). Depends on the Sonable fix, A101io/vidalo#115 (D1) | analyst |
| 2026-11-11 | 0 intake | Julian's second message recorded; brief amended (Amendment A: understanding step, question families per mode, question library, waiting page). Read as approval of the direction | Claude |
| 2026-11-12 | 4 verify | State brought in line with 04-build.md: shape and build were done on 2026-11-11 (12 tickets, merged in #120); waits for verify | think run |
| 2026-11-15 | 4 verify | Round 1: compliance (36/47 pass, 1 P1) and security (32/40 pass, 7 P2) on 15 Nov night run; qa finished in the stopgap run (18 criteria: 10 pass, 2 as amended, 1 fail, 5 partly/not verifiable; 2 P1, 2 P2). Gate observed: core 1431 passed / 23 skipped, worker 52, e2e:mock OK, AC-3 snapshot 21/21 regenerated from 5a1a40e. Verdict FIX AND RE-VERIFY; PR for docs and tests opened against main, not merged | delivery-lead (unattended) |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|

## Decisions needed
<The five-line memo format from `_OS/playbook/PIPELINE.md`, "Who decides what", or "none".>
