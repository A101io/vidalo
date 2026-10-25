import { describe, expect, it } from "vitest";
import {
  CRITERIA,
  CRITERIUM_IDS,
  ENGINE_NL_USAGE,
  STIP_ENGINE_MIN_USAGE,
  criterium,
  criteriumFor,
  criteriumNotFound,
  engineCounts,
  engineStip,
  judge,
  overallStip,
  severityOf,
} from "../src/criteria";
import { compare, type ComparableSample } from "../src/scanner/compare";
import { extractClaimsRules, mentionsBusiness, notFoundClaim } from "../src/scanner/extract";
import { computeStip, groupBySeverity } from "../src/scanner/stip";
import { factValue } from "../src/scanner/normalize";
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_VALUE, PRESENT_VALUE, type Claim, type Engine, type Finding, type Prompt } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const prompt = (category: Prompt["category"], probes: string[], extra: Partial<Prompt> = {}): Pick<Prompt, "category" | "probes" | "textNl" | "kind" | "criterium"> => ({
  category,
  probes,
  textNl: `vraag over ${probes.join(",")}`,
  kind: "about",
  ...extra,
});

const claim = (factKey: Claim["factKey"], subject: string | null, value: string, sampleId: string): Claim => ({ sampleId, factKey, subject, value, confidence: 0.8, otherEntity: false, rawQuote: value });

