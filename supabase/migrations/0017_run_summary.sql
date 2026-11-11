-- Feature 002 (Mijn omgeving), B-02: each finished check stores a small summary on its scan_run row
-- (ADR-0007): the dot colour, the counts the report heading shows and the progress snapshot. The
-- archive (/app/rapporten), /app/voortgang and /app should read one row per check, not recompute
-- the check from its samples, so their round trips stop growing with history. Checks finished before this
-- migration are filled by scripts/backfill-run-summaries.mts; until then they show date and kind, no counts.
alter table scan_run add column summary jsonb;
alter table scan_run add constraint scan_run_summary_shape check (
  summary is null or (
    summary ? 'v' and summary ? 'stip' and summary ? 'answered' and summary ? 'correct'
    and jsonb_typeof(summary -> 'answered') = 'number' and jsonb_typeof(summary -> 'correct') = 'number'
  )
);
-- Keyset paging of the archive: (business_id, created_at desc, id desc), rechecks left out.
create index scan_run_archive_idx on scan_run (business_id, created_at desc, id desc) where kind <> 'recheck';
