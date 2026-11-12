/**
 * QA 11 Nov 2026 (free report A1, A2, A6): the result page's counts, built by apps/web/lib/report.ts from a ScanReport.
 * A1: the per-AI-system line under the hero counts questions, not samples.
 * A2: "Alle N antwoorden bekijken": N is the number of lines in the list.
 * A6: the "De gratis controle stelde X van de N vragen" block counts the business's real sets, and its about/recommendation split matches the hero.
 */
import { describe, expect, it } from "vitest";
import { buildReportView } from "../../../apps/web/lib/report";
import { copy } from "../src/copy";
import { ASKED_ENGINES } from "../src/scanner";
import { moreQuestionsView, questionSets } from "../src/scanner/question-sets";
import type { Engine, Finding, ScanReport } from "../src/types";
import { business, facts } from "./worker-fixtures";

const T = "2026-11-11T10:00:00.000Z";
const finding = (o: Partial<Finding>): Finding =>
  ({ id: "f", businessId: "b", scanRunId: "r", sampleCount: 3, verdict: "wrong", resolvedAt: null, evidenceBefore: null, evidenceAfter: null, status: "open", firstSeenAt: T, sourceUrl: null, sourceType: "third_party", evidenceKind: "about", subject: null, ...o }) as Finding;

/** Three questions to ChatGPT, three times each: phone wrong `wrongN` of 3, address and existence right 3 of 3. */
function report(wrongN: number): ScanReport {
  const correct: ScanReport["correct"] = [];
  const add = (factKey: "phone" | "address" | "existence", value: string, n: number) => {
    for (let i = 0; i < n; i++) correct.push({ prompt: factKey, engine: "chatgpt", value, raw: value, factKey, subject: null });
  };
  add("address", "Grote Houtstraat 1", 3);
  add("existence", "open", 3);
  add("phone", "023 123 45 67", 3 - wrongN);
  const findings = [finding({ factKey: "phone", engine: "chatgpt", wrongValue: "023 999 99 99", correctValue: "023 123 45 67", frequency: wrongN, criterium: 2 })];
  const asked = (["phone", "address", "existence"] as const).map((factKey) => ({ factKey, subject: null, engine: "chatgpt" as Engine, kind: "about" as const, samples: 3, checked: true }));
  return {
    business: { id: "b", slug: "b", name: "Bakkerij Jansen", place: "Haarlem" },
    scanRunId: "r",
    kind: "free",
    checkedAt: T,
    totalAnswers: 9,
    wrongAnswers: wrongN,
    notFoundAnswers: 0,
    visibility: "found",
    engines: [{ engine: "chatgpt", correct: 9 - wrongN, wrong: wrongN, notFound: 0, skipped: false }],
    findings,
    correct,
    stip: "rood",
    engineStips: [{ engine: "chatgpt", stip: "rood", usage: 0.83, counts: true }],
    findingsBySeverity: { afhaker: findings, misleider: [], verwarring: [] },
    instable: [],
    criteriaNotFound: [],
    recommendations: [],
    asked,
  } as unknown as ScanReport;
}

describe("free report counts (A1, A2)", () => {
  it("A1: 3 questions, ChatGPT asked 3x each, 1 question wrong 3 of 3 -> '2 klopt · 1 fout'", () => {
    const v = buildReportView(report(3), copy);
    expect(v.engineLines[0]!.text).toBe("2 klopt · 1 fout");
  });

  it("A1: a phone wrong 1 of 3 is a finding (threshold any), so the hero says 1 wrong question; the engine line must agree", () => {
    const v = buildReportView(report(1), copy);
    expect(v.hero.number).toBe(1); // hero: 1 wrong question
    expect(v.engineLines[0]!.text).toBe("2 klopt · 1 fout");
  });

  it("A2: the heading's N equals the number of lines in the list", () => {
    for (const n of [1, 2, 3]) {
      const v = buildReportView(report(n), copy);
      expect(v.allCount).toBe(v.all.length);
    }
  });
});

describe("free report 'more questions' block (A6)", () => {
  it("X of N come from the real sets; body split matches the hero's question count; 3 examples; topics", async () => {
    const b = { ...business, sector: "horeca" as const, profileAuto: null, profileOwner: null };
    const sets = await questionSets({ questionLibrary: async () => [] } as never, b, { ...facts, sector: "horeca" }, new Date("2026-11-11"));
    const m = moreQuestionsView(sets, ASKED_ENGINES, copy)!;
    expect(m.h2).toBe(`De gratis controle stelde ${sets.free.length} van de ${sets.full.length} vragen`);
    expect(m.cta).toContain(String(sets.full.length));
    const about = sets.free.filter((p) => p.kind !== "recommendation");
    const recs = sets.free.filter((p) => p.kind === "recommendation");
    // The hero counts distinct (fact, subject) keys of the about questions asked.
    const heroQuestions = new Set(about.map((p) => `${p.category}|${(p as { subject?: string | null }).subject ?? ""}`)).size;
    expect(m.body).toContain(`${heroQuestions} vragen over je zaak`);
    expect(m.body).toContain(`${recs.length} vragen over wie AI aanraadt`);
    expect(m.examples).toHaveLength(3);
    const fullTexts = new Set(sets.full.map((p) => p.textNl));
    const freeTexts = new Set(sets.free.map((p) => p.textNl));
    for (const q of m.examples) {
      expect(fullTexts.has(q)).toBe(true);
      expect(freeTexts.has(q)).toBe(false); // an example is a question not yet asked
    }
    expect(m.topics.length).toBeGreaterThan(0);
  });

  it("A6: nothing to add -> no block", () => {
    const b = { ...business, sector: "horeca" as const, profileAuto: null, profileOwner: null };
    return questionSets({ questionLibrary: async () => [] } as never, b, { ...facts, sector: "horeca" }).then((sets) => {
      expect(moreQuestionsView({ free: sets.free, full: sets.free }, ASKED_ENGINES, copy)).toBeNull();
    });
  });
});

describe("free report mail 'more questions' block (A7)", async () => {
  const { baselineSummaryEmail } = await import("../src/reporter/templates");
  const { finding: f } = await import("./worker-fixtures");
  const mq = { h2: "De gratis controle stelde 6 van de 35 vragen", body: "Je zag 3 vragen over je zaak en 3 vragen over wie AI aanraadt.", topics: ["Adres"], examples: ["Waar zit X?"], cta: "Laat alle 35 vragen controleren" };
  const data = (paying: boolean) => ({
    business: { name: "X", place: "Haarlem" },
    checkedAt: T,
    totalAnswers: 9,
    wrongAnswers: 1,
    findings: [f],
    engines: ["chatgpt", "google_ai"] as Engine[],
    links: { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten/x", resultUrl: "https://vidalo.ai/r/x" },
    stip: "rood" as const,
    moreQuestions: mq,
    paying,
  });
  it("free: the block and a CTA to the report's #plan", () => {
    const m = baselineSummaryEmail(data(false) as never);
    expect(m.html).toContain(mq.h2);
    expect(m.text).toContain(mq.h2);
    expect(m.html).toContain("https://vidalo.ai/r/x#plan");
    expect(m.html).toContain(mq.cta);
  });
  it("paying: no block", () => {
    const m = baselineSummaryEmail(data(true) as never);
    expect(m.html).not.toContain(mq.h2);
    expect(m.html).not.toContain("#plan");
  });
});
