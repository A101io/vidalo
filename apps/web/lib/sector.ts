/**
 * Sector page data: the questions a sector pack asks, rendered with a
 * placeholder business ("X in [plaats]") from the sample facts in copy, so
 * the page and the scanner share one source (packages/core/src/prompts/sectors.ts).
 */
import type { Facts, Hours, SectorSlug, Severity } from "@vidalo/core/types";
import { SECTORS, type SectorPromptTemplate } from "@vidalo/core/prompts";
import { criterium, type Criterium } from "@vidalo/core/criteria";
import type { CopyShape } from "@vidalo/core/copy";

export interface SectorQuestion {
  text: string;
  criterium: Criterium;
  severity: Severity;
  kind: SectorPromptTemplate["kind"];
}

function placeholderFacts(slug: SectorSlug, copy: CopyShape): Facts {
  const s = copy.sectorPages[slug].sample;
  const name = copy.sector.placeholderName;
  const place = copy.sector.placeholderPlace;
  const hours: Hours[] = ([0, 1, 2, 3, 4] as const).map((day) => ({ day, open: "09:00", close: "17:00", closed: false }));
  hours.push({ day: 5, open: "09:00", close: "13:00", closed: false }, { day: 6, open: null, close: null, closed: true });
  return {
    businessId: "vak",
    version: 1,
    verifiedAt: null,
    provisional: true,
    name,
    place,
    address: null,
    postcode: null,
    phone: null,
    email: null,
    website: null,
    openStatus: "open",
    hours,
    servicesYes: [...s.servicesYes],
    servicesNo: [...s.servicesNo],
    prices: s.prices.map((label) => ({ label, amount: 0 })),
    policies: [...s.policies],
    paymentMethods: [],
    notConfusedWith: s.notConfusedWith.map((n) => n.replace("X", name)),
    serviceArea: { places: s.areaPlace ? [s.areaPlace] : [], radiusKm: null },
    urgency: s.urgency ? { available: true, hoursNl: null } : undefined,
    credentials: [...s.credentials],
    sector: slug,
  };
}

/** The sector's extra questions, in the order the scanner asks them. */
export function sectorQuestions(slug: SectorSlug, copy: CopyShape): SectorQuestion[] {
  const pack = SECTORS[slug];
  const facts = placeholderFacts(slug, copy);
  const xInPlace = `${facts.name} in ${facts.place}`;
  return pack.prompts(facts).filter((p) => p.pool === "core").map((p) => {
    const c = criterium(p.criterium);
    // "Komt X in [plaats] ook in Z?" reads better as "Komt X ook in Z?" on the page.
    return { text: p.textNl.split(xInPlace).join(facts.name), criterium: c, severity: c.severity, kind: p.kind };
  });
}
