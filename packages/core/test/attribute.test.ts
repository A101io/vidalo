import { describe, expect, it } from "vitest";
import { attributeFinding, classifyHost, textContainsValue, type AttributionContext } from "../src/scanner/attribute";
import type { FindingCandidate } from "../src/scanner/compare";

const ctx: AttributionContext = {
  business: { domain: "bakkerijdevries.nl", slug: "bakkerij-de-vries-haarlem", name: "Bakkerij De Vries" },
  factsHost: "feiten.bakkerijdevries.nl",
  websiteHost: "bakkerijdevries.nl",
};

function candidate(over: Partial<FindingCandidate> = {}): FindingCandidate {
  return {
    factKey: "phone",
    subject: null,
    engine: "chatgpt",
    wrongValue: "+31235399999",
    correctValue: "+31235312345",
    frequency: 1,
    sampleCount: 3,
    wrongSampleIds: ["s1"],
    citations: [],
    quotes: [],
    ...over,
  };
}

describe("classifyHost", () => {
  it("classifies by hostname", () => {
    expect(classifyHost("https://feiten.bakkerijdevries.nl/", ctx)).toBe("owned_facts_page");
    expect(classifyHost("https://www.bakkerijdevries.nl/contact", ctx)).toBe("owned_website");
    expect(classifyHost("https://www.google.com/maps/place/x", ctx)).toBe("directory_api");
    expect(classifyHost("https://www.bing.com/maps?q=x", ctx)).toBe("directory_api");
    expect(classifyHost("https://openingstijden.nl/bakkerij-de-vries-haarlem", ctx)).toBe("directory_form");
    expect(classifyHost("https://www.telefoonboek.nl/x", ctx)).toBe("directory_form");
    expect(classifyHost("https://www.kvk.nl/zoeken/x", ctx)).toBe("directory_form");
    expect(classifyHost("https://www.facebook.com/x", ctx)).toBe("directory_form");
    expect(classifyHost("https://haarlemsdagblad.nl/artikel", ctx)).toBe("third_party");
  });

  it("falls back to the {slug}-feiten.* fallback host when no facts host is known", () => {
    expect(classifyHost("https://bakkerij-de-vries-haarlem-feiten.vidalo.io/", { ...ctx, factsHost: "bakkerij-de-vries-haarlem-feiten.vidalo.io" })).toBe("owned_facts_page");
  });
});

describe("textContainsValue", () => {
  it("finds phone digits regardless of separators", () => {
    expect(textContainsValue("Bel ons: 023 - 539 99 99", "phone", null, "+31235399999")).toBe(true);
    expect(textContainsValue("Bel ons: 023-5312345", "phone", null, "+31235399999")).toBe(false);
  });
  it("finds 'gesloten' near the day name and time ranges", () => {
    expect(textContainsValue("Openingstijden\nzaterdag 08:00-17:00\nzondag gesloten", "hours", "6", "closed")).toBe(true);
    expect(textContainsValue("zaterdag gesloten\nzondag 10:00-16:00", "hours", "6", "closed")).toBe(false);
    expect(textContainsValue("zondag 10:00 - 16:00", "hours", "6", "10:00-16:00")).toBe(true);
  });
});

describe("attributeFinding", () => {
  it("returns none without citations and other_entity for other-entity candidates", async () => {
    expect(await attributeFinding(candidate(), ctx, { offline: true })).toEqual({ sourceUrl: null, sourceType: "none" });
    expect(await attributeFinding(candidate({ sourceType: "other_entity", citations: ["https://x.nl"] }), ctx, { offline: true })).toEqual({ sourceUrl: "https://x.nl", sourceType: "other_entity" });
  });

  it("classifies the first citation by hostname when offline", async () => {
    const r = await attributeFinding(candidate({ citations: ["https://www.telefoonboek.nl/bakkerij-de-vries-haarlem"] }), ctx, { offline: true });
    expect(r).toEqual({ sourceUrl: "https://www.telefoonboek.nl/bakkerij-de-vries-haarlem", sourceType: "directory_form" });
  });

  it("picks the first fetched page that actually contains the wrong value", async () => {
    const pages: Record<string, string> = {
      "https://haarlemsdagblad.nl/artikel": "<html><body>Een artikel over brood, telefoon 023-5312345</body></html>",
      "https://openingstijden.nl/bakkerij-de-vries-haarlem": "<html><body>Bakkerij De Vries<br>Tel: 023 539 99 99</body></html>",
    };
    const r = await attributeFinding(candidate({ citations: Object.keys(pages) }), ctx, { offline: false, fetch: async (u) => pages[u] ?? null });
    expect(r).toEqual({ sourceUrl: "https://openingstijden.nl/bakkerij-de-vries-haarlem", sourceType: "directory_form" });
  });
});
