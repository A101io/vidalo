import { describe, expect, it } from "vitest";
import { CRITERIUM_IDS } from "../src/criteria";
import { basePrompts, freeScanPrompts, generatePrompts, selectFreeScanPrompts } from "../src/prompts";
import { SECTORS, SECTOR_LIST, inferSector, sectorPrompts } from "../src/prompts/sectors";
import { renderFactsPage } from "../src/publisher/render";
import { copy } from "../src/copy";
import { FACT_KEYS, SECTOR_SLUGS, type Facts, type SectorSlug } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";
import { business } from "./worker-fixtures";

/** Full facts for a plumber: every sector-layer field filled, so every pack can build its longest set. */
function fullFacts(overrides: Partial<Facts> = {}): Facts {
  return sampleFacts({
    name: "Installatiebedrijf Hendriks",
    place: "Zwolle",
    servicesYes: ["warmtepompen", "cv-ketels"],
    servicesNo: ["zonnepanelen", "dakwerk"],
    prices: [{ label: "uurtarief", amount: 65 }],
    policies: ["Geen voorrijkosten", "Gratis offerte", "Zonder afspraak welkom", "Zonder verwijzing welkom", "Nieuwe patiënten welkom", "Reserveren mogelijk", "Vaste prijs mogelijk"],
    notConfusedWith: ["Hendriks Installaties in Breda"],
    serviceArea: { places: ["Kampen", "Hattem"], radiusKm: 25 },
    urgency: { available: true, hoursNl: "24 uur per dag, 7 dagen per week" },
    credentials: ["warmtepompen", "gas"],
    hours: [
      { day: 0, open: "08:00", close: "17:00", closed: false },
      { day: 1, open: "08:00", close: "17:00", closed: false },
      { day: 2, open: "08:00", close: "17:00", closed: false },
      { day: 3, open: "08:00", close: "17:00", closed: false },
      { day: 4, open: "08:00", close: "17:00", closed: false },
      { day: 5, open: "09:00", close: "13:00", closed: false },
      { day: 6, open: "10:00", close: "12:00", closed: false },
    ],
    ...overrides,
  });
}

const BANNED = /\b(GEO|AEO|LLM|LLMs|prompt|prompts|agent|platform|zichtbaarheid|credits)\b/i;

