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
  factValue,
  lineKey,
  normalizeAddress,
  normalizeLabel,
  normalizePhone,
  normalizePrice,
  normalizeSpecValue,
  normalizeTime,
  normalizeWebsite,
  outletKey,
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
export function mentionsBusiness(answerText: string, facts: Pick<Facts, "name" | "place"> & Partial<Pick<Facts, "profile" | "productLine">>): boolean {
  const answer = ` ${normalizeName(answerText)} `;
  const full = normalizeName(facts.name);
  if (!full) return false;
  const tokens = nameTokens(facts.name);
  // One distinctive word only ("Jansen"): ask for the place too so a namesake elsewhere does not count.
  // An online business has no town: its name stands alone, so the place is not asked for. A product line is the same:
  // it has no town (feature 006), its name and the product's own words identify it.
  const placeOk = tokens.length > 1 || facts.profile?.mode === "online" || Boolean(facts.productLine) || answer.includes(` ${normalizeName(facts.place)} `);
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

/**
 * Softer phrasings (Sonable, 11 Nov 2026: "geen specifieke informatie", "niet direct
 * beschikbaar in de zoekresultaten"). They also occur as a hedge inside an answer that
 * does give facts ("het nummer kon ik niet vinden, maar het adres is …"), so they only
 * count when the answer names no business fact.
 */
export const SOFT_NOT_FOUND_PATTERNS: RegExp[] = [
  /geen (?:\p{L}+[ \t]+){1,2}(?:informatie|gegevens)/iu,
  /niet (?:direct |openbaar )?beschikbaar in de zoekresultaten/i,
  /(?:heb|kon|kan) [^.\n]{0,80}niet (?:kunnen )?vinden/i,
  /no (?:specific |detailed |current )information/i,
];

/** AI answers are third-party text: every pattern runs on a bounded prefix. */
const MATCH_LIMIT = 8000;

/** Does the answer say the engine has no information about the business? (The firm phrasings: they decide on their own.) */
export function looksNotFound(answerText: string): boolean {
  const text = answerText.slice(0, MATCH_LIMIT);
  return NOT_FOUND_PATTERNS.some((re) => re.test(text));
}

/**
 * A softer phrasing with no business fact in the answer. Only decides when the answer
 * gave no claim for the question asked: "Nee, je kunt er niet pinnen. Over creditcards
 * heb ik geen specifieke informatie." is a (wrong or right) answer, not "niets gevonden"
 * (QA round 2, 11 Nov 2026).
 */
export function looksSoftNotFound(answerText: string): boolean {
  const text = answerText.slice(0, MATCH_LIMIT);
  return SOFT_NOT_FOUND_PATTERNS.some((re) => re.test(text)) && !namesBusinessFacts(text);
}

/** Did the claims answer the question asked (any probe's fact key)? */
function answersProbe(claims: Pick<Claim, "factKey">[], prompt: PromptLike): boolean {
  const keys = new Set((prompt.probes.length ? prompt.probes : [prompt.category]).map((p) => parseProbe(p).factKey));
  return claims.some((c) => keys.has(c.factKey));
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

export const NL_CITIES = [
  "Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Tilburg", "Almere", "Breda", "Nijmegen",
  "Apeldoorn", "Haarlem", "Arnhem", "Enschede", "Amersfoort", "Zaanstad", "Haarlemmermeer", "Den Bosch", "'s-Hertogenbosch",
  "Zwolle", "Zoetermeer", "Leiden", "Leeuwarden", "Maastricht", "Dordrecht", "Ede", "Alphen aan den Rijn", "Alkmaar",
  "Emmen", "Delft", "Venlo", "Deventer", "Westland", "Helmond", "Hilversum", "Heerlen", "Amstelveen", "Oss", "Purmerend",
  "Roosendaal", "Hoorn", "Gouda", "Schiedam", "Lelystad", "Vlaardingen", "Almelo", "Spijkenisse", "Assen", "Bergen op Zoom",
  "Capelle aan den IJssel", "Veenendaal", "Katwijk", "Zeist", "Nieuwegein", "Hengelo", "Roermond", "Middelburg", "Vlissingen",
  "Doetinchem", "Hoofddorp", "Zutphen", "Harderwijk", "Weert", "Kampen", "Heerenveen", "Sneek", "Tiel", "Woerden", "Gorinchem",
];

/** Words that say what kind of business it is, not which one: they do not identify it. */
const GENERIC_NAME_WORDS = new Set(["bakkerij", "bakker", "restaurant", "cafe", "eetcafe", "kapsalon", "kapper", "salon", "garage", "autobedrijf", "installatiebedrijf", "loodgieter", "schildersbedrijf", "praktijk", "tandarts", "fysiotherapie", "advocaten", "notaris", "makelaar", "makelaardij", "winkel", "shop", "studio", "de", "het", "een", "van", "en", "bv", "nv", "b", "v", "the", "and"]);

/** The words of a business name that identify it: lowercase, no accents, generic words and suffixes ("| Ambachtelijk brood") left out. */
export function nameCore(name: string): string[] {
  const head = name.split(/\s[|·–-]\s|\s\|/)[0] ?? name;
  const words = head
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  return words.length ? words : head.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The answer is headed by another business: ChatGPT's map-card heading
 * ("## [Sonova Retail Support Centre B.V.](…)") names a business that shares no
 * identifying word with this one, and the answer never uses this name. ChatGPT
 * answered Sonable's address question with Sonova's address this way (11 Nov 2026).
 * Only the heading counts: a company mentioned in passing ("betalen via Worldline
 * B.V.") says nothing about whom the answer is about.
 */
export function namesOnlyAnotherBusiness(answer: string, name: string): boolean {
  const text = answer.slice(0, MATCH_LIMIT);
  const heading = text.match(/^[ \t]*#{1,6}[ \t]*\[([^\]\n]{1,200})\]/m)?.[1];
  if (!heading) return false;
  const core = nameCore(name);
  if (!core.length) return false;
  const words = (s: string) => new Set(s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u));
  const inHeading = words(heading);
  const inAnswer = words(text);
  if (core.some((w) => inHeading.has(w) || inAnswer.has(w))) return false;
  // "Haar Zaken Kappers" for "Kapsalon Haarzaken", "Hair Lab" for "HairLab": the same letters, other spacing.
  const letters = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const joined = letters(core.join(""));
  const head = letters(heading);
  if (joined.length >= 4 && (head.includes(joined) || (head.length >= 4 && joined.includes(head)))) return false;
  return true;
}

/** Does the answer talk about the same-named business in another town, or lead with another business? */
export function detectOtherEntity(answer: string, facts: Facts): boolean {
  // A product line has no namesake judging (ADR-0010): no town, and no criterium 11 finding for it.
  if (facts.productLine) return false;
  const place = facts.place.toLowerCase();
  const lower = answer.toLowerCase();
  if (namesOnlyAnotherBusiness(answer, facts.name)) return true;
  // The town is not the identity of an online business: "gevestigd in Amsterdam" says nothing about whom the answer is about.
  if (facts.profile?.mode === "online") return false;
  if (/dit gaat over .+ in [A-Z]/.test(answer) && !lower.includes(`dit gaat over ${facts.name.toLowerCase()} in ${place}`)) return true;
  const area = new Set((facts.serviceArea?.places ?? []).map((p) => p.toLowerCase()));
  for (const city of NL_CITIES) {
    if (city.toLowerCase() === place || area.has(city.toLowerCase())) continue;
    const re = new RegExp(`\\bin ${city.replace(/[-'. ]/g, (c) => `\\${c}`)}\\b`, "i");
    if (re.test(answer) && !lower.includes(`niet in ${city.toLowerCase()}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// "Wat doet X?": is the business described as the kind of business it is?
// ---------------------------------------------------------------------------

const KIND_STOPWORDS = new Set([
  "voor", "met", "een", "het", "van", "naar", "bedrijf", "bedrijven", "aanbieder", "aanbieders", "organisatie", "wordt", "deze", "dient", "doet",
  "maar", "zijn", "ook", "onder", "over", "dat", "die", "heeft", "hebben", "kunnen", "kunt", "waar", "waarbij", "gevestigd", "bieden", "biedt",
  "that", "with", "from", "this", "company", "provider", "business", "their", "which", "offers", "offer", "your",
]);

/** Kinds of business an answer can wrongly call this one. Short on purpose: a word outside the list never decides. */
const OTHER_KINDS = ["winkel", "shop", "webshop", "restaurant", "kapper", "hoortoestel", "audicien", "makelaar", "bakkerij", "garage", "store", "hearing"];

function contentWords(text: string, drop: Set<string>): string[] {
  return normalizeName(text.slice(0, MATCH_LIMIT))
    .split(" ")
    .filter((w) => w.length >= 4 && !KIND_STOPWORDS.has(w) && !drop.has(w));
}

/** The same word, allowing a plural or a compound end ("winkel" / "winkels"): one starts with the other. */
function sameStem(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * Reads a "wat doet X" answer against the profile: "same" when it shares a content
 * word with the offer or category, "other" when it calls the business one of a short
 * list of other kinds that the offer does not contain, else null (nothing to judge).
 * Bounded prefix; no backtracking pattern.
 */
export function kindClaimFromAnswer(answer: string, facts: Pick<Facts, "name"> & Partial<Pick<Facts, "profile">>): "same" | "other" | null {
  const profile = facts.profile;
  if (!profile) return null;
  const reference = [profile.offer, profile.category].filter(Boolean).join(" ");
  if (!reference) return null;
  const own = new Set(nameTokens(facts.name));
  const refWords = contentWords(reference, own);
  const answerWords = contentWords(answer, own);
  if (refWords.some((r) => answerWords.some((a) => sameStem(r, a)))) return "same";
  const named = OTHER_KINDS.find((k) => answerWords.some((a) => a === k || (a.startsWith(k) && a.length <= k.length + 2)));
  if (named && !refWords.some((r) => sameStem(r, named))) return "other";
  return null;
}

const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:uur)?`;
const TIME_RANGE = new RegExp(`${TIME}\\s*(?:tot(?: en met)?|-|–|t/m|to|until|till)\\s*${TIME}`, "i");
const PHONE_RE = /(?:\+31|0031|0)\s?[1-9](?:[\s-]?\d){8}\b|\b0[89]00[\s-]?\d{3,7}\b/;

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

/** The answer without its hedge sentences ("Over creditcards heb ik geen specifieke informatie."). */
function withoutHedges(answerText: string): string {
  return answerText
    .slice(0, MATCH_LIMIT)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !SOFT_NOT_FOUND_PATTERNS.some((re) => re.test(s)))
    .join(" ");
}


// ---------------------------------------------------------------------------
// Product lines (feature 006): spec, certificate, outlet, successor
// ---------------------------------------------------------------------------

/** A number with a unit; a bounded window of an answer is searched, the pattern holds no owner text. */
const SPEC_VALUE_RE = /(\d{1,6}(?:[.,]\d{1,3})?)\s?(mg|kg|g|gr|grams?|kilo(?:gram)?s?|mm|cm|m|meters?|metres?|ml|cl|l|liters?|litres?|bar|mbar|w|kw|watt|v|volt|%|°c|dagen|days?|weken|weeks?|maanden|months?|jaar|years?|uur|hours?|stuks|pieces)(?![a-zA-Z])/i;
const SPEC_CODE_RE = /\b([A-Za-z]{1,4})[ -]?(\d{1,4})\b/;
const LINE_WINDOW = 200;
const NOT_AN_OUTLET = new Set(["tip", "tips", "let op", "conclusie", "samenvatting", "bronnen", "bron", "online", "offline", "note", "sources", "source", "summary", "options", "opties", "waar te koop", "where to buy", "webshop", "website", "winkels", "stores", "retailers"]);

/** The owner's spec value for a label in the line view, normalised, or null. */
function expectedSpec(facts: Facts, label: string): string | null {
  return factValue(facts, "spec", label);
}

/** What the answer says the value of `label` is: the owner's own value when the answer holds it, else a number with unit, a code, or the phrase after the label. */
export function specValueFromAnswer(answer: string, facts: Facts, label: string): { value: string; quote: string } | null {
  const text = answer.slice(0, MATCH_LIMIT);
  const lower = text.toLowerCase();
  const key = label.toLowerCase();
  const at = key ? lower.indexOf(key) : -1;
  const window = at >= 0 ? text.slice(at + key.length, at + key.length + LINE_WINDOW) : text.slice(0, LINE_WINDOW * 2);
  const expected = expectedSpec(facts, label);
  const numeric = expected != null && /^-?\d/.test(expected);
  if (expected != null && !numeric && normalizeSpecValue(lower.slice(0, LINE_WINDOW * 4)).includes(expected)) return { value: expected, quote: window.trim().slice(0, 200) };
  const m = SPEC_VALUE_RE.exec(window);
  if (m) return { value: normalizeSpecValue(`${m[1]} ${m[2]}`), quote: m[0] };
  if (!numeric) {
    const c = SPEC_CODE_RE.exec(window);
    if (c) return { value: normalizeSpecValue(`${c[1]}${c[2]}`), quote: c[0] };
    const phrase = window.replace(/^[\s:=,-]*(?:is|van|of|bedraagt|are|equals|heeft|has)\b[\s:=,-]*/i, "").split(/[.\n;]/)[0]!.trim().slice(0, 60);
    if (phrase.length >= 2 && at >= 0) return { value: normalizeSpecValue(phrase), quote: phrase };
  }
  return null;
}

/** Outlet names and hosts an answer names, ordered: those not in the owner's list first (the claim compare() judges), then the listed ones in the owner's spelling. */
export function outletValuesFromAnswer(answer: string, facts: Facts): string[] {
  const pl = facts.productLine;
  if (!pl) return [];
  const text = answer.slice(0, MATCH_LIMIT);
  const owners = pl.outlets.filter((o) => o.market === pl.market).map((o) => ({ name: o.name, key: outletKey(o.name), host: o.url ? normalizeWebsite(o.url) : null }));
  const own = new Set([outletKey(pl.brand), outletKey(facts.name), normalizeWebsite(facts.website) ?? ""].filter(Boolean));
  const found: { raw: string; host: boolean }[] = [];
  for (const line of text.split(/\r?\n/).slice(0, 200)) {
    const item = /^\s*(?:\d+[.)]|[-*•])\s+(.{1,300})$/.exec(line);
    const raw = (item ? item[1]! : line).replace(/\[([^\]]{1,100})\]\([^)]{0,300}\)/g, "$1");
    const hadUrl = /https?:\/\//.test(raw);
    const body = raw.replace(/https?:\/\/\S{1,300}/g, " ");
    const bold = /\*\*([^*]{2,80})\*\*/.exec(body);
    // a plain list item that carries an address is read by its host below, not by the words around it
    const name = bold ? bold[1]! : item && !hadUrl ? body.split(/\s[–—-]\s|:|\(|,/)[0]! : null;
    if (name) found.push({ raw: name.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().replace(/[.:;,–—-]+$/, "").trim(), host: false });
  }
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) found.push({ raw: m[1]!.toLowerCase(), host: true });
  const unlisted: string[] = [];
  const listed: string[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const key = outletKey(f.raw);
    if (f.raw.length < 2 || f.raw.length > 80 || !key || f.raw.split(" ").length > 7 || NOT_AN_OUTLET.has(f.raw.toLowerCase()) || own.has(key) || seen.has(key)) continue;
    const brand = outletKey(pl.brand);
    if (brand && key.includes(brand)) continue;
    seen.add(key);
    const hit = owners.find((o) => (f.host ? o.host === normalizeWebsite(f.raw) : o.key === key || (key.length >= 4 && o.key.length >= 4 && (key.includes(o.key) || o.key.includes(key)))) || (o.host != null && o.host === normalizeWebsite(f.raw)));
    if (hit) listed.push(hit.name);
    else unlisted.push(f.raw);
  }
  return [...new Set([...unlisted, ...listed])].slice(0, 8);
}

/** The product an answer names as the successor of `old`; PRESENT_VALUE when it names the line itself, ABSENT_VALUE when it names none. */
export function successorValueFromAnswer(answer: string, facts: Facts, old: string): string {
  const text = answer.slice(0, MATCH_LIMIT);
  // The old name shares words with the new one (Tigris K3, Tigris K5): look for the line with the old name taken out.
  const oldAt = text.toLowerCase().split(old.toLowerCase());
  const without = oldAt.length > 1 ? oldAt.join(" ") : text;
  if (mentionsBusiness(without, facts)) return PRESENT_VALUE;
  const cue = /(?:opvolger(?: van [^.:\n]{0,80})? (?:is|=|:)|opgevolgd door|vervangen door|vervangen is door|replaced by|succeeded by|successor(?: to [^.:\n]{0,80})? (?:is|:)|superseded by)\s*(?:de |het |een |the |a |an )?\**\[?([^*\n.,;:()\]\[]{2,60})/i.exec(text);
  const named = cue?.[1]?.trim();
  return named && outletKey(named) !== outletKey(old) ? named : ABSENT_VALUE;
}

/** The claims of a product-line probe, by rules. */
function lineClaimsRules(answerText: string, facts: Facts, factKey: FactKey, subject: string | null): { value: string; quote: string }[] {
  const pl = facts.productLine;
  if (!pl || !subject) return [];
  switch (factKey) {
    case "spec": {
      const v = specValueFromAnswer(answerText, facts, subject);
      return v ? [v] : [];
    }
    case "certificate": {
      const v = yesNo(withoutHedges(answerText));
      return v ? [{ value: v, quote: answerText }] : [];
    }
    case "outlet":
      return outletValuesFromAnswer(answerText, facts).map((value) => ({ value, quote: answerText }));
    case "successor":
      return [{ value: successorValueFromAnswer(answerText, facts, subject), quote: answerText }];
    default:
      return [];
  }
}

export function extractClaimsRules(answerText: string, facts: Facts, prompt: PromptLike, sampleId = ""): Claim[] {
  if (isRecommendationPrompt(prompt)) return extractRecommendation(answerText, facts, prompt, sampleId);
  if (looksNotFound(answerText)) return [notFoundClaim(prompt, sampleId, 0.9, answerText)];
  // A hedge sentence is read apart from the answer: its "geen" is not a "no" (QA round 2).
  if (SOFT_NOT_FOUND_PATTERNS.some((re) => re.test(answerText.slice(0, MATCH_LIMIT)))) {
    const rest = withoutHedges(answerText);
    if (rest !== answerText) {
      const claims = rest.trim() ? extractClaimsRules(rest, facts, prompt, sampleId) : [];
      return answersProbe(claims, prompt) || !looksSoftNotFound(answerText) ? claims : [notFoundClaim(prompt, sampleId, 0.8, answerText)];
    }
  }
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
        if (factKey === "identity" && subject === "kind") {
          const kind = kindClaimFromAnswer(answerText, facts);
          if (kind) push("identity", "kind", kind, answerText);
          break;
        }
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
      case "spec":
      case "certificate":
      case "outlet":
      case "successor": {
        // One claim per outlet named; compare() judges the first, so the ones not in the owner's list come first.
        for (const c of lineClaimsRules(answerText, facts, factKey, subject)) {
          claims.push({ sampleId, factKey, subject, value: c.value, confidence: 0.7, otherEntity: false, rawQuote: c.quote.trim().slice(0, 300) });
        }
        break;
      }
    }
  }
  if (!answersProbe(claims, prompt) && looksSoftNotFound(answerText)) return [notFoundClaim(prompt, sampleId, 0.8, answerText)];
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
              'Normalised: existence open|temporarily_closed|permanently_closed; hours "HH:MM-HH:MM" or "closed"; phone in E.164 ("+31201234567", "+442079460000"); spec the value the answer gives for the label as "<number> <unit>" or the short text; certificate yes|no; outlet one shop or webshop the answer names (its name or host), one claim per outlet; successor the product named as successor, "__present__" when that is the product in productlijn.naam, "__absent__" when none is named; address "straat nummer postcode plaats"; website hostname; service/policy/payment/area/urgency/credential yes|no; identity yes (same business) | no (different business); identity with subject "kind": same (the answer describes the business as the kind of business in profiel.aanbod / profiel.categorie) | other (it describes it as a different kind of business); price decimal number.',
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
Als het antwoord over een ander bedrijf met dezelfde naam in een andere plaats gaat, zet otherEntity op true.
Staat er een veld productlijn bij de vraag, dan gaan spec, certificate, outlet en successor over dat product, niet over het bedrijf.`;

export async function extractClaimsLlm(answerText: string, facts: Facts, prompt: PromptLike, sampleId = ""): Promise<Claim[]> {
  const { openaiClient } = await import("./engines/chatgpt");
  const model = process.env.EXTRACTION_MODEL ?? "gpt-4.1-mini";
  const user = JSON.stringify(
    {
      bedrijf: { naam: facts.name, plaats: facts.place, land: facts.country ?? "NL" },
      vraag: prompt.textNl,
      probes: prompt.probes,
      ...(facts.profile && (facts.profile.offer || facts.profile.category) ? { profiel: { aanbod: facts.profile.offer, categorie: facts.profile.category } } : {}),
      // Product line: only the names the answer is about, capped; no owner values, no outlet list (S-16, L-21).
      ...(facts.productLine ? { productlijn: { naam: facts.name.slice(0, 80), merk: facts.productLine.brand.slice(0, 80), categorie: facts.productLine.category.slice(0, 60), markt: facts.productLine.market } } : {}),
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
  if (looksNotFound(answerText) || (parsed.data.claims.length === 0 && !namesBusinessFacts(answerText)) || (!answersProbe(parsed.data.claims, prompt) && looksSoftNotFound(answerText))) {
    return [notFoundClaim(prompt, sampleId, parsed.data.claims.length === 0 ? 0.9 : 0.7, answerText)];
  }
  const otherEntityHint = detectOtherEntity(answerText, facts);
  return parsed.data.claims.map((c) => ({
    sampleId,
    factKey: c.factKey,
    subject: c.subject,
    value: postNormaliseLine(c.factKey, c.value, answerText, facts, c.subject) ?? postNormalise(c.factKey, c.value, facts.country),
    confidence: c.confidence,
    otherEntity: c.otherEntity || otherEntityHint,
    rawQuote: c.rawQuote.slice(0, 300),
  }));
}

/** Line keys of an LLM claim in the same value space as the rules: units, the owner's outlet spelling, the successor sentinel. */
function postNormaliseLine(factKey: FactKey, value: string, answer: string, facts: Facts, subject: string | null): string | null {
  const pl = facts.productLine;
  if (!pl) return null;
  switch (factKey) {
    case "spec":
      return normalizeSpecValue(value);
    case "certificate": {
      const v = value.toLowerCase().trim();
      return v === "ja" ? "yes" : v === "nee" ? "no" : v;
    }
    case "outlet": {
      const key = outletKey(value);
      const hit = pl.outlets.find((o) => o.market === pl.market && (outletKey(o.name) === key || (o.url != null && normalizeWebsite(o.url) === normalizeWebsite(value))));
      return hit ? hit.name : value.trim().slice(0, 80);
    }
    case "successor":
      return subject ? successorValueFromAnswer(answer, facts, subject) === PRESENT_VALUE ? PRESENT_VALUE : value.trim().slice(0, 80) || ABSENT_VALUE : value.trim().slice(0, 80);
    default:
      return null;
  }
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
