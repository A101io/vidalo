import type { Facts } from "../src/types";

/** Facts fixture for the prompt / compare / scan tests. */
export function sampleFacts(overrides: Partial<Facts> = {}): Facts {
  return {
    businessId: "b1",
    version: 1,
    verifiedAt: null,
    provisional: true,
    name: "Bakkerij De Vries",
    place: "Haarlem",
    address: "Grote Houtstraat 12",
    postcode: "2011 SM",
    phone: "023-5312345",
    email: null,
    website: "https://www.bakkerijdevries.nl",
    openStatus: "open",
    hours: [
      { day: 0, open: "08:00", close: "18:00", closed: false },
      { day: 1, open: "08:00", close: "18:00", closed: false },
      { day: 2, open: "08:00", close: "18:00", closed: false },
      { day: 3, open: "08:00", close: "18:00", closed: false },
      { day: 4, open: "08:00", close: "20:00", closed: false },
      { day: 5, open: "08:00", close: "17:00", closed: false },
      { day: 6, open: null, close: null, closed: true },
    ],
    servicesYes: ["taarten op bestelling", "glutenvrij brood"],
    servicesNo: ["bezorgen", "catering"],
    prices: [{ label: "een brood", amount: 3.95 }, { label: "appeltaart", amount: 14.5 }],
    policies: ["Pinnen mogelijk", "Bestellen kan telefonisch"],
    paymentMethods: ["pin", "contant"],
    notConfusedWith: [],
    ...overrides,
  };
}

/** Store the questions a business with a door is asked, as the first scan does (prepareBusiness no longer stores any). Returns the active rows. */
export async function storeDoorPrompts(db: import("../src/db").Db, business: import("../src/db").BusinessRecord) {
  const { loadPrompts } = await import("../src/scanner");
  const { withCountry } = await import("../src/shared/country");
  const facts = withCountry((await db.latestFacts(business.id))!, business);
  await loadPrompts(db, business.id, facts, "baseline", business.sector);
  return db.listPrompts(business.id, { activeOnly: true });
}
