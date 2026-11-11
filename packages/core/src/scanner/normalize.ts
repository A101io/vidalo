/**
 * Normalisation helpers: bring owner facts and engine claims into the same
 * value space so compare.ts can do plain string comparisons.
 *
 * Value spaces per FactKey:
 *  - existence: "open" | "temporarily_closed" | "permanently_closed"
 *  - hours (subject = day 0..6): "closed" | "HH:MM-HH:MM"
 *  - phone: "+31XXXXXXXXX" (digits only after +31)
 *  - address: lowercased, punctuation stripped ("stationsplein 12 2011lr haarlem")
 *  - website: hostname without "www." ("bakkerijdevries.nl")
 *  - service / policy / payment (subject = name): "yes" | "no"
 *  - price (subject = label): decimal string ("12.5")
 *  - area (subject = place): "yes" | "no"   (werkgebied)
 *  - urgency: "yes" | "no"                   (spoed / beschikbaarheid)
 *  - credential (subject = name): "yes" | "no"
 *  - identity (subject = other business): "no" = a different business (the owner's position)
 *  - recommendation answers: PRESENT_VALUE | ABSENT_VALUE (is the business named)
 */
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_LABEL, NOT_FOUND_VALUE, PRESENT_VALUE, type FactKey, type Facts, type Hours } from "../types";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { HOME_COUNTRY } from "../shared/country";

export const DAY_NAMES_NL = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"] as const;

/** Day index (0 = Monday) for a Dutch day name, or null. */
export function dayIndexFromName(name: string): number | null {
  const i = DAY_NAMES_NL.findIndex((d) => d === name.toLowerCase().trim());
  return i === -1 ? null : i;
}

/**
 * Normalise a phone number to E.164 ("+31XXXXXXXXX", "+442079460000"). A number written with its
 * country code is read as such; a national one ("020-...", "030 1234 5678") is read in `country`
 * (the business's, default NL). Returns null if it does not look like a phone number.
 * Dutch numbers keep their own reader, which also accepts the "+31 (0)23" habit.
 */
export function normalizePhone(raw: string | null | undefined, country: string = HOME_COUNTRY): string | null {
  if (!raw) return null;
  const international = /^\s*(\+|00)/.test(raw) && !/^\s*(\+|00)\s*31/.test(raw);
  if (international || country !== HOME_COUNTRY) {
    const n = parsePhoneNumberFromString(raw.replace(/^\s*00/, "+").replace(/\(0\)/, ""), country as CountryCode);
    return n?.isValid() ? n.number : null;
  }
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("31")) digits = digits.slice(2);
  // National trunk prefix: "023-..." or the "(0)" in "+31 (0)23 ...".
  if (digits.startsWith("0")) digits = digits.slice(1);
  // Service numbers (0800, 0900, 0906, 0909) are 4 to 7 digits after the prefix: "0900-1511" (Conceptable, 11 Nov 2026).
  if (/^(?:800|90[069])\d{4,7}$/.test(digits)) return `+31${digits}`;
  // Dutch national significant number is 9 digits (landline + mobile).
  if (digits.length !== 9) return null;
  return `+31${digits}`;
}

/** Human-friendly display of a normalised phone: Dutch style for +31, international style otherwise. */
export function formatPhone(normalised: string): string {
  if (normalised.startsWith("+31")) return formatPhoneNl(normalised);
  return parsePhoneNumberFromString(normalised)?.formatInternational() ?? normalised;
}

