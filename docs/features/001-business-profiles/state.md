# State — 001 Business profiles: questions per kind of business, and competition

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 4 verify, **round 2 of 2 done 2026-11-16: SHIP** (05-verification.md "Round 2"). V1-QA-02 and V1-QA-03 (P1) closed with controls; V1-SEC-04, V1-QA-04 closed. **PR #137 merged into `main` as `e808eec`** on 2026-11-16 after every CI check on head `0571a2c` was read green (check, postgres, cloudflare, browser, build) and `deploy` was skipped. Nothing deployed to vidalo.ai (`deploy.yml` is manual). PR #135 (round-1 reports) is now contained in `main`; the think run can close it. Feature not done until release gate J-1 closes. Open P2s go to tickets (findings.md), no third round |
| Started | 2026-11-11 |
| Design reviewed | none |
| Design gate rounds used | 0 of 2 |
| Verify rounds used | **2 of 2** |
| Open P0s | none (qa, security, compliance each declared none in round 2) |
| Release gates | **J-1 / V1-COMP-01 (P1)**: the source line under "Gecontroleerd als" says "uit Google en je website" even when Google was not read. Customer copy; fix (1 h, frontend) starts on Julian's yes. Also carried, not verified: a real Sonable free check, migration 0015 + RLS on the hosted project, the client bundle (S-37), the waiting page in a browser |
| Waiting on Julian | **J-1**: may the line become one of three, picked by what was read: "Zo lazen wij je bedrijf, uit Google." / "Zo lazen wij je bedrijf, uit je website." / "Zo lazen wij je bedrijf, uit Google en je website.", each followed by "Het is onze lezing, geen feit over je bedrijf."? Suggested answer: **Ja**. **J-2**: did you read the customer-facing lines (04-build FE-04) and the privacy change before #120 was merged? Suggested answer: **Ja**. **J-3**: does A101 B.V. still have fewer than 10 people and at most €2M turnover or balance sheet? Suggested answer: **Ja** (default from 18 Nov). **J-4**: stop sending the text of a website that does not name the business (a directory site) to OpenAI, with no privacy-text change? Suggested answer: **Stop** (default from 18 Nov; not implemented yet). Lawyer items from phase 1 unchanged |
## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-11 | 0 intake | Request recorded; analyst asked for the brief | Claude |
| 2026-11-11 | 0 intake | 01-brief.md written (8 acceptance criteria, Q1–Q11 with assumed answers). Depends on the Sonable fix, A101io/vidalo#115 (D1) | analyst |
| 2026-11-11 | 0 intake | Julian's second message recorded; brief amended (Amendment A: understanding step, question families per mode, question library, waiting page). Read as approval of the direction | Claude |
| 2026-11-12 | 4 verify | State brought in line with 04-build.md: shape and build were done on 2026-11-11 (12 tickets, merged in #120); waits for verify | think run |
| 2026-11-15 | 4 verify | Round 1: compliance (36/47 pass, 1 P1) and security (32/40 pass, 7 P2) on 15 Nov night run; qa finished in the stopgap run (18 criteria: 10 pass, 2 as amended, 1 fail, 5 partly/not verifiable; 2 P1, 2 P2). Gate observed: core 1431 passed / 23 skipped, worker 52, e2e:mock OK, AC-3 snapshot 21/21 regenerated from 5a1a40e. Verdict FIX AND RE-VERIFY; PR for docs and tests opened against main, not merged | delivery-lead (unattended) |
| 2026-11-16 | 4 verify | Round 2 of 2 (stopgap run): round-1 reports merged into the fix branch (PR #137), then current `main`. Gate observed on branch + main: typecheck clean; core 102 files 1478 passed / 23 skipped; worker 52; e2e:mock OK; feature tests 269 passed; controls red for all four fixes; Playwright qa-001-online 4 passed / 1 fixme after a test-only update to main's free-check flow. Verdict **SHIP**; 1 new P2 (V2-QA-01) | delivery-lead (unattended) |
| 2026-11-16 | 4 verify | PR #137 merged into `main`: merge commit `e808eec` (head `0571a2c`, all CI checks green, `deploy` skipped). PR #135 contained in `main`, to be closed by the think run. Push to `main` runs only the GitHub Pages mock preview, not vidalo.ai | delivery-lead (unattended) |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|

## Decisions needed
<The five-line memo format from `_OS/playbook/PIPELINE.md`, "Who decides what", or "none".>