describe("sector packs", () => {
  it("has exactly the eleven sectors with the agreed slugs", () => {
    expect(SECTOR_SLUGS).toEqual([
      "loodgieters-installateurs",
      "aannemers-dakdekkers-schilders",
      "vve-beheer",
      "zorg-praktijken",
      "horeca",
      "winkels",
      "garages-fietsenmakers",
      "kappers-schoonheid",
      "advocaten-notarissen-accountants",
      "makelaars-hypotheek",
      "kinderopvang-sport-rijscholen",
    ]);
    expect(Object.keys(SECTORS).sort()).toEqual([...SECTOR_SLUGS].sort());
    for (const pack of SECTOR_LIST) {
      expect(pack.labelNl.length).toBeGreaterThan(3);
      expect(pack.googleCategories.length).toBeGreaterThan(0);
      expect(pack.sbiCodes.length).toBeGreaterThan(0);
      expect(pack.decisiveFacts).toHaveLength(3);
      expect(pack.typicalSource.length).toBeGreaterThan(0);
      expect(pack.biggestRisk.length).toBeGreaterThan(0);
      expect(copy.sectors[pack.slug]).toBeTruthy();
    }
  });

  it.each(SECTOR_SLUGS)("%s: core of up to 6 questions about the business + one recommendation per intent, and a bank of 20 or more", (slug) => {
    const facts = fullFacts();
    const prompts = sectorPrompts(facts, slug);
    const core = prompts.filter((p) => p.pool === "core");
    const bank = prompts.filter((p) => p.pool === "bank");
    expect(core.filter((p) => p.kind === "about").length).toBeLessThanOrEqual(6);
    const coreRecs = core.filter((p) => p.kind === "recommendation");
    expect(coreRecs).toHaveLength(6);
    // Every intent that applies has its own question; care asks no price question.
    const intents = new Set(coreRecs.map((p) => p.intent));
    for (const i of ["quality", "trust", "now", "specialty", "place"]) expect(intents.has(i as never), `${slug} ${i}`).toBe(true);
    if (slug !== "zorg-praktijken") expect(intents.has("price")).toBe(true);
    expect(bank.length).toBeGreaterThanOrEqual(20);
    expect(bank.every((p) => p.kind === "recommendation" && p.intent)).toBe(true);
    const texts = new Set<string>();
    for (const p of prompts) {
      expect(FACT_KEYS).toContain(p.category);
      expect(CRITERIUM_IDS).toContain(p.criterium);
      expect(["about", "recommendation"]).toContain(p.kind);
      expect(p.probes.length).toBeGreaterThan(0);
      for (const probe of p.probes) expect(probe.startsWith(p.category)).toBe(true);
      expect(p.textNl).toMatch(/\?$/);
      // Named for the business place, or (area questions) a place in its werkgebied.
      expect(p.textNl.includes(facts.place) || facts.serviceArea!.places.some((pl) => p.textNl.includes(pl))).toBe(true);
      if (p.kind === "about") expect(p.textNl).toContain(facts.name);
      if (p.kind === "recommendation") expect(p.textNl).not.toContain(facts.name);
      expect(p.textNl).not.toMatch(BANNED);
      expect(p.textNl).not.toMatch(/\bWelke (restaurant|café)\b/);
      expect(texts.has(p.textNl)).toBe(false);
      texts.add(p.textNl);
    }
  });

  it("phrases recommendations the way customers do", () => {
    const plumber = sectorPrompts(fullFacts({ place: "Utrecht" }), "loodgieters-installateurs").map((p) => p.textNl);
    expect(plumber).toContain("Wat is de beste installateur in Utrecht?");
    expect(plumber).toContain("Betrouwbare installateur in Utrecht, wie raad je aan?");
    expect(plumber).toContain("Lekkage, wie kan vandaag komen in Utrecht?");
    expect(plumber).toContain("Wie installeert warmtepompen in Utrecht?");
    const chinees = sectorPrompts(fullFacts({ name: "Golden Dragon", place: "Rotterdam", servicesYes: ["dim sum", "terras"] }), "horeca");
    const texts = chinees.map((p) => p.textNl);
    expect(texts).toContain("Wat is het beste restaurant in Rotterdam?");
    expect(texts).toContain("Welk restaurant in Rotterdam heeft de beste reviews?");
    expect(texts).toContain("Welk restaurant in Rotterdam heeft dim sum?");
    expect(chinees.find((p) => p.textNl.includes("terras in de zon"))).toMatchObject({ pool: "bank", season: "zomer" });
    const vve = sectorPrompts(fullFacts({ name: "Stadsbeheer VvE", place: "Utrecht" }), "vve-beheer").map((p) => p.textNl);
    expect(vve).toContain("VvE-beheerder voor 12 appartementen in Utrecht, wie kan dat doen?");
    const fysio = sectorPrompts(fullFacts({ name: "Fysio Van Dijk", place: "Amersfoort" }), "zorg-praktijken").map((p) => p.textNl);
    expect(fysio).toContain("Fysio zonder verwijzing in Amersfoort?");
  });

  it("judges the open-ended intents on being open, and keeps them out of the afhaker class", () => {
    const prompts = sectorPrompts(fullFacts(), "winkels");
    const byIntent = (i: string) => prompts.filter((p) => p.intent === i && p.category === "existence");
    expect(byIntent("quality").every((p) => p.probes[0] === "existence:beste" && p.criterium === 6)).toBe(true);
    expect(byIntent("trust").every((p) => p.probes[0] === "existence:betrouwbaar" && p.criterium === 6)).toBe(true);
    expect(byIntent("price").every((p) => p.probes[0] === "existence:betaalbaar" && p.criterium === 9)).toBe(true);
    expect(byIntent("place").every((p) => p.probes[0] === "existence:dichtbij" && p.criterium === 6)).toBe(true);
  });

  it("still asks six recommendation questions when the facts are sparse", () => {
    const sparse = sampleFacts({ servicesYes: [], servicesNo: [], prices: [], policies: [], serviceArea: undefined, urgency: undefined, credentials: [] });
    for (const slug of SECTOR_SLUGS) {
      const core = sectorPrompts(sparse, slug).filter((p) => p.pool === "core");
      expect(core.filter((p) => p.kind === "recommendation").length, slug).toBe(6);
      expect(core.length).toBeLessThanOrEqual(12);
    }
  });
});

