/**
 * QA, feature 001, verify round 1 (2026-11-15): AC-6 on the real online question set (loadPrompts, not hand-made
 * prompts). Whether Sonable is named in the category and alternative answers never changes the dot; one answer of N
 * that calls Sonable a shop is a criterium-11 finding and the dot is at least orange.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMockDb } from "../src/db";
import { loadPrompts, runScan } from "../src/scanner";
import type { EngineClient } from "../src/scanner/engines/types";
import type { BusinessProfile, Facts, Prompt } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const profile: BusinessProfile = {
  mode: "online", offer: "achtergrondmuziek voor hotels en horeca", audience: "hotels en horeca", category: "aanbieder van achtergrondmuziek",
  competitors: [], website: "sonable.io", confidence: "high", basis: ["website"], source: "owner", grounded: true, decidedAt: "2026-11-11T08:00:00.000Z",
};
const facts: Facts = sampleFacts({
  name: "Sonable", place: "Rotterdam", address: null, postcode: null, phone: null, hours: [], website: "https://sonable.io",
  servicesYes: [], servicesNo: [], prices: [], policies: [], paymentMethods: [], profile,
});

type Answer = (p: Prompt, n: number) => string;
const right: Answer = (p) =>
  p.category === "identity" ? "Sonable levert achtergrondmuziek voor hotels en horeca."
    : p.category === "website" ? "De website van Sonable is sonable.io."
      : "Ja, Sonable bestaat en is actief.";

async function scan(about: Answer, recNamesSonable: boolean) {
  const db = withMockDb();
  const b = await db.upsertBusiness({ name: "Sonable", place: "Rotterdam" });
  await db.insertFacts(b.id, { ...facts, businessId: b.id }, { provisional: false, verifiedAt: "2026-11-11T08:00:00.000Z" });
  await db.setOwnerProfile(b.id, profile);
  const chosen = await loadPrompts(db, b.id, facts, "free", null, undefined, new Date("2026-11-11T09:00:00Z"), profile);
  const seen = new Map<string, number>();
  const client: EngineClient = {
    engine: "chatgpt",
    available: () => true,
    ask: async (_t, ctx) => {
      const p = ctx.prompt as Prompt;
      const n = (seen.get(p.id) ?? 0) + 1;
      seen.set(p.id, n);
      if (p.kind === "recommendation") return { answerText: recNamesSonable ? "1. Sonable\n2. Mood Media\n3. Soundtrack Your Brand" : "1. Mood Media\n2. Soundtrack Your Brand", citations: [], costCents: 0 };
      return { answerText: about(p, n), citations: [], costCents: 0 };
    },
  };
  const report = await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 5, firstSamples: 5, clients: [client], db, promptIds: chosen.map((x) => x.id) });
  return { report, chosen };
}

describe("QA 001 AC-6 on the real online question set", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VIDALO_MOCK", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("named in every category answer or in none: the same dot (green) and the same findings (none)", async () => {
    const none = await scan(right, false);
    const all = await scan(right, true);
    expect(none.chosen).toHaveLength(6);
    expect(none.report.findings).toEqual([]);
    expect(all.report.findings).toEqual([]);
    expect(none.report.stip).toBe("groen");
    expect(all.report.stip).toBe(none.report.stip);
    const recs = (r: typeof none.report) => (r.recommendations ?? []).filter((x) => x.family !== "rec_town");
    expect(recs(none.report).every((r) => r.named === 0)).toBe(true);
    expect(recs(all.report).every((r) => r.named === r.answers && r.answers > 0)).toBe(true);
  });

  it("one answer of five calls Sonable a shop at Weena 705, open on Sunday: a criterium-11 finding, dot orange or worse", async () => {
    const oneWrong: Answer = (p, n) =>
      p.category === "identity" && n === 1 ? "Sonable is een winkel aan de Weena 705 in Rotterdam en is op zondag open." : right(p, n);
    const { report } = await scan(oneWrong, false);
    const identity = report.findings.filter((f) => f.factKey === "identity");
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((f) => f.criterium === 11)).toBe(true);
    expect(["oranje", "rood"]).toContain(report.stip);
  });
});
