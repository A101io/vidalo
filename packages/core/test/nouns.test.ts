import { describe, expect, it } from "vitest";
import { deBesteFor, inflect, isHetNoun, nounFromGoogleTypes, welkFor } from "../src/prompts/nouns";
import { businessNoun, sectorPack } from "../src/prompts/sectors";
import type { Facts } from "../src/types";

const facts = (over: Partial<Facts>): Facts => ({
  name: "Restaurant 'Top Exotic'",
  place: "Rotterdam",
  address: null,
  postcode: null,
  phone: null,
  email: null,
  website: null,
  openStatus: "open",
  hours: [],
  servicesYes: [],
  servicesNo: [],
  prices: [],
  policies: [],
  paymentMethods: [],
  notConfusedWith: [],
  ...over,
});

describe("the comparison profile: the word the recommendation questions are built on", () => {
  it("takes Google's specific type before the sector's default (Top Exotic, 9 Nov 2026)", () => {
    expect(nounFromGoogleTypes(["meal_takeaway", "restaurant", "food"], "nl")).toBe("afhaalrestaurant");
    expect(nounFromGoogleTypes(["indonesian_restaurant", "meal_takeaway"], "nl")).toBe("Indonesisch restaurant");
    expect(nounFromGoogleTypes(["indonesian_restaurant"], "en")).toBe("Indonesian restaurant");
    expect(nounFromGoogleTypes(["restaurant", "food"], "nl")).toBeNull();
    expect(businessNoun(facts({ googleTypes: ["meal_takeaway", "restaurant"] }), "horeca")).toBe("afhaalrestaurant");
    expect(businessNoun(facts({ googleTypes: ["restaurant"] }), "horeca")).toBe("restaurant");
  });

  it("the owner's own word wins over everything", () => {
    expect(businessNoun(facts({ googleTypes: ["meal_takeaway"], kind: " Surinaams restaurant " }), "horeca")).toBe("Surinaams restaurant");
    expect(businessNoun(facts({ googleTypes: ["meal_takeaway"], kind: "" }), "horeca")).toBe("afhaalrestaurant");
  });

  it("the questions use the word with the right article and inflection", () => {
    const pack = sectorPack("horeca")!;
    const texts = pack.prompts(facts({ googleTypes: ["indonesian_restaurant"] })).map((p) => p.textNl);
    expect(texts).toContain("Wat is het beste Indonesische restaurant in Rotterdam?");
    expect(texts.some((t) => t.startsWith("Welk Indonesisch restaurant in Rotterdam"))).toBe(true);
    const snackbar = pack.prompts(facts({ kind: "Surinaamse snackbar" })).map((p) => p.textNl);
    expect(snackbar).toContain("Wat is de beste Surinaamse snackbar in Rotterdam?");
    expect(snackbar.some((t) => t.startsWith("Welke Surinaamse snackbar in Rotterdam"))).toBe(true);
  });

  it("Dutch grammar helpers", () => {
    expect(isHetNoun("restaurant")).toBe(true);
    expect(isHetNoun("Surinaams restaurant")).toBe(true);
    expect(isHetNoun("snackbar")).toBe(false);
    expect(isHetNoun("afhaalrestaurant")).toBe(true);
    expect(deBesteFor("afhaalrestaurant")).toBe("het beste afhaalrestaurant");
    expect(welkFor("visrestaurant")).toBe("Welk");
    expect(welkFor("café")).toBe("Welk");
    expect(welkFor("kapper")).toBe("Welke");
    expect(deBesteFor("restaurant")).toBe("het beste restaurant");
    expect(deBesteFor("Chinees restaurant")).toBe("het beste Chinese restaurant");
    expect(deBesteFor("mediterraan restaurant")).toBe("het beste mediterrane restaurant");
    expect(deBesteFor("Thais restaurant")).toBe("het beste Thaise restaurant");
    expect(deBesteFor("vegetarisch restaurant")).toBe("het beste vegetarische restaurant");
    expect(deBesteFor("pizzeria")).toBe("de beste pizzeria");
    expect(inflect("goede")).toBe("goede");
  });
});
