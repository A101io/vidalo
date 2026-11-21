# ADR-0011 — Line rows share the scan tables; the database keeps their scope

*2026-11-21 · status: accepted*

## Context
The brief sketches a `product_line` table (name, category, status, markets, versioned facts) and a
nullable `product_line_id` on `prompt`, `sample` and `finding`. A line run (ADR-0010) also needs
its market and the exact version it was asked with. The fixer, the finding page, the member RLS
policies (0016) and the purge all work on these tables already. Business readers (`listPrompts`,
`listScanRuns`, `listFindings`, the archive, the summaries) select by `business_id` only.

## Decision
- `product_line` holds identity and status only (`id`, `business_id`, `status`, timestamps).
  Everything the owner asserts, name, category and markets included, lives in
  `product_line_facts (product_line_id, version, data, confirmed_at)`. A version is written once per
  confirmation and never changed (trigger `product_line_facts_immutable`).
- `prompt`, `scan_run`, `sample`, `finding` gain nullable `product_line_id` and `market`;
  `scan_run` also `product_line_version`. Null means the business itself.
- Invariants in SQL: composite FKs `(product_line_id, business_id)` on `prompt` and `scan_run` keep a
  line's rows in its business; `(product_line_id, product_line_version)` ties a run to its version;
  CHECKs set line and market together; trigger `inherit_line_scope` sets a sample's and a
  finding's line and market from its scan run, refuses a sample whose prompt is of another line or
  market, and refuses moving a row to another line or market. The `sample` column exists as the
  brief asks, but no application code writes it.
- **Scope is decided by the `Db` method.** A reader without a `line` argument returns business rows
  only (`product_line_id is null`); with `{ productLineId, market? }` it returns that line. An
  isolation test seeds a line and asserts every listed business reader returns the same as without
  it, on MemDb and PgDb.

## Consequences
**Good:** fixes, rechecks, the finding page and the member policies cover line findings without a
copy; deleting a business cascades through lines; the scope of a sample or finding cannot be
wrong, whatever the application sends.
**Bad:** every existing business reader gains a filter, and a reader added later must choose a
scope (the isolation test only covers the readers it lists); the trigger costs one lookup per
inserted sample.
**We can no longer:** store a line's name, category or markets anywhere but a version; edit a
confirmed version in place; delete a single line (it is discontinued; it goes with the business).

## Alternatives rejected
| Option | Why not |
|---|---|
| Separate `line_prompt`, `line_scan_run`, `line_sample`, `line_finding` tables | A second fixer, finding page, recheck path and set of policies |
| Name, category and markets on the row, the rest versioned (the brief's sketch) | Two places answer "what is this line called"; an old run could not be judged against what it asked |
| Composite FKs only, no trigger | With MATCH SIMPLE a row with a null line is never checked, so a business sample on a line run or a line prompt would pass |
| The application sets `sample.product_line_id` | A rule enforced only in application code is not enforced |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
