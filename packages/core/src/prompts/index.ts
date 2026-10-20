/**
 * Dutch prompt templates per FactKey.
 *
 * generatePrompts(facts) builds ~20 prompts a Dutch consumer would plausibly
 * type into an AI assistant about this business. Each prompt names the fact
 * field(s) it probes in `probes` (e.g. "hours.6", "service:verhuur",
 * "payment:pin") so the extractor and comparer know what to look for.
 */
import type { FactKey, Facts, Hours, Prompt, SectorSlug } from "../types";
import { DAY_NAMES_NL, normalizeHours } from "../scanner/normalize";
import { FACT_KEY_CRITERIUM } from "../criteria";
import { sectorPrompts, type SectorPromptTemplate } from "./sectors";

export * from "./sectors";
export * from "./rotation";

export type PromptTemplate = Omit<Prompt, "id" | "businessId">;

interface Ctx {
  name: string;
  place: string;
}

const t = (category: FactKey, textNl: string, probes: string[]): PromptTemplate => ({ category, textNl, probes, active: true, criterium: FACT_KEY_CRITERIUM[category], kind: "about" });

/** The sector that applies to a facts record (owner override on the facts, else the business sector). */
export function sectorOf(facts: Pick<Facts, "sector">, fallback?: SectorSlug | null): SectorSlug | null {
  return facts.sector ?? fallback ?? null;
}

/** Existence: three phrasings so model memory and web answers both get probed. */
export function existencePrompts({ name, place }: Ctx): PromptTemplate[] {
  return [
    t("existence", `Is ${name} in ${place} nog open?`, ["existence"]),
    t("existence", `Bestaat ${name} in ${place} nog?`, ["existence"]),
    t("existence", `Is ${name} in ${place} permanent gesloten?`, ["existence"]),
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
    t("hours", `Wat zijn de openingstijden van ${name} in ${place}?`, allDays.length ? allDays : ["hours"]),
    t("hours", `Is ${name} in ${place} op zondag open?`, ["hours.6"]),
  ];
  if (unusual != null) {
    out.push(t("hours", `Hoe laat is ${name} in ${place} op ${DAY_NAMES_NL[unusual]} open?`, [`hours.${unusual}`]));
  } else {
    out.push(t("hours", `Hoe laat is ${name} in ${place} op zaterdag open?`, ["hours.5"]));
  }
  const second = unusual === 5 ? 4 : 5; // one more weekday/saturday probe
  out.push(t("hours", `Tot hoe laat kan ik op ${DAY_NAMES_NL[second]} terecht bij ${name} in ${place}?`, [`hours.${second}`]));
  return out;
}

export function phonePrompts({ name, place }: Ctx): PromptTemplate[] {
  return [
    t("phone", `Wat is het telefoonnummer van ${name} in ${place}?`, ["phone"]),
    t("phone", `Hoe kan ik ${name} in ${place} telefonisch bereiken?`, ["phone"]),
  ];
}

export function addressPrompts({ name, place }: Ctx): PromptTemplate[] {
  return [t("address", `Wat is het adres van ${name} in ${place}?`, ["address"])];
}

export function websitePrompts({ name, place }: Ctx): PromptTemplate[] {
  return [t("website", `Wat is de website van ${name} in ${place}?`, ["website"])];
}

/** Two services the business does offer, two it does not (if known). */
export function servicePrompts({ name, place }: Ctx, facts: Facts): PromptTemplate[] {
  const yes = facts.servicesYes.slice(0, 2);
  const no = facts.servicesNo.slice(0, 2);
  return [
    ...yes.map((service) => t("service", `Doet ${name} in ${place} ook ${service}?`, [`service:${service}`])),
    ...no.map((service) => ({ ...t("service", `Doet ${name} in ${place} ook ${service}?`, [`service:${service}`]), criterium: 7 as const })),
  ];
}

export function pricePrompts({ name, place }: Ctx, facts: Facts): PromptTemplate[] {
  return facts.prices.slice(0, 2).map((p) => t("price", `Wat kost ${p.label} bij ${name} in ${place}?`, [`price:${p.label}`]));
}

export function policyPrompts({ name, place }: Ctx, facts: Facts): PromptTemplate[] {
  return facts.policies.slice(0, 2).map((p) => t("policy", `Geldt bij ${name} in ${place}: "${p}"?`, [`policy:${p}`]));
}

export function paymentPrompts({ name, place }: Ctx): PromptTemplate[] {
  return [t("payment", `Kan ik bij ${name} in ${place} pinnen?`, ["payment:pin"])];
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
  const ctx: Ctx = { name: facts.name, place: facts.place };
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
  const extra: PromptTemplate[] = sectorPrompts(facts, sectorOf(facts, opts.sector)).filter((p) => !seen.has(p.textNl));
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
  const ctx: Ctx = { name: facts.name, place: facts.place };
  const sunday = t("hours", `Is ${facts.name} in ${facts.place} op zondag open?`, ["hours.6"]);
  const sector: SectorPromptTemplate[] = sectorPrompts(facts, sectorOf(facts, opts.sector));
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
  if (service) out.push(t("service", `Doet ${facts.name} in ${facts.place} ook ${service}?`, [`service:${service}`]));
  out.push(paymentPrompts(ctx)[0]!);
  return out;
}

/** Pick, from a stored prompt list, the ones that match the free-scan templates (by text). */
export function selectFreeScanPrompts<T extends { textNl: string }>(prompts: T[], facts: Facts, opts: GenerateOptions = {}): T[] {
  const wanted = new Set(freeScanPrompts(facts, opts).map((p) => p.textNl));
  return prompts.filter((p) => wanted.has(p.textNl));
}
