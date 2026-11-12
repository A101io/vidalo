import { afterAll, describe, expect, it } from "vitest";
import { createDb, withMockDb, type Db } from "../src/db";
import { OVERVIEW_LIMITS, capFindings, dashboardRows, listReportArchive, overviewExtras, runSummaries } from "../src/db/owner-area";
import { buildReport, buildSnapshot } from "../src/scanner";
import { countingDb, seedHistory } from "./helpers/counting-db";

/**
 * Feature 002 B-03 (AC-7): the owner pages make the same number of database round trips with 36 checks as with 3.
 * MemDb always; PgDb under verify:pg (TEST_DATABASE_URL, run with this file by hand: verify-pg.sh only globs db*.test.ts).
 * "Today's code" is the progress view before B-03: buildSnapshot for every check.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";
let pg: Db | undefined;
afterAll(async () => {
  await pg?.close();
});

async function freshDb(kind: "mem" | "pg"): Promise<Db> {
  if (kind === "mem") return withMockDb();
  const postgres = (await import("postgres")).default;
  const raw = postgres(PG_URL!, { max: 1, onnotice: () => {} });
  await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
  await raw.end();
  return (pg ??= createDb(PG_URL!));
}

/** What /app, /app/voortgang and /app/rapporten read, as the web loaders call it (lib/reads.ts, lib/owner-data.ts, lib/core.ts). */
async function pageReads(db: Db, businessId: string) {
  const dash = await dashboardRows(db, businessId); // /app, /app/voortgang
  const lastRun = dash.scanRuns.find((r) => r.status === "done");
  await Promise.all([
    overviewExtras(db, businessId), // /app: the log and the open fix of each finding
    lastRun ? buildReport(lastRun.id, db) : null, // /app: the report of the last check
    runSummaries(db, businessId, 30), // /app/voortgang
    listReportArchive(db, businessId, { limit: 24 }), // /app/rapporten
  ]);
  return dash;
}

/** The progress view before B-03: a snapshot rebuilt from samples, per check. */
async function oldProgress(db: Db, businessId: string) {
  const runs = (await db.listScanRuns(businessId, 60)).filter((r) => r.status === "done" && r.kind !== "recheck").slice(0, 30);
  return Promise.all(runs.map((r) => buildSnapshot(r.id, db)));
}

describe.each([["mem"], ...(PG_URL ? [["pg"]] : [])] as ["mem" | "pg"][])("%s: round trips do not grow with history", (kind) => {
  it("the loaders behind /app, /app/voortgang and /app/rapporten count the same for 3 and 36 checks; the old progress view does not", async () => {
    const db = await freshDb(kind);
    const small = await seedHistory(db, { name: "Klein Archief", place: "Haarlem", checks: 3, findings: 20, events: 40, answers: 3 });
    const big = await seedHistory(db, { name: "Groot Archief", place: "Leiden", checks: 36, findings: 120, events: 300, answers: 3 });
    const counts: Record<string, number> = {};
    for (const [label, id] of [["small", small.businessId], ["big", big.businessId]] as const) {
      const c = countingDb(db);
      await pageReads(c.db, id);
      counts[label] = c.count();
      const old = countingDb(db);
      await oldProgress(old.db, id);
      counts[`old-${label}`] = old.count();
    }
    if (process.env.SCALE_VERBOSE) console.info(`[${kind}] round trips`, JSON.stringify(counts));
    if (kind === "pg") expect(counts.small, "the pages make queries at all").toBeGreaterThan(3);
    expect(counts.big).toBe(counts.small);
    expect(counts["old-big"], "today's progress view grows with the history").toBeGreaterThan(counts["old-small"]!);
  });

  it("the page reads are bounded: findings per status group, runs and events never exceed their named limits", async () => {
    const db = await freshDb(kind);
    const { businessId } = await seedHistory(db, { name: "Begrensd", place: "Utrecht", checks: 14, findings: 60, events: 260, answers: 2 });
    const dash = await dashboardRows(db, businessId);
    expect(dash.scanRuns.length).toBeLessThanOrEqual(OVERVIEW_LIMITS.runs);
    expect((await overviewExtras(db, businessId)).events.length).toBeLessThanOrEqual(OVERVIEW_LIMITS.events);
    expect((await overviewExtras(db, businessId)).events.length).toBe(OVERVIEW_LIMITS.events);
    // capFindings keeps the newest per group, in the order given.
    const many = Array.from({ length: 1300 }, (_, i) => ({ id: `f${i}`, status: i % 2 ? "resolved" : "open", firstSeenAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    const capped = capFindings(many);
    expect(capped.filter((f) => f.status === "open")).toHaveLength(500);
    expect(capped.filter((f) => f.status === "resolved")).toHaveLength(500);
    expect(capped.map((f) => f.id)).toEqual(many.filter((f) => capped.some((c) => c.id === f.id)).map((f) => f.id));
    expect(capped.some((f) => f.id === "f1298")).toBe(true);
    expect(capped.some((f) => f.id === "f0")).toBe(false);
  });
});
