# State — 006 Productlijnen in het dashboard

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | **4 verify, DECISION NEEDED** after round 2 (21 Nov 2026): no P0 left in code; AC8 timing waits on Julian. PR open for review, not merged |
| Started | 2026-11-21 (Julian's request, verbatim in `00-request.md`; the brief was written as "005" on another branch, this repo numbers it 006) |
| Branch | `claude/005-productlijnen` (worktree `.claude/worktrees/005-productlijnen`), cut from origin/main; build uncommitted on top of 8fdd35e |
| Design reviewed | none; phase 2 skipped (below) |
| Design gate rounds used | 0 of 2 (skipped) |
| Verify rounds used | **2 of 2** |
| Open P0s | **QA-01** (AC8; waits on Julian, not a build item). SEC-V01 fixed on this branch (round 2); the same hole is still on main |
| Waiting on Julian | **AC8 timing (memo below)**, D1, D2, D5 (incl. CMP-606), CMP-608 EAA confirmation, SEC-V01 hotfix deploy to production, CMP-609 lawyer question; D3/D4 as before; PR approval before merge (AC8, L-74) |

Ledger: `findings.md`. Round detail and per-lane lists: `05-verification.md`.

## DECISION NEEDED — 006 productlijnen (AC8 timing)
```
DECISION NEEDED — 006 productlijnen
Disagreement:  AC8 wants FAQ, assistant, pricing, /organisaties and the terms line "what a line includes" in this PR; compliance B3 forbids any public line wording while VIDALO_PRODUCT_LINES is off and D1 is open.
Position A:    qa wants the surfaces in this PR (FAQ item + assistant fact now, /organisaties when that branch merges) because AC8 says "same PR". Cost: 1–2 h, and a public sentence tying lines to Monthly before D1.
Position B:    compliance wants no public surface until D1 and the switch, in one change, because lines named on Monthly become part of Monthly by conduct (terms art. 3) and removing them later needs notice and a right to cancel. Cost: 0 now; the surfaces join the launch-switch change.
Recommendation:B. Amend AC8: owner pages, mails, legal texts and docs in this PR (done); FAQ, assistant, pricing, /organisaties and the terms line in one change with D1 and VIDALO_PRODUCT_LINES=1. Your PR approval stays the merge gate.
Default:       nothing merges and no public copy is written; QA-01 stays an open P0 until you answer — proceeding on your word.
```
Grounds for not building option A now: lawfulness is compliance's decision, and the FAQ sentence QA proposes states
what Monthly includes, which B3 forbids. QA's position is recorded under QA-01 in `findings.md`.

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-21 | 0 intake | `00-request.md`, `01-brief.md` (AC1–AC8, D1–D4), approved | Julian, analyst |
| 2026-11-21 | 1 shape | `02-architecture.md`, `adr/0010`–`0014`, tickets BE-01–BE-06, FE-01–FE-05 | architect |
| 2026-11-21 | 1 shape | `checklists/security.md` (S-01..S-37, S-19b), `checklists/compliance.md` (B1–B7, L-items) | security, compliance |
| 2026-11-21 | 3 build | BE-01 committed (8fdd35e); BE-02..06 and FE-01..05 built, uncommitted; `04-build.md` with 7 deviations | backend, frontend |
| 2026-11-21 | 4 verify r1 | QA: AC1–AC7 pass, AC8 fails (QA-01 P0). Security: SEC-V01 P0, V02 P1, V03/V04 P2, V05/V06 P3. Compliance: no hard stop, CMP-601..603 P1. Merged into `05-verification.md`; CMP-608, CMP-609, SEC-V07, CMP-611 re-classified to P2 (demotion rule). Verdict BLOCKED | qa, security, compliance, delivery-lead |
| 2026-11-21 | 4 fix r1 | Started on this branch: SEC-V01..V05, CMP-601..604, CMP-607, QA-03..08 | backend, frontend |

## Next
1. Fix round r1 finishes; SEC-V07 (one argument in `loadProductLineDetail`) goes in the next pass if r1 has closed.
2. The business half of SEC-V01 goes to main as its own PR (merge on CI green is inside the envelope); **deploying it to production is Julian's**.
3. Verify round 2: QA, security (incl. the SEC-V01 PoC and controls 1–2 re-run), compliance (mail lab for CMP-601..604).
4. Round 2 not closing SEC-V01 → decision memo here. QA-01 closes only on Julian's AC8 answer.
5. Process: PROC-01, PROC-02 to the analyst and the playbook template (see `findings.md`).

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 2 design gate | Skipped by delivery-lead, 21 Nov 2026: no design was delivered; the pages are built on main's `OwnerUi` components in design G and copy the `/app/voortgang` grids (`DotGrid`); axe 0 violations on five screens, 375 px checked by QA. A design that arrives later re-enters at phase 2 and reviews the build |

## Decisions needed
Defaults are in code; changing one is one constant or one function.

| Id | Question | Default in code | Where it changes |
|---|---|---|---|
| AC8 | When do FAQ, assistant, pricing, `/organisaties` and the terms line ship? | Memo above. Default: no merge, no public copy | Brief amendment (analyst), Julian approves |
| D1 | Price: included in a plan, or per line per month? | Lines only on Vidalo Monthly/Yearly (`plan = "monitor"`), paying and verified; no price in any copy | `productLineAccess` in `packages/core/src/shared/product-lines.ts` |
| D2 | Limits per plan | 2 active lines, 2 markets per line (≈ €10–16 a month extra at the cap; see Cost in `02-architecture.md`) | `PRODUCT_LINE_LIMITS`, same file |
| D3 | Who enters lines | Only the verified owner | `productLineAccess` |
| D4 | Apply migration 0020 to the hosted project | Not applied; `verify:pg` only | Julian, after the branch is approved; then `scripts/rls/product-lines.sql` on the hosted project |
| D5 | Severity of a wrong product fact; and (CMP-606) whether an outlet "not in your list" colours the dot and counts as wrong | Specifications, certificates, where to buy: misleider (orange); successor: verwarring; all at ≥ 30 % of answers. Unlisted outlet counts as wrong today | `LINE_CRITERIA` in `packages/core/src/criteria.ts` and `docs/CRITERIA.md` |
| SEC-V01 hotfix | Deploy the main fix for the cron re-enqueue to production ahead of 006? | PR to main opened by the fix round; not deployed until Julian says so | `.github/workflows/deploy.yml` (manual, `production`) |
| CMP-608 | Confirm A101 is under 10 staff and at most €2M turnover/balance on 21 Nov 2026 (EAA exemption) | Assumed yes; AA failures block through QA, not compliance | Ship report |
| CMP-609 | Lawyer: does terms art. 5 cover a certificate letter on the owner's word alone, or must the owner link proof? | Letters state the owner's number and date only when valid (B6) | Ship report |

## Follow-ups outside this branch (AC8)
- `/organisaties` and the corporate pricing live on the unmerged corporate branch: add "in je dashboard" there once both are on main.
- Terms: what a line includes, after D1/D2 (`legal:lock`); bundle CMP-605 (GB/CH transfers) into the same version.
- Report statuses and square marks (corporate branch): the line pages pick them up through `OwnerUi`.
- Pre-existing on main, for a main ticket: QA-09 (Dutch "What now" on English finding pages), QA-10 (sticky owner header at 375 px), CMP-610 ("Bakker Bart"), SEC-V08 (orphan chunk).