/** Human-friendly Dutch display of a normalised phone ("+31231234567" -> "023-1234567"). */
export function formatPhoneNl(normalised: string): string {
  const d = normalised.replace(/^\+31/, "");
  if (d.startsWith("6")) return `06-${d.slice(1)}`;
  // 3-digit area codes (020, 010, 023, ...) vs 4-digit (0172, ...). Heuristic: the big cities use 2-digit codes.
  const twoDigit = ["10", "13", "15", "20", "23", "24", "26", "30", "33", "35", "36", "38", "40", "43", "45", "46", "50", "53", "55", "58", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79"];
  if (twoDigit.includes(d.slice(0, 2))) return `0${d.slice(0, 2)}-${d.slice(2)}`;
  return `0${d.slice(0, 3)}-${d.slice(3)}`;
}

/** "9:00" / "09.00" / "9 uur" / "9am" / "5:30 p.m." -> "09:00", "17:30". */
export function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(?:uur|([ap])\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  }
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function normalizeHours(h: Hours): string {
  if (h.closed || !h.open || !h.close) return "closed";
  return `${normalizeTime(h.open) ?? h.open}-${normalizeTime(h.close) ?? h.close}`;
}

/** Dutch name particles stay lowercase inside a street or town name ("Laan van Meerdervoort"). */
const PARTICLES = new Set(["van", "der", "den", "de", "het", "aan", "op", "in", "bij", "te", "ten", "ter", "'t", "en"]);

/**
 * A normalised Dutch address back in the way people write it: "factorij 80 3071av rotterdam"
 * -> "Factorij 80, 3071 AV Rotterdam". The report showed the lowercase form (Sonable, 11 Nov 2026).
 * Anything that is not a Dutch street + postcode stays as it is.
 */
export function displayAddress(value: string): string {
  const v = value.trim();
  if (v.length > 200) return v;
  const m = v.match(/^([^\d]{1,120}?\d{1,5}[ ]?[a-z]?)[ ]+(\d{4})[ ]?([a-z]{2})(?:[ ]+([^\d]{1,80}))?$/i);
  if (!m) return v;
  const cap = (s: string) =>
    s
      .split(" ")
      .map((w, i) => (i > 0 && PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
      .join(" ");
  const [, street, digits, letters, town] = m;
  return `${cap(street!)}, ${digits} ${letters!.toUpperCase()}${town ? ` ${cap(town)}` : ""}`;
}

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .replace(/[.,;:'"()]/g, " ")
    .replace(/(\d{4})\s+([a-z]{2})\b/g, "$1$2") // "2011 LR" -> "2011lr"
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizePrice(raw: string | number): string | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d,.]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

/** Words that count as "pin / card payment" in paymentMethods or policies. */
const PIN_WORDS = ["pin", "pinnen", "pinpas", "debitcard", "debit", "maestro", "kaart", "card", "contactloos", "ideal"];

/** Does the profile hold an offer that rests on something other than the AI lookup? */
function kindIsGrounded(facts: Facts): boolean {
  const p = facts.profile;
  if (!p || !p.grounded || !p.offer) return false;
  return !(p.basis.length > 0 && p.basis.every((b) => b === "ai_lookup"));
}


/**
 * The owner-asserted value for a (factKey, subject) in the normalised value
 * space, or null when the facts do not say anything about it (skip compare).
 */
export function factValue(facts: Facts, factKey: FactKey, subject: string | null): string | null {
  switch (factKey) {
    case "existence":
      return facts.openStatus;
    case "hours": {
      if (subject == null) return null;
      const day = Number(subject);
      const h = facts.hours.find((x) => x.day === day);
      return h ? normalizeHours(h) : null;
    }
    case "phone":
      return normalizePhone(facts.phone, facts.country);
    case "address":
      // A town alone is no address: without street and number every address in that town would match (Sonable, 11 Nov 2026).
      return facts.address ? normalizeAddress([facts.address, facts.postcode, facts.place].filter(Boolean).join(" ")) : null;
    case "website":
      return normalizeWebsite(facts.website);
    case "service": {
      if (!subject) return null;
      const s = normalizeLabel(subject);
      if (facts.servicesYes.some((x) => normalizeLabel(x) === s)) return "yes";
      if (facts.servicesNo.some((x) => normalizeLabel(x) === s)) return "no";
      return null;
    }
    case "price": {
      if (!subject) return null;
      const s = normalizeLabel(subject);
      const p = facts.prices.find((x) => normalizeLabel(x.label) === s);
      return p ? normalizePrice(p.amount) : null;
    }
    case "policy": {
      if (!subject) return null;
      const s = normalizeLabel(subject);
      return facts.policies.some((x) => normalizeLabel(x) === s) ? "yes" : null;
    }
    case "payment": {
      if (!subject) return null;
      const s = normalizeLabel(subject);
      const methods = facts.paymentMethods.map(normalizeLabel);
      const policies = facts.policies.map(normalizeLabel);
      if (s === "pin") {
        if (methods.some((m) => PIN_WORDS.some((w) => m.includes(w)))) return "yes";
        if (policies.some((p) => p.includes("pinnen mogelijk") || p.includes("pin mogelijk"))) return "yes";
        if (policies.some((p) => p.includes("alleen contant")) || methods.length > 0) return "no";
        return null;
      }
      if (methods.length === 0) return null;
      return methods.some((m) => m.includes(s)) ? "yes" : "no";
    }
    case "area": {
      const area = facts.serviceArea;
      if (!area) return null;
      if (!subject) return area.places.length || area.radiusKm != null ? "yes" : null;
      const s = normalizeLabel(subject);
      if (s === normalizeLabel(facts.place)) return "yes";
      if (area.places.some((p) => normalizeLabel(p) === s)) return "yes";
      // A place outside the list: only a "no" when the owner listed places and gave no radius.
      if (area.places.length && area.radiusKm == null) return "no";
      return null;
    }
    case "urgency":
      return facts.urgency ? (facts.urgency.available ? "yes" : "no") : null;
    case "credential": {
      if (!subject) return facts.credentials?.length ? "yes" : null;
      const s = normalizeLabel(subject);
      return facts.credentials?.some((c) => normalizeLabel(c) === s) ? "yes" : null;
    }
    case "identity":
      // "wat doet X": only a grounded offer (Google, the business's own site, the owner) is a reference.
      // An offer that came from the AI lookup alone would grade the AI against itself (ADR-0005).
      if (subject === "kind") return kindIsGrounded(facts) ? "same" : null;
      // The owner's position is always: that is a different business.
      return facts.notConfusedWith.length || subject ? "no" : null;
  }
}

/** Expected value for a recommendation prompt: the business should be named. */
export const RECOMMENDATION_EXPECTED = PRESENT_VALUE;

/** Does a claimed value agree with the owner value? Some keys compare fuzzily. */
export function valuesMatch(factKey: FactKey, claimed: string, expected: string): boolean {
  const a = claimed.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  if (a === b) return true;
  switch (factKey) {
    case "address": {
      // Street + house number is the load-bearing part; postcode/place may be omitted by the engine.
      const streetA = a.match(/^(.+?\d+\s?[a-z]?)\b/)?.[1]?.trim();
      const streetB = b.match(/^(.+?\d+\s?[a-z]?)\b/)?.[1]?.trim();
      if (streetA && streetB) return streetA === streetB || a.includes(streetB) || b.includes(streetA);
      return a.includes(b) || b.includes(a);
    }
    case "price": {
      const x = Number(a);
      const y = Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      return Math.abs(x - y) <= Math.max(0.05, y * 0.01);
    }
    case "website":
      return a.replace(/^www\./, "") === b.replace(/^www\./, "");
    default:
      return false;
  }
}

/** Dutch, human readable rendering of a normalised value (used in summaries). */
export function describeValue(factKey: FactKey, value: string, subject: string | null): string {
  if (value === NOT_FOUND_LABEL || value === NOT_FOUND_VALUE) return NOT_FOUND_LABEL;
  if (value === ABSENT_VALUE || value === ABSENT_LABEL) return ABSENT_LABEL;
  if (value === PRESENT_VALUE) return "genoemd";
  switch (factKey) {
    case "existence":
      return value === "open" ? "open" : value === "temporarily_closed" ? "tijdelijk gesloten" : "permanent gesloten";
    case "hours": {
      const day = subject != null ? DAY_NAMES_NL[Number(subject)] : "";
      return value === "closed" ? `${day} gesloten` : `${day} ${value.replace("-", " tot ")}`;
    }
    case "phone":
      return value.startsWith("+") ? formatPhone(value) : value;
    case "service":
    case "policy":
    case "payment":
    case "area":
    case "urgency":
    case "credential":
      return value === "yes" ? "ja" : value === "no" ? "nee" : value;
    case "identity":
      return value === "no" ? "een ander bedrijf" : value === "yes" ? "hetzelfde bedrijf" : value === "other" ? "een ander soort bedrijf" : value === "same" ? "dit soort bedrijf" : value;
    case "price":
      return `€ ${value.replace(".", ",")}`;
    default:
      return value;
  }
}

/** Human readable Dutch label for a (factKey, subject) pair. */
export function describeFact(factKey: FactKey, subject: string | null): string {
  switch (factKey) {
    case "existence":
      return "open of gesloten";
    case "hours":
      return subject != null ? `openingstijden ${DAY_NAMES_NL[Number(subject)]}` : "openingstijden";
    case "phone":
      return "telefoonnummer";
    case "address":
      return "adres";
    case "website":
      return "website";
    case "service":
      return `dienst: ${subject ?? ""}`;
    case "price":
      return `prijs: ${subject ?? ""}`;
    case "policy":
      return `voorwaarde: ${subject ?? ""}`;
    case "payment":
      return subject === "pin" ? "pinnen" : `betalen: ${subject ?? ""}`;
    case "area":
      return subject ? `werkgebied: ${subject}` : "werkgebied";
    case "urgency":
      return "spoed en beschikbaarheid";
    case "credential":
      return subject ? `erkenning: ${subject}` : "erkenningen";
    case "identity":
      return subject === "kind" ? "wat het bedrijf doet" : subject ? `naamgenoot: ${subject}` : "naamgenoot";
  }
}

/** Build a URL-safe slug from name + place. */
export function slugify(...parts: string[]): string {
  return parts
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
