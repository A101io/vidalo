# Compliance review, round 2 of 2 — 001 Business profiles (phase 4)

*compliance agent · 2026-11-16, unattended stopgap run · branch `claude/fix-2026-11-16-001-business-profiles`
(PR #137) with the round-1 reports and current `main` merged in. A diff against `compliance-r1.md`. I am not a
lawyer. No legal text, customer copy or brand text was changed; nothing hosted was touched.*

## Verdict

**Legal hard stop (P0): none.** PR #137 changes no customer-facing string, no legal text, no cookie or storage, no
processor and no price: its `src` diff is `prompts/library.ts`, `prompts/profile.ts`, `scanner/index.ts`,
`scanner/progress.ts`, `scanner/recommendations.ts`. `legal.test.ts` and `copy-profiles.test.ts` pass (24 and 36)
on the combined tree. No compliance finding was fixed in round 1's fix PR, so the round-1 items stand as they were.

## Effects of the fixes on checklist items

| Item | Round 1 | Round 2 | Note |
|---|---|---|---|
| C-02 / B1 (what goes to an AI system) | PASS | **PASS** | The V1-QA-02 change sends three neutral questions with the business's own name to the question engines when no online template fits. That data (the name, in a question) already went to the same engines in the door set, which also carried the town; nothing new is sent, nothing is sent to a new party |
| C-31 (quotes) | PASS | **PASS** | V1-QA-04 removes quotes that are only the name; fewer quotes, same rules |
| C-07 / C-39 log lines | PASS | **PASS** | No new event or log key |
| All other rows | as round 1 | unchanged | |

**Counts:** unchanged from round 1: 36 PASS, 6 FAIL (four defects), 2 MOOT, 3 NOT VERIFIED.

## Findings

| ID | Sev | Status | Note |
|---|---|---|---|
| V1-COMP-01 | P1 | **open, release gate, waits on J-1** | Customer copy; not a blocker for merging PR #137 (the sentence is already on `main` since #120, and #137 does not touch it). It must close before this feature counts as done |
| V1-COMP-02 | P2 | open | CRITERIA.md:10, :96, ARCHITECTURE.md:5 unchanged |
| V1-COMP-03 | P2 | open | online self-help block unchanged |
| V1-COMP-04 | P2 | **open, partly met** | PR #137 changes no surface, so the table it needs is short; it is carried in `05-verification.md` Round 2 ("Surfaces") so Julian sees it in the merged diff. The PR body itself was not edited |
| V1-COMP-05 | P2 | open | `docs/processors.md` rows unchanged |
| V1-COMP-06 | P2 | open; (a) waits on J-4 | J-4 takes its default only from 18 Nov; not implemented tonight |

## For Julian (unchanged questions, see state.md)

J-1 (source sentence), J-2 (did you read #120's lines), J-3 (EAA micro-enterprise), J-4 (stop sending a directory
site's text to OpenAI). Lawyer items from phase 1 unchanged.
