import { beforeEach, describe, expect, it } from "vitest";
import { withMockDb, type Db } from "../src/db";
import { runSummaries, saveRunSummary, summarizeRun } from "../src/db/owner-area";
import { exportMyData } from "../src/shared/my-data";
import { PRODUCT_LINE_LIMITS, lineScopeOf } from "../src/shared/product-lines";
import type { ProductLineData, ScanReport } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

/**
 * Feature 006 BE-01. Written in the shared db test style: BE-02 adds PgDb to `backends` (and the line tables to
 * TABLES) once migration 0020 exists; until then the PgDb methods throw "BE-02" and only MemDb runs.
 */
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];

const data = (name: string, over: Partial<ProductLineData> = {}): ProductLineData => ({
  name,
  category: "persfittingsysteem",
  useCases: ["renovatie"],
  markets: ["NL", "BE"],
  specs: [{ label: "Drukklasse", value: "PN16" }],
  certificates: [],
  outlets: [],
  replaces: [],
  replacedBy: null,
  ...over,
});
const MAX = PRODUCT_LINE_LIMITS.lines;

describe.each(backends)("%s product lines", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });
  const biz = async (name = "Installatiebedrijf Noord") => db.upsertBusiness({ name, place: "Zwolle" });
  const save = (businessId: string, name: string, productLineId: string | null = null, over: Partial<ProductLineData> = {}, maxActive = MAX) =>
    db.saveProductLine({ businessId, productLineId, data: data(name, over), maxActive });

  it("save new -> v1, save again -> v2 and v1 is unchanged", async () => {
    const b = await biz();
    const r1 = await save(b.id, "Tigris K5");
    expect(r1).toMatchObject({ ok: true, created: true, line: { status: "active", businessId: b.id, current: { version: 1, name: "Tigris K5" } } });
    if (!r1.ok) return;
    const r2 = await save(b.id, "Tigris K5 Plus", r1.line.id, { specs: [{ label: "Drukklasse", value: "PN25" }] });
    expect(r2).toMatchObject({ ok: true, created: false, line: { id: r1.line.id, current: { version: 2, name: "Tigris K5 Plus" } } });
    const versions = await db.listProductLineVersions(r1.line.id);
    expect(versions.map((v) => [v.version, v.name, v.specs[0]!.value])).toEqual([[1, "Tigris K5", "PN16"], [2, "Tigris K5 Plus", "PN25"]]);
    // what comes back is a copy: changing it never changes a stored version
    versions[0]!.name = "changed";
    (await db.getProductLineVersion(r1.line.id, 1))!.specs.length = 0;
    expect((await db.getProductLineVersion(r1.line.id, 1))).toMatchObject({ name: "Tigris K5", specs: [{ value: "PN16" }] });
    expect((await db.getProductLine(r1.line.id))!.current.version).toBe(2);
    expect(await db.getProductLineVersion(r1.line.id, 3)).toBeNull();
  });

  it("lists active lines first, then by name", async () => {
    const b = await biz();
    const z = await save(b.id, "Zeta", null, {}, 5);
    const a = await save(b.id, "Alfa", null, {}, 5);
    const c = await save(b.id, "Gamma", null, {}, 5);
    if (!z.ok || !a.ok || !c.ok) throw new Error("setup");
    await db.setProductLineStatus({ businessId: b.id, productLineId: a.line.id, status: "discontinued", maxActive: 5 });
    expect((await db.listProductLines(b.id)).map((l) => l.current.name)).toEqual(["Gamma", "Zeta", "Alfa"]);
  });

  it("refuses a third active line with limit; discontinuing frees a place; reactivation obeys the limit", async () => {
    const b = await biz();
    const l1 = await save(b.id, "Een");
    const l2 = await save(b.id, "Twee");
    expect(await save(b.id, "Drie")).toEqual({ ok: false, reason: "limit" });
    if (!l1.ok || !l2.ok) throw new Error("setup");
    expect(await db.setProductLineStatus({ businessId: b.id, productLineId: l1.line.id, status: "discontinued", maxActive: MAX })).toMatchObject({ ok: true, line: { status: "discontinued" } });
    const l3 = await save(b.id, "Drie");
    expect(l3.ok).toBe(true);
    expect(await db.setProductLineStatus({ businessId: b.id, productLineId: l1.line.id, status: "active", maxActive: MAX })).toEqual({ ok: false, reason: "limit" });
    expect((await db.getProductLine(l1.line.id))!.status).toBe("discontinued");
    // editing a discontinued line is allowed (any status) and keeps it discontinued
    expect(await save(b.id, "Een nieuw", l1.line.id)).toMatchObject({ ok: true, line: { status: "discontinued", current: { version: 2 } } });
  });

  it("two parallel saves at the limit: one ok, one limit", async () => {
    const b = await biz();
    expect((await save(b.id, "Een")).ok).toBe(true); // one place left at lines: 2
    const out = await Promise.all([save(b.id, "Twee"), save(b.id, "Drie")]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok && r.reason === "limit")).toHaveLength(1);
    expect((await db.listProductLines(b.id)).filter((l) => l.status === "active")).toHaveLength(2);
    // many in parallel
    const b2 = await biz("Ander bedrijf");
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => save(b2.id, `Lijn ${i}`)));
    expect(many.filter((r) => r.ok)).toHaveLength(MAX);
  });

  it("parallel reactivations at the limit do not oversell", async () => {
    const b = await biz();
    const ids: string[] = [];
    for (const n of ["Een", "Twee"]) {
      const r = await save(b.id, n);
      if (r.ok) ids.push(r.line.id);
    }
    for (const id of ids) await db.setProductLineStatus({ businessId: b.id, productLineId: id, status: "discontinued", maxActive: MAX });
    const three = await save(b.id, "Drie");
    const four = await save(b.id, "Vier");
    expect([three.ok, four.ok]).toEqual([true, true]);
    const back = await Promise.all(ids.map((id) => db.setProductLineStatus({ businessId: b.id, productLineId: id, status: "active", maxActive: MAX })));
    expect(back.filter((r) => r.ok)).toHaveLength(0);
  });

  it("not_found for another business's id, in save and in status; nothing is written", async () => {
    const a = await biz("Bedrijf A");
    const b = await biz("Bedrijf B");
    const lineB = await save(b.id, "Van B");
    if (!lineB.ok) throw new Error("setup");
    expect(await save(a.id, "Gekaapt", lineB.line.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await db.setProductLineStatus({ businessId: a.id, productLineId: lineB.line.id, status: "discontinued", maxActive: MAX })).toEqual({ ok: false, reason: "not_found" });
    expect(await save(a.id, "Onbekend", "does-not-exist")).toEqual({ ok: false, reason: "not_found" });
    expect(await db.listProductLineVersions(lineB.line.id)).toHaveLength(1);
    expect((await db.getProductLine(lineB.line.id))!.status).toBe("active");
    expect(await db.listProductLines(a.id)).toEqual([]);
  });

  describe("scope", () => {
    async function setup() {
      const b = await biz();
      await db.insertFacts(b.id, sampleFacts(), { provisional: false });
      const saved = await save(b.id, "Tigris K5");
      if (!saved.ok) throw new Error("setup");
      const lineId = saved.line.id;
      const [bp] = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het nummer?", probes: ["phone"], active: true }]);
      const lp = await db.insertPrompts(
        b.id,
        [{ category: "spec", textNl: "Welke drukklasse heeft Tigris K5?", probes: ["spec:Drukklasse"], active: true, criterium: 13 }],
        { productLineId: lineId, market: "NL" },
      );
      const lpBE = await db.insertPrompts(b.id, [{ category: "spec", textNl: "What drukklasse does Tigris K5 have?", probes: ["spec:Drukklasse"], active: true, criterium: 13 }], { productLineId: lineId, market: "BE" });
      const bizRun = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
      const lineRun = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: lineId, productLineVersion: 1, market: "NL" });
      const lineRunBE = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: lineId, productLineVersion: 1, market: "BE" });
      return { b, lineId, bp: bp!, lp: lp[0]!, lpBE: lpBE[0]!, bizRun, lineRun, lineRunBE };
    }
    const finding = (s: Awaited<ReturnType<typeof setup>>, runId: string, over: Record<string, unknown> = {}) => ({
      businessId: s.b.id, scanRunId: runId, factKey: "spec" as const, subject: "Drukklasse", engine: "chatgpt" as const, wrongValue: "PN10", correctValue: "PN16",
      frequency: 3, sampleCount: 5, sourceUrl: null, sourceType: "none" as const, evidenceBefore: null, criterium: 13 as const, ...over,
    });

    it("listPrompts, listScanRuns, lastScanRunStartedAt without a line see the business only; with a line only that line", async () => {
      const s = await setup();
      expect((await db.listPrompts(s.b.id)).map((p) => p.id)).toEqual([s.bp.id]);
      expect((await db.listPrompts(s.b.id, { line: { productLineId: s.lineId } })).map((p) => p.id).sort()).toEqual([s.lp.id, s.lpBE.id].sort());
      expect((await db.listPrompts(s.b.id, { line: { productLineId: s.lineId, market: "BE" } })).map((p) => p.id)).toEqual([s.lpBE.id]);
      expect(s.lp).toMatchObject({ productLineId: s.lineId, market: "NL" });
      expect((await db.listScanRuns(s.b.id)).map((r) => r.id)).toEqual([s.bizRun.id]);
      expect((await db.listScanRuns(s.b.id, 50, { productLineId: s.lineId })).map((r) => r.id).sort()).toEqual([s.lineRun.id, s.lineRunBE.id].sort());
      expect((await db.listScanRuns(s.b.id, 50, { productLineId: s.lineId, market: "NL" })).map((r) => r.id)).toEqual([s.lineRun.id]);
      expect((await db.getScanRun(s.lineRun.id))).toMatchObject({ productLineId: s.lineId, productLineVersion: 1, market: "NL" });
      await db.updateScanRun(s.lineRun.id, { startedAt: "2099-01-01T00:00:00.000Z" });
      expect(await db.lastScanRunStartedAt(s.b.id, "monthly")).not.toBe("2099-01-01T00:00:00.000Z");
    });

    it("a run needs line, version and market together, and an existing version of its own business's line", async () => {
      const s = await setup();
      const other = await biz("Ander");
      const base = { kind: "monthly" as const, engines: ["chatgpt" as const], samplesPerPrompt: 1 };
      await expect(db.createScanRun({ businessId: s.b.id, ...base, productLineId: s.lineId })).rejects.toThrow(/all_or_none/);
      await expect(db.createScanRun({ businessId: s.b.id, ...base, productLineId: s.lineId, market: "NL" })).rejects.toThrow(/all_or_none/);
      await expect(db.createScanRun({ businessId: s.b.id, ...base, productLineId: s.lineId, productLineVersion: 9, market: "NL" })).rejects.toThrow(/line_version/);
      await expect(db.createScanRun({ businessId: other.id, ...base, productLineId: s.lineId, productLineVersion: 1, market: "NL" })).rejects.toThrow(/same_business/);
      await expect(db.insertPrompts(other.id, [{ category: "spec", textNl: "x y", probes: [], active: true }], { productLineId: s.lineId, market: "NL" })).rejects.toThrow(/same_business/);
    });

    it("samples take the run's line and market; a line prompt in a business run (or the reverse) throws", async () => {
      const s = await setup();
      const [ok] = await db.insertSamples([{ scanRunId: s.lineRun.id, promptId: s.lp.id, engine: "chatgpt", answerText: "PN10", citations: [], costCents: 1 }]);
      expect(ok).toMatchObject({ productLineId: s.lineId, market: "NL" });
      expect(await db.listSamples(s.lineRun.id)).toHaveLength(1);
      const bad = (runId: string, promptId: string) => db.insertSamples([{ scanRunId: runId, promptId, engine: "chatgpt", answerText: "x", citations: [], costCents: 1 }]);
      await expect(bad(s.bizRun.id, s.lp.id)).rejects.toThrow(/different product lines/);
      await expect(bad(s.lineRun.id, s.bp.id)).rejects.toThrow(/different product lines/);
      await expect(bad(s.lineRun.id, s.lpBE.id)).rejects.toThrow(/different product lines/); // another market
      const [bizSample] = await db.insertSamples([{ scanRunId: s.bizRun.id, promptId: s.bp.id, engine: "chatgpt", answerText: "x", citations: [], costCents: 1 }]);
      expect(bizSample!.productLineId ?? null).toBeNull();
      // a prompt of another business never answers in this run
      const other = await biz("Ander");
      const [op] = await db.insertPrompts(other.id, [{ category: "phone", textNl: "Nummer?", probes: ["phone"], active: true }]);
      await expect(bad(s.bizRun.id, op!.id)).rejects.toThrow(/different businesses/);
    });

    it("listFindings, upsertFindings: line and market are the run's; matching is per line and market", async () => {
      const s = await setup();
      const [lf] = await db.upsertFindings([finding(s, s.lineRun.id)]);
      expect(lf).toMatchObject({ productLineId: s.lineId, market: "NL" });
      // the same finding key in a business run is a different finding, not a match
      const [bf] = await db.upsertFindings([finding(s, s.bizRun.id, { factKey: "phone", subject: null, criterium: 2 })]);
      expect(bf!.productLineId ?? null).toBeNull();
      const [again] = await db.upsertFindings([finding(s, s.lineRun.id, { frequency: 4 })]);
      expect(again!.id).toBe(lf!.id);
      const [be] = await db.upsertFindings([finding(s, s.lineRunBE.id)]);
      expect(be!.id).not.toBe(lf!.id); // same key, other market
      expect((await db.listFindings(s.b.id)).map((f) => f.id)).toEqual([bf!.id]);
      expect((await db.listFindings(s.b.id, "open", { productLineId: s.lineId })).map((f) => f.id).sort()).toEqual([lf!.id, be!.id].sort());
      expect((await db.listFindings(s.b.id, undefined, { productLineId: s.lineId, market: "BE" })).map((f) => f.id)).toEqual([be!.id]);
      expect(lineScopeOf(be!)).toEqual({ productLineId: s.lineId, market: "BE" });
      expect(lineScopeOf(bf!)).toBeUndefined();
      // the same key and market on another line is another finding
      const second = await save(s.b.id, "Tigris K7");
      if (!second.ok) throw new Error("setup");
      const run2 = await db.createScanRun({ businessId: s.b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: second.line.id, productLineVersion: 1, market: "NL" });
      const [other] = await db.upsertFindings([finding(s, run2.id)]);
      expect(other!.id).not.toBe(lf!.id);
      expect((await db.listFindings(s.b.id, undefined, { productLineId: second.line.id })).map((f) => f.id)).toEqual([other!.id]);
    });

    it("a finding cannot move to another line's or the business's run, or another business's run", async () => {
      const s = await setup();
      await expect(db.upsertFindings([finding(s, s.lineRun.id, { productLineId: s.lineId, market: "BE" })])).rejects.toThrow(/cannot move/);
      await expect(db.upsertFindings([finding(s, s.bizRun.id, { productLineId: s.lineId, market: "NL" })])).rejects.toThrow(/cannot move/);
      const other = await biz("Ander");
      const otherRun = await db.createScanRun({ businessId: other.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
      await expect(db.upsertFindings([finding(s, otherRun.id)])).rejects.toThrow(/different|business/);
      // deleting a run moves its findings only to a run of the same scope
      await db.upsertFindings([finding(s, s.lineRun.id)]);
      expect(await db.deleteScanRun(s.lineRun.id, { moveFindingsTo: s.bizRun.id })).toBe(false);
      expect(await db.deleteScanRun(s.lineRun.id, { moveFindingsTo: s.lineRunBE.id })).toBe(false);
      expect(await db.getScanRun(s.lineRun.id)).not.toBeNull();
    });

    it("runSummaries: without a line only business runs; with a line only that line (and market); recommend is filled", async () => {
      const s = await setup();
      const summary = (stip: "groen" | "oranje") => ({ v: 1 as const, stip, answered: 1, correct: 1, snapshot: { scanRunId: "x", kind: "monthly" as const, checkedAt: "", engines: [], stip, engineStips: [], cells: [] } });
      await saveRunSummary(db, s.bizRun.id, summary("groen"));
      await saveRunSummary(db, s.lineRun.id, { ...summary("oranje"), recommend: { named: 3, answers: 10, others: [{ name: "Merk A", answers: 2 }] } });
      await saveRunSummary(db, s.lineRunBE.id, summary("oranje"));
      expect((await runSummaries(db, s.b.id, 10)).map((r) => r.id)).toEqual([s.bizRun.id]);
      expect((await runSummaries(db, s.b.id, 10, { productLineId: s.lineId })).map((r) => r.id).sort()).toEqual([s.lineRun.id, s.lineRunBE.id].sort());
      const nl = await runSummaries(db, s.b.id, 10, { productLineId: s.lineId, market: "NL" });
      expect(nl.map((r) => r.id)).toEqual([s.lineRun.id]);
      expect(nl[0]!.summary!.recommend).toEqual({ named: 3, answers: 10, others: [{ name: "Merk A", answers: 2 }] });
    });

    it("the owner's export holds every line, its versions and its line rows", async () => {
      const s = await setup();
      await save(s.b.id, "Tigris K5 Plus", s.lineId);
      await db.insertSamples([{ scanRunId: s.lineRun.id, promptId: s.lp.id, engine: "chatgpt", answerText: "PN10", citations: [], costCents: 1 }]);
      const [lf] = await db.upsertFindings([finding(s, s.lineRun.id)]);
      const out = (await exportMyData(db, s.b.id))!;
      expect(out.productLines).toHaveLength(1);
      expect(out.productLines[0]!.versions.map((v) => v.version)).toEqual([1, 2]);
      expect(out.scans.map((r) => r.id)).toEqual(expect.arrayContaining([s.bizRun.id, s.lineRun.id, s.lineRunBE.id]));
      expect(out.scans.find((r) => r.id === s.lineRun.id)!.samples).toHaveLength(1);
      expect(out.findings.map((f) => f.id)).toContain(lf!.id);
      expect(out.prompts.map((p) => p.id)).toEqual(expect.arrayContaining([s.bp.id, s.lp.id, s.lpBE.id]));
    });
  });
});

describe("summarizeRun recommend", () => {
  it("sums named and answers over the recommendation questions and keeps the five most-named others", () => {
    const rec = (named: number, answers: number, others: [string, number][]) => ({ promptId: "p", prompt: "q", intent: null, family: "rec_category" as const, quotes: [], pool: "core" as const, probe: null, answers, named, others: others.map(([name, a]) => ({ name, answers: a })), sources: [] });
    const report = {
      stip: "oranje", engines: [], findings: [], correct: [], asked: [],
      recommendations: [rec(2, 5, [["A", 3], ["B", 1]]), rec(1, 5, [["A", 2], ["C", 2], ["D", 1], ["E", 1], ["F", 1], ["G", 1]])],
    } as unknown as ScanReport;
    const s = summarizeRun(report, { scanRunId: "r", kind: "monthly", checkedAt: "", engines: [], stip: "oranje", engineStips: [], cells: [] });
    expect(s.recommend).toEqual({ named: 3, answers: 10, others: [{ name: "A", answers: 5 }, { name: "C", answers: 2 }, { name: "B", answers: 1 }, { name: "D", answers: 1 }, { name: "E", answers: 1 }] });
  });
});
