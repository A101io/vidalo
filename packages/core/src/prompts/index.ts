/**
 * Prompt templates per FactKey, in the scan language: Dutch for a business in
 * the Netherlands, English for one abroad (shared/country.ts scanLang; the
 * field is still called textNl and holds the question in that language).
 *
 * generatePrompts(facts) builds ~20 prompts a customer would plausibly
 * type into an AI assistant about this business. Each prompt names the fact
 * field(s) it probes in `probes` (e.g. "hours.6", "service:verhuur",
 * "payment:pin") so the extractor and comparer know what to look for.
 */
import type { FactKey, Facts, Hours, Prompt, SectorSlug } from "../types";
import { DAY_NAMES_NL, normalizeHours } from "../scanner/normalize";
import { FACT_KEY_CRITERIUM } from "../criteria";
import { sectorPrompts, type SectorPromptTemplate } from "./sectors";
import { sectorPromptsEn } from "./sectors.en";
import { scanLang, type ScanLang } from "../shared/country";

export * from "./sectors";
export * from "./rotation";

export type PromptTemplate = Omit<Prompt, "id" | "businessId">;

interface Ctx {
  name: string;
  place: string;
  lang: ScanLang;
}

const DAY_NAMES_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** The question in the scan language. */
const say = (ctx: Ctx, nl: string, en: string) => (ctx.lang === "nl" ? nl : en);

const ctxOf = (facts: Facts): Ctx => ({ name: facts.name, place: facts.place, lang: scanLang(facts.country) });

const t = (category: FactKey, textNl: string, probes: string[]): PromptTemplate => ({ category, textNl, probes, active: true, criterium: FACT_KEY_CRITERIUM[category], kind: "about" });

/** The sector that applies to a facts record (owner override on the facts, else the business sector). */
export function sectorOf(facts: Pick<Facts, "sector">, fallback?: SectorSlug | null): SectorSlug | null {
  return facts.sector ?? fallback ?? null;
}

/** Existence: three phrasings so model memory and web answers both get probed. */
export function existencePrompts(ctx: Ctx): PromptTemplate[] {
  const { name, place } = ctx;
  return [
    t("existence", say(ctx, `Is ${name} in ${place} nog open?`, `Is ${name} in ${place} still open?`), ["existence"]),
    t("existence", say(ctx, `Bestaat ${name} in ${place} nog?`, `Does ${name} in ${place} still exist?`), ["existence"]),
    t("existence", say(ctx, `Is ${name} in ${place} permanent gesloten?`, `Is ${name} in ${place} permanently closed?`), ["existence"]),
  ];
}

/**
 * The day whose hours differ most from the other days (fewest days sharing the
 * same open/close signature). Sunday is excluded because it has its own prompt.
 * Ties prefer a weekday over Saturday (Saturday differing is expected), then
 * the later day.
 */
export function mostUnusualDay(hours: Hours[], exclude: number[] = [6]): number | null {
  const candidates = hours.filter((h) => !exclude.includes(h.day));
  if (!candidates.length) return null;
  const sig = (h: Hours) => normalizeHours(h);
  let best: Hours | null = null;
  let bestCount = Infinity;
  for (const h of candidates) {
    const count = hours.filter((x) => sig(x) === sig(h)).length;
    const better = count < bestCount || (count === bestCount && best != null && ((best.day === 5 && h.day < 5) || (h.day > best.day && h.day < 5)));
    if (!best || better) {
      best = h;
      bestCount = count;
    }
  }
  return best ? best.day : null;
}