describe("criteria model", () => {
  it("has the twelve criteria with the thresholds from docs/CRITERIA.md", () => {
    expect(CRITERIUM_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(CRITERIA.filter((c) => c.threshold.kind === "any").map((c) => c.id)).toEqual([1, 2, 8, 11]);
    for (const c of CRITERIA) {
      if (c.threshold.kind === "ratio") expect(c.threshold.min).toBe(0.3);
      expect(c.instableBelow).toBe(0.1);
      expect(c.key).toMatch(/^[a-z-]+$/);
      expect(c.labelNl.length).toBeGreaterThan(0);
    }
    expect(CRITERIA.slice(0, 5).every((c) => c.severity === "afhaker")).toBe(true);
    expect(CRITERIA.slice(5, 10).every((c) => c.severity === "misleider")).toBe(true);
    expect(CRITERIA.slice(10).every((c) => c.severity === "verwarring")).toBe(true);
  });

  it("maps fact keys to criteria, splitting services into wel (6) and niet (7)", () => {
    const facts = sampleFacts();
    expect(criteriumFor("existence", null, facts)).toBe(1);
    expect(criteriumFor("phone", null, facts)).toBe(2);
    expect(criteriumFor("hours", "6", facts)).toBe(3);
    expect(criteriumFor("area", "Heemstede", facts)).toBe(4);
    expect(criteriumFor("urgency", null, facts)).toBe(5);
    expect(criteriumFor("service", "taarten op bestelling", facts)).toBe(6);
    expect(criteriumFor("service", "bezorgen", facts)).toBe(7);
    expect(criteriumFor("address", null, facts)).toBe(8);
    expect(criteriumFor("price", "een brood", facts)).toBe(9);
    expect(criteriumFor("payment", "pin", facts)).toBe(10);
    expect(criteriumFor("identity", null, facts)).toBe(11);
    expect(criteriumFor("credential", "x", facts)).toBe(12);
    expect(criteriumFor("hours", "6", facts, { otherEntity: true })).toBe(11);
  });

  it("judges 'any' criteria on one sample, 'ratio' criteria at 30%, below that instable", () => {
    expect(judge(2, 1, 10)).toBe("finding"); // phone: one wrong sample
    expect(judge(1, 1, 10)).toBe("finding");
    expect(judge(3, 3, 10)).toBe("finding"); // hours: 30%
    expect(judge(3, 2, 10)).toBe("instable"); // 20%
    expect(judge(3, 1, 10)).toBe("instable"); // 10%
    expect(judge(3, 0, 10)).toBe("ok");
    expect(judge(6, 1, 3)).toBe("finding"); // 33%
    expect(criterium(4).severity).toBe("afhaker");
    expect(severityOf(12)).toBe("verwarring");
  });

  it("not found per criterium at >= 50% of the samples", () => {
    expect(criteriumNotFound(5, 10)).toBe(true);
    expect(criteriumNotFound(4, 10)).toBe(false);
    expect(criteriumNotFound(0, 0)).toBe(false);
  });
});

describe("compare with criteria", () => {
  it("one wrong phone is a finding, 2 of 10 wrong hours is instable, 3 of 10 a finding", () => {
    const facts = sampleFacts();
    const samples: ComparableSample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push({ sampleId: `p${i}`, engine: "chatgpt", prompt: prompt("phone", ["phone"]), claims: [claim("phone", null, i === 0 ? "+31231111111" : "+31235312345", `p${i}`)], citations: [] });
      samples.push({ sampleId: `h${i}`, engine: "chatgpt", prompt: prompt("hours", ["hours.6"]), claims: [claim("hours", "6", i < 2 ? "10:00-14:00" : "closed", `h${i}`)], citations: [] });
      samples.push({ sampleId: `s${i}`, engine: "gemini", prompt: prompt("hours", ["hours.5"]), claims: [claim("hours", "5", i < 3 ? "closed" : "08:00-17:00", `s${i}`)], citations: [] });
    }
    const r = compare(samples, facts);
    const phone = r.findings.find((f) => f.factKey === "phone");
    expect(phone).toMatchObject({ frequency: 1, sampleCount: 10, criterium: 2, evidenceKind: "about" });
    expect(r.findings.find((f) => f.factKey === "hours" && f.subject === "6")).toBeUndefined();
    expect(r.instable).toHaveLength(1);
    expect(r.instable[0]).toMatchObject({ factKey: "hours", subject: "6", frequency: 2, instable: true, criterium: 3 });
    expect(r.findings.find((f) => f.factKey === "hours" && f.subject === "5")).toMatchObject({ frequency: 3, engine: "gemini", criterium: 3 });
  });

  it("marks a criterium not found per engine when >= 50% of its samples say so, independent of the fact groups", () => {
    const facts = sampleFacts();
    const samples: ComparableSample[] = [];
    const p = prompt("existence", ["existence"]);
    for (let i = 0; i < 4; i++) {
      const id = `e${i}`;
      const nf = i < 2;
      samples.push({ sampleId: id, engine: "chatgpt", prompt: p, claims: nf ? [notFoundClaim(p, id)] : [claim("existence", null, "open", id)], citations: [] });
    }
    // Phone: only 1 of 4 not found -> the criterium is found.
    for (let i = 0; i < 4; i++) {
      const id = `t${i}`;
      const q = prompt("phone", ["phone"]);
      samples.push({ sampleId: id, engine: "chatgpt", prompt: q, claims: i === 0 ? [notFoundClaim(q, id)] : [claim("phone", null, "+31235312345", id)], citations: [] });
    }
    const r = compare(samples, facts);
    expect(r.criteriaNotFound).toEqual([{ criterium: 1, engine: "chatgpt", frequency: 2, sampleCount: 4 }]);
    expect(r.findings.filter((f) => f.verdict === "not_found").map((f) => f.factKey)).toEqual(["existence"]);
  });
});

