import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb, withMockDb, type Db } from "../src/db";
import { listReportArchive, runSummaries, saveRunSummary, summarizeRun, type RunSummary } from "../src/db/owner-area";
import { reportCounts } from "../src/progress";
import { backfillRunSummaries, buildReport, buildSnapshot, prepareBusiness, runScan, createMockEngine } from "../src/scanner";
import type { ScanReport } from "../src/types";

/**
 * Feature 002 B-02: each finished check keeps a summary whose counts are the report heading's (one function,
 * progress.ts reportCounts, which apps/web/lib/report.ts also calls). MemDb and, under verify:pg, PgDb.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";
let pg: Db | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      const raw = postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      await raw.end();
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
});

const clients = (rate: number) => (["chatgpt", "google_ai", "perplexity"] as const).map((e) => createMockEngine(e, { wrongPairRate: rate, otherEntityRate: rate === 0 ? 0 : undefined }));

/** The heading's numbers, counted by hand from the report (independent of reportCounts). */
function byHand(r: ScanReport) {
  const key = (f: string, s: string | null | undefined) => `${f}:${s ?? ""}`;
  const wrong = new Set(r.findings.filter((f) => f.verdict !== "not_found").map((f) => key(f.factKey, f.subject) + (f.evidenceKind === "recommendation" ? ":rec" : "")));
  const all = new Set([...r.correct.map((c) => (c.factKey ? key(c.factKey, c.subject) : `p:${c.prompt}`)), ...r.findings.map((f) => key(f.factKey, f.subject) + (f.evidenceKind === "recommendation" ? ":rec" : ""))]);
  return { wrong: wrong.size, groups: all.size };
}

describe.each(backends)("%s run summary", (_name, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });

  async function scan(name: string, rate: number) {
    const { business } = await prepareBusiness({ name, place: "Haarlem", db });
    return runScan({ businessId: business.id, kind: "free", samplesPerPrompt: 3, clients: clients(rate), db });
  }

  it("a finished check stores a summary with the heading's numbers: red, green and grey", async () => {
    const red = await scan("Bakkerij Rood", 1);
    const green = await scan("Bakkerij Groen", 0);
    const grey = await scan("Polyvale Nieuw", 0.2); // the mock treats this name as a business AI does not know
    expect([red.stip, green.stip, grey.stip]).toEqual(["rood", "groen", "grijs"]);
    for (const report of [red, green, grey]) {
      const run = await db.getScanRun(report.scanRunId);
      const rows = await runSummaries(db, run!.businessId, 5);
      expect(rows.length, report.business.name).toBe(1);
      const s = rows[0]!.summary!;
      const hand = byHand(report);
      expect(s).toMatchObject({ v: 1, stip: report.stip });
      expect(s.snapshot.scanRunId).toBe(report.scanRunId);
      expect(s.answered).toBeGreaterThanOrEqual(hand.groups);
      expect(s.correct).toBe(hand.groups - hand.wrong - reportCounts(report).notFound);
      expect(s.correct + hand.wrong + reportCounts(report).notFound).toBeLessThanOrEqual(s.answered);
    }
    // The green check has nothing wrong: every question is right. The red one has questions wrong.
    expect(reportCounts(green).wrong).toBe(0);
    expect(reportCounts(green).correct).toBe(reportCounts(green).questions - reportCounts(green).unchecked);
    expect(reportCounts(red).wrong).toBeGreaterThan(0);
    expect(reportCounts(grey).correct).toBeLessThan(reportCounts(grey).questions);
  });

  it("the stored snapshot is what the progress view used to rebuild from the samples, check by check", async () => {
    for (const [name, rate] of [["Bakkerij Rood", 1], ["Bakkerij Groen", 0], ["Polyvale Nieuw", 0.2]] as const) {
      const report = await scan(name, rate);
      const run = await db.getScanRun(report.scanRunId);
      const [row] = await runSummaries(db, run!.businessId, 5);
      expect(row!.summary!.snapshot, name).toEqual(await buildSnapshot(report.scanRunId, db));
    }
  });

  it("a recheck stores no summary and is not in the summaries", async () => {
    const report = await scan("Bakkerij Rood", 1);
    const run = await db.getScanRun(report.scanRunId);
    const recheck = await db.createScanRun({ businessId: run!.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    expect((await runSummaries(db, run!.businessId, 10)).map((r) => r.id)).toEqual([report.scanRunId]);
    expect((await listReportArchive(db, run!.businessId, { limit: 10 })).rows.map((r) => r.id)).not.toContain(recheck.id);
  });

  it("backfill fills a check that has none, and only that one unless asked for all", async () => {
    const report = await scan("Bakkerij Rood", 1);
    const run = await db.getScanRun(report.scanRunId);
    if (db.kind === "pg") await (db as unknown as { sql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).sql`update scan_run set summary = null where id = ${report.scanRunId}`;
    else (db as unknown as Record<symbol, Map<string, unknown>>)[Symbol.for("vidalo.runSummaries")]!.delete(report.scanRunId);
    expect(await runSummaries(db, run!.businessId, 5)).toEqual([]);
    expect(await backfillRunSummaries(db)).toEqual({ saved: 1, failed: 0 });
    const [row] = await runSummaries(db, run!.businessId, 5);
    expect(row!.summary).toEqual(summarizeRun(await buildReport(report.scanRunId, db), (await buildSnapshot(report.scanRunId, db))!));
    expect(await backfillRunSummaries(db)).toEqual({ saved: 0, failed: 0 });
    expect(await backfillRunSummaries(db, { all: true })).toEqual({ saved: 1, failed: 0 });
  });
});
