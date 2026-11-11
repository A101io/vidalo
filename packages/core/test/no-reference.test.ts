/**
 * A business Vidalo knows nothing about beyond its name and town (no Google
 * listing, no owner facts). The free check of Sonable, Rotterdam on 11 Nov 2026
 * (scan cb4aac86) came out green with "1 van 1 vraag goed" while ChatGPT gave
 * another company's address and phone number. The answers below are quoted
 * from that scan.
 */
import { describe, expect, it } from "vitest";
import type { Claim, Engine, Facts } from "../src/types";
import { compare, type ComparableSample } from "../src/scanner/compare";
import { detectOtherEntity, extractClaimsRules, looksNotFound, looksSoftNotFound, nameCore, namesOnlyAnotherBusiness } from "../src/scanner/extract";
import { displayAddress, factValue } from "../src/scanner/normalize";
import { computeEngineStips } from "../src/scanner/stip";
import { engineStip } from "../src/criteria";
import { sampleFacts } from "./scanner-fixtures";
import { isUncheckedGrey, uncheckedAnswersOf } from "../src/types";
import { normalizePhone } from "../src/scanner/normalize";
import { baselineSummaryEmail, statusLine } from "../src/reporter/templates";

const bare: Facts = sampleFacts({
  name: "Sonable",
  place: "Rotterdam",
  address: null,
  postcode: null,
  phone: null,
  hours: [],
  website: null,
  servicesYes: [],
  servicesNo: [],
  prices: [],
  policies: [],
  paymentMethods: [],
});

function sample(id: string, engine: Engine, probe: string, claims: Partial<Claim>[]): ComparableSample {
  const [factKey, subject] = probe.includes(".") ? probe.split(".") : probe.includes(":") ? probe.split(":") : [probe, null];
  return {
    sampleId: id,
    engine,
    prompt: { category: factKey as Claim["factKey"], probes: [probe], textNl: `vraag ${probe}` },
    claims: claims.map((c) => ({ sampleId: id, factKey: factKey as Claim["factKey"], subject: (subject ?? null) as string | null, value: "", confidence: 0.9, otherEntity: false, rawQuote: "", ...c })),
    citations: [],
  };
}

describe("a town alone is no address", () => {
  it("has no address fact without a street", () => {
    expect(factValue(bare, "address", null)).toBeNull();
  });

  it("keeps the address fact when the street is known", () => {
    expect(factValue(sampleFacts(), "address", null)).not.toBeNull();
  });

  it("does not call two different Rotterdam addresses right", () => {
    const result = compare(
      [
        sample("c1", "chatgpt", "address", [{ value: "bahialaan 500 3065wc rotterdam" }]),
        sample("g1", "google_ai", "address", [{ value: "factorij 80 3071av rotterdam" }]),
      ],
      bare,
    );
    expect(result.correct).toEqual([]);
    expect(result.verdicts.get("c1")).toBe("unknown");
    expect(result.verdicts.get("g1")).toBe("unknown");
    expect(result.asked.find((a) => a.factKey === "address" && a.engine === "chatgpt")).toMatchObject({ samples: 1, checked: false });
  });
});

describe("addresses read the way people write them", () => {
  it("restores capitals, the comma and the postcode space", () => {
    expect(displayAddress("factorij 80 3071av rotterdam")).toBe("Factorij 80, 3071 AV Rotterdam");
    expect(displayAddress("bahialaan 500 3065wc rotterdam")).toBe("Bahialaan 500, 3065 WC Rotterdam");
    expect(displayAddress("van der helststraat 12a 1072ab amsterdam")).toBe("Van der Helststraat 12a, 1072 AB Amsterdam");
    expect(displayAddress("laan van meerdervoort 5 2517aa den haag")).toBe("Laan van Meerdervoort 5, 2517 AA Den Haag");
    // Not a Dutch street and postcode: left alone, never mangled.
    expect(displayAddress("10 downing street london sw1a 2aa")).toBe("10 downing street london sw1a 2aa");
  });
});

describe("without a fact, not found and another business still count", () => {
  it("makes an answer about another business a namesake finding", () => {
    const result = compare(
      [
        sample("p1", "chatgpt", "phone", [{ value: "+319001511", otherEntity: true }]),
        sample("p2", "chatgpt", "phone", [{ value: "+319001511", otherEntity: true }]),
        sample("p3", "chatgpt", "phone", [{ value: "__not_found__" }]),
      ],
      bare,
    );
    const namesake = result.findings.find((f) => f.sourceType === "other_entity");
    expect(namesake).toMatchObject({ engine: "chatgpt", factKey: "phone", wrongValue: "+319001511", correctValue: "", criterium: 11 });
    expect(result.verdicts.get("p1")).toBe("other_entity");
    expect(result.verdicts.get("p3")).toBe("not_found");
  });

  it("does not resolve older findings on a question it cannot check", () => {
    const result = compare([sample("a1", "chatgpt", "address", [{ value: "factorij 80 3071av rotterdam" }])], bare);
    expect([...result.checkedKeys]).toEqual([]);
  });
});

