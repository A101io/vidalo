/**
 * Claim extraction: turn an engine's free-text Dutch answer into atomic claims
 * keyed to FactKey/subject with normalised values (see normalize.ts for the
 * value space).
 *
 * Two strategies:
 *  - LLM (OpenAI chat completion, model EXTRACTION_MODEL, strict JSON schema
 *    validated with zod) when an OPENAI_API_KEY exists and VIDALO_MOCK != 1.
 *  - Rules (regexes for phone numbers, "gesloten"/"open", time ranges, ja/nee)
 *    in mock mode, so the pipeline works offline. Also the fallback when the
 *    LLM call fails.
 */
import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";
import { HOME_COUNTRY } from "../shared/country";
import { z } from "zod";
import { ABSENT_VALUE, FACT_KEYS, NOT_FOUND_VALUE, PRESENT_VALUE, type Claim, type FactKey, type Facts, type Prompt } from "../types";
import {
  DAY_NAMES_NL,
  normalizeAddress,
  normalizePhone,
  normalizePrice,
  normalizeTime,
  normalizeWebsite,
} from "./normalize";
import { retry } from "./util";

export type ExtractMode = "rules" | "llm";

export interface ExtractOptions {
  sampleId?: string;
  mode?: ExtractMode;
}

export type PromptLike = Pick<Prompt, "category" | "probes" | "textNl"> & Partial<Pick<Prompt, "kind" | "criterium">>;

export function isRecommendationPrompt(prompt: PromptLike): boolean {
  return prompt.kind === "recommendation";
}

// ---------------------------------------------------------------------------
// Recommendation answers: is the business named at all?
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set(["de", "het", "een", "van", "der", "den", "en", "bv", "b.v.", "vof", "v.o.f.", "nv", "the", "&", "in", "te", "op", "aan", "bij"]);

/** Lowercase, strip diacritics, punctuation and legal suffixes. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(b\.?v\.?|v\.?o\.?f\.?|n\.?v\.?|cv|eenmanszaak)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/**
 * Does the answer name this business? Exact match on the normalised name, or
 * most of its distinctive words (and, when the name is a single common word,
 * the place as well). Never looks at position or count.
 */
export function mentionsBusiness(answerText: string, facts: Pick<Facts, "name" | "place">): boolean {
  const answer = ` ${normalizeName(answerText)} `;
  const full = normalizeName(facts.name);
  if (!full) return false;
  const tokens = nameTokens(facts.name);
  // One distinctive word only ("Jansen"): ask for the place too so a namesake elsewhere does not count.
  const placeOk = tokens.length > 1 || answer.includes(` ${normalizeName(facts.place)} `);
  if (answer.includes(` ${full} `)) return placeOk;
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => answer.includes(` ${t} `) || answer.includes(` ${t}s `)).length;
  const needed = Math.max(1, Math.ceil(tokens.length * 0.6));
  return hits >= needed && placeOk;
}

/**
 * The single claim for a recommendation answer: PRESENT_VALUE when the
 * business is named, ABSENT_VALUE otherwise, keyed to the prompt's probe so
 * compare.ts can hang the finding on the linked criterium.
 */
export function extractRecommendation(answerText: string, facts: Facts, prompt: PromptLike, sampleId = ""): Claim[] {
  const first = prompt.probes[0] ?? prompt.category;
  const { factKey, subject } = parseProbe(first);
  const present = mentionsBusiness(answerText, facts);
  return [{ sampleId, factKey, subject, value: present ? PRESENT_VALUE : ABSENT_VALUE, confidence: 0.8, otherEntity: false, rawQuote: answerText.trim().slice(0, 300) }];
}

/** Pick the extraction mode from the environment. */
export function defaultExtractMode(): ExtractMode {
  if (process.env.VIDALO_MOCK === "1") return "rules";
  return process.env.OPENAI_API_KEY ? "llm" : "rules";
}

/** Split a probe like "hours.6" / "service:verhuur" / "phone" into key + subject. */
export function parseProbe(probe: string): { factKey: FactKey; subject: string | null } {
  const m = probe.match(/^([a-z_]+)(?:[.:](.*))?$/);
  const factKey = (m?.[1] ?? probe) as FactKey;
  const subject = m?.[2] ?? null;
  return { factKey, subject: subject === "" ? null : subject };
}

