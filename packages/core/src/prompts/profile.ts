/**
 * Which questions a business is asked, by how it meets its customers (ADR-0003, brief Amendment A2).
 * door: main's questions, text for text. visit: the same, minus what needs a shop front. online:
 * code-held templates (online.ts / online.en.ts) with sanitised slots, no town.
 */
import { FACT_KEY_CRITERIUM } from "../criteria";
import { scanLang } from "../shared/country";
import { mentionsBusiness, normalizeName } from "../scanner/extract";
import type { BusinessProfile, Facts, Prompt, QuestionFamily, RecommendationSummary, ScanKind, SectorSlug } from "../types";
import { INTENT_SUBJECT } from "../types";
import { deBesteFor, welkFor } from "./nouns";
import { ONLINE_SUBJECT, ONLINE_TEMPLATES, type OnlineTemplate } from "./online";
import { ONLINE_TEMPLATES_EN } from "./online.en";
import { deriveSlot, fillTemplate, slotValue, type SlotValue } from "./slots";
import { freeScanPrompts, generatePrompts, type PromptTemplate } from "./index";

/** The family of a question, derived from what it already carries (no column). */
export function familyOf(p: Pick<Prompt, "category" | "kind" | "intent" | "templateKey">): QuestionFamily {
  const key = p.templateKey ?? "";
  if (key.startsWith("online.")) {
    const t = ONLINE_TEMPLATES.find((x) => x.key === key);
    if (t) return t.family;
  }
  if (p.kind === "recommendation") return p.intent === "alternative" ? "alternative" : "rec_town";
  switch (p.category) {
    case "existence": return "existence";
    case "hours": return "hours";
    case "address": return "address";
    case "payment": return "payment";
    case "phone": return "phone";
    case "website": return "website";
    default: return "other";
  }
}

const hasOpenDay = (facts: Pick<Facts, "hours">) => facts.hours.some((h) => !h.closed && h.open != null);

/** The A2 table: is a question of this family asked of a business with this profile? */
export function applies(family: QuestionFamily, profile: Pick<BusinessProfile, "mode">, facts: Pick<Facts, "hours" | "phone">): boolean {
  switch (profile.mode) {
    case "door":
      return family !== "what" && family !== "rec_category" && family !== "alternative";
    case "visit":
      if (family === "hours") return hasOpenDay(facts);
      return family === "existence" || family === "phone" || family === "website" || family === "rec_town" || family === "other";
    case "online":
      if (family === "phone") return Boolean(facts.phone);
      return family === "existence" || family === "what" || family === "website" || family === "rec_category" || family === "alternative";
  }
}

/** The words before the first " van | voor | met | in | uit ": "aanbieder van muziek" -> "aanbieder". */
export function headNoun(category: string): string {
  return category.split(/ (?:van|voor|met|in|uit) /)[0]!.trim();
}

type PreviousRecs = Pick<RecommendationSummary, "family" | "others">;

/**
 * Names to ask an alternative for: the profile's own list, else the three most often named next to
 * the business in the previous online scan. Every name is cleaned, the business itself is dropped.
 */
export function competitorsInUse(profile: BusinessProfile, previous: readonly PreviousRecs[] | undefined, facts: Pick<Facts, "name" | "place">): string[] {
  let names = profile.competitors;
  if (!names.length) {
    const counts = new Map<string, { name: string; answers: number }>();
    for (const r of previous ?? []) {
      if (r.family !== "rec_category" && r.family !== "alternative") continue;
      for (const o of r.others) {
        const key = normalizeName(o.name);
        const row = counts.get(key) ?? { name: o.name, answers: 0 };
        row.answers += o.answers;
        counts.set(key, row);
      }
    }
    names = [...counts.values()].sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)).map((r) => r.name);
  }
  const self = normalizeName(facts.name);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const clean = slotValue(raw, "competitor");
    if (!clean) continue;
    const key = normalizeName(clean);
    if (!key || key === self || mentionsBusiness(clean, { name: facts.name, place: facts.place, profile }) || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length === 3) break;
  }
  return out;
}

/** Picks n templates of a family from the built-in ones; BE-05 binds the question library into it. Default: in order. */
export type PickTemplates = <T extends { key: string; family: QuestionFamily }>(family: QuestionFamily, n: number, builtIns: T[]) => T[];
const inOrder: PickTemplates = (_family, n, builtIns) => builtIns.slice(0, n);

export interface QuestionLibrary {
  pick?: PickTemplates;
  /** Recommendation summaries of the previous online scan, for the competitors in use. */
  previous?: readonly PreviousRecs[];
}

export interface SelectInput {
  profile: BusinessProfile;
  facts: Facts;
  kind: ScanKind;
  sector?: SectorSlug | null;
  library?: QuestionLibrary;
}

const FREE_REC_COUNT = 2;
const FULL_REC_COUNT = 4;