describe("the phrasings in which an engine knows nothing", () => {
  it.each([
    "Het spijt me, maar ik heb geen specifieke informatie kunnen vinden over een bedrijf genaamd 'Sonable' in Rotterdam.",
    "Op dit moment heb ik geen specifieke informatie over de betaalmethoden bij Sonable in Rotterdam.",
    "Het adres van Sonable in Rotterdam is niet direct beschikbaar in de zoekresultaten.",
  ])("reads %s as not found", (answer) => {
    expect(looksNotFound(answer) || looksSoftNotFound(answer)).toBe(true);
  });

  it("does not read a plain answer as not found", () => {
    expect(looksNotFound("Bakkerij De Vries is op zondag gesloten.")).toBe(false);
  });
});

describe("an answer that leads with another business", () => {
  const sonova = "## [Sonova Retail Support Centre B.V.](https://www.google.com/maps/search/Bahialaan+500) Sonova Retail Support Centre B.V. is gevestigd aan Bahialaan 500, 3065 WC Rotterdam.";
  const conceptable = "## [Conceptable B.V.](https://www.google.com/maps/search/Meent+29) Het telefoonnummer van Conceptable B.V., gevestigd op Meent 29 A in Rotterdam, is 0900-1511.";
  const own = "## [Sonable Rotterdam](https://www.google.com/maps/search/Sonable+Rotterdam) Sonable is een audiomerk gevestigd in Rotterdam.";

  it("flags an answer that never names the business", () => {
    expect(namesOnlyAnotherBusiness(sonova, "Sonable")).toBe(true);
    expect(namesOnlyAnotherBusiness(conceptable, "Sonable")).toBe(true);
    expect(detectOtherEntity(sonova, bare)).toBe(true);
  });

  it("does not flag an answer about the business itself", () => {
    expect(namesOnlyAnotherBusiness(own, "Sonable")).toBe(false);
    expect(namesOnlyAnotherBusiness("Bakkerij De Vries is op zondag gesloten.", "Bakkerij De Vries")).toBe(false);
  });
});

describe("nothing checked is never green", () => {
  it("makes an engine grey when no answer could be judged", () => {
    expect(engineStip({ findingSeverities: [], notFoundCriteria: [], notFoundShare: 0, wrongShare: 0, instableShare: 0, nothingChecked: true })).toBe("grijs");
  });

  it("keeps green when answers were judged right", () => {
    expect(engineStip({ findingSeverities: [], notFoundCriteria: [], notFoundShare: 0, wrongShare: 0, instableShare: 0, nothingChecked: false })).toBe("groen");
  });

  it("gives the Sonable answers a grey dot for Google AI, not green", () => {
    const samples = [
      sample("g1", "google_ai", "address", [{ value: "factorij 80 3071av rotterdam" }]),
      sample("g2", "google_ai", "hours.6", [{ value: "closed" }]),
      sample("g3", "google_ai", "payment:pin", [{ value: "no" }]),
    ];
    const result = compare(samples, bare);
    const stips = computeEngineStips({
      engines: ["google_ai"],
      samples: samples.map((s) => ({ id: s.sampleId, engine: s.engine })),
      verdicts: result.verdicts,
      findings: [],
      instable: [],
      criteriaNotFound: [],
      unavailable: new Set(),
    });
    expect(stips[0]?.stip).toBe("grijs");
  });
});

