/**
 * The questions asked about a product line (feature 006, ADR-0010): code-held templates, filled only with
 * values that went through `slotValue` (ADR-0003), in the scan language of the market (Dutch for NL, English
 * elsewhere), stored per (line, market). No owner text reaches an AI system any other way: spec values,
 * certificate numbers, outlet names and urls and `replacedBy` never enter a question (security S-15, L-20).
 * A template whose slot is refused is skipped, never asked with a hole.
 *
 * Slot names are the same in both languages (`{category}` is "Welk speltbrood" in Dutch and "speltbrood"
 * in English: the value carries the grammar). The English texts are in `line.en.ts`.
 */
import type { Db } from "../db/types";
import { countryName, scanLang, type ScanLang } from "../shared/country";
import { normalizeName } from "../scanner/extract";
import type { CriteriumId, FactKey, Prompt, PromptKind, ProductLineVersion, ScanKind } from "../types";
import { LINE_TEMPLATES_EN } from "./line.en";
import { deBesteFor, welkFor } from "./nouns";
import type { PromptInput } from "../db/types";
import { deriveSlot, fillTemplate, slotValue, type SlotValue } from "./slots";

export type LineTemplateKey = "line.rec.use" | "line.rec.quality" | "line.spec" | "line.cert" | "line.outlet" | "line.successor";

export interface LineTemplate {
  key: LineTemplateKey;
  /** The question with `{slot}` places. */
  text: string;
  kind: PromptKind;
  category: FactKey;
  /** What the question probes; slots are filled with the same sanitised values ("spec:Gewicht"). */
  probe: string;
  criterium: CriteriumId;
}

export const LINE_TEMPLATES: readonly LineTemplate[] = [
  { key: "line.rec.use", text: "{category} is het beste voor {use}?", kind: "recommendation", category: "existence", probe: "existence:{use}", criterium: 6 },
  { key: "line.rec.quality", text: "Wat is {category}?", kind: "recommendation", category: "existence", probe: "existence:beste", criterium: 6 },
  { key: "line.spec", text: "{spec} heeft {name}{brand}?", kind: "about", category: "spec", probe: "spec:{spec_label}", criterium: 13 },
  { key: "line.cert", text: "Is {name}{brand} {certificate}-gecertificeerd?", kind: "about", category: "certificate", probe: "certificate:{certificate}", criterium: 14 },
  { key: "line.outlet", text: "Waar koop ik {name}{brand} in {country}?", kind: "about", category: "outlet", probe: "outlet:{market}", criterium: 15 },
  { key: "line.successor", text: "Wat is de opvolger van {old}{brand}?", kind: "about", category: "successor", probe: "successor:{old}", criterium: 16 },
];

export const lineTemplates = (lang: ScanLang): readonly LineTemplate[] => (lang === "nl" ? LINE_TEMPLATES : LINE_TEMPLATES_EN);

