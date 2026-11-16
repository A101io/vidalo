import { describe, expect, it } from "vitest";
import { identityMatches, identityText, parseBusinessIdentity, readCheckCookie, signCheckCookie } from "../src/shared/index.js";

const voila = { name: "Voila ! Damesmode", postcode: "3011 AB", address: "Hoogstraat 12A", website: "https://www.voila-damesmode.nl/" };

describe("parseBusinessIdentity", () => {
  it("reads a Dutch postcode with house number in the ways people type it", () => {
    for (const t of ["3071 AV 80", "3071AV80", "3071 av, 80", "3071 AV 80a", "3071 AV 80-2", " 3071 AV 080 "]) {
      expect(parseBusinessIdentity(t), t).toEqual({ kind: "postcode", postcode: "3071AV", number: "80" });
    }
  });

  it("reads a website", () => {
    expect(parseBusinessIdentity("www.vidalo.ai")).toEqual({ kind: "website", host: "vidalo.ai", url: "https://www.vidalo.ai" });
    expect(parseBusinessIdentity("https://Vidalo.ai/over")).toMatchObject({ kind: "website", host: "vidalo.ai" });
  });

  it("refuses a name, a postcode without number, an internal host and empty input", () => {
    for (const t of ["Vidalo", "3071 AV", "localhost", "http://10.0.0.1", "", "   ", null, 42, "x".repeat(300)]) expect(parseBusinessIdentity(t), String(t)).toBeNull();
  });
});

describe("identityMatches: never the name", () => {
  it("matches exactly the postcode and the house number", () => {
    expect(identityMatches(voila, parseBusinessIdentity("3011 AB 12")!)).toBe(true);
    expect(identityMatches(voila, parseBusinessIdentity("3011ab 12a")!)).toBe(true);
    expect(identityMatches(voila, parseBusinessIdentity("3011 AB 14")!)).toBe(false);
    expect(identityMatches(voila, parseBusinessIdentity("3011 AC 12")!)).toBe(false);
    // "1" is not "12": whole numbers only.
    expect(identityMatches(voila, parseBusinessIdentity("3011 AB 1")!)).toBe(false);
  });

  it("matches the website's host with or without www, nothing else", () => {
    expect(identityMatches(voila, parseBusinessIdentity("voila-damesmode.nl")!)).toBe(true);
    expect(identityMatches(voila, parseBusinessIdentity("https://www.voila-damesmode.nl/winkel")!)).toBe(true);
    expect(identityMatches(voila, parseBusinessIdentity("vidalo.ai")!)).toBe(false);
    expect(identityMatches({ ...voila, website: null }, parseBusinessIdentity("voila-damesmode.nl")!)).toBe(false);
  });

  it("reads only the house number at the end of the street line (QA-01)", () => {
    const at = (address: string) => ({ ...voila, address });
    expect(identityMatches(at("2e Hugo de Grootstraat 12"), parseBusinessIdentity("3011 AB 12")!)).toBe(true);
    expect(identityMatches(at("2e Hugo de Grootstraat 12"), parseBusinessIdentity("3011 AB 2")!)).toBe(false);
    expect(identityMatches(at("Kerkstraat 12-2"), parseBusinessIdentity("3011 AB 12")!)).toBe(true);
    expect(identityMatches(at("Kerkstraat 12-2"), parseBusinessIdentity("3011 AB 2")!)).toBe(false);
    expect(identityMatches(at("Laan 3-5"), parseBusinessIdentity("3011 AB 4")!)).toBe(true);
    expect(identityMatches(at("Laan 3-5"), parseBusinessIdentity("3011 AB 6")!)).toBe(false);
  });

  it("a page on a shared host is that page only (QA-02)", () => {
    const fb = { ...voila, website: "https://www.facebook.com/voiladamesmode" };
    expect(identityMatches(fb, parseBusinessIdentity("facebook.com/vidalo")!)).toBe(false);
    expect(identityMatches(fb, parseBusinessIdentity("facebook.com")!)).toBe(false);
    expect(identityMatches(fb, parseBusinessIdentity("https://facebook.com/VoilaDamesmode/about")!)).toBe(true);
    // A language folder names no page of its own.
    expect(identityMatches({ ...voila, website: "https://voila-damesmode.nl/nl/" }, parseBusinessIdentity("voila-damesmode.nl")!)).toBe(true);
  });

  it("a candidate without postcode or street matches no postcode", () => {
    expect(identityMatches({ ...voila, postcode: null }, parseBusinessIdentity("3011 AB 12")!)).toBe(false);
    expect(identityMatches({ ...voila, address: null }, parseBusinessIdentity("3011 AB 12")!)).toBe(false);
  });
});

describe("the identity in the check cookie", () => {
  it("survives the round trip and reads back to the same identity", () => {
    const id = parseBusinessIdentity("3071 av 80")!;
    const back = readCheckCookie("s", signCheckCookie("s", { email: "a@b.nl", marketing: false, identity: identityText(id) }));
    expect(back).toEqual({ email: "a@b.nl", marketing: false, identity: "3071AV 80" });
    expect(parseBusinessIdentity(back!.identity)).toEqual(id);
  });

  it("an older cookie without one reads as none", () => {
    expect(readCheckCookie("s", signCheckCookie("s", { email: "a@b.nl", marketing: true }))!.identity).toBeNull();
  });
});