describe("inferSector", () => {
  it("maps Google categories and Dutch words", () => {
    expect(inferSector("plumber")).toBe("loodgieters-installateurs");
    expect(inferSector("Loodgieter")).toBe("loodgieters-installateurs");
    expect(inferSector("bakery")).toBe("winkels");
    expect(inferSector("bakkerij")).toBe("winkels");
    expect(inferSector("restaurant")).toBe("horeca");
    expect(inferSector("hair_salon")).toBe("kappers-schoonheid");
    expect(inferSector("car_repair")).toBe("garages-fietsenmakers");
    expect(inferSector("physiotherapist")).toBe("zorg-praktijken");
    expect(inferSector("lawyer")).toBe("advocaten-notarissen-accountants");
    expect(inferSector("real_estate_agency")).toBe("makelaars-hypotheek");
    expect(inferSector("driving_school")).toBe("kinderopvang-sport-rijscholen");
    expect(inferSector("roofing_contractor")).toBe("aannemers-dakdekkers-schilders");
    expect(inferSector("property_management_company")).toBe("vve-beheer");
  });

  it("falls back to SBI codes with the longest prefix, then to the manual override, else null", () => {
    expect(inferSector(null, "43221")).toBe("loodgieters-installateurs");
    expect(inferSector(null, "4120")).toBe("aannemers-dakdekkers-schilders");
    expect(inferSector(null, "68.32.1")).toBe("vve-beheer");
    expect(inferSector(null, "4711")).toBe("winkels");
    expect(inferSector(null, "8691")).toBe("zorg-praktijken");
    expect(inferSector(null, "9602")).toBe("kappers-schoonheid");
    expect(inferSector(undefined, undefined)).toBeNull();
    expect(inferSector("space_station", "9999")).toBeNull();
    expect(inferSector("space_station", "9999", "horeca")).toBe("horeca");
    expect(inferSector("plumber", null, "horeca")).toBe("horeca");
  });
});

describe("generatePrompts with a sector", () => {
  it("adds the sector pack on top of the base prompts and marks criterium + kind on every prompt", () => {
    const facts = fullFacts({ sector: "loodgieters-installateurs" });
    const base = basePrompts(facts);
    const all = generatePrompts(facts);
    expect(all.length).toBeGreaterThan(base.length);
    expect(all.length - base.length).toBeGreaterThanOrEqual(6);
    for (const p of all) {
      expect(p.kind === "about" || p.kind === "recommendation").toBe(true);
      expect(CRITERIUM_IDS).toContain(p.criterium);
    }
    expect(all.filter((p) => p.kind === "recommendation" && p.pool === "core")).toHaveLength(6);
    // The servicesNo base prompts carry criterium 7.
    expect(all.find((p) => p.probes[0] === "service:zonnepanelen")?.criterium).toBe(7);
  });

  it("uses the option sector when the facts carry none", () => {
    const facts = fullFacts();
    expect(generatePrompts(facts)).toHaveLength(basePrompts(facts).length);
    expect(generatePrompts(facts, { sector: "horeca" }).length).toBeGreaterThan(basePrompts(facts).length);
  });

  it("free scan stays at 6: existence, phone, Sunday hours + recommendations for kwaliteit, vertrouwen and nu", () => {
    const facts = fullFacts({ sector: "loodgieters-installateurs" });
    const free = freeScanPrompts(facts);
    expect(free).toHaveLength(6);
    expect(free.slice(0, 3).map((p) => p.category)).toEqual(["existence", "phone", "hours"]);
    expect(free[2]!.probes).toEqual(["hours.6"]);
    expect(free.slice(3).map((p) => p.intent)).toEqual(["quality", "trust", "now"]);
    expect(free[3]!.textNl).toBe("Wat is de beste installateur in Zwolle?");
    // Every free prompt exists in the stored set so it can be selected by text.
    const stored = generatePrompts(facts).map((p, i) => ({ ...p, id: String(i) }));
    expect(selectFreeScanPrompts(stored, facts)).toHaveLength(6);
  });

  it("free scan without a sector keeps the original six", () => {
    const facts = sampleFacts();
    expect(freeScanPrompts(facts).map((p) => p.category)).toEqual(["existence", "hours", "phone", "address", "service", "payment"]);
  });
});

