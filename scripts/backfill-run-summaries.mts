/**
 * Fills scan_run.summary (migration 0017, ADR-0007) for finished checks that have none: every done,
 * non-recheck run, in batches. Run once per database after 0017 is applied; the page shows a check without
 * a summary with its date and kind and no counts, it never computes in the request.
 *
 *   DATABASE_URL=postgresql://… pnpm tsx scripts/backfill-run-summaries.mts           # dry run: counts only
 *   DATABASE_URL=postgresql://… pnpm tsx scripts/backfill-run-summaries.mts --write   # fills them
 *   … --all                                                                          # also rewrites existing summaries
 *
 * It reads DATABASE_URL from the environment only, never from the root .env (which points at production):
 * pass it on purpose. Nothing is printed about businesses or addresses, only counts.
 */
import { createDb } from "@vidalo/core/db";
import { listRunsToSummarize } from "@vidalo/core/db";
import { backfillRunSummaries } from "@vidalo/core/scanner";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Pass the database on purpose, e.g. the verify:pg one; this script never reads .env.");
  process.exit(2);
}
const write = process.argv.includes("--write");
const all = process.argv.includes("--all");
const db = createDb(url);
try {
  let waiting = 0;
  for (let after: string | undefined; ; ) {
    const ids = await listRunsToSummarize(db, { limit: 500, afterId: after, all });
    if (!ids.length) break;
    waiting += ids.length;
    after = ids[ids.length - 1];
  }
  console.log(`${waiting} finished check(s) ${all ? "in total" : "without a summary"}.`);
  if (!write) {
    console.log("Dry run. Add --write to fill them.");
  } else {
    const { saved, failed } = await backfillRunSummaries(db, { batch: 50, all, onBatch: (s, f) => console.log(`  … ${s} saved, ${f} failed`) });
    console.log(`Done: ${saved} saved, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  }
} finally {
  await db.close();
}