describe("recommendation questions", () => {
  const facts = sampleFacts({ serviceArea: { places: ["Heemstede"], radiusKm: null }, urgency: { available: true, hoursNl: null }, credentials: ["SKB"] });

  it("detects whether the business is named, fuzzily", () => {
    expect(mentionsBusiness("In Haarlem kun je terecht bij Bakkerij De Vries, Bakkerij Jansen en Vlaanderen.", facts)).toBe(true);
    expect(mentionsBusiness("bakkerij de vries (haarlem) en nog twee andere", facts)).toBe(true);
    expect(mentionsBusiness("De Vries Bakkerij B.V. in Haarlem is open op zondag.", facts)).toBe(true);
    expect(mentionsBusiness("Probeer Bakkerij Jansen of Vlaanderen in Haarlem.", facts)).toBe(false);
    expect(mentionsBusiness("Ik kan geen bakkers vinden die op zondag open zijn.", facts)).toBe(false);
    // A one-word name needs the place as well, so a namesake elsewhere does not count.
    const jansen = sampleFacts({ name: "Jansen", place: "Zwolle" });
    expect(mentionsBusiness("Jansen in Amsterdam is een optie.", jansen)).toBe(false);
    expect(mentionsBusiness("Jansen in Zwolle is een optie.", jansen)).toBe(true);
  });

  it("extraction yields one present/absent claim keyed to the probe, without a model", () => {
    const rec = prompt("service", ["service:glutenvrij brood"], { kind: "recommendation", criterium: 6 });
    const present = extractClaimsRules("1. Bakkerij De Vries Haarlem\n2. Bakkerij Jansen", facts, rec, "s1");
    expect(present).toEqual([expect.objectContaining({ factKey: "service", subject: "glutenvrij brood", value: PRESENT_VALUE, sampleId: "s1" })]);
    const absent = extractClaimsRules("1. Bakkerij Jansen\n2. Vlaanderen", facts, rec, "s2");
    expect(absent[0]!.value).toBe(ABSENT_VALUE);
    // "geen informatie" wording in a list answer is not a not-found verdict for a recommendation.
    const noInfo = extractClaimsRules("Ik heb geen informatie over zondagsopening, maar probeer Bakkerij Jansen.", facts, rec, "s3");
    expect(noInfo[0]!.value).toBe(ABSENT_VALUE);
    expect(noInfo[0]!.value).not.toBe(NOT_FOUND_VALUE);
  });

  it("named or not is its own verdict: never a finding, never wrong or correct, never a checked fact; never a rank", () => {
    const rec = prompt("service", ["service:glutenvrij brood"], { kind: "recommendation", criterium: 6, textNl: "Welke bakker in Haarlem verkoopt glutenvrij brood?" });
    const samples: ComparableSample[] = [
      { sampleId: "r1", engine: "chatgpt", prompt: rec, claims: [claim("service", "glutenvrij brood", ABSENT_VALUE, "r1")], citations: ["https://openingstijden.nl/x"] },
      { sampleId: "r2", engine: "chatgpt", prompt: rec, claims: [claim("service", "glutenvrij brood", ABSENT_VALUE, "r2")], citations: [] },
      { sampleId: "r3", engine: "chatgpt", prompt: rec, claims: [claim("service", "glutenvrij brood", PRESENT_VALUE, "r3")], citations: [] },
      { sampleId: "g1", engine: "gemini", prompt: rec, claims: [claim("service", "glutenvrij brood", PRESENT_VALUE, "g1")], citations: [] },
    ];
    const r = compare(samples, facts);
    // Julian, 25 Oct 2026: not being recommended is not a wrong fact.
    expect(r.findings).toHaveLength(0);
    expect(r.correct).toHaveLength(0);
    expect(r.verdicts.get("r1")).toBe("not_named");
    expect(r.verdicts.get("r3")).toBe("named");
    expect(r.verdicts.get("g1")).toBe("named");
    // An open finding from an older scan is neither confirmed nor resolved by a recommendation answer.
    expect(r.checkedKeys.has("service|glutenvrij brood|chatgpt|rec")).toBe(false);
  });

  it("a recommendation answer never makes a fact wrong: one sample, a fact question and a recommendation", () => {
    const about = prompt("phone", ["phone"], {});
    const rec = prompt("existence", ["existence:beste"], { kind: "recommendation", criterium: 6 });
    const r = compare(
      [
        { sampleId: "f1", engine: "chatgpt", prompt: about, claims: [claim("phone", null, factValue(facts, "phone", null)!, "f1")], citations: [] },
        { sampleId: "n1", engine: "chatgpt", prompt: rec, claims: [claim("existence", "beste", ABSENT_VALUE, "n1")], citations: [] },
      ],
      facts,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.verdicts.get("f1")).toBe("correct");
    expect(r.verdicts.get("n1")).toBe("not_named");
  });

  it("is skipped when the facts do not support the question (a service the business does not offer, closed on that day)", () => {
    const recNo = prompt("service", ["service:bezorgen"], { kind: "recommendation", criterium: 6 });
    const recSunday = prompt("hours", ["hours.6"], { kind: "recommendation", criterium: 3 });
    const r = compare(
      [
        { sampleId: "a", engine: "chatgpt", prompt: recNo, claims: [claim("service", "bezorgen", ABSENT_VALUE, "a")], citations: [] },
        { sampleId: "b", engine: "chatgpt", prompt: recSunday, claims: [claim("hours", "6", ABSENT_VALUE, "b")], citations: [] },
      ],
      facts,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.verdicts.get("a")).toBe("unknown");
  });

  it("area, urgency and credential recommendations are judged named or not, not as facts", () => {
    const mk = (category: Prompt["category"], probe: string, crit: Prompt["criterium"], id: string): ComparableSample => ({
      sampleId: id,
      engine: "google_ai",
      prompt: prompt(category, [probe], { kind: "recommendation", criterium: crit }),
      claims: [claim(category, probe.includes(":") ? probe.split(":")[1]! : null, ABSENT_VALUE, id)],
      citations: [],
    });
    const r = compare([mk("area", "area:Heemstede", 4, "x1"), mk("urgency", "urgency", 5, "x2"), mk("credential", "credential:SKB", 12, "x3")], facts);
    // The questions still apply (the facts support them) but not being named is reported, not counted.
    expect(r.findings).toHaveLength(0);
    expect(["x1", "x2", "x3"].map((id) => r.verdicts.get(id))).toEqual(["not_named", "not_named", "not_named"]);
  });
});

