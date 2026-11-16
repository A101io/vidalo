import { describe, expect, it } from "vitest";
import { identityMatches, parseBusinessIdentity } from "../src/shared/index.js";
import { copy } from "../src/copy/index.js";
import { en } from "../src/copy/en.js";

/**
 * QA, feature 005 (docs/features/005-scan-identity/qa.md). The `it.fails` cases are the open findings:
 * they pass while the bug is there; when it is fixed they go red and must become plain `it`.
 */
const at = (address: string, postcode: string, website: string | null = null) => ({ address, postcode, website });

describe("AC-2 edge forms of the typed postcode + house number", () => {
  it("reads suffixes and separators people type", () => {
    for (const t of ["3071AV-80", "3071 AV 80 bis", "3071 AV 80 III", "3071 AV 80 1hg", "3071 AV 80-a", "3071 AV  80", " 3071 AV 80"]) {
      expect(parseBusinessIdentity(t), t).toEqual({ kind: "postcode", postcode: "3071AV", number: "80" });
    }
  });

  it("refuses what it cannot read, so the visitor is asked again (never a guess)", () => {
    for (const t of ["Factorij 80, 3071 AV", "3071 AV nr. 80", "3071-AV 80", "SW1A 1AA", "B-1000 Brussel 5", "a@b.nl", "http://vidalo.ai:8080"]) {
      expect(parseBusinessIdentity(t), t).toBeNull();
    }
  });

  it("a range on the street line matches both ends", () => {
    expect(identityMatches(at("Laan 3-5", "1234 AB"), parseBusinessIdentity("1234 AB 5")!)).toBe(true);
  });

  it("a postcode in the candidate with a space or lower case still matches", () => {
    expect(identityMatches(at("Hoogstraat 1", "3011ab"), parseBusinessIdentity("3011 AB 1")!)).toBe(true);
  });

  // QA-01: every number in the street line counts, so a number in the street NAME or a unit number is taken as the house number.
  it("QA-01: '2e Hugo de Grootstraat 12' does not have house number 2", () => {
    expect(identityMatches(at("2e Hugo de Grootstraat 12", "1052 LB"), parseBusinessIdentity("1052 LB 2")!)).toBe(false);
  });
  it("QA-01: 'Kerkstraat 12-2' (number 12, unit 2) does not have house number 2", () => {
    expect(identityMatches(at("Kerkstraat 12-2", "1234 AB"), parseBusinessIdentity("1234 AB 2")!)).toBe(false);
  });
});

describe("AC-7 the privacy statement and cookie table say what the field is for", () => {
  const texts = (legal: object) => JSON.stringify(legal);
  it("NL: the item names postcode and house number, home address, compare only, not kept; the cookie row carries it", () => {
    const t = texts(copy.legal);
    expect(t).toMatch(/"Herkennen:[^"]*postcode[^"]*woonadres[^"]*vergelijken[^"]*bewaren (ze|het) niet[^"]*"/);
    expect(t).toMatch(/\["vidalo_check","[^"]*postcode[^"]*"/);
  });
  it("EN: the same", () => {
    const t = texts(en.legal);
    expect(t).toMatch(/"Recognising:[^"]*postcode[^"]*home address[^"]*compare[^"]*do not keep[^"]*"/);
    expect(t).toMatch(/\["vidalo_check","[^"]*postcode[^"]*"/);
  });
});

describe("AC-8 field copy exists in both languages", () => {
  it("label, placeholder, hint and error, NL and EN, all different per language", () => {
    for (const k of ["identityLabel", "identityPlaceholder", "identityHint", "identityInvalid"] as const) {
      expect(copy.scanField[k], k).toBeTruthy();
      expect(en.scanField[k], k).toBeTruthy();
      expect(en.scanField[k]).not.toBe(copy.scanField[k]);
    }
    expect(en.scan.choose.unlistedButton).toBe("My business is not listed");
    expect(copy.scan.choose.unlistedButton).toBe("Mijn bedrijf staat er niet bij");
  });
});

describe("AC-2 website hosts", () => {
  it("bare host, www, path and trailing dot all reduce to the host", () => {
    const id = parseBusinessIdentity("https://www.Voila.nl./winkel")!;
    expect(identityMatches(at("Hoogstraat 1", "3011 AB", "http://voila.nl/"), id)).toBe(true);
  });

  // QA-02: on a shared host the host says nothing about the business: another business's Facebook page is "the same website".
  it("QA-02: facebook.com/vidalo is not facebook.com/voiladamesmode", () => {
    expect(identityMatches(at("Hoogstraat 1", "3011 AB", "https://www.facebook.com/voiladamesmode"), parseBusinessIdentity("facebook.com/vidalo")!)).toBe(false);
  });
});
