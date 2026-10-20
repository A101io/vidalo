import { describe, expect, it } from "vitest";
import { withMockDb } from "../src/db";
import { ENGINES } from "../src/types";
import { generatePrompts } from "../src/prompts";
import { buildReport, runScan } from "../src/scanner";
import { createMockEngine } from "../src/scanner/engines";
import { prepareBusiness } from "../src/scanner/onboard";
import { resolveBusiness, draftProvisionalFacts } from "../src/scanner/resolve";
import { sampleFacts } from "./scanner-fixtures";

describe("mock engine", () => {
  it("is deterministic and injects wrong values for a share of prompts", async () => {
    const db = withMockDb();
    const business = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem" });
    const facts = sampleFacts({ businessId: business.id });
    const prompts = (await db.insertPrompts(business.id, generatePrompts(facts))).slice(0, 20);
    const engine = createMockEngine("chatgpt");
    const a = await engine.ask(prompts[0]!.textNl, { business, facts, prompt: prompts[0], sampleIndex: 0 });
    const b = await engine.ask(prompts[0]!.textNl, { business, facts, prompt: prompts[0], sampleIndex: 0 });
    expect(a).toEqual(b);
    expect(a.answerText).toMatch(/Bakkerij De Vries/);
  });
});

describe("runScan (mock pipeline)", () => {
  it("returns findings with sources and a correct list, and persists everything", async () => {
    const db = withMockDb();
    const prepared = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    // 20 base prompts + the "winkels" sector pack (inferred from the name): its core and its bank.
    expect(prepared.business.sector).toBe("winkels");
    const core = prepared.prompts.filter((p) => p.pool !== "bank");
    const bank = prepared.prompts.filter((p) => p.pool === "bank");
    expect(core.length).toBeGreaterThanOrEqual(26);
    expect(core.length).toBeLessThanOrEqual(32);
    expect(core.filter((p) => p.kind === "recommendation").length).toBe(6);
    expect(bank.length).toBeGreaterThanOrEqual(6);

    const report = await runScan({ businessId: prepared.business.id, kind: "baseline", samplesPerPrompt: 3, db });
    // A full scan asks the core and six questions from the bank.
    expect(report.totalAnswers).toBe((core.length + 6) * 5 * 3);
    const recs = report.recommendations ?? [];
    expect(recs.filter((r) => r.pool === "core")).toHaveLength(6);
    expect(recs.filter((r) => r.pool === "bank").length).toBeLessThanOrEqual(6);
    // The mock leaves the business out of part of the lists and names three others.
    expect(recs.some((r) => r.named < r.answers)).toBe(true);
    expect(recs.every((r) => r.others.every((o) => !o.name.includes("De Vries")))).toBe(true);
    expect(recs.some((r) => r.others.length > 0)).toBe(true);
    expect(["rood", "oranje", "groen", "grijs"]).toContain(report.stip);
    expect(report.engineStips).toHaveLength(5);
    expect(report.findingsBySeverity.afhaker.length + report.findingsBySeverity.misleider.length + report.findingsBySeverity.verwarring.length).toBe(report.findings.length);
    expect(report.wrongAnswers).toBeGreaterThan(0);
    expect(report.wrongAnswers).toBeLessThan(report.totalAnswers);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.correct.length).toBeGreaterThan(0);
    expect(report.engines).toHaveLength(5);
    expect(report.engines.every((e) => !e.skipped)).toBe(true);

    for (const f of report.findings) {
      expect(f.businessId).toBe(prepared.business.id);
      expect(f.scanRunId).toBe(report.scanRunId);
      expect(f.status).toBe("open");
      expect(f.frequency).toBeGreaterThan(0);
      expect(f.frequency).toBeLessThanOrEqual(f.sampleCount);
      expect(f.evidenceBefore).toBeTruthy();
      if (f.sourceUrl) expect(f.sourceType).not.toBe("none");
      else expect(["none", "other_entity"]).toContain(f.sourceType);
    }
    // The mock cites directories for part of the wrong answers.
    expect(report.findings.some((f) => f.sourceType === "directory_form")).toBe(true);
    expect(report.findings.some((f) => f.sourceType === "none")).toBe(true);

    const run = await db.getScanRun(report.scanRunId);
    expect(run?.status).toBe("done");
    expect(await db.listSamples(report.scanRunId)).toHaveLength(report.totalAnswers);
    expect((await db.listEvents(prepared.business.id)).map((e) => e.type)).toContain("scan.finished");

    // buildReport reconstructs the same numbers from storage.
    const rebuilt = await buildReport(report.scanRunId, db);
    expect(rebuilt.totalAnswers).toBe(report.totalAnswers);
    expect(rebuilt.wrongAnswers).toBe(report.wrongAnswers);
    expect(rebuilt.findings.map((f) => f.id).sort()).toEqual(report.findings.map((f) => f.id).sort());
  });

  it("free scan uses 6 prompts and the free-scan engines", async () => {
    const db = withMockDb();
    const prepared = await prepareBusiness({ name: "Kapsalon Mooi", place: "Leiden", db });
    const report = await runScan({ businessId: prepared.business.id, kind: "free", db });
    expect(report.engines.map((e) => e.engine)).toEqual(["chatgpt", "google_ai", "copilot"]);
    expect(report.totalAnswers).toBe(6 * 3 * 3);
  });

  it("upserts findings across scans and resolves the ones that are no longer wrong", async () => {
    const db = withMockDb();
    const prepared = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const first = await runScan({ businessId: prepared.business.id, kind: "baseline", samplesPerPrompt: 2, db });
    expect(first.findings.length).toBeGreaterThan(0);

    // Same inputs again: the same findings are updated in place, not duplicated.
    const second = await runScan({ businessId: prepared.business.id, kind: "monthly", samplesPerPrompt: 2, db });
    const ids = new Set(first.findings.map((f) => f.id));
    expect(second.findings.every((f) => ids.has(f.id))).toBe(true);
    expect(await db.listFindings(prepared.business.id, "open")).toHaveLength(first.findings.length);

    // A recheck where every engine now answers correctly resolves all open findings with after-evidence.
    const perfect = ENGINES.map((e) => createMockEngine(e, { wrongPairRate: 0, otherEntityRate: 0 }));
    const third = await runScan({ businessId: prepared.business.id, kind: "recheck", samplesPerPrompt: 2, db, clients: perfect });
    expect(third.findings).toHaveLength(0);
    expect(third.wrongAnswers).toBe(0);
    expect(await db.listFindings(prepared.business.id, "open")).toHaveLength(0);
    const resolved = await db.listFindings(prepared.business.id, "resolved");
    expect(resolved).toHaveLength(first.findings.length);
    expect(resolved.every((f) => f.resolvedAt && f.evidenceAfter)).toBe(true);
  });
});