describe("stipregel", () => {
  const base = { findingSeverities: [], notFoundCriteria: [], notFoundShare: 0, wrongShare: 0, instableShare: 0 };

  it("colours one engine: afhaker or criterium 1 not found is red, misleider orange, nothing green, unknown grey", () => {
    expect(engineStip({ ...base })).toBe("groen");
    expect(engineStip({ ...base, findingSeverities: ["afhaker"] })).toBe("rood");
    expect(engineStip({ ...base, findingSeverities: ["misleider"] })).toBe("oranje");
    expect(engineStip({ ...base, findingSeverities: ["verwarring"] })).toBe("oranje");
    expect(engineStip({ ...base, notFoundCriteria: [1] })).toBe("rood");
    expect(engineStip({ ...base, notFoundCriteria: [9] })).toBe("groen");
    expect(engineStip({ ...base, wrongShare: 0.3 })).toBe("rood");
    expect(engineStip({ ...base, fixesInProgress: 1 })).toBe("oranje");
    expect(engineStip({ ...base, notFoundShare: 0.3 })).toBe("oranje");
    expect(engineStip({ ...base, notFoundShare: 0.6, findingSeverities: ["afhaker"] })).toBe("grijs");
    expect(engineStip({ ...base, instableShare: 0.05 })).toBe("groen");
    expect(engineStip({ ...base, instableShare: 0.2 })).toBe("oranje");
    expect(engineStip({ ...base, skipped: true })).toBe("grijs");
  });

  it("only engines with >= 10% NL usage decide: ChatGPT alone makes red, Perplexity alone does not", () => {
    expect(STIP_ENGINE_MIN_USAGE).toBe(0.1);
    expect(engineCounts("chatgpt")).toBe(true);
    expect(engineCounts("google_ai")).toBe(true);
    expect(engineCounts("copilot")).toBe(true);
    expect(engineCounts("gemini")).toBe(true);
    expect(engineCounts("perplexity")).toBe(false);
    expect(ENGINE_NL_USAGE.perplexity).toBeLessThan(STIP_ENGINE_MIN_USAGE);

    const all = (stips: Partial<Record<Engine, "rood" | "oranje" | "groen" | "grijs">>) =>
      (["chatgpt", "gemini", "perplexity", "google_ai", "copilot"] as Engine[]).map((engine) => ({ engine, stip: stips[engine] ?? "groen" }));
    expect(overallStip(all({ chatgpt: "rood" }))).toBe("rood");
    expect(overallStip(all({ perplexity: "rood" }))).toBe("groen");
    expect(overallStip(all({ perplexity: "rood", gemini: "oranje" }))).toBe("oranje");
    expect(overallStip(all({ copilot: "grijs" }))).toBe("grijs");
    expect(overallStip(all({}))).toBe("groen");
    expect(overallStip([])).toBe("grijs");
    // Only Perplexity scanned: it decides on its own.
    expect(overallStip([{ engine: "perplexity", stip: "rood" }])).toBe("rood");
  });

  it("computes per-engine colours from samples and findings, and groups findings by severity", () => {
    const f = (engine: Engine, factKey: Finding["factKey"], criterium: Finding["criterium"], extra: Partial<Finding> = {}): Finding => ({
      id: `${engine}-${factKey}`,
      businessId: "b",
      scanRunId: "r",
      factKey,
      subject: null,
      engine,
      verdict: "wrong",
      wrongValue: "x",
      correctValue: "y",
      frequency: 1,
      sampleCount: 3,
      sourceUrl: null,
      sourceType: "none",
      status: "open",
      firstSeenAt: "2026-10-01T00:00:00Z",
      resolvedAt: null,
      evidenceBefore: null,
      evidenceAfter: null,
      evidenceKind: "about",
      criterium,
      ...extra,
    });
    const findings = [f("chatgpt", "phone", 2), f("google_ai", "price", 9), f("perplexity", "existence", 1), f("gemini", "hours", 3, { sourceType: "other_entity", criterium: 11 })];
    const samples = (["chatgpt", "google_ai", "perplexity", "gemini", "copilot"] as Engine[]).flatMap((engine) => [0, 1, 2].map((i) => ({ id: `${engine}${i}`, engine })));
    const verdicts = new Map(samples.map((s) => [s.id, "correct" as const]));
    const { stip, engineStips } = computeStip({ engines: ["chatgpt", "google_ai", "perplexity", "gemini", "copilot"], samples, verdicts, findings, instable: [], criteriaNotFound: [], unavailable: new Set() });
    const by = Object.fromEntries(engineStips.map((e) => [e.engine, e.stip]));
    expect(by).toEqual({ chatgpt: "rood", google_ai: "oranje", perplexity: "rood", gemini: "oranje", copilot: "groen" });
    expect(stip).toBe("rood");
    const grouped = groupBySeverity(findings);
    expect(grouped.afhaker.map((x) => x.id).sort()).toEqual(["chatgpt-phone", "perplexity-existence"]);
    expect(grouped.misleider.map((x) => x.id)).toEqual(["google_ai-price"]);
    expect(grouped.verwarring.map((x) => x.id)).toEqual(["gemini-hours"]);

    // Without ChatGPT's afhaker, Perplexity's red alone does not colour the dot.
    const withoutChatgpt = computeStip({ engines: ["chatgpt", "google_ai", "perplexity", "gemini", "copilot"], samples, verdicts, findings: findings.filter((x) => x.engine !== "chatgpt"), instable: [], criteriaNotFound: [], unavailable: new Set() });
    expect(withoutChatgpt.stip).toBe("oranje");

    // Facts not confirmed by the owner (free check against Google): a mismatch is "check this", at most orange.
    const unconfirmed = computeStip({ engines: ["chatgpt", "google_ai", "perplexity", "gemini", "copilot"], samples, verdicts, findings, instable: [], criteriaNotFound: [], unavailable: new Set(), unconfirmed: true });
    expect(Object.fromEntries(unconfirmed.engineStips.map((e) => [e.engine, e.stip]))).toEqual({ chatgpt: "oranje", google_ai: "oranje", perplexity: "oranje", gemini: "oranje", copilot: "groen" });
    expect(unconfirmed.stip).toBe("oranje");
    // ... but not knowing the business at all is not a comparison with Google, and still counts in full.
    const unknown = computeStip({ engines: ["chatgpt"], samples: samples.filter((x) => x.engine === "chatgpt"), verdicts, findings: [], instable: [], criteriaNotFound: [{ criterium: 1, engine: "chatgpt", frequency: 3, sampleCount: 3 }], unavailable: new Set(), unconfirmed: true });
    expect(unknown.stip).toBe("rood");
  });
});
