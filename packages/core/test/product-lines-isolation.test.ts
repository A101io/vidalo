import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb, withMockDb, type Db } from "../src/db";
import { dashboardRows, listReportArchive, openFixesByFinding, runSummaries, saveRunSummary, type RunSummary } from "../src/db/owner-area";
import { buildReport } from "../src/scanner";
import { exportMyData } from "../src/shared/my-data";
import { streamMyData } from "../src/shared/export-stream";
import type { ProductLineData } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

/**
 * Feature 006 (ADR-0011, S-06): a business reader that is not given a line returns exactly what it returned before
 * the business had any product line. The same business is read twice, with and without a line holding prompts, runs
 * (the newest of them), samples, findings, a fix and a summary, and every reader must agree with itself.
 *
 * A NEW business reader (a Db method, an owner-area function, a SQL query that reads prompts, runs, samples or
 * findings) IS ADDED TO `readAll` BELOW. The test catches the readers it lists, not ones written later.
 *
 * Runs on MemDb and, under TEST_DATABASE_URL (pnpm verify:pg), on PgDb.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
let pg: Db | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      const raw = postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe("truncate claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist restart identity cascade");
      await raw.end();
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
});

const lineData: ProductLineData = {
  name: "Haarlems Speltbrood", category: "speltbrood", useCases: ["ontbijt"], markets: ["NL", "BE"],
  specs: [{ label: "Gewicht", value: "800 g" }], certificates: [], outlets: [], replaces: [], replacedBy: null,
};
const summary = (stip: "groen" | "oranje", recommend?: RunSummary["recommend"]): RunSummary => ({
  v: 1, stip, answered: 1, correct: 1, recommend,
  snapshot: { scanRunId: "x", kind: "monthly", checkedAt: "2026-01-01T00:00:00.000Z", engines: [], stip, engineStips: [], cells: [] },
});

describe.each(backends)("%s business readers ignore product lines", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });

  async function business() {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor" });
    await db.insertFacts(b.id, sampleFacts({ businessId: b.id }), { provisional: false });
    const [p] = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het telefoonnummer van Bakkerij De Vries?", probes: ["phone"], active: true }]);
    const run = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    await db.updateScanRun(run.id, { finishedAt: new Date().toISOString() });
    const [s] = await db.insertSamples([{ scanRunId: run.id, promptId: p!.id, engine: "chatgpt", answerText: "Bel 023-5300000", citations: [], costCents: 1 }]);
    await db.insertClaims([{ sampleId: s!.id, factKey: "phone", value: "0235300000", subject: null, confidence: 0.9, otherEntity: false, rawQuote: "023-5300000" }]);
    const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "0235300000", correctValue: "0235312345", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null, criterium: 2 }]);
    await db.insertFix({ findingId: f!.id, action: "manual", target: "x", evidence: {} });
    await saveRunSummary(db, run.id, summary("oranje"));
    return { b, run };
  }

  /** Every business reader, one JSON value. A line is never named: that is the point. */
  async function readAll(b: { id: string }, run: { id: string }) {
    const dash = await dashboardRows(db, b.id);
    return JSON.parse(
      JSON.stringify({
        prompts: await db.listPrompts(b.id),
        promptsActive: await db.listPrompts(b.id, { activeOnly: true }),
        runs: await db.listScanRuns(b.id),
        lastMonthly: await db.lastScanRunStartedAt(b.id, "monthly"),
        findings: await db.listFindings(b.id),
        findingsOpen: await db.listFindings(b.id, ["open", "fixing", "recheck"]),
        archive: await listReportArchive(db, b.id, { limit: 50 }),
        summaries: await runSummaries(db, b.id, 50),
        dashboard: { findings: dash.findings, runs: dash.scanRuns },
        openFixes: [...(await openFixesByFinding(db, b.id)).entries()],
        report: await buildReport(run.id, db),
        // the downloads hold the lines apart from the business, never mixed into its own lists
        exportBusinessOnly: (await exportMyData(db, b.id))!.scans.filter((r) => !r.productLineId).map((r) => r.id),
      }),
    );
  }

  async function addLine(b: { id: string }) {
    const saved = await db.saveProductLine({ businessId: b.id, productLineId: null, data: lineData, maxActive: 2 });
    if (!saved.ok) throw new Error("setup");
    const lineId = saved.line.id;
    const [lp] = await db.insertPrompts(b.id, [{ category: "spec", textNl: "Welk gewicht heeft Haarlems Speltbrood?", probes: ["spec:Gewicht"], active: true, criterium: 13 }], { productLineId: lineId, market: "NL" });
    for (const market of ["NL", "BE"]) {
      // newer than the business run: any reader that forgets the scope would now pick the line run
      const run = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: lineId, productLineVersion: 1, market });
      await db.updateScanRun(run.id, { finishedAt: new Date().toISOString(), startedAt: new Date(Date.now() + 60_000).toISOString() });
      if (market === "NL") {
        const [s] = await db.insertSamples([{ scanRunId: run.id, promptId: lp!.id, engine: "chatgpt", answerText: "500 g, volgens Bakkerij Concurrent", citations: [], costCents: 1 }]);
        await db.insertClaims([{ sampleId: s!.id, factKey: "spec", value: "500 g", subject: "Gewicht", confidence: 0.9, otherEntity: false, rawQuote: "500 g" }]);
        const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "spec", subject: "Gewicht", engine: "chatgpt", wrongValue: "500 g", correctValue: "800 g", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null, criterium: 13 }]);
        await db.insertFix({ findingId: f!.id, action: "email", target: "info@x.example", evidence: {} });
      }
      await saveRunSummary(db, run.id, summary("groen", { named: 1, answers: 2, others: [{ name: "Bakkerij Concurrent", answers: 2 }] }));
    }
    return lineId;
  }

  it("every reader returns the same with a product line present", async () => {
    const { b, run } = await business();
    const before = await readAll(b, run);
    const lineId = await addLine(b);
    const after = await readAll(b, run);
    expect(after).toEqual(before);
    // and the line is really there for a reader that asks for it (the test would prove nothing otherwise)
    expect((await db.listScanRuns(b.id, 50, { productLineId: lineId })).length).toBe(2);
    expect((await db.listPrompts(b.id, { line: { productLineId: lineId } })).length).toBe(1);
    expect((await db.listFindings(b.id, undefined, { productLineId: lineId })).length).toBe(1);
    expect((await runSummaries(db, b.id, 10, { productLineId: lineId })).length).toBe(2);
    expect((await openFixesByFinding(db, b.id, { productLineId: lineId })).size).toBe(1);
    expect((await dashboardRows(db, b.id, { productLineId: lineId })).findings.length).toBe(1);
  });

  it("the download holds the line apart: its runs, prompts, findings and versions are in it", async () => {
    const { b } = await business();
    const lineId = await addLine(b);
    const out = (await exportMyData(db, b.id))!;
    expect(out.scans.filter((r) => r.productLineId === lineId)).toHaveLength(2);
    expect(out.prompts.filter((p) => p.productLineId === lineId)).toHaveLength(1);
    expect(out.findings.filter((f) => f.productLineId === lineId)).toHaveLength(1);
    expect(out.productLines[0]!.versions).toHaveLength(1);
    // the streamed download (the one the account page serves) says the same
    const streamed = JSON.parse(await new Response(streamMyData(db, b.id, { signedInAs: "x@example.com" })).text());
    expect(streamed.scans.filter((r: { productLineId?: string }) => r.productLineId === lineId)).toHaveLength(2);
    expect(streamed.prompts.filter((p: { productLineId?: string }) => p.productLineId === lineId)).toHaveLength(1);
    expect(streamed.findings.filter((f: { productLineId?: string }) => f.productLineId === lineId)).toHaveLength(1);
    expect(streamed.productLines).toHaveLength(1);
  });
});