describe("round 1 review: correct answers stay correct", () => {
  const full = sampleFacts();
  it.each([
    "## [De Vries](https://maps) De bakker zit aan de Grote Houtstraat 12, 2011 SN Haarlem.",
    "Je belt ze op 023-5312345. Betalen gaat via Worldline B.V.",
    "Het adres is Grote Houtstraat 12 Haarlem. De Vries Bakkerij B.V. staat ingeschreven bij de KvK.",
    "## [Bakkerij De Vries](https://maps) Bakkerij De Vries zit aan de Grote Houtstraat 12.",
  ])("does not call %s another business", (answer) => {
    expect(namesOnlyAnotherBusiness(answer, full.name)).toBe(false);
  });

  it("matches a Google name with a suffix on its core words", () => {
    expect(nameCore("Bakkerij De Vries | Ambachtelijk brood")).toEqual(["vries"]);
    expect(namesOnlyAnotherBusiness("## [De Vries Haarlem](https://maps) Open tot 18:00.", "Bakkerij De Vries | Ambachtelijk brood")).toBe(false);
    expect(namesOnlyAnotherBusiness("## [Café Zuid](https://maps) Open tot 18:00.", "Cafe Zuid")).toBe(false);
  });

  it("keeps the fact in an answer that only hedges about something else", () => {
    const prompt = { category: "address" as const, probes: ["address"], textNl: "Wat is het adres?" };
    for (const answer of [
      "Ik heb het telefoonnummer niet kunnen vinden, maar het adres is Grote Houtstraat 12, 2011 SN Haarlem.",
      "Het adres is Grote Houtstraat 12, 2011 SN Haarlem; het telefoonnummer is niet direct beschikbaar in de zoekresultaten.",
      "Open van 10:00 tot 16:00. Over feestdagen heb ik geen actuele informatie.",
    ]) {
      expect(looksSoftNotFound(answer)).toBe(false);
      expect(extractClaimsRules(answer, full, prompt).some((c) => c.value === "__not_found__")).toBe(false);
    }
  });

  it("still reads the long Sonable sentence as not found", () => {
    expect(looksSoftNotFound("Ik heb het telefoonnummer van Sonable in Rotterdam niet kunnen vinden.")).toBe(true);
  });
});

describe("round 1 review: grey never hides a red", () => {
  it("keeps red when the engine says the business does not exist (criterium 1) and nothing else was judged", () => {
    const facts = sampleFacts();
    const samples = [
      sample("e1", "google_ai", "existence", [{ value: "__not_found__" }]),
      sample("h1", "google_ai", "hours.6", []),
      sample("p1", "google_ai", "phone", []),
    ];
    const result = compare(samples, facts);
    const stips = computeEngineStips({
      engines: ["google_ai"],
      samples: samples.map((s) => ({ id: s.sampleId, engine: s.engine })),
      verdicts: result.verdicts,
      findings: [],
      instable: [],
      criteriaNotFound: [{ criterium: 1, engine: "google_ai", frequency: 1, sampleCount: 1 }],
      unavailable: new Set(),
    });
    expect(stips[0]?.stip).toBe("rood");
  });
});