/** Values for the placeholders of a template, in the scan language; a grammar word is made of the cleaned category. */
function valuesFor(lang: "nl" | "en", slots: { name: SlotValue | null; category: SlotValue | null; audience: SlotValue | null; competitor?: SlotValue | null }) {
  const { name, category, audience, competitor } = slots;
  if (lang === "en") return { name, category, audience, competitor };
  return {
    naam: name,
    doelgroep: audience,
    concurrent: competitor,
    Welke: category && deriveSlot(category, (c) => `${welkFor(headNoun(c))} ${c}`),
    "de beste": category && deriveSlot(category, (c) => deBesteFor(c)),
    categorie: category,
  };
}

function build(t: OnlineTemplate, text: string): PromptTemplate {
  const sub = t.intent ? (ONLINE_SUBJECT as Record<string, string>)[t.intent]! : null;
  switch (t.family) {
    case "existence": return { category: "existence", textNl: text, probes: ["existence"], active: true, criterium: FACT_KEY_CRITERIUM.existence, kind: "about", pool: "core", templateKey: t.key };
    case "what": return { category: "identity", textNl: text, probes: ["identity:kind"], active: true, criterium: FACT_KEY_CRITERIUM.identity, kind: "about", pool: "core", templateKey: t.key };
    case "website": return { category: "website", textNl: text, probes: ["website"], active: true, criterium: FACT_KEY_CRITERIUM.website, kind: "about", pool: "core", templateKey: t.key };
    case "phone": return { category: "phone", textNl: text, probes: ["phone"], active: true, criterium: FACT_KEY_CRITERIUM.phone, kind: "about", pool: "core", templateKey: t.key };
    default: return { category: "existence", textNl: text, probes: [`existence:${t.family === "alternative" ? INTENT_SUBJECT.alternative : sub}`], active: true, criterium: t.intent === "price" ? 9 : 6, kind: "recommendation", intent: t.intent, pool: "core", templateKey: t.key };
  }
}

/** The questions of an online business, in template order. A template whose slot was refused is left out. */
export function onlineQuestions(profile: BusinessProfile, facts: Facts, kind: ScanKind, library: QuestionLibrary = {}): PromptTemplate[] {
  const lang = scanLang(facts.country);
  const templates = lang === "nl" ? ONLINE_TEMPLATES : ONLINE_TEMPLATES_EN;
  const pick = library.pick ?? inOrder;
  const name = slotValue(facts.name, "name");
  const category = slotValue(profile.category, "category");
  const audience = slotValue(profile.audience, "audience");
  const free = kind === "free";
  const by = (key: string) => templates.find((t) => t.key === key)!;

  const usable = (t: OnlineTemplate, extra: Partial<Record<string, SlotValue | null>> = {}): string | null => {
    const filled = fillTemplate(t.text, { ...valuesFor(lang, { name, category, audience }), ...extra });
    return filled;
  };

  const chosen: { t: OnlineTemplate; text: string }[] = [];
  const add = (t: OnlineTemplate, extra?: Partial<Record<string, SlotValue | null>>) => {
    const text = usable(t, extra);
    if (text) chosen.push({ t, text });
  };

  if (free) {
    add(by("online.existence.exists"));
    add(by("online.what"));
    add(by("online.website"));
  } else {
    add(by("online.existence.exists"));
    add(by("online.existence.active"));
    add(by("online.what"));
    add(by("online.website"));
    if (facts.phone) add(by("online.phone"));
  }
  const recs = templates.filter((t) => t.family === "rec_category" && usable(t) != null);
  for (const t of pick("rec_category", free ? FREE_REC_COUNT : FULL_REC_COUNT, recs)) add(t);
  add(by("online.alt.self"));
  if (!free) {
    const comp = by("online.alt.competitor");
    for (const c of competitorsInUse(profile, library.previous, facts)) {
      const v = slotValue(c, "competitor");
      add(comp, lang === "en" ? { competitor: v } : { concurrent: v });
    }
  }
  const order = new Map(templates.map((t, i) => [t.key, i]));
  // template order; the competitor questions keep the order of the competitors
  chosen.sort((a, b) => order.get(a.t.key)! - order.get(b.t.key)!);
  const seen = new Set<string>();
  return chosen.filter((c) => !seen.has(c.text) && seen.add(c.text)).map((c) => build(c.t, c.text));
}

/**
 * The one entry point for "which questions does this profile get": door -> main's output untouched,
 * visit -> main's output filtered by applies(), online -> the templates.
 */
export function selectQuestions(input: SelectInput): PromptTemplate[] {
  const { profile, facts, kind, sector, library } = input;
  if (profile.mode === "online") return onlineQuestions(profile, facts, kind, library);
  const main = kind === "free" ? freeScanPrompts(facts, { sector }) : generatePrompts(facts, { sector });
  return profile.mode === "door" ? main : main.filter((p) => applies(familyOf(p), profile, facts));
}