// ---------------------------------------------------------------------------
// Not found: the engine says it has no information about the business
// ---------------------------------------------------------------------------

/**
 * Phrases (Dutch + English) with which an engine says it knows nothing about
 * the business. "bestaat niet meer" is excluded: that is a (wrong or right)
 * claim that the business closed, not an absence of information.
 */
export const NOT_FOUND_PATTERNS: RegExp[] = [
  /geen informatie/i,
  /kan ik niet vinden/i,
  /kon ik niet vinden/i,
  /ik kon geen/i,
  /ik kan geen/i,
  /niet bekend/i,
  /ken ik niet/i,
  /geen gegevens/i,
  /bestaat (?:mogelijk )?niet\b(?! meer)/i,
  /i couldn'?t find/i,
  /i could not find/i,
  /no information/i,
  /i don'?t have (?:any )?information/i,
  /i do not have (?:any )?information/i,
];

/** Does the answer say the engine has no information about the business? */
export function looksNotFound(answerText: string): boolean {
  return NOT_FOUND_PATTERNS.some((re) => re.test(answerText));
}

/** Does the answer carry anything that looks like a business fact (phone, time range, price, street address, URL, open/closed)? */
export function namesBusinessFacts(answerText: string): boolean {
  return (
    PHONE_RE.test(answerText) ||
    TIME_RANGE.test(answerText) ||
    PRICE_RE.test(answerText) ||
    STREET_RE.test(answerText) ||
    /(?:https?:\/\/|www\.)[a-z0-9-]+\./i.test(answerText) ||
    /\b(?:geopend|gesloten|open van)\b/i.test(answerText)
  );
}

/** The sentinel claim that marks a sample as "not found". Keyed to the prompt category; subject = the first probe's subject. */
export function notFoundClaim(prompt: PromptLike, sampleId = "", confidence = 0.9, rawQuote = ""): Claim {
  const first = prompt.probes[0] ?? prompt.category;
  const { subject } = parseProbe(first);
  return { sampleId, factKey: prompt.category, subject, value: NOT_FOUND_VALUE, confidence, otherEntity: false, rawQuote: rawQuote.trim().slice(0, 300) };
}

export function isNotFoundClaim(c: Pick<Claim, "value">): boolean {
  return c.value === NOT_FOUND_VALUE;
}

// ---------------------------------------------------------------------------
// Rule-based extractor
// ---------------------------------------------------------------------------

const NL_CITIES = [
  "Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Tilburg", "Almere", "Breda", "Nijmegen",
  "Apeldoorn", "Haarlem", "Arnhem", "Enschede", "Amersfoort", "Zaanstad", "Haarlemmermeer", "Den Bosch", "'s-Hertogenbosch",
  "Zwolle", "Zoetermeer", "Leiden", "Leeuwarden", "Maastricht", "Dordrecht", "Ede", "Alphen aan den Rijn", "Alkmaar",
  "Emmen", "Delft", "Venlo", "Deventer", "Westland", "Helmond", "Hilversum", "Heerlen", "Amstelveen", "Oss", "Purmerend",
  "Roosendaal", "Hoorn", "Gouda", "Schiedam", "Lelystad", "Vlaardingen", "Almelo", "Spijkenisse", "Assen", "Bergen op Zoom",
  "Capelle aan den IJssel", "Veenendaal", "Katwijk", "Zeist", "Nieuwegein", "Hengelo", "Roermond", "Middelburg", "Vlissingen",
  "Doetinchem", "Hoofddorp", "Zutphen", "Harderwijk", "Weert", "Kampen", "Heerenveen", "Sneek", "Tiel", "Woerden", "Gorinchem",
];

/** Does the answer talk about the same-named business in another town? */
export function detectOtherEntity(answer: string, facts: Facts): boolean {
  const place = facts.place.toLowerCase();
  const lower = answer.toLowerCase();
  if (/dit gaat over .+ in [A-Z]/.test(answer) && !lower.includes(`dit gaat over ${facts.name.toLowerCase()} in ${place}`)) return true;
  const area = new Set((facts.serviceArea?.places ?? []).map((p) => p.toLowerCase()));
  for (const city of NL_CITIES) {
    if (city.toLowerCase() === place || area.has(city.toLowerCase())) continue;
    const re = new RegExp(`\\bin ${city.replace(/[-'. ]/g, (c) => `\\${c}`)}\\b`, "i");
    if (re.test(answer) && !lower.includes(`niet in ${city.toLowerCase()}`)) return true;
  }
  return false;
}