describe("runScan on a business the AI has never heard of", () => {
  it("Polyvale Nieuw in Haarlem without a website: visibility unknown, not_found findings, nothing counted as wrong twice", async () => {
    const db = withMockDb();
    const prepared = await prepareBusiness({ name: "Polyvale Nieuw", place: "Haarlem", db });
    const provisional = (await db.latestFacts(prepared.business.id))!;
    const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, ...data } = provisional;
    await db.insertFacts(prepared.business.id, { ...data, website: null }, { provisional: true });

    const report = await runScan({ businessId: prepared.business.id, kind: "free", db });
    expect(report.totalAnswers).toBe(6 * 3 * 3);
    expect(report.visibility).toBe("unknown");
    expect(report.notFoundAnswers / report.totalAnswers).toBeGreaterThanOrEqual(0.6);
    expect(report.wrongAnswers + report.notFoundAnswers).toBeLessThanOrEqual(report.totalAnswers);
    const notFound = report.findings.filter((f) => f.verdict === "not_found");
    expect(notFound.length).toBeGreaterThanOrEqual(1);
    for (const f of notFound) {
      expect(f.wrongValue).toBe("niet gevonden");
      expect(f.sourceType).toBe("none");
      expect(f.sourceUrl).toBeNull();
      expect(f.frequency / f.sampleCount).toBeGreaterThanOrEqual(0.5);
      expect(f.evidenceBefore).toBeTruthy();
    }
    // Per-engine counts add up and not-found is reported on its own.
    const sum = report.engines.reduce((acc, e) => acc + e.notFound, 0);
    expect(sum).toBe(report.notFoundAnswers);
    expect(report.engines.every((e) => e.notFound > 0)).toBe(true);
    expect(report.wrongAnswers).toBe(report.engines.reduce((acc, e) => acc + e.wrong, 0));

    const rebuilt = await buildReport(report.scanRunId, db);
    expect(rebuilt.visibility).toBe("unknown");
    expect(rebuilt.notFoundAnswers).toBe(report.notFoundAnswers);

    // A second scan upserts the same not_found findings (match key includes the verdict).
    const second = await runScan({ businessId: prepared.business.id, kind: "free", db });
    const ids = new Set(report.findings.map((f) => f.id));
    expect(second.findings.every((f) => ids.has(f.id))).toBe(true);
  });

  it("a known business stays 'found'", async () => {
    const db = withMockDb();
    const prepared = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const report = await runScan({ businessId: prepared.business.id, kind: "free", db });
    expect(report.visibility).toBe("found");
    expect(report.notFoundAnswers).toBe(0);
    expect(report.findings.every((f) => f.verdict === "wrong")).toBe(true);
  });
});

describe("resolve (mock)", () => {
  it("returns a synthetic candidate and drafts provisional facts", async () => {
    const [c] = await resolveBusiness("Garage Jansen", "Zwolle");
    expect(c).toMatchObject({ name: "Garage Jansen", place: "Zwolle", source: "mock" });
    expect(c!.phone).toMatch(/^\+31/);
    const facts = await draftProvisionalFacts(c!);
    expect(facts.provisional).toBe(true);
    expect(facts.verifiedAt).toBeNull();
    expect(facts.hours).toHaveLength(7);
    expect(facts.servicesYes).toContain("apk-keuring");
  });
});
