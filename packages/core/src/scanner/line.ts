/**
 * A product line presented to compare(), computeStip() and the report as an in-memory `Facts` view (ADR-0010), the same
 * device as withCountry() and withProfile(). Never stored: insertFacts strips `productLine`.
 */
import type { BusinessRecord } from "../db/types";
import type { Facts, ProductLineVersion } from "../types";

/** The scan date as YYYY-MM-DD in Europe/Amsterdam (pinned, never the host's zone): a certificate is valid through its end date. */
export function amsterdamDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function lineFacts(business: Pick<BusinessRecord, "name">, facts: Facts, version: ProductLineVersion, market: string, now: Date = new Date()): Facts {
  const today = amsterdamDate(now);
  return {
    businessId: facts.businessId,
    version: facts.version,
    verifiedAt: facts.verifiedAt,
    provisional: facts.provisional,
    name: version.name,
    place: "",
    country: market,
    address: null,
    postcode: null,
    phone: null,
    email: null,
    website: facts.website,
    // A recommendation question applies only to something that is open (compare.ts recommendationApplies).
    openStatus: "open",
    hours: [],
    servicesYes: [],
    servicesNo: [],
    prices: [],
    policies: [],
    paymentMethods: [],
    notConfusedWith: [],
    profile: null,
    productLine: {
      productLineId: version.productLineId,
      version: version.version,
      market,
      brand: business.name,
      category: version.category,
      useCases: [...version.useCases],
      specs: version.specs.map((s) => ({ ...s })),
      certificates: version.certificates.map((c) => ({ ...c, valid: c.validUntil == null || c.validUntil >= today })),
      outlets: version.outlets.filter((o) => o.market === market).map((o) => ({ ...o })),
      replaces: [...version.replaces],
    },
  };
}
