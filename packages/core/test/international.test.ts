import { describe, expect, it } from "vitest";
import { countryOptions, currencyOf, hasDirectorySync, normalizeCountry, scanLang, withCountry } from "../src/shared/country";
import { normalizePhone, normalizeTime, formatPhone, factValue } from "../src/scanner/normalize";
import { freeScanPrompts, generatePrompts } from "../src/prompts";
import { extractClaimsRules } from "../src/scanner/extract";
import { systemFor, SYSTEM_NL } from "../src/scanner/engines/types";
import { renderFactsPage } from "../src/publisher/render";
import type { Facts } from "../src/types";
import { business, facts } from "./worker-fixtures";

const ukBusiness = { ...business, slug: "joes-bakery-leeds", name: "Joe's Bakery", place: "Leeds", country: "GB", kvk: null, domain: "joesbakery.co.uk", sector: "winkels" as const };
const ukFacts: Facts = {
  ...facts,
  name: "Joe's Bakery",
  place: "Leeds",
  address: "12 Kirkgate",
  postcode: "LS1 6BY",
  phone: "0113 496 0123",
  website: "https://joesbakery.co.uk",
  servicesYes: ["sourdough", "birthday cakes"],
  servicesNo: ["delivery"],
  prices: [{ label: "a sourdough loaf", amount: 4.5 }],
  policies: ["Card only"],
  country: "GB",
};

const DUTCH = /\b(welke?|zondag|zaterdag|maandag|openingstijden|telefoonnummer|bestaat|nog open|pinnen|bij)\b/i;

describe("country", () => {
  it("picks Dutch only for the Netherlands", () => {
    expect(scanLang("NL")).toBe("nl");
    expect(scanLang(undefined)).toBe("nl");
    expect(scanLang("GB")).toBe("en");
    expect(scanLang("DE")).toBe("en");
  });

  it("normalises codes and falls back to NL", () => {
    expect(normalizeCountry(" gb ")).toBe("GB");
    expect(normalizeCountry("XX")).toBe("NL");
    expect(normalizeCountry(null)).toBe("NL");
  });

  it("syncs the Dutch directories only for NL and knows the currency", () => {
    expect(hasDirectorySync("NL")).toBe(true);
    expect(hasDirectorySync("BE")).toBe(false);
    expect(currencyOf("NL")).toBe("EUR");
    expect(currencyOf("DE")).toBe("EUR");
    expect(currencyOf("GB")).toBe("GBP");
    expect(currencyOf("CH")).toBe("CHF");
  });

  it("lists every country with the Netherlands first", () => {
    const nl = countryOptions("nl");
    expect(nl[0]).toEqual({ code: "NL", name: "Nederland" });
    expect(nl.find((c) => c.code === "DE")?.name).toBe("Duitsland");
    expect(countryOptions("en").find((c) => c.code === "GB")?.name).toBe("United Kingdom");
    expect(nl.length).toBe(249);
  });

  it("copies the business country into facts", () => {
    expect(withCountry(facts, { country: "GB" }).country).toBe("GB");
  });
});

describe("phone numbers abroad", () => {
  it("keeps the Dutch reader for NL", () => {
    expect(normalizePhone("023-5312345")).toBe("+31235312345");
    expect(normalizePhone("+31 (0)23 531 23 45", "NL")).toBe("+31235312345");
  });

  it("reads a national number in the business's country", () => {
    expect(normalizePhone("0113 496 0123", "GB")).toBe("+441134960123");
    expect(normalizePhone("030 12345678", "DE")).toBe("+493012345678");
    expect(normalizePhone("12345", "GB")).toBeNull();
  });

  it("reads a number with a foreign country code anywhere", () => {
    expect(normalizePhone("+44 113 496 0123")).toBe("+441134960123");
    expect(normalizePhone("0032 2 123 45 67")).toBe("+3221234567");
  });

  it("shows a foreign number in international style", () => {
    expect(formatPhone("+441134960123")).toBe("+44 113 496 0123");
    expect(formatPhone("+31235312345")).toBe("023-5312345");
  });

  it("compares the owner's national number in their country", () => {
    expect(factValue(ukFacts, "phone", null)).toBe("+441134960123");
  });
});

describe("times", () => {
  it("reads am/pm", () => {
    expect(normalizeTime("9am")).toBe("09:00");
    expect(normalizeTime("5:30 p.m.")).toBe("17:30");
    expect(normalizeTime("12pm")).toBe("12:00");
    expect(normalizeTime("12am")).toBe("00:00");
    expect(normalizeTime("13pm")).toBeNull();
    expect(normalizeTime("9 uur")).toBe("09:00");
  });
});

