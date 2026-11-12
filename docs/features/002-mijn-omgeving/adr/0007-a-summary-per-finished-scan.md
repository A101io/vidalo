# ADR-0007 — Each finished scan stores a summary; lists read summaries

*2026-11-11 · status: accepted*

## Context
AC-7: `/app`, `/app/voortgang`, the archive, `/app/account` and `/app/abonnement` make the same
number of round trips with 36 checks as with 3. `/app/voortgang` today calls `buildSnapshot`
per run (several queries each, up to `PROGRESS_MAX_SCANS = 30`). AC-1's archive needs per run
the dot colour and "n van m antwoorden klopten", which today only a full report build knows.
Scan history must be rebuilt from samples, not findings (CLAUDE.md), so a summary must be
taken when the run finishes.

## Decision
- `scan_run.summary jsonb` (migration 0017) holds `RunSummary { v: 1, stip, answered,
  correct, snapshot }`, with a CHECK on its keys.
- The scanner writes it right after marking a run `done`, from the same `ScanReport` and
  `buildSnapshot` the report and progress pages use; one function computes the numbers.
- The archive, `/app/voortgang` and the dashboard read summaries in one query each;
  `scripts/backfill-run-summaries.mts` fills runs from before the migration; a run without a
  summary is listed without counts, never recomputed in a request.
- A change in how a report counts bumps `v` and re-runs the backfill.

## Consequences
**Good:** round trips are constant in history length; the archive and voortgang need no
sample reads; the numbers on the archive equal the report heading by construction.
**Bad:** a stored copy that can go stale when counting rules change (guarded by `v`); one more
write at the end of each scan; ~10–30 kB per run of jsonb.
**We can no longer:** change the report's counting without a backfill, or list a run's counts
without it having finished through the scanner.

## Alternatives rejected
| Option | Why not |
|---|---|
| Recompute per request with caching | Round trips still grow on a cold cache; Workers have no shared cache across isolates without KV |
| A materialised view over samples | Refresh timing, cost on every scan, and MemDb has no equivalent |
| Count from findings | Findings move to the latest run that saw them (`upsertFindings`), so old runs undercount |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
