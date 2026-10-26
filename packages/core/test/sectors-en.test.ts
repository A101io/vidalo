import { describe, expect, it } from "vitest";
import { sectorPrompts } from "../src/prompts/sectors";
import { sectorPromptsEn } from "../src/prompts/sectors.en";
import { SECTOR_SLUGS, type Facts } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const week = (sunday: boolean): Facts["hours"] => [
  { day: 0, open: "08:00", close: "17:00", closed: false },
  { day: 1, open: "08:00", close: "17:00", closed: false },
  { day: 2, open: "08:00", close: "17:00", closed: false },
  { day: 3, open: "08:00", close: "17:00", closed: false },
  { day: 4, open: "08:00", close: "17:00", closed: false },
  { day: 5, open: "09:00", close: "13:00", closed: false },
  sunday ? { day: 6, open: "10:00", close: "12:00", closed: false } : { day: 6, open: null, close: null, closed: true },
];

/** Rich, Dutch owner values: every policy branch in sectors.ts fires. */
function richNl(overrides: Partial<Facts> = {}): Facts {
  return sampleFacts({
    name: "Installatiebedrijf Hendriks",
    place: "Zwolle",
    servicesYes: ["warmtepompen", "cv-ketels", "terras", "dakgoten"],
    servicesNo: ["zonnepanelen", "dakwerk"],
    prices: [{ label: "uurtarief", amount: 65 }],
    policies: ["Geen voorrijkosten", "Gratis offerte", "Zonder afspraak welkom", "Zonder verwijzing welkom", "Nieuwe patiënten welkom", "Reserveren mogelijk", "Vaste prijs mogelijk", "Bestellen kan telefonisch"],
    notConfusedWith: ["Hendriks Installaties in Breda"],
    serviceArea: { places: ["Kampen", "Hattem"], radiusKm: 25 },
    urgency: { available: true, hoursNl: "24 uur per dag" },
    credentials: ["warmtepompen", "gas"],
    hours: week(true),
    ...overrides,
  });
}

/** Rich, English owner values: the business a scan in English is for. */
function richEn(overrides: Partial<Facts> = {}): Facts {
  return sampleFacts({
    name: "Riverside Plumbing",
    place: "Leeds",
    address: "12 Kirkgate",
    postcode: "LS1 6BY",
    servicesYes: ["heat pumps", "boiler repair", "bathroom fitting"],
    servicesNo: ["solar panels"],
    prices: [{ label: "an hourly rate", amount: 70 }],
    policies: ["Reservations recommended", "New patients welcome", "Free quotes"],
    notConfusedWith: ["Riverside Heating in York"],
    serviceArea: { places: ["Leeds", "Bradford", "Wakefield"], radiusKm: 30 },
    urgency: { available: true, hoursNl: "24/7" },
    credentials: ["Gas Safe"],
    hours: week(true),
    ...overrides,
  });
}

function sparse(overrides: Partial<Facts> = {}): Facts {
  return sampleFacts({ name: "Northgate", place: "Bristol", servicesYes: [], servicesNo: [], prices: [], policies: [], serviceArea: undefined, urgency: undefined, credentials: [], hours: week(false), ...overrides });
}

/** Names that pick each pack's other nouns (and the Dutch "Welk"/"Welke" split). */
const NAMES = ["Riverside Plumbing", "Elektro Bos", "CV Service Jansen", "Dakdekker Smit", "Fysio Van Dijk", "Dental Care Leeds", "Lunchroom Het Hoekje", "Café Central", "Bakery Brown", "Fiets Fix", "Barber Joe", "Notaris Smit", "Hypotheek Huis", "Rijschool Vos", "City Gym"];

const FIXTURES: [string, Facts][] = [
  ["rich NL", richNl()],
  ["rich EN", richEn()],
  ["sparse", sparse()],
  ["urgency off", richEn({ urgency: { available: false, hoursNl: "" } })],
  ...NAMES.map((name): [string, Facts] => [`rich NL as ${name}`, richNl({ name })]),
  ...NAMES.map((name): [string, Facts] => [`rich EN as ${name}`, richEn({ name })]),
];

const structure = ({ textNl: _t, ...rest }: { textNl: string } & Record<string, unknown>) => rest;

/** Dutch words that must never show in an English question (owner values in the EN fixtures are English). */
const DUTCH = /\b(welk|welke|zondag|zaterdag|maandag|spoed|raad|aanraden|bij|het|de|een|ook|wie|waar|kan ik|heeft|doet|komt|beste|goede|nog|vandaag|zonder|met)\b/;