/** "Gewicht" -> "gewicht" mid-sentence; an acronym ("IP-klasse", "PN") keeps its capitals. */
function lowerFirst(s: string): string {
  return /\p{Lu}/u.test(s.slice(1, 3)) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * The questions for one market of one version of a line, in template order (all `line.rec.use`, then `line.rec.quality`,
 * `line.spec`, `line.cert`, `line.outlet`, `line.successor`). `brand` is the business name.
 */
export function generateLinePrompts(version: ProductLineVersion, market: string, brand: string): PromptInput[] {
  const lang = scanLang(market);
  const nl = lang === "nl";
  const templates = lineTemplates(lang);
  const out: PromptInput[] = [];
  const seen = new Set<string>();

  const name = slotValue(version.name, "name");
  if (!name) return [];
  // " van {merk}" / " by {brand}" only when the line's name does not already carry the brand's name.
  const brandKey = normalizeName(brand);
  const carriesBrand = brandKey !== "" && normalizeName(version.name).includes(brandKey);
  const brandSlot = carriesBrand ? null : slotValue(brand, "name");
  const brandPart: SlotValue | null = carriesBrand ? deriveSlot(name, () => "") : brandSlot ? deriveSlot(brandSlot, (b) => `${nl ? " van " : " by "}${b}`) : null;
  const category = slotValue(version.category, "category");
  const country = deriveSlot(name, () => countryName(market, lang));

  const add = (t: LineTemplate, values: Record<string, SlotValue | null>, probeValues: Record<string, SlotValue | null> = values) => {
    const text = fillTemplate(t.text, values);
    const probe = fillTemplate(t.probe, probeValues);
    if (text === null || probe === null || seen.has(text)) return;
    seen.add(text);
    out.push({ category: t.category, textNl: text, probes: [probe], active: true, criterium: t.criterium, kind: t.kind, pool: "core", templateKey: t.key });
  };

  for (const t of templates) {
    switch (t.key) {
      case "line.rec.use": {
        if (!category) break;
        const cat = deriveSlot(category, (c) => (nl ? `${welkFor(c)} ${c}` : c));
        for (const raw of version.useCases) add(t, { category: cat, use: slotValue(raw, "use") });
        break;
      }
      case "line.rec.quality": {
        // only when the owner named no use case: one question about the line's category as a whole
        if (!category || version.useCases.length) break;
        add(t, { category: deriveSlot(category, (c) => (nl ? deBesteFor(c) : c)) });
        break;
      }
      case "line.spec": {
        for (const s of version.specs) {
          const label = slotValue(s.label, "spec");
          if (!label || brandPart === null) continue;
          const phrase = deriveSlot(label, (l) => (nl ? `${welkFor(lowerFirst(l))} ${lowerFirst(l)}` : lowerFirst(l)));
          add(t, { spec: phrase, name, brand: brandPart, spec_label: label });
        }
        break;
      }
      case "line.cert": {
        if (brandPart === null) break;
        for (const c of version.certificates) add(t, { name, brand: brandPart, certificate: slotValue(c.name, "certificate") });
        break;
      }
      case "line.outlet": {
        if (brandPart === null || !version.outlets.some((o) => o.market === market)) break;
        add(t, { name, brand: brandPart, country, market: deriveSlot(name, () => market) });
        break;
      }
      case "line.successor": {
        if (brandPart === null) break;
        for (const raw of version.replaces) add(t, { old: slotValue(raw, "name"), brand: brandPart });
        break;
      }
    }
  }
  return out;
}

/**
 * The prompts a line run asks for this market: with `promptIds` the stored scoped prompts with those ids (a recheck);
 * otherwise the generated set, inserting the ones not stored yet (by text, scoped to the line and market), in template
 * order. Prompts stored for an older version stay and are not asked. `_kind` is accepted for the day a kind needs a
 * smaller set; every kind asks the same questions today.
 */
export async function loadLinePrompts(db: Db, businessId: string, version: ProductLineVersion, market: string, _kind: ScanKind, promptIds?: string[]): Promise<Prompt[]> {
  const scope = { productLineId: version.productLineId, market };
  if (promptIds?.length) {
    const set = new Set(promptIds);
    return (await db.listPrompts(businessId, { activeOnly: true, line: scope })).filter((p) => set.has(p.id));
  }
  const business = await db.getBusiness(businessId);
  if (!business) throw new Error(`business ${businessId} not found`);
  const wanted = generateLinePrompts(version, market, business.name);
  const stored = await db.listPrompts(businessId, { line: scope });
  const have = new Set(stored.map((p) => p.textNl));
  const missing = wanted.filter((w) => !have.has(w.textNl));
  const all = missing.length ? [...stored, ...(await db.insertPrompts(businessId, missing, scope))] : stored;
  const byText = new Map(all.filter((p) => p.active).map((p) => [p.textNl, p]));
  return wanted.flatMap((w) => byText.get(w.textNl) ?? []);
}