describe("round 1 review: patterns stay fast on long AI answers", () => {
  it("handles 200 KB of hostile text in well under a second", () => {
    const words = "Aa ".repeat(70_000) + "B.V.";
    const lines = "\n".repeat(200_000);
    const digits = "1".repeat(50_000);
    const start = performance.now();
    namesOnlyAnotherBusiness(words, "Sonable");
    namesOnlyAnotherBusiness(lines, "Sonable");
    looksNotFound(words + lines);
    looksSoftNotFound(words + lines);
    displayAddress(digits);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("round 1 review: mails never say all right when answers went unchecked", () => {
  const base = {
    business: { name: "Sonable", place: "Rotterdam" },
    checkedAt: "2026-11-11T07:40:23Z",
    totalAnswers: 19,
    wrongAnswers: 0,
    notFoundAnswers: 0,
    visibility: "found" as const,
    findings: [],
    engines: ["chatgpt", "google_ai"] as ("chatgpt" | "google_ai")[],
    links: { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten", resultUrl: "https://vidalo.ai/r/x" },
    stip: "grijs" as const,
  };
  it("words the free-check mail as not checkable, in NL and EN", () => {
    const nl = baselineSummaryEmail({ ...base, uncheckedAnswers: 7, uncheckedQuestions: 4, uncheckedGrey: true });
    expect(nl.subject).toBe("Eerste controle van Sonable: niet alles was te controleren");
    expect(nl.html).not.toMatch(/antwoorden kloppen/);
    expect(nl.html).toMatch(/We konden niet alle antwoorden controleren/);
    expect(nl.text).toMatch(/12/); // 19 asked, 7 unchecked: 12 checked
    const en = baselineSummaryEmail({ ...base, lang: "en", uncheckedAnswers: 7, uncheckedQuestions: 4, uncheckedGrey: true });
    expect(en.subject).toBe("First check of Sonable: not everything could be checked");
  });
  it("keeps the clean mail when everything was checked", () => {
    expect(baselineSummaryEmail({ ...base, stip: "groen" }).subject).toBe("Eerste controle van Sonable: alle 19 antwoorden kloppen");
  });
  it("says only the checked answers are right in the monthly status line", () => {
    expect(statusLine({ totalAnswers: 30, wrongAnswers: 0, resolved: 0, inProgress: 0, uncheckedAnswers: 6 })).toBe("24 gecontroleerde antwoorden kloppen");
    expect(statusLine({ totalAnswers: 30, wrongAnswers: 0, resolved: 0, inProgress: 0 })).toBe("30 van 30 antwoorden kloppen");
  });
});

describe("round 2 review", () => {
  const full = sampleFacts();
  const pin = { category: "payment" as const, probes: ["payment:pin"], textNl: "Kan ik bij Bakkerij De Vries pinnen?" };
  const sunday = { category: "hours" as const, probes: ["hours.6"], textNl: "Is Bakkerij De Vries op zondag open?" };

  it("keeps a wrong yes/no answer that ends with a hedge (N1)", () => {
    const claims = extractClaimsRules("Nee, bij Bakkerij De Vries kun je niet pinnen, alleen contant. Over creditcards heb ik geen specifieke informatie.", full, pin);
    expect(claims.some((c) => c.value === "__not_found__")).toBe(false);
    expect(claims.find((c) => c.factKey === "payment")?.value).toBe("no");
  });

  it("still reads a hedge without any answer as not found (N1)", () => {
    const claims = extractClaimsRules("Ik heb geen specifieke informatie over de betaalmethoden van Bakkerij De Vries.", full, pin);
    expect(claims.map((c) => c.value)).toEqual(["__not_found__"]);
  });

  it("keeps a Sunday answer that hedges about holidays (N1)", () => {
    const claims = extractClaimsRules("Ja, Bakkerij De Vries is op zondag open van 10:00 tot 16:00. Over feestdagen heb ik geen actuele informatie.", full, sunday);
    expect(claims.some((c) => c.value === "__not_found__")).toBe(false);
  });

  it.each([
    ["## [Haar Zaken Kappers](https://maps) Haar Zaken Kappers is open tot 18:00.", "Kapsalon Haarzaken"],
    ["## [Hair Lab](https://maps) Open tot 18:00.", "HairLab"],
    ["## [Café](https://maps) Open tot 18:00.", "Cafe"],
  ])("reads %s as the business itself (N3)", (answer, name) => {
    expect(namesOnlyAnotherBusiness(answer, name)).toBe(false);
  });

  it("reads Dutch service numbers (N7)", () => {
    expect(normalizePhone("0900-1511")).toBe("+319001511");
    const claims = extractClaimsRules("## [Conceptable B.V.](https://maps) Het telefoonnummer van Conceptable B.V. is 0900-1511.", bare, { category: "phone", probes: ["phone"], textNl: "Wat is het telefoonnummer van Sonable?" });
    expect(claims[0]).toMatchObject({ factKey: "phone", value: "+319001511", otherEntity: true });
  });

  it("counts answers without a usable claim as unchecked, not as right (N4)", () => {
    const report = {
      stip: "grijs" as const,
      visibility: "found" as const,
      engines: [{ engine: "chatgpt" as const, correct: 0, wrong: 0, notFound: 0, unchecked: 20, skipped: false }],
    };
    expect(uncheckedAnswersOf(report)).toBe(20);
    expect(isUncheckedGrey(report)).toBe(true);
    const mail = baselineSummaryEmail({
      business: { name: "Sonable", place: "Rotterdam" },
      checkedAt: "2026-11-11T07:40:23Z",
      totalAnswers: 20,
      wrongAnswers: 0,
      notFoundAnswers: 0,
      visibility: "found",
      findings: [],
      engines: ["chatgpt"],
      links: { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten", resultUrl: "https://vidalo.ai/r/x" },
      stip: "grijs",
      uncheckedAnswers: 20,
      uncheckedQuestions: 1,
      uncheckedGrey: true,
    });
    expect(mail.subject).not.toMatch(/kloppen/);
    expect(mail.html).not.toMatch(/AI kent je niet/);
  });

  it("does not call a grey dot unchecked when answers were checked (compliance NEW-1)", () => {
    const report = {
      stip: "grijs" as const,
      visibility: "partial" as const,
      engines: [
        { engine: "chatgpt" as const, correct: 10, wrong: 0, notFound: 0, unchecked: 0, skipped: false },
        { engine: "google_ai" as const, correct: 3, wrong: 0, notFound: 7, unchecked: 0, skipped: false },
      ],
    };
    expect(isUncheckedGrey(report)).toBe(false);
  });
});