describe("sectorPromptsEn", () => {
  it("returns nothing without a sector", () => {
    expect(sectorPromptsEn(richEn(), null)).toEqual([]);
    expect(sectorPromptsEn(richEn(), undefined)).toEqual([]);
  });

  for (const slug of SECTOR_SLUGS) {
    describe(slug, () => {
      it.each(FIXTURES)("matches the Dutch list item for item (%s)", (_label, facts) => {
        const nl = sectorPrompts(facts, slug);
        const en = sectorPromptsEn(facts, slug);
        expect(en.length).toBe(nl.length);
        en.forEach((p, i) => {
          expect(structure(p), `${slug} #${i}: ${nl[i]!.textNl} / ${p.textNl}`).toEqual(structure(nl[i]!));
          expect(p.textNl).toMatch(/\?$/);
          expect(p.textNl).not.toMatch(/!/);
        });
        // Different Dutch questions stay different in English.
        expect(new Set(en.map((p) => p.textNl)).size).toBe(en.length);
      });

      it("reads as English", () => {
        for (const facts of [richEn(), sparse(), ...NAMES.filter((n) => /^[A-Z][a-z]+ [A-Z]/.test(n) && !/Elektro|Dakdekker|Fysio|Lunchroom|Fiets|Notaris|Hypotheek|Rijschool|CV/.test(n)).map((name) => richEn({ name }))]) {
          for (const p of sectorPromptsEn(facts, slug)) expect(p.textNl, p.textNl).not.toMatch(DUTCH);
        }
      });
    });
  }

  it("phrases questions the way English-speaking customers do", () => {
    const plumber = sectorPromptsEn(richEn(), "loodgieters-installateurs").map((p) => p.textNl);
    expect(plumber).toContain("What is the best plumber in Leeds?");
    expect(plumber).toContain("Reliable plumber in Leeds, who would you recommend?");
    expect(plumber).toContain("I have a leak, who can come out today in Leeds?");
    expect(plumber).toContain("Which plumber in Leeds has a 24-hour service?");
    expect(plumber).toContain("Who installs heat pumps in Leeds?");
    expect(plumber).toContain("Does Riverside Plumbing in Leeds also cover Bradford?");
    expect(plumber).toContain("Which plumber in Leeds is open on Sunday?");
    expect(plumber).toContain("Plumber near me in Leeds?");

    const electrician = sectorPromptsEn(richEn({ name: "Bright Electrical" }), "loodgieters-installateurs").map((p) => p.textNl);
    expect(electrician).toContain("I need an electrician in Leeds urgently, who can come today?");

    const restaurant = sectorPromptsEn(richEn({ name: "Golden Dragon", servicesYes: ["dim sum", "terras"] }), "horeca");
    const texts = restaurant.map((p) => p.textNl);
    expect(texts).toContain("What is the best restaurant in Leeds?");
    expect(texts).toContain("Which restaurant in Leeds has the best reviews?");
    expect(texts).toContain("Which restaurant in Leeds offers dim sum?");
    expect(texts).toContain("Restaurant in Leeds where I can book a table for 6?");
    expect(restaurant.find((p) => p.textNl.includes("in the sun"))).toMatchObject({ pool: "bank", season: "zomer", probes: ["service:terras"] });

    const salon = sectorPromptsEn(richEn({ name: "Studio Shine", googleTypes: ["hair_salon"] }), "kappers-schoonheid").map((p) => p.textNl);
    expect(salon).toContain("What is the best hair salon in Leeds?");

    const vve = sectorPromptsEn(richEn({ name: "City Block Management" }), "vve-beheer").map((p) => p.textNl);
    expect(vve).toContain("Homeowners' association manager for 12 apartments in Leeds, who can do that?");

    const dentist = sectorPromptsEn(richEn({ name: "Dental Care Leeds" }), "zorg-praktijken").map((p) => p.textNl);
    expect(dentist).toContain('Does this apply at Dental Care Leeds in Leeds: "New patients welcome"?');
    // Which policies get a question is decided by the Dutch patterns in sectors.ts.
    expect(sectorPromptsEn(richNl({ name: "Dental Care Leeds" }), "zorg-praktijken").map((p) => p.textNl)).toContain("Which dentist in Zwolle is taking on new patients?");
    expect(dentist).toContain("Which dentist in Leeds can see me today?");

    const agent = sectorPromptsEn(sparse({ name: "Hill & Co" }), "makelaars-hypotheek").map((p) => p.textNl);
    expect(agent).toContain("Can you recommend a good estate agent in Bristol?");
  });

  it("keeps the probes and owner values verbatim", () => {
    const nl = sectorPrompts(richNl(), "loodgieters-installateurs");
    const en = sectorPromptsEn(richNl(), "loodgieters-installateurs");
    expect(en.map((p) => p.probes)).toEqual(nl.map((p) => p.probes));
    expect(en.map((p) => p.textNl)).toContain("Who installs warmtepompen in Zwolle?");
  });
});
