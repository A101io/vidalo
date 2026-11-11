/**
 * BE-06 (feature 001): judging an online business. "Wat doet X" is a criterium-11
 * question, naming needs no town for an online business, and the recommendation
 * summaries carry a family and quoted sentences. Sonable is the AC-6 case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMockDb } from "../src/db";
import { compare, type ComparableSample } from "../src/scanner/compare";
import { runScan } from "../src/scanner";
import { detectOtherEntity, extractClaimsRules, kindClaimFromAnswer, mentionsBusiness } from "../src/scanner/extract";
import { factValue } from "../src/scanner/normalize";
import { quotesFor, summarizeRecommendations } from "../src/scanner/recommendations";
import type { EngineClient } from "../src/scanner/engines/types";
import type { BusinessProfile, Facts } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  mode: "online",
  offer: "achtergrondmuziek en geluid voor bedrijven",
  audience: "ondernemers",
  category: "aanbieder van achtergrondmuziek",
  competitors: [],
  website: "sonable.io",
  confidence: "high",
  basis: ["website"],
  source: "auto",
  grounded: true,
  decidedAt: "2026-11-11T08:00:00.000Z",
  ...over,
});

const online = (over: Partial<Facts> = {}, p: Partial<BusinessProfile> = {}): Facts =>
  sampleFacts({
    name: "Sonable",
    place: "Rotterdam",
    address: null,
    postcode: null,
    phone: null,
    hours: [],
    website: "https://www.sonable.io",
    servicesYes: [],
    servicesNo: [],
    prices: [],
    policies: [],
    paymentMethods: [],
    profile: profile(p),
    ...over,
  });

const kindPrompt = { category: "identity" as const, probes: ["identity:kind"], textNl: "Wat doet Sonable?" };

describe("factValue identity:kind", () => {
  it("is same only for a grounded profile with an offer", () => {
    expect(factValue(online(), "identity", "kind")).toBe("same");
    expect(factValue(online({}, { grounded: false }), "identity", "kind")).toBeNull();
    expect(factValue(online({}, { offer: null }), "identity", "kind")).toBeNull();
    expect(factValue(sampleFacts(), "identity", "kind")).toBeNull();
  });
  it("does not use an offer that came from the AI lookup alone", () => {
    expect(factValue(online({}, { grounded: true, basis: ["ai_lookup"] }), "identity", "kind")).toBeNull();
    expect(factValue(online({}, { basis: ["ai_lookup", "website"] }), "identity", "kind")).toBe("same");
  });
  it("leaves the other identity subjects as they were", () => {
    expect(factValue(sampleFacts(), "identity", "Bakkerij Jansen")).toBe("no");
    expect(factValue(sampleFacts(), "identity", null)).toBeNull();
  });
});

describe("rules extractor, identity:kind", () => {
  const f = online();
  it("reads a description that shares a content word as same", () => {
    expect(kindClaimFromAnswer("Sonable levert achtergrondmuziek aan bedrijven.", f)).toBe("same");
  });
  it("reads a shop at an address as other", () => {
    const claims = extractClaimsRules("Sonable is een winkel aan de Weena 705 in Rotterdam en is op zondag open.", f, kindPrompt);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ factKey: "identity", subject: "kind", value: "other", otherEntity: false });
  });
  it("does not call a kind other when the offer contains it", () => {
    const shop = online({}, { offer: "webshop voor koffiebonen", category: "webwinkel" });
    expect(kindClaimFromAnswer("Sonable is een webshop met koffie.", shop)).toBe("same");
    expect(kindClaimFromAnswer("Sonable is een winkel.", online({}, { offer: "winkelinrichting op maat", category: null }))).toBe("same");
  });
  it("gives no claim when the answer says nothing about the kind, and not found when it knows nothing", () => {
    expect(kindClaimFromAnswer("Sonable is een bedrijf in Nederland.", f)).toBeNull();
    const nf = extractClaimsRules("Ik heb geen specifieke informatie kunnen vinden over Sonable.", f, kindPrompt);
    expect(nf.map((c) => c.value)).toEqual(["__not_found__"]);
  });
  it("has nothing to read without a profile", () => {
    expect(kindClaimFromAnswer("Sonable is een winkel.", sampleFacts({ name: "Sonable" }))).toBeNull();
  });
});

describe("naming an online business", () => {
  it("is named in a list answer without the town; a door business still needs it", () => {
    const answer = "1. Sonable\n2. Mood Media";
    expect(mentionsBusiness(answer, online())).toBe(true);
    expect(mentionsBusiness(answer, { name: "Sonable", place: "Rotterdam" })).toBe(false);
    expect(mentionsBusiness(answer, { name: "Sonable", place: "Rotterdam", profile: profile({ mode: "door" }) })).toBe(false);
    expect(mentionsBusiness(`${answer}\nin Rotterdam`, { name: "Sonable", place: "Rotterdam" })).toBe(true);
  });
  it("does not read 'gevestigd in Amsterdam' as another business when online, and still does for a door business", () => {
    const answer = "Sonable is gevestigd in Amsterdam.";
    expect(detectOtherEntity(answer, online())).toBe(false);
    expect(detectOtherEntity(answer, sampleFacts({ name: "Sonable", place: "Rotterdam" }))).toBe(true);
    expect(detectOtherEntity(answer, online({}, { mode: "door" }))).toBe(true);
  });
  it("keeps the heading rule for an online business", () => {
    const heading = "## [Sonova Retail Support Centre B.V.](https://maps) Sonova zit aan de Bahialaan.";
    expect(detectOtherEntity(heading, online())).toBe(true);
  });
});

describe("quotes and families", () => {
  const f = online();
  const rec = (id: string, templateKey: string | null, intent: "quality" | "alternative" | null = "quality") =>
    ({ id, textNl: "Welke aanbieder van achtergrondmuziek is goed?", kind: "recommendation", intent, pool: "core", probes: ["existence:beste"], templateKey }) as never;
  const s = (id: string, promptId: string, engine: "chatgpt" | "claude", answerText: string) => ({ id, promptId, engine, answerText, citations: [] });

  const samples = [
    s("a1", "p1", "chatgpt", "1. **Mood Media** – groot.\n2. **Sonable** – achtergrondmuziek voor winkels en kantoren, zonder abonnement op een licentie.\nSonable is ook duidelijk over prijzen. Sonable is goedkoper dan Mood Media. Beter dan Mood Media is het niet."),
    s("a2", "p1", "claude", "Sonable levert muziek voor bedrijven. Spotify Business is een alternatief, net als Sonable."),
    s("a3", "p1", "chatgpt", "Je kunt kiezen uit Soundtrack Your Brand en Mood Media."),
    s("a4", "p1", "claude", "Sonable. ".repeat(3) + "Sonable werkt ook in cafes."),
  ];
  const verdicts = new Map([["a1", "named"], ["a2", "named"], ["a3", "not_named"], ["a4", "named"]]);
  const out = summarizeRecommendations({ samples, prompts: [rec("p1", "online.rec.audience")], verdicts, facts: f })[0]!;

  it("sets the family from the template key", () => {
    expect(out.family).toBe("rec_category");
    const alt = summarizeRecommendations({ samples: [s("x", "p2", "chatgpt", "Sonable.")], prompts: [rec("p2", "online.alt.one", null)], verdicts: new Map(), facts: f })[0]!;
    expect(alt.family).toBe("alternative");
    const town = summarizeRecommendations({ samples: [s("x", "p3", "chatgpt", "Sonable in Haarlem is een goede keuze.")], prompts: [rec("p3", null)], verdicts: new Map(), facts: sampleFacts({ name: "Sonable" }) })[0]!;
    expect(town.family).toBe("rec_town");
    expect(town.quotes).toEqual([]);
    expect(town.named).toBe(0); // verdicts were empty; the sentence did name the business, so quotes would have had it
  });

  it("quotes at most 3 sentences, never one that names another business, first per engine first", () => {
    expect(out.quotes.length).toBeLessThanOrEqual(3);
    expect(out.quotes.length).toBeGreaterThan(0);
    const names = ["Mood Media", "Spotify Business", "Soundtrack Your Brand"];
    for (const q of out.quotes) {
      expect(q.text.length).toBeLessThanOrEqual(240);
      expect(names.some((n) => q.text.includes(n))).toBe(false);
      expect(q.text).toMatch(/Sonable/);
    }
    expect(out.quotes.slice(0, 2).map((q) => q.engine).sort()).toEqual(["chatgpt", "claude"]);
    expect(out.quotes[0]!.text).toMatch(/achtergrondmuziek voor winkels/);
  });

  it("drops a sentence that names another business, even when it also names this one", () => {
    const both = quotesFor([{ answerText: "Sonable is goedkoper dan Mood Media. Sonable werkt zonder licentie.", engine: "chatgpt" }], ["Mood Media"], f);
    expect(both.map((q) => q.text)).toEqual(["Sonable werkt zonder licentie."]);
  });

  it("clips a long sentence at a word boundary", () => {
    const long = `Sonable ${"levert muziek ".repeat(40)}aan bedrijven.`;
    const q = quotesFor([{ answerText: long, engine: "chatgpt" }], [], f);
    expect(q[0]!.text.length).toBeLessThanOrEqual(240);
    expect(q[0]!.text.endsWith("…")).toBe(true);
    expect(q[0]!.text).not.toMatch(/\bleve…$/);
  });

  it("adds up: named + answers without the business = answers", () => {
    const notNamed = samples.filter((x) => !mentionsBusiness(x.answerText, f)).length;
    expect(out.named + notNamed).toBe(out.answers);
    expect(out.named).toBe(3);
  });

  it("scans only a bounded prefix of an answer for quotes", () => {
    const hostile = `${"x ".repeat(5000)}Sonable levert muziek aan bedrijven.`;
    expect(quotesFor([{ answerText: hostile, engine: "chatgpt" }], [], f)).toEqual([]);
  });
});

describe("AC-6 through runScan", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VIDALO_MOCK", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function scan(facts: Facts, answers: (probe: string, text: string) => string) {
    const db = withMockDb();
    const business = await db.upsertBusiness({ name: "Sonable", place: "Rotterdam" });
    await db.insertFacts(business.id, { ...facts, businessId: business.id }, { provisional: false, verifiedAt: "2026-11-11T08:00:00.000Z" });
    // The profile reaches the scan through the business (facts never store it): the owner's profile is used as is, with no model call.
    if (facts.profile) await db.setOwnerProfile(business.id, { ...facts.profile, source: "owner" });
    const prompts = await db.insertPrompts(business.id, [
      { category: "existence", probes: ["existence"], textNl: "Bestaat Sonable nog?" },
      { category: "identity", probes: ["identity:kind"], textNl: "Wat doet Sonable?", criterium: 11 },
      { category: "website", probes: ["website"], textNl: "Wat is de website van Sonable?" },
      { category: "existence", probes: ["existence:beste"], textNl: "Welke aanbieder van achtergrondmuziek is het beste?", kind: "recommendation", intent: "quality" },
    ]);
    const client: EngineClient = {
      engine: "chatgpt",
      available: () => true,
      ask: async (text, ctx) => ({ answerText: answers(ctx.prompt?.probes[0] ?? "", text), citations: [], costCents: 0 }),
    };
    const report = await runScan({ businessId: business.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client], db, promptIds: prompts.map((p) => p.id) });
    return report;
  }

  it("orange or worse when the answer describes Sonable as a shop at Weena 705", async () => {
    const report = await scan(online(), (probe) =>
      probe === "identity:kind"
        ? "Sonable is een winkel aan de Weena 705 in Rotterdam en is op zondag open."
        : probe === "website"
          ? "De website van Sonable is sonable.io."
          : probe === "existence"
            ? "Ja, Sonable is open."
            : "1. Mood Media\n2. Soundtrack Your Brand",
    );
    const f = report.findings.find((x) => x.factKey === "identity" && x.subject === "kind");
    expect(f).toBeDefined();
    expect(f!.criterium).toBe(11);
    expect(["oranje", "rood"]).toContain(report.stip);
  });

  it("green when every answer is right, even with Sonable in no category answer", async () => {
    const report = await scan(online(), (probe) =>
      probe === "identity:kind"
        ? "Sonable levert achtergrondmuziek aan bedrijven."
        : probe === "website"
          ? "De website van Sonable is sonable.io."
          : probe === "existence"
            ? "Ja, Sonable is open."
            : "1. Mood Media\n2. Soundtrack Your Brand",
    );
    expect(report.findings).toEqual([]);
    expect(report.stip).toBe("groen");
    expect(report.recommendations![0]).toMatchObject({ named: 0, answers: 2 });
  });

  it("leaves 'wat doet X' unchecked when the profile is not grounded", async () => {
    const facts = online({}, { grounded: false });
    expect(factValue(facts, "identity", "kind")).toBeNull();
    const report = await scan(facts, (probe) => (probe === "identity:kind" ? "Sonable is een winkel aan de Weena 705." : "Ja, Sonable is open."));
    expect(report.findings.some((x) => x.factKey === "identity" && x.subject === "kind")).toBe(false);
  });
});

describe("an ungrounded profile leaves 'wat doet X' unchecked", () => {
  it("marks the cell unchecked and never correct", () => {
    const samples: ComparableSample[] = [
      { sampleId: "k1", engine: "chatgpt", prompt: kindPrompt, citations: [], claims: [{ sampleId: "k1", factKey: "identity", subject: "kind", value: "same", confidence: 0.9, otherEntity: false, rawQuote: "" }] },
    ];
    const grounded = compare(samples, online());
    expect(grounded.asked.find((a) => a.factKey === "identity")).toMatchObject({ checked: true });
    expect(grounded.correct).toHaveLength(1);
    const ungrounded = compare(samples, online({}, { grounded: false }));
    expect(ungrounded.asked.find((a) => a.factKey === "identity")).toMatchObject({ checked: false });
    expect(ungrounded.correct).toEqual([]);
    expect(ungrounded.findings).toEqual([]);
  });
});
