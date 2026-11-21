# State — 006 Productlijnen in het dashboard

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | 1 shape: architecture, ADR-0010 to ADR-0014 and tickets written; security and compliance pre-checklists not yet written |
| Started | 2026-11-21 (Julian's request, verbatim in `00-request.md`; the brief was written as "005" on another branch, this repo numbers it 006) |
| Branch | `claude/005-productlijnen` (worktree `.claude/worktrees/005-productlijnen`), cut from origin/main |
| Design reviewed | none (pages are built on main's `OwnerUi` components in design G) |
| Design gate rounds used | 0 of 2 |
| Verify rounds used | 0 of 2 |
| Open P0s | none |
| Waiting on Julian | D1, D2, D3, D4 from the brief, and D5 below; none blocks the build (defaults in code) |

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-21 | 0 intake | `00-request.md`, `01-brief.md` (AC1–AC8, D1–D4), approved | Julian, analyst |
| 2026-11-21 | 1 shape | `02-architecture.md`, `adr/0010`–`0014`, tickets BE-01–BE-06, FE-01–FE-05 | architect |

## Next
- Security and compliance write `checklists/security.md` and `checklists/compliance.md` from
  `02-architecture.md` (phase 1, before build).
- Build: BE-01 first (contract, MemDb, seed, ~6 h); then BE-02/BE-03 and FE-01–FE-04 in parallel;
  BE-04 → BE-05 → BE-06 in that order; FE-05 any time.

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 2 design gate | Not skipped yet; delivery-lead decides. The pages reuse `OwnerUi` and the `/app/voortgang` grids; if no design arrives, the gate can be skipped with that reason |

## Decisions needed
Defaults are in code; changing one is one constant or one function.

| Id | Question | Default in code | Where it changes |
|---|---|---|---|
| D1 | Price: included in a plan, or per line per month? | Lines only on Vidalo Monthly/Yearly (`plan = "monitor"`), paying and verified; no price in any copy | `productLineAccess` in `packages/core/src/shared/product-lines.ts` |
| D2 | Limits per plan | 2 active lines, 2 markets per line (≈ €10–16 a month extra at the cap; see Cost in `02-architecture.md`) | `PRODUCT_LINE_LIMITS`, same file |
| D3 | Who enters lines | Only the verified owner | `productLineAccess` |
| D4 | Apply migration 0020 to the hosted project | Not applied; `verify:pg` only | Julian, after the branch is approved; then `scripts/rls/product-lines.sql` on the hosted project |
| D5 | Severity of a wrong product fact | Specifications, certificates, where to buy: misleider (orange); successor: verwarring; all at ≥ 30 % of answers, so a line turns red only when ≥ 30 % of its answers are wrong | `LINE_CRITERIA` in `packages/core/src/criteria.ts` and `docs/CRITERIA.md` |

## Follow-ups outside this branch (AC8)
- `/organisaties` and the corporate pricing live on the unmerged corporate branch: add "in je dashboard" there once both are on main.
- Terms: what a line includes, after D1/D2 (`legal:lock`).
- Report statuses and square marks (corporate branch): the line pages pick them up through `OwnerUi`.