const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:uur)?`;
const TIME_RANGE = new RegExp(`${TIME}\\s*(?:tot(?: en met)?|-|–|t/m|to|until|till)\\s*${TIME}`, "i");
const PHONE_RE = /(?:\+31|0031|0)\s?[1-9](?:[\s-]?\d){8}\b/;

/** The first phone number in an answer: Dutch notation for NL businesses, any notation of the country elsewhere. */
function findPhone(text: string, country: string | undefined): { number: string; quote: string } | null {
  if ((country ?? HOME_COUNTRY) === HOME_COUNTRY) {
    const m = text.match(PHONE_RE);
    const n = m ? normalizePhone(m[0]) : null;
    return n ? { number: n, quote: m![0] } : null;
  }
  const found = findPhoneNumbersInText(text, country as CountryCode)[0];
  return found ? { number: found.number.number, quote: text.slice(found.startsAt, found.endsAt) } : null;
}
const PRICE_RE = /€\s?(\d+(?:[.,]\d{1,2})?)/;
const STREET_RE = /([A-Z][\p{L}.'-]*(?:\s(?:[A-Z][\p{L}.'-]*|de|van|der|den|het|'t|aan|op))*\s\d+[a-zA-Z]?(?:-\d+)?)(?:,?\s*(\d{4}\s?[A-Z]{2}))?(?:,?\s*([A-Z][\p{L}-]+))?/u;
const NO_RE = /^\s*nee\b|\bgeen\b|\bniet\b|alleen contant|\bnee,|^\s*no\b|\bnot\b|\bdoes(?:n't| not)\b|cash only/i;
const YES_RE = /^\s*ja\b|\bja,|\book\b|\bwel\b|\bgewoon\b|\bbiedt\b|\bdoet\b|\bmogelijk\b|\bkun je\b|^\s*yes\b|\boffers\b|\byou can\b|\bavailable\b/i;
const DAY_NAMES_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** The sentence(s) of the answer that mention a given day. */
function daySegment(answer: string, day: number): string | null {
  const names = [DAY_NAMES_NL[day]!, DAY_NAMES_EN[day]!];
  const parts = answer.split(/(?<=[.;\n])|,\s*(?=(?:op|on)\s)/i);
  const seg = parts.find((p) => names.some((n) => p.toLowerCase().includes(n)));
  return seg ?? null;
}

function hoursFromSegment(seg: string): string | null {
  const range = seg.match(TIME_RANGE);
  if (range) {
    const a = normalizeTime(range[1]!);
    const b = normalizeTime(range[2]!);
    if (a && b) return `${a}-${b}`;
  }
  if (/gesloten|dicht|\bclosed\b/i.test(seg)) return "closed";
  return null;
}

function yesNo(answer: string): "yes" | "no" | null {
  if (NO_RE.test(answer)) return "no";
  if (YES_RE.test(answer)) return "yes";
  return null;
}

export function extractClaimsRules(answerText: string, facts: Facts, prompt: PromptLike, sampleId = ""): Claim[] {
  if (isRecommendationPrompt(prompt)) return extractRecommendation(answerText, facts, prompt, sampleId);
  if (looksNotFound(answerText)) return [notFoundClaim(prompt, sampleId, 0.9, answerText)];
  const claims: Claim[] = [];
  // An identity question ("is X in Y hetzelfde als X in Z?") names the other place by design.
  const otherEntity = prompt.category === "identity" || prompt.category === "area" ? false : detectOtherEntity(answerText, facts);
  const lower = answerText.toLowerCase();
  const push = (factKey: FactKey, subject: string | null, value: string, rawQuote: string, confidence = 0.7) => {
    if (claims.some((c) => c.factKey === factKey && c.subject === subject)) return;
    claims.push({ sampleId, factKey, subject, value, confidence, otherEntity, rawQuote: rawQuote.trim().slice(0, 300) });
  };
  const probes = prompt.probes.length ? prompt.probes : [prompt.category];

  for (const probe of probes) {
    const { factKey, subject } = parseProbe(probe);
    switch (factKey) {
      case "existence": {
        if (/permanent gesloten|definitief gesloten|voorgoed gesloten|bestaat niet meer|niet meer actief|is gesloten\b(?! op)|gestopt|failliet|permanently closed|closed down|no longer (?:exists|operating|in business)|has closed\b|went bankrupt/.test(lower)) {
          push("existence", null, "permanently_closed", answerText);
        } else if (/tijdelijk gesloten|tijdelijk dicht|temporarily closed/.test(lower)) {
          push("existence", null, "temporarily_closed", answerText);
        } else if (/nog (gewoon |steeds )?open|is (gewoon )?open|bestaat nog|ontvangt klanten|nog actief|gewoon geopend|is still open|still exists|still operating|is open\b/.test(lower) || (/^\s*(?:ja|yes)\b/.test(lower) && !/permanent/.test(prompt.textNl.toLowerCase()))) {
          push("existence", null, "open", answerText);
        } else if (/^\s*(?:nee|no)\b/.test(lower)) {
          // "Nee" to "Is X permanent gesloten?" means open; "Nee" to "Is X nog open?" means closed.
          push("existence", null, /permanent/.test(prompt.textNl.toLowerCase()) ? "open" : "permanently_closed", answerText);
        }
        break;
      }
      case "hours": {
        const days = subject != null ? [Number(subject)] : [0, 1, 2, 3, 4, 5, 6];
        for (const day of days) {
          const seg = daySegment(answerText, day);
          let value: string | null = null;
          let quote = seg ?? answerText;
          if (seg) value = hoursFromSegment(seg);
          else if (subject != null && days.length === 1) {
            // Single-day prompt whose answer does not repeat the day name.
            value = hoursFromSegment(answerText);
            if (!value && /^\s*(?:nee|no)\b/.test(lower)) value = "closed";
            if (!value && /^\s*(?:ja|yes)\b/.test(lower)) value = null; // "ja, open" without times is not a checkable claim
            quote = answerText;
          }
          if (value) push("hours", String(day), value, quote);
        }
        break;
      }
      case "phone": {
        const m = findPhone(answerText, facts.country);
        if (m) push("phone", null, m.number, m.quote, 0.9);
        break;
      }
      case "address": {
        const m = answerText.match(STREET_RE);
        if (m) {
          const norm = normalizeAddress([m[1], m[2], m[3]].filter(Boolean).join(" "));
          if (norm) push("address", null, norm, m[0]);
        }
        break;
      }
      case "website": {
        const m = answerText.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:\/\S*)?/i);
        const host = m ? normalizeWebsite(m[0]) : null;
        if (host && !/google\.|bing\.|openingstijden\.|telefoonboek\./.test(host)) push("website", null, host, m![0]);
        break;
      }
      case "service":
      case "policy":
      case "payment":
      case "area":
      case "credential":
      case "identity": {
        const v = yesNo(answerText);
        if (v && subject) push(factKey, subject, v, answerText);
        break;
      }
      case "urgency": {
        const v = yesNo(answerText);
        if (v) push("urgency", null, v, answerText);
        break;
      }
      case "price": {
        const m = answerText.match(PRICE_RE);
        const norm = m ? normalizePrice(m[1]!) : null;
        if (norm && subject) push("price", subject, norm, m![0]);
        break;
      }
    }
  }
  return claims;
}

// ---------------------------------------------------------------------------
// LLM extractor
// ---------------------------------------------------------------------------

const ClaimSchema = z.object({
  factKey: z.enum(FACT_KEYS as [FactKey, ...FactKey[]]),
  subject: z.string().nullable(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  otherEntity: z.boolean(),
  rawQuote: z.string(),
});
const ExtractionSchema = z.object({ claims: z.array(ClaimSchema) });

/** JSON schema handed to the model (strict mode: every property required, no extras). */
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factKey", "subject", "value", "confidence", "otherEntity", "rawQuote"],
        properties: {
          factKey: { type: "string", enum: FACT_KEYS },
          subject: { type: ["string", "null"], description: 'Sub-key: day index "0".."6" (0 = maandag) for hours, service/price/policy/credential name, "pin" for payment, place name for area, the other business for identity, else null.' },
          value: {
            type: "string",
            description:
              'Normalised: existence open|temporarily_closed|permanently_closed; hours "HH:MM-HH:MM" or "closed"; phone in E.164 ("+31201234567", "+442079460000"); address "straat nummer postcode plaats"; website hostname; service/policy/payment/area/urgency/credential yes|no; identity yes (same business) | no (different business); price decimal number.',
          },
          confidence: { type: "number" },
          otherEntity: { type: "boolean", description: "True when the answer is about a business with the same name in a different place." },
          rawQuote: { type: "string", description: "The exact fragment of the answer that carries the claim." },
        },
      },
    },
  },
} as const;

const EXTRACTION_SYSTEM = `Je haalt atomaire feitelijke beweringen over een bedrijf uit het antwoord van een AI-assistent.
Geef alleen beweringen die over de gevraagde feiten (probes) gaan en die controleerbaar zijn. Geen beweringen verzinnen.
Normaliseer waarden precies volgens het schema. Als het antwoord zegt dat het geen informatie heeft, geef dan geen bewering.
Als het antwoord over een ander bedrijf met dezelfde naam in een andere plaats gaat, zet otherEntity op true.`;

export async function extractClaimsLlm(answerText: string, facts: Facts, prompt: PromptLike, sampleId = ""): Promise<Claim[]> {
  const { openaiClient } = await import("./engines/chatgpt");
  const model = process.env.EXTRACTION_MODEL ?? "gpt-4.1-mini";
  const user = JSON.stringify(
    {
      bedrijf: { naam: facts.name, plaats: facts.place, land: facts.country ?? "NL" },
      vraag: prompt.textNl,
      probes: prompt.probes,
      antwoord: answerText,
    },
    null,
    1,
  );
  const completion = await retry(
    () =>
      openaiClient().chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "claims", strict: true, schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown> } },
      }),
    { retries: 2 },
  );
  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = ExtractionSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`extraction schema mismatch: ${parsed.error.message}`);
  // The model gives no claims and the answer names no facts: the engine knows nothing about the business.
  if (looksNotFound(answerText) || (parsed.data.claims.length === 0 && !namesBusinessFacts(answerText))) {
    return [notFoundClaim(prompt, sampleId, parsed.data.claims.length === 0 ? 0.9 : 0.7, answerText)];
  }
  const otherEntityHint = detectOtherEntity(answerText, facts);
  return parsed.data.claims.map((c) => ({
    sampleId,
    factKey: c.factKey,
    subject: c.subject,
    value: postNormalise(c.factKey, c.value, facts.country),
    confidence: c.confidence,
    otherEntity: c.otherEntity || otherEntityHint,
    rawQuote: c.rawQuote.slice(0, 300),
  }));
}

/** Second pass over LLM values so they land in the same value space as facts. */
function postNormalise(factKey: FactKey, value: string, country?: string): string {
  switch (factKey) {
    case "phone":
      return normalizePhone(value, country) ?? value;
    case "address":
      return normalizeAddress(value) ?? value;
    case "website":
      return normalizeWebsite(value) ?? value;
    case "price":
      return normalizePrice(value) ?? value;
    case "hours": {
      const v = value.toLowerCase().trim();
      if (v === "closed" || v === "gesloten") return "closed";
      const m = v.match(TIME_RANGE);
      if (m) {
        const a = normalizeTime(m[1]!);
        const b = normalizeTime(m[2]!);
        if (a && b) return `${a}-${b}`;
      }
      return v;
    }
    case "service":
    case "policy":
    case "payment":
    case "area":
    case "urgency":
    case "credential":
    case "identity": {
      const v = value.toLowerCase().trim();
      return v === "ja" ? "yes" : v === "nee" ? "no" : v;
    }
    default:
      return value.trim();
  }
}

/**
 * Extract claims from one answer. Uses the LLM when configured, falling back
 * to rules on failure; rules only in mock mode.
 */
export async function extractClaims(answerText: string, facts: Facts, prompt: PromptLike, opts: ExtractOptions = {}): Promise<Claim[]> {
  const sampleId = opts.sampleId ?? "";
  if (!answerText.trim()) return [];
  // A recommendation answer is judged on one thing (is the business named); no model needed.
  if (isRecommendationPrompt(prompt)) return extractRecommendation(answerText, facts, prompt, sampleId);
  const mode = opts.mode ?? defaultExtractMode();
  if (mode === "llm") {
    try {
      return await extractClaimsLlm(answerText, facts, prompt, sampleId);
    } catch (err) {
      console.warn(`[extract] LLM extraction failed, using rules: ${(err as Error).message}`);
    }
  }
  return extractClaimsRules(answerText, facts, prompt, sampleId);
}