describe("questions in English", () => {
  it("asks every base and sector question in English for a business abroad", () => {
    const prompts = generatePrompts(ukFacts, { sector: "winkels" });
    expect(prompts.length).toBeGreaterThan(10);
    for (const p of prompts) expect(p.textNl, p.textNl).not.toMatch(DUTCH);
    expect(prompts.map((p) => p.textNl)).toContain("Is Joe's Bakery in Leeds still open?");
    expect(prompts.map((p) => p.textNl)).toContain("What is the phone number of Joe's Bakery in Leeds?");
    expect(prompts.map((p) => p.textNl)).toContain("Is Joe's Bakery in Leeds open on Sunday?");
  });

  it("asks the free scan in English with the same probes as in Dutch", () => {
    const en = freeScanPrompts(ukFacts, { sector: "winkels" });
    const nl = freeScanPrompts({ ...ukFacts, country: "NL" }, { sector: "winkels" });
    expect(en.map((p) => p.probes)).toEqual(nl.map((p) => p.probes));
    for (const p of en) expect(p.textNl).not.toMatch(DUTCH);
  });

  it("leaves Dutch businesses asked in Dutch", () => {
    expect(generatePrompts(facts)[0]!.textNl).toBe("Is Bakkerij Jansen in Haarlem nog open?");
  });
});

describe("reading English answers", () => {
  const prompt = (textNl: string, probes: string[], category: Facts extends never ? never : "hours" | "phone" | "existence") => ({ textNl, probes, category });

  it("reads Sunday hours with am/pm", () => {
    const claims = extractClaimsRules("On Sunday Joe's Bakery is open from 8am to 2pm.", ukFacts, prompt("Is Joe's Bakery in Leeds open on Sunday?", ["hours.6"], "hours"));
    expect(claims[0]).toMatchObject({ factKey: "hours", subject: "6", value: "08:00-14:00" });
  });

  it("reads a closed day", () => {
    const claims = extractClaimsRules("Joe's Bakery is closed on Sunday.", ukFacts, prompt("Is Joe's Bakery in Leeds open on Sunday?", ["hours.6"], "hours"));
    expect(claims[0]).toMatchObject({ value: "closed" });
  });

  it("reads a British phone number", () => {
    const claims = extractClaimsRules("You can call them on 0113 496 0123.", ukFacts, prompt("What is the phone number of Joe's Bakery in Leeds?", ["phone"], "phone"));
    expect(claims[0]).toMatchObject({ factKey: "phone", value: "+441134960123" });
  });

  it("reads permanently closed and still open", () => {
    const closed = extractClaimsRules("Joe's Bakery has permanently closed.", ukFacts, prompt("Is Joe's Bakery in Leeds still open?", ["existence"], "existence"));
    expect(closed[0]).toMatchObject({ value: "permanently_closed" });
    const open = extractClaimsRules("Yes, Joe's Bakery is still open.", ukFacts, prompt("Is Joe's Bakery in Leeds still open?", ["existence"], "existence"));
    expect(open[0]).toMatchObject({ value: "open" });
  });
});

describe("AI systems abroad", () => {
  it("asks a user in that country, in English", () => {
    expect(systemFor("NL")).toBe(SYSTEM_NL);
    expect(systemFor("GB")).toContain("a user in United Kingdom");
    expect(systemFor("GB")).toContain("Answer in English");
  });
});

describe("facts page abroad", () => {
  const page = renderFactsPage(ukFacts, ukBusiness, { host: "facts.joesbakery.co.uk", verifiedAt: "2026-10-07T02:00:00.000Z" });

  it("is in English with the country and currency", () => {
    expect(page.html).toContain('<html lang="en">');
    expect(page.html).toContain("<title>Joe&#39;s Bakery in Leeds – facts and opening hours</title>");
    expect(page.html).toContain("<h2>Opening hours</h2>");
    expect(page.html).toMatch(/<tr><th scope="row">Sunday<\/th><td>closed<\/td><\/tr>/);
    expect(page.html).toContain("Last checked on <time datetime=\"2026-10-07\">7 October 2026</time>");
    expect(page.html).toContain("£4.50");
    expect(page.html).not.toMatch(/Openingstijden|gesloten|Bellen/);
    expect((page.jsonLd.address as Record<string, string>).addressCountry).toBe("GB");
    expect((page.jsonLd.makesOffer as Record<string, string>[])[0]!.priceCurrency).toBe("GBP");
    expect(page.llmsTxt).toContain("## Opening hours");
    expect(page.llmsTxt).toContain("- Phone: 0113 496 0123");
  });

  it("takes the country from the business when the facts lack it", () => {
    const { country: _c, ...noCountry } = ukFacts;
    const p = renderFactsPage(noCountry, ukBusiness, { host: "facts.joesbakery.co.uk" });
    expect(p.html).toContain('<html lang="en">');
  });

  it("keeps the Dutch page for a Dutch business", () => {
    const nl = renderFactsPage(facts, business, { host: "feiten.bakkerijjansen.nl" });
    expect(nl.html).toContain('<html lang="nl">');
    expect((nl.jsonLd.address as Record<string, string>).addressCountry).toBe("NL");
  });
});
