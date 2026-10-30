/**
 * Practise what we preach: everything the product promises a customer exists
 * for Vidalo itself, from one record. The twelve criteria are answered, the
 * three forms of the facts page render from it, and the prices on it are
 * the prices on the site.
 */
import { describe, expect, it } from "vitest";
import { CRITERIA } from "../src/criteria.js";
import { PRICES } from "../src/copy/index.js";
import { renderFactsPage } from "../src/publisher/index.js";
import { OWN_BUSINESS, OWN_FACTS, OWN_FACTS_PATH, ownFactsFingerprint } from "../src/shared/own.js";
import type { FactKey } from "../src/types.js";

/** Criteria the owner still has to fill in; listed here so the gap is visible, not hidden. */
const OPEN: ReadonlySet<FactKey> = new Set<FactKey>(["payment", "identity", "credential"]);

function answered(key: FactKey): boolean {
  const f = OWN_FACTS;
  switch (key) {
    case "existence":
      return f.openStatus === "open";
    case "hours":
      return f.hours.length === 7;
    case "phone":
      return f.phone !== null;
    case "address":
      return Boolean(f.address && f.postcode && f.place);
    case "website":
      return Boolean(f.website);
    case "service":
      return f.servicesYes.length > 0 && f.servicesNo.length > 0;
    case "price":
      return f.prices.length > 0;
    case "policy":
      return f.policies.length > 0;
    case "payment":
      return f.paymentMethods.length > 0;
    case "area":
      return Boolean(f.serviceArea && (f.serviceArea.places.length || f.serviceArea.radiusKm != null));
    case "urgency":
      return f.urgency !== undefined;
    case "credential":
      return Boolean(f.credentials?.length);
    case "identity":
      return f.notConfusedWith.length > 0;
  }
}

describe("Vidalo as its own first customer", () => {
  it("answers every criterium that is not an open item", () => {
    for (const c of CRITERIA) {
      for (const key of c.factKeys) {
        if (OPEN.has(key)) continue;
        expect(answered(key), `criterium ${c.id} ${c.key} (${key})`).toBe(true);
      }
    }
  });

  it("names the open items honestly", () => {
    for (const key of OPEN) expect(answered(key), `${key} is listed as open but is answered; take it off the list`).toBe(false);
  });

  it("renders the facts page in three forms from the one record", () => {
    const page = renderFactsPage(OWN_FACTS, OWN_BUSINESS, { canonicalUrl: `https://vidalo.io${OWN_FACTS_PATH}` });
    expect(page.canonicalUrl).toBe("https://vidalo.io/feiten");
    expect(page.html).toContain("Vidalo in Rotterdam");
    expect(page.html).toContain("Factorij 80, 3071 AV Rotterdam");
    expect(page.html).toContain("KvK-nummer: 42057858");
    expect(page.html).toContain(OWN_FACTS.verifiedAt ? "Laatst bevestigd door de eigenaar" : "Nog niet bevestigd door de eigenaar");
    expect(page.jsonLd["@type"]).toBe("LocalBusiness");
    expect(page.jsonLd.name).toBe("Vidalo");
    expect(page.llmsTxt).toContain("# Vidalo (Rotterdam)");
    expect(page.llmsTxt).toContain("- Niet: Websites bouwen");
  });

  it("charges itself what it charges customers", () => {
    const setup = OWN_FACTS.prices.find((p) => p.label === "Goed zetten");
    const monitor = OWN_FACTS.prices.find((p) => p.label === "Goed houden");
    expect(setup?.amount).toBe(PRICES.setupEur);
    expect(monitor?.amount).toBe(PRICES.monitorEurPerMonth);
    expect(setup?.unit).toContain("excl. btw");
  });

  it("is provisional until the owner confirmed it", () => {
    expect(OWN_FACTS.provisional).toBe(OWN_FACTS.verifiedAt === null);
    expect(OWN_BUSINESS.plan).toBe("monitor");
    expect(OWN_BUSINESS.status).toBe("active");
  });

  it("has a stable fingerprint the worker can compare against the database", () => {
    expect(ownFactsFingerprint(OWN_FACTS)).toBe(ownFactsFingerprint({ ...OWN_FACTS, version: 9, businessId: "x" }));
    expect(ownFactsFingerprint(OWN_FACTS)).not.toBe(ownFactsFingerprint({ ...OWN_FACTS, phone: "010-1234567" }));
  });
});
