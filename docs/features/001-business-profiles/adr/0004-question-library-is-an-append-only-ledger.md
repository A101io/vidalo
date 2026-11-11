# ADR-0004 — The question library is an append-only usage ledger; thresholds live in code

*2026-11-11 · status: accepted*

## Context
Amendment A3: every question asked counts in a library keyed by category and mode (template,
family, intent, times asked, times usable). A new check takes proven templates for its category
(asked ≥ 20, usable ≥ 60 %), else the built-ins; a template below 30 % usable after 50 asks is
retired for that category and listed for Julian; a file and a database view, no admin screen.
Scans run concurrently (queue consumer, cron, CLI) on MemDb and PgDb; a counter row per
(category, template) would be updated by every scan of that category.

## Decision
- Table `question_use` (migration 0015): one row per (scan run, template key) with `asked` and
  `usable` for that scan, plus category, mode, template text with slots (`{naam}` …), family and
  intent. Written once at the end of `runScan` by `Db.recordQuestionUse` (single insert,
  `on conflict (scan_run_id, template_key) do nothing`). No row is ever updated.
- View `question_library`: sums per category, mode and template, and `usable_share`. Read with
  `where category = $1 and mode = $2` (index `(category, mode)`).
- **Usable** (`isUsable` in `prompts/library.ts`), per stored sample: a recommendation answer is
  usable when it names the business or `namedBusinesses(answer)` is not empty; an about answer is
  usable when its verdict is `correct`, `wrong`, `other_entity` or `not_found`, or it carried a
  value that could not be checked. Not usable = the report's "geen bruikbaar antwoord".
- **Status** (`libraryStatus` in `prompts/library.ts`, the only place with the numbers):
  `PROVEN_MIN_ASKED = 20`, `PROVEN_MIN_SHARE = 0.6`, `RETIRE_MIN_ASKED = 50`, `RETIRE_BELOW_SHARE = 0.3`.
- **Pick** (`pickTemplates(family, n, rows)`): for an online family slot needing n templates, when
  the category has ≥ n proven templates of that family, the n with the highest usable share
  (ties: built-in order); otherwise the first n built-ins that are not retired. Fixed families
  (existence, what, website, phone) have one template each and are not subject to retirement:
  they feed the dot.
- Door and visit questions are recorded too (key `door|visit.<kind>.<category>[.<intent>]`,
  text with name and place replaced by `{naam}`/`{plaats}`) so Julian sees their usable shares;
  they are never picked or retired by the library (AC-A2, AC-3).
- The list for Julian: `pnpm library` reads `Db.questionLibrary()` and writes `out/library.md`
  (retired first, then by category; columns category, mode, question, asked, usable share,
  status). In production he reads the view in the Supabase SQL editor. A template that a recorded
  use moves into "retired" logs `library.retired` (business null).

## Consequences
**Good:** inserts never contend, a retried scan creates a new run and cannot double-count an old
one, nothing needs repairing, and retirement is permanent without a status column (a retired
template is not asked, so its numbers do not move). MemDb implements the same as an array.
**Bad:** reads aggregate on every question choice (small: ~150 rows a day at today's caps); the
view cannot show "proven"/"retired" because the thresholds live in code; a bad day (an engine
outage) lowers shares for good unless rows are deleted by hand.
**We can no longer:** un-retire a template without deleting ledger rows, or change thresholds
without a code change.

## Alternatives rejected
| Option | Why not |
|---|---|
| A counter row per (category, mode, template), `update … set asked = asked + n` | Hot row under concurrent scans; a failed scan after the update leaves counts that no run backs |
| Thresholds and status in the SQL view as well | Two places deciding the same thing; MemDb would need a copy |
| A `status` column set by the scanner | State that can disagree with the counts; derived status cannot |
| An admin screen | Out of this cycle (A6) |
| Writing the list file from the worker | The production worker runs on Cloudflare and has no file system |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