export function hoursPrompts(ctx: Ctx, facts: Facts): PromptTemplate[] {
  const { name, place } = ctx;
  const allDays = facts.hours.map((h) => `hours.${h.day}`);
  const unusual = mostUnusualDay(facts.hours);
  const out: PromptTemplate[] = [
    t("hours", say(ctx, `Wat zijn de openingstijden van ${name} in ${place}?`, `What are the opening hours of ${name} in ${place}?`), allDays.length ? allDays : ["hours"]),
    sundayPrompt(ctx),
  ];
  const day = unusual ?? 5;
  out.push(t("hours", say(ctx, `Hoe laat is ${name} in ${place} op ${DAY_NAMES_NL[day]} open?`, `What time is ${name} in ${place} open on ${DAY_NAMES_EN[day]}?`), [`hours.${day}`]));
  const second = unusual === 5 ? 4 : 5; // one more weekday/saturday probe
  out.push(t("hours", say(ctx, `Tot hoe laat kan ik op ${DAY_NAMES_NL[second]} terecht bij ${name} in ${place}?`, `Until what time can I go to ${name} in ${place} on ${DAY_NAMES_EN[second]}?`), [`hours.${second}`]));
  return out;
}

function sundayPrompt(ctx: Ctx): PromptTemplate {
  return t("hours", say(ctx, `Is ${ctx.name} in ${ctx.place} op zondag open?`, `Is ${ctx.name} in ${ctx.place} open on Sunday?`), ["hours.6"]);
}

export function phonePrompts(ctx: Ctx): PromptTemplate[] {
  const { name, place } = ctx;
  return [
    t("phone", say(ctx, `Wat is het telefoonnummer van ${name} in ${place}?`, `What is the phone number of ${name} in ${place}?`), ["phone"]),
    t("phone", say(ctx, `Hoe kan ik ${name} in ${place} telefonisch bereiken?`, `How can I reach ${name} in ${place} by phone?`), ["phone"]),
  ];
}

export function addressPrompts(ctx: Ctx): PromptTemplate[] {
  return [t("address", say(ctx, `Wat is het adres van ${ctx.name} in ${ctx.place}?`, `What is the address of ${ctx.name} in ${ctx.place}?`), ["address"])];
}

export function websitePrompts(ctx: Ctx): PromptTemplate[] {
  return [t("website", say(ctx, `Wat is de website van ${ctx.name} in ${ctx.place}?`, `What is the website of ${ctx.name} in ${ctx.place}?`), ["website"])];
}

function servicePrompt(ctx: Ctx, service: string): PromptTemplate {
  return t("service", say(ctx, `Doet ${ctx.name} in ${ctx.place} ook ${service}?`, `Does ${ctx.name} in ${ctx.place} also offer ${service}?`), [`service:${service}`]);
}

/** Two services the business does offer, two it does not (if known). */
export function servicePrompts(ctx: Ctx, facts: Facts): PromptTemplate[] {
  const yes = facts.servicesYes.slice(0, 2);
  const no = facts.servicesNo.slice(0, 2);
  return [...yes.map((service) => servicePrompt(ctx, service)), ...no.map((service) => ({ ...servicePrompt(ctx, service), criterium: 7 as const }))];
}

export function pricePrompts(ctx: Ctx, facts: Facts): PromptTemplate[] {
  const { name, place } = ctx;
  return facts.prices.slice(0, 2).map((p) => t("price", say(ctx, `Wat kost ${p.label} bij ${name} in ${place}?`, `How much does ${p.label} cost at ${name} in ${place}?`), [`price:${p.label}`]));
}

export function policyPrompts(ctx: Ctx, facts: Facts): PromptTemplate[] {
  const { name, place } = ctx;
  return facts.policies.slice(0, 2).map((p) => t("policy", say(ctx, `Geldt bij ${name} in ${place}: "${p}"?`, `Is this true at ${name} in ${place}: "${p}"?`), [`policy:${p}`]));
}

export function paymentPrompts(ctx: Ctx): PromptTemplate[] {
  return [t("payment", say(ctx, `Kan ik bij ${ctx.name} in ${ctx.place} pinnen?`, `Can I pay by card at ${ctx.name} in ${ctx.place}?`), ["payment:pin"])];
}

/** The sector pack's questions in the scan language. */
function sectorFor(facts: Facts, sector: SectorSlug | null): SectorPromptTemplate[] {
  return scanLang(facts.country) === "nl" ? sectorPrompts(facts, sector) : sectorPromptsEn(facts, sector);
}

