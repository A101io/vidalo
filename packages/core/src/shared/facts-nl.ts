/**
 * Dutch, human wording for fact keys and normalised claim values.
 * Used by the correction emails, the reports and the proof cards.
 */
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_LABEL, NOT_FOUND_VALUE, PRESENT_VALUE, type FactKey, type Finding } from "../types.js";

const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

/** Recommendation questions not tied to one fact (probe "existence:beste" etc.). */
const INTENT_LABEL: Record<string, string> = {
  beste: "of je genoemd wordt als iemand de beste in je vak zoekt",
  betrouwbaar: "of je genoemd wordt als iemand een betrouwbaar bedrijf zoekt",
  betaalbaar: "of je genoemd wordt als iemand een betaalbaar bedrijf zoekt",
  dichtbij: "of je genoemd wordt als iemand iets in de buurt zoekt",
};

export function factLabelNl(factKey: FactKey, subject: string | null): string {
  switch (factKey) {
    case "existence":
      return subject && INTENT_LABEL[subject] ? INTENT_LABEL[subject]! : "of het bedrijf open is";
    case "hours": {
      const idx = subject != null && /^\d$/.test(subject) ? Number(subject) : -1;
      return idx >= 0 && idx < 7 ? `de openingstijden op ${DAYS[idx]}` : "de openingstijden";
    }
    case "phone":
      return "het telefoonnummer";
    case "address":
      return "het adres";
    case "website":
      return "de website";
    case "service":
      return subject ? `of ${subject} wordt aangeboden` : "de diensten";
    case "price":
      return subject ? `de prijs van ${subject}` : "de prijzen";
    case "policy":
      return subject ? `de afspraak over ${subject}` : "de afspraken";
    case "payment":
      return "de betaalmogelijkheden";
    case "area":
      return subject ? `of ${subject} in het werkgebied ligt` : "het werkgebied";
    case "urgency":
      return "de spoeddienst";
    case "credential":
      return subject ? `de erkenning ${subject}` : "de erkenningen";
    case "identity":
      return subject ? `of dit hetzelfde bedrijf is als ${subject}` : "of dit hetzelfde bedrijf is";
    default:
      return "de gegevens";
  }
}

/** Short field name for tables: "Telefoon", "Zondag", ... */
export function factFieldNl(factKey: FactKey, subject: string | null): string {
  switch (factKey) {
    case "existence":
      return "Status";
    case "hours": {
      const idx = subject != null && /^\d$/.test(subject) ? Number(subject) : -1;
      const day = idx >= 0 && idx < 7 ? DAYS[idx]! : "";
      return day ? day.charAt(0).toUpperCase() + day.slice(1) : "Openingstijden";
    }
    case "phone":
      return "Telefoon";
    case "address":
      return "Adres";
    case "website":
      return "Website";
    case "service":
      return subject ? `Dienst: ${subject}` : "Diensten";
    case "price":
      return subject ? `Prijs: ${subject}` : "Prijzen";
    case "policy":
      return subject ? `Beleid: ${subject}` : "Beleid";
    case "payment":
      return "Betalen";
    case "area":
      return subject ? `Werkgebied: ${subject}` : "Werkgebied";
    case "urgency":
      return "Spoed";
    case "credential":
      return subject ? `Erkenning: ${subject}` : "Erkenningen";
    case "identity":
      return "Naamgenoot";
    default:
      return "Gegevens";
  }
}

/** Normalised value → Dutch wording. "closed" → "gesloten", "yes" → "ja", "09:00-17:00" → "09:00 tot 17:00". */
export function valueNl(factKey: FactKey, value: string): string {
  const v = value.trim();
  if (v === NOT_FOUND_LABEL || v === NOT_FOUND_VALUE) return NOT_FOUND_LABEL;
  if (v === ABSENT_LABEL || v === ABSENT_VALUE) return ABSENT_LABEL;
  if (v === PRESENT_VALUE) return "genoemd";
  const lower = v.toLowerCase();
  if (factKey === "identity") {
    if (lower === "no" || lower === "nee") return "een ander bedrijf";
    if (lower === "yes" || lower === "ja") return "hetzelfde bedrijf";
  }
  if (factKey === "existence") {
    if (["closed", "permanently_closed", "permanent gesloten", "permanently closed"].includes(lower)) return "definitief gesloten";
    if (["temporarily_closed", "temporarily closed"].includes(lower)) return "tijdelijk gesloten";
    if (["open", "exists", "yes"].includes(lower)) return "open";
  }
  if (lower === "closed" || lower === "gesloten") return "gesloten";
  if (lower === "yes" || lower === "ja") return "ja";
  if (lower === "no" || lower === "nee") return "nee";
  const hours = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(v);
  if (hours) return `${hours[1]} tot ${hours[2]}`;
  if (factKey === "price" && /^\d+(\.\d+)?$/.test(v)) return `€ ${Number(v).toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;
  return v;
}

export interface FindingWordsNl {
  what: string; // "de openingstijden op zondag"
  field: string; // "Zondag"
  wrong: string; // "gesloten", or "niet gevonden" for a not_found finding
  correct: string; // "10:00 tot 16:00"
  frequency: string; // "7 van de 10 keer"
  /** true when the engine said it has no information (verdict not_found) */
  notFound: boolean;
  /** "ChatGPT vond niets over de openingstijden op zondag" style line for not_found; empty otherwise */
  notFoundLine: string;
  /** true when the finding comes from a recommendation question (the business was not named) */
  recommendation: boolean;
}

export function findingWordsNl(f: Pick<Finding, "factKey" | "subject" | "wrongValue" | "correctValue" | "frequency" | "sampleCount"> & Partial<Pick<Finding, "verdict" | "evidenceKind">>): FindingWordsNl {
  const notFound = f.verdict === "not_found" || f.wrongValue === NOT_FOUND_LABEL || f.wrongValue === NOT_FOUND_VALUE;
  const recommendation = f.evidenceKind === "recommendation" || f.wrongValue === ABSENT_LABEL || f.wrongValue === ABSENT_VALUE;
  const what = factLabelNl(f.factKey, f.subject);
  return {
    what,
    field: factFieldNl(f.factKey, f.subject),
    wrong: notFound ? NOT_FOUND_LABEL : recommendation ? ABSENT_LABEL : valueNl(f.factKey, f.wrongValue),
    correct: recommendation && f.factKey === "existence" && f.subject && INTENT_LABEL[f.subject] ? "je bent open en werkt in deze plaats" : valueNl(f.factKey, f.correctValue),
    frequency: `${f.frequency} van de ${f.sampleCount} keer`,
    notFound,
    notFoundLine: notFound ? `vond niets over ${what}` : "",
    recommendation,
  };
}

/** "AI vindt niets over je" style count line for reports: "3 vragen: AI vindt niets over je". */
export function notFoundCountNl(n: number): string {
  return `${n} ${n === 1 ? "vraag" : "vragen"}: AI vindt niets over je`;
}

/** One calm sentence per visibility state for e-mails. */
export function visibilityLineNl(visibility: "found" | "partial" | "unknown", name: string): string {
  switch (visibility) {
    case "unknown":
      return `AI vindt (bijna) niets over ${name}. Je bestaat niet in het antwoord.`;
    case "partial":
      return `AI kent ${name} maar half: een deel van de antwoorden is leeg.`;
    default:
      return "";
  }
}

export function hostOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
