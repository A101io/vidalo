import { afterAll, describe, expect, it } from "vitest";
import { createDb, withMockDb, type Db } from "../src/db";
import { dashboardRows, listReportArchive, overviewExtras, runSummaries } from "../src/db/owner-area";
import { buildReport } from "../src/scanner";
import { streamMyData } from "../src/shared/export-stream";
import { countingDb, seedHistory } from "./helpers/counting-db";
import { ENGINES } from "../src/types";

/**
 * Feature 002 QA (phase 4), AC-7 at the brief's numbers: 36 monthly checks with every answer stored (10 questions ×
 * every AI system × 10 answers), 500 findings, 2,000 events, against 3 checks. Counts the round trips of the reads
 * behind all five owner pages (B-03's test covers three, with 3 answers and 120 findings), and streams the download
 * of the big history: complete, and timed against the 30-second budget.
 *
 *   TEST_DATABASE_URL=…/vidalo_verify SCALE_VERBOSE=1 npx vitest run --no-file-parallelism test/owner-area-scale-qa.test.ts
 *
 * Control used in phase 4: `runSummaries` (db/owner-area.ts) made to read each check's summary with its own query,
 * as the progress view did before B-03; the equality goes red (see verification/qa.md).
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "auth_session, auth_throttle, question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";
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

/** The reads of the five owner pages, as the web loaders make them (lib/reads.ts, owner-data.ts, core.ts, app/app/account, app/app/abonnement). */
async function pageReads(db: Db, businessId: string, userId: string) {
  const dash = await dashboardRows(db, businessId); // /app, /app/voortgang, /app/account (loadDashboard)
  const lastRun = dash.scanRuns.find((r) => r.status === "done");
  await Promise.all([
    overviewExtras(db, businessId), // /app
    lastRun ? buildReport(lastRun.id, db) : null, // /app and /app/account: the report of the last check
    runSummaries(db, businessId, 30), // /app/voortgang
    listReportArchive(db, businessId, { limit: 24 }), // /app/rapporten
    db.listSignIns(userId, 10), // /app/account
    db.listEvents(businessId, 200), // /app/abonnement
  ]);
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  let out = "";
  const r = s.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return out;
    out += dec.decode(value, { stream: true });
  }
}

describe.each([["mem"], ...(PG_URL ? [["pg"]] : [])] as ["mem" | "pg"][])("%s: AC-7 at the brief's numbers", (kind) => {
  it("all five owner pages: the same round trips with 36 checks as with 3; the download is whole and within budget", { timeout: 300_000 }, async () => {
    const db = await freshDb(kind);
    const user = { small: "0a0a0a0a-0000-4000-8000-000000000001", big: "0a0a0a0a-0000-4000-8000-000000000002" };
    const small = await seedHistory(db, { name: "Klein QA", place: "Haarlem", checks: 3, findings: 20, events: 40, samplesForEvery: true, answers: 10, ownerUserId: user.small });
    const big = await seedHistory(db, { name: "Groot QA", place: "Leiden", checks: 36, findings: 500, events: 2000, samplesForEvery: true, answers: 10, ownerUserId: user.big });
    const counts: Record<string, number> = {};
    for (const [label, id, u] of [["small", small.businessId, user.small], ["big", big.businessId, user.big]] as const) {
      const c = countingDb(db);
      await pageReads(c.db, id, u);
      counts[label] = c.count();
    }

    const started = Date.now();
    const parsed = JSON.parse(await readAll(streamMyData(db, big.businessId, { signedInAs: "groot@example.nl", userId: user.big })));
    const ms = Date.now() - started;
    const samples = parsed.scans.reduce((n: number, s: { samples: unknown[] }) => n + s.samples.length, 0);
    if (process.env.SCALE_VERBOSE) console.info(`[${kind}] AC-7 round trips ${JSON.stringify(counts)}; export: ${parsed.scans.length} checks, ${samples} answers, ${parsed.findings.length} findings, ${parsed.events.length} events in ${ms} ms`);

    expect(counts.big).toBe(counts.small);
    expect(parsed.scans).toHaveLength(36);
    expect(samples, "every answer of every check").toBe(36 * 10 * ENGINES.length * 10);
    expect(parsed.findings).toHaveLength(500);
    expect(parsed.events.length).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThan(30_000);
  });
});