export interface GenerateOptions {
  /** Sector pack to add; defaults to facts.sector. */
  sector?: SectorSlug | null;
}

/**
 * Base prompts for a business (no sector layer). Count: 3 existence + 4 hours
 * + 2 phone + 1 address + 1 website + up to 4 service + up to 2 price + up to
 * 2 policy + 1 payment = up to 20.
 */
export function basePrompts(facts: Facts): PromptTemplate[] {
  const ctx = ctxOf(facts);
  return [
    ...existencePrompts(ctx),
    ...hoursPrompts(ctx, facts),
    ...phonePrompts(ctx),
    ...addressPrompts(ctx),
    ...websitePrompts(ctx),
    ...servicePrompts(ctx, facts),
    ...pricePrompts(ctx, facts),
    ...policyPrompts(ctx, facts),
    ...paymentPrompts(ctx),
  ];
}

/**
 * All prompts for a business: the base prompts plus the sector pack (up to 6
 * questions about the business and one recommendation question per intent,
 * pool "core", plus the rotating bank, pool "bank"). A text that already
 * exists in the base set is not added twice.
 */
export function generatePrompts(facts: Facts, opts: GenerateOptions = {}): PromptTemplate[] {
  const base = basePrompts(facts);
  const seen = new Set(base.map((p) => p.textNl));
  const extra: PromptTemplate[] = sectorFor(facts, sectorOf(facts, opts.sector)).filter((p) => !seen.has(p.textNl));
  return [...base, ...extra];
}

/** Intents the free scan asks for, in order of preference: who is the best, who can you trust, who can help now. */
const FREE_SCAN_INTENTS = ["quality", "trust", "now", "specialty", "place", "price"] as const;

/**
 * The 6 prompts for the free scan. With a sector: existence, phone, Sunday
 * hours and three recommendation questions from the core: kwaliteit,
 * vertrouwen and nu ("Wat is de beste loodgieter in Utrecht?"), falling back
 * to specialisme, plek and prijs. That is the question a customer really
 * asks, and the one an owner wants to see answered.
 * Without a sector: existence, Sunday hours, phone, address, one service the
 * business does NOT offer (falls back to one it does), and pin payment.
 */
export function freeScanPrompts(facts: Facts, opts: GenerateOptions = {}): PromptTemplate[] {
  const ctx = ctxOf(facts);
  const sunday = sundayPrompt(ctx);
  const sector: SectorPromptTemplate[] = sectorFor(facts, sectorOf(facts, opts.sector));
  if (sector.length) {
    const out: PromptTemplate[] = [existencePrompts(ctx)[0]!, phonePrompts(ctx)[0]!, sunday];
    const recs = sector.filter((p) => p.kind === "recommendation" && p.pool === "core");
    const picked: PromptTemplate[] = [];
    for (const intent of FREE_SCAN_INTENTS) {
      const p = recs.find((r) => r.intent === intent);
      if (p && picked.length < 3) picked.push(p);
    }
    // Top up with base prompts when the pack is short.
    const fill = [addressPrompts(ctx)[0]!, paymentPrompts(ctx)[0]!];
    while (picked.length < 3 && fill.length) picked.push(fill.shift()!);
    return [...out, ...picked].slice(0, 6);
  }
  const service = facts.servicesNo[0] ?? facts.servicesYes[0];
  const out: PromptTemplate[] = [existencePrompts(ctx)[0]!, sunday, phonePrompts(ctx)[0]!, addressPrompts(ctx)[0]!];
  if (service) out.push(servicePrompt(ctx, service));
  out.push(paymentPrompts(ctx)[0]!);
  return out;
}

/** Pick, from a stored prompt list, the ones that match the free-scan templates (by text). */
export function selectFreeScanPrompts<T extends { textNl: string }>(prompts: T[], facts: Facts, opts: GenerateOptions = {}): T[] {
  const wanted = new Set(freeScanPrompts(facts, opts).map((p) => p.textNl));
  return prompts.filter((p) => wanted.has(p.textNl));
}