describe("facts page with the sector-layer fields", () => {
  it("renders werkgebied, spoed and erkenningen in HTML, llms.txt and JSON-LD", () => {
    const facts = fullFacts({ businessId: business.id });
    const page = renderFactsPage(facts, business, { host: "feiten.hendriks.nl", verifiedAt: "2026-10-07T10:00:00Z" });
    expect(page.html).toContain("<h2>Werkgebied</h2>");
    expect(page.html).toContain("Kampen, Hattem; binnen 25 km van Zwolle");
    expect(page.html).toContain("Spoeddienst beschikbaar: 24 uur per dag, 7 dagen per week.");
    expect(page.html).toContain("<h2>Erkenningen</h2>");
    expect(page.llmsTxt).toContain("## Werkgebied");
    expect(page.llmsTxt).toContain("## Spoed");
    expect(page.llmsTxt).toContain("- gas");
    const ld = page.jsonLd as { areaServed: unknown[]; hasCredential: { name: string }[]; additionalProperty: { name: string; value: string } };
    expect(ld.areaServed).toHaveLength(3);
    expect(ld.areaServed[0]).toEqual({ "@type": "City", name: "Kampen" });
    expect(ld.areaServed[2]).toMatchObject({ "@type": "GeoCircle", geoRadius: "25000" });
    expect(ld.hasCredential.map((c) => c.name)).toEqual(["warmtepompen", "gas"]);
    expect(ld.additionalProperty).toMatchObject({ name: "spoeddienst", value: "ja" });
  });

  it("leaves the page unchanged for facts without the new fields", () => {
    const page = renderFactsPage(sampleFacts({ businessId: business.id }), business, { host: "feiten.x.nl", verifiedAt: "2026-10-07T10:00:00Z" });
    expect(page.html).not.toContain("Werkgebied");
    expect(page.html).not.toContain("Spoed");
    expect(page.jsonLd).not.toHaveProperty("areaServed");
  });
});

describe("customer copy for criteria, severity, stip and sectors", () => {
  it("names all twelve criteria, three severities, four colours and eleven sectors, without jargon", () => {
    expect(Object.keys(copy.criteria)).toHaveLength(12);
    expect(Object.keys(copy.severity)).toEqual(["afhaker", "misleider", "verwarring"]);
    expect(Object.keys(copy.stip)).toEqual(["rood", "oranje", "groen", "grijs"]);
    expect(Object.keys(copy.sectors)).toHaveLength(11);
    const strings: string[] = [
      ...Object.values(copy.criteria),
      ...Object.values(copy.severity),
      ...Object.values(copy.severityExplain),
      ...Object.values(copy.stip),
      ...Object.values(copy.stipMeaning),
      ...Object.values(copy.stipLine),
      ...Object.values(copy.sectors),
      copy.instable,
      copy.instableLine,
      copy.recommendation.label,
      copy.recommendation.absent,
      copy.recommendation.note,
      copy.recommendation.line,
      copy.sectorHint,
      copy.sectorNone,
      ...Object.values(copy.factKey),
    ];
    for (const s of strings) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toContain("!");
    }
    const slugs: SectorSlug[] = SECTOR_SLUGS;
    for (const slug of slugs) expect(copy.sectors[slug]).toBeTruthy();
  });
});
