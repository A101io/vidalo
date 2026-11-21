# ADR-0013 — Line criteria 13–16, kept off the public twelve

*2026-11-21 · status: accepted (severities are defaults for Julian)*

## Context
Every finding hangs on a criterium, which gives it a severity (the dot) and a threshold
(`criteria.ts`, `docs/CRITERIA.md`). The twelve criteria describe a local business; none fits
"wrong pressure class" or "sold at a shop not on your list". The public site renders `CRITERIA`
(`components/CriteriumCard.tsx`) and `copy.criteria` by id; the progress view groups cells by the
criterium they carry.

## Decision
- `CriteriumId` becomes 1–16. `CRITERIA` stays the twelve (public pages unchanged).
  `LINE_CRITERIA` holds four more; `criterium(id)` and `severityOf(id)` read both lists.
- Defaults, all with the ratio threshold (≥ 30 %), so one stray answer is never an error:

| Id | Key | Label | Severity | Fact key |
|---|---|---|---|---|
| 13 | `specificaties` | Specificaties | misleider | `spec` |
| 14 | `certificaten` | Certificaten | misleider | `certificate` |
| 15 | `verkooppunten` | Waar te koop | misleider | `outlet` |
| 16 | `opvolger` | Opvolger en oude namen | verwarring | `successor` |

- Category recommendation questions of a line hang on criterium 6, as the business's open intents
  do (`existence:<subject>`), and are judged named or not named only.
- With these defaults a line's dot turns orange on any line finding and red only when ≥ 30 % of its
  answers are wrong (no afhaker among them). Julian may change a severity in `LINE_CRITERIA`; that
  is one line and the CRITERIA.md table.

## Consequences
**Good:** the owner reads honest labels; the dot rule is unchanged; the landing page and sector
pages are untouched.
**Bad:** two lists to know about; a wrong specification can never make a line red on its own, which
some manufacturers will find too mild.
**We can no longer:** add a public criterium as number 13 without renumbering stored line findings.

## Alternatives rejected
| Option | Why not |
|---|---|
| Map the keys onto 6, 8, 11, 12 | "Diensten: wel" or "Adres" on a product's error page is wrong |
| One array of sixteen | The landing's criteria cards would list product-line criteria to every small business |
| An afhaker for specifications | A product decision with no evidence yet; offered to Julian as a default to change |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
