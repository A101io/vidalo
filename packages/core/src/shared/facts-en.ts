/**
 * English, human wording for fact keys and normalised claim values: the
 * mirror of facts-nl.ts, for the mails to an owner who chose English.
 * `findingWords(f, lang)` picks the language.
 */
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_LABEL, NOT_FOUND_VALUE, PRESENT_VALUE, type FactKey, type Finding } from "../types.js";
import { findingWordsNl, type FindingWordsNl } from "./facts-nl.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Recommendation questions not tied to one fact (probe "existence:beste" etc.). */
const INTENT_LABEL: Record<string, string> = {
  beste: "whether you are named when someone looks for the best in your trade",
  betrouwbaar: "whether you are named when someone looks for a reliable business",
  betaalbaar: "whether you are named when someone looks for an affordable business",
  dichtbij: "whether you are named when someone looks for something nearby",
};

export function factLabelEn(factKey: FactKey, subject: string | null): string {
  switch (factKey) {
    case "existence":
      return subject && INTENT_LABEL[subject] ? INTENT_LABEL[subject]! : "whether the business is open";
    case "hours": {
      const idx = subject != null && /^\d$/.test(subject) ? Number(subject) : -1;
      return idx >= 0 && idx < 7 ? `the opening hours on ${DAYS[idx]}` : "the opening hours";
    }
    case "phone":
      return "the phone number";
    case "address":
      return "the address";
    case "website":
      return "the website";
    case "service":
      return subject ? `whether ${subject} is offered` : "the services";
    case "price":
      return subject ? `the price of ${subject}` : "the prices";
    case "policy":
      return subject ? `the terms for ${subject}` : "the terms";
    case "payment":
      return "the payment options";
    case "area":
      return subject ? `whether ${subject} is in the service area` : "the service area";
    case "urgency":
      return "the emergency service";
    case "credential":
      return subject ? `the accreditation ${subject}` : "the accreditations";
    case "identity":
      return subject ? `whether this is the same business as ${subject}` : "whether this is the same business";
    default:
      return "the details";
  }
}

/** Short field name: "Phone", "Sunday", ... */
export function factFieldEn(factKey: FactKey, subject: string | null): string {
  switch (factKey) {
    case "existence":
      return "Status";
    case "hours": {
      const idx = subject != null && /^\d$/.test(subject) ? Number(subject) : -1;
      return idx >= 0 && idx < 7 ? DAYS[idx]! : "Opening hours";
    }
    case "phone":
      return "Phone";
    case "address":
      return "Address";
    case "website":
      return "Website";
    case "service":
      return subject ? `Service: ${subject}` : "Services";
    case "price":
      return subject ? `Price: ${subject}` : "Prices";
    case "policy":
      return subject ? `Terms: ${subject}` : "Terms";
    case "payment":
      return "Payment";
    case "area":
      return subject ? `Service area: ${subject}` : "Service area";
    case "urgency":
      return "Emergency";
    case "credential":
      return subject ? `Accreditation: ${subject}` : "Accreditations";
    case "identity":
      return "Same name";
    default:
      return "Details";
  }
}

/** Normalised value → English wording. "closed" → "closed", "09:00-17:00" → "09:00 to 17:00", "4.5" → "€4.50". */
export function valueEn(factKey: FactKey, value: string): string {
  const v = value.trim();
  if (v === NOT_FOUND_LABEL || v === NOT_FOUND_VALUE) return "not found";
  if (v === ABSENT_LABEL || v === ABSENT_VALUE) return "not named";
  if (v === PRESENT_VALUE) return "named";
  const lower = v.toLowerCase();
  if (factKey === "identity") {
    if (lower === "no" || lower === "nee") return "another business";
    if (lower === "yes" || lower === "ja") return "the same business";
  }
  if (factKey === "existence") {
    if (["closed", "permanently_closed", "permanent gesloten", "permanently closed"].includes(lower)) return "permanently closed";
    if (["temporarily_closed", "temporarily closed"].includes(lower)) return "temporarily closed";
    if (["open", "exists", "yes"].includes(lower)) return "open";
  }
  if (lower === "closed" || lower === "gesloten") return "closed";
  if (lower === "yes" || lower === "ja") return "yes";
  if (lower === "no" || lower === "nee") return "no";
  const hours = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(v);
  if (hours) return `${hours[1]} to ${hours[2]}`;
  if (factKey === "price" && /^\d+(\.\d+)?$/.test(v)) return `€${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  return v;
}

export function findingWordsEn(f: Parameters<typeof findingWordsNl>[0]): FindingWordsNl {
  const nl = findingWordsNl(f);
  const what = factLabelEn(f.factKey, f.subject);
  return {
    what,
    field: factFieldEn(f.factKey, f.subject),
    wrong: nl.notFound ? "not found" : nl.recommendation ? "not named" : valueEn(f.factKey, f.wrongValue),
    correct: nl.recommendation && f.factKey === "existence" && f.subject && INTENT_LABEL[f.subject] ? "you are open and work in this town" : valueEn(f.factKey, f.correctValue),
    frequency: `${f.frequency} of ${f.sampleCount} times`,
    notFound: nl.notFound,
    notFoundLine: nl.notFound ? `found nothing about ${what}` : "",
    recommendation: nl.recommendation,
  };
}

/** The finding in the owner's language. */
export function findingWords(f: Parameters<typeof findingWordsNl>[0] & Partial<Pick<Finding, "verdict" | "evidenceKind">>, lang: "nl" | "en" = "nl"): FindingWordsNl {
  return lang === "en" ? findingWordsEn(f) : findingWordsNl(f);
}
