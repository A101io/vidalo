/**
 * Vidalo's own facts: the company as its own first customer.
 *
 * Everything the product promises a customer (a dated facts page in three
 * forms, the same data in the directories, a monthly check, fixes with proof)
 * runs for Vidalo itself from this one record. The web app renders it at
 * /feiten, in the structured data of every page and in /llms.txt; the worker
 * keeps it in the database as a business so the normal publish, sync and
 * monthly-scan jobs cover it.
 *
 * Facts are owner-asserted: `verifiedAt` is set only once Julian confirmed
 * them. Until then the page says "nog niet bevestigd door de eigenaar", as it
 * would for any customer.
 */
import type { Business, Facts } from "../types.js";
import { PRICES } from "../copy/index.js";

/** The business record as the worker upserts it (slug fixed, so it stays one row). */
export const OWN_BUSINESS: Business = {
  id: "own-vidalo",
  slug: "vidalo",
  name: "Vidalo",
  place: "Rotterdam",
  domain: "vidalo.io",
  kvk: "42057858",
  googlePlaceId: null,
  sector: null,
  plan: "monitor",
  status: "active",
  ownerEmail: "hello@vidalo.io",
  createdAt: "2026-10-13T00:00:00.000Z",
};

/** The twelve criteria answered for Vidalo. Confirmed by the owner: see `OWN_FACTS_VERIFIED_AT`. */
export const OWN_FACTS_VERIFIED_AT: string | null = null;

export const OWN_FACTS: Facts = {
  businessId: OWN_BUSINESS.id,
  version: 1,
  verifiedAt: OWN_FACTS_VERIFIED_AT,
  provisional: OWN_FACTS_VERIFIED_AT === null,
  name: OWN_BUSINESS.name,
  place: OWN_BUSINESS.place,
  address: "Factorij 80",
  postcode: "3071 AV",
  phone: "+31 85 109 1393",
  email: "hello@vidalo.io",
  website: "https://vidalo.io",
  openStatus: "open",
  hours: [
    { day: 0, open: "09:00", close: "17:00", closed: false },
    { day: 1, open: "09:00", close: "17:00", closed: false },
    { day: 2, open: "09:00", close: "17:00", closed: false },
    { day: 3, open: "09:00", close: "17:00", closed: false },
    { day: 4, open: "09:00", close: "17:00", closed: false },
    { day: 5, open: null, close: null, closed: true },
    { day: 6, open: null, close: null, closed: true },
  ],
  servicesYes: [
    "Controleren wat ChatGPT, Google AI en Copilot over een bedrijf zeggen",
    "Een feitenpagina publiceren op het eigen domein van het bedrijf",
    "Bedrijfsgegevens doorzetten naar Google, Bing, Apple en de Nederlandse gidsen",
    "Fouten herstellen bij de bron, met bewijs voor en na",
  ],
  servicesNo: ["Websites bouwen", "Advertenties plaatsen", "Reviews schrijven of laten verwijderen"],
  prices: [
    { label: "Goed zetten", amount: PRICES.setupEur, unit: "eenmalig, excl. btw" },
    { label: "Goed houden", amount: PRICES.monitorEurPerMonth, unit: "per maand, excl. btw" },
  ],
  policies: ["De eerste controle is gratis, zonder account", "Geen opzegtermijn, maandelijks opzegbaar", "Prijzen exclusief btw", "Alleen voor bedrijven in Nederland"],
  paymentMethods: [],
  notConfusedWith: [],
  serviceArea: { places: ["Nederland"], radiusKm: null },
  urgency: { available: false, hoursNl: null },
  credentials: [],
  sector: null,
};

/** Where the own facts page lives on the website (the customer pages live on their own host). */
export const OWN_FACTS_PATH = "/feiten";

/** The fields a database row must match before the worker treats its facts as current. */
export function ownFactsFingerprint(f: Pick<Facts, "address" | "postcode" | "phone" | "email" | "website" | "openStatus" | "hours" | "servicesYes" | "servicesNo" | "prices" | "policies" | "paymentMethods" | "notConfusedWith" | "serviceArea" | "urgency" | "credentials" | "verifiedAt">): string {
  const { address, postcode, phone, email, website, openStatus, hours, servicesYes, servicesNo, prices, policies, paymentMethods, notConfusedWith, serviceArea, urgency, credentials, verifiedAt } = f;
  return JSON.stringify({ address, postcode, phone, email, website, openStatus, hours, servicesYes, servicesNo, prices, policies, paymentMethods, notConfusedWith, serviceArea: serviceArea ?? null, urgency: urgency ?? null, credentials: credentials ?? [], verifiedAt });
}
