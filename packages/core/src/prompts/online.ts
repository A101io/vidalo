/**
 * Questions for a business that is only online (profile mode "online"), in Dutch. Fixed text; the
 * only variable parts are slot values from sanitizeSlot (ADR-0003). None of them names a town,
 * opening hours, a street or a way of paying. online.en.ts holds the same keys in the same order.
 */
import type { QuestionFamily, RecommendationIntent } from "../types";
import { INTENT_SUBJECT } from "../types";
import type { SlotKind } from "./slots";

export type OnlineFamily = Extract<QuestionFamily, "existence" | "what" | "website" | "phone" | "rec_category" | "alternative">;

export interface OnlineTemplate {
  key: string;
  family: OnlineFamily;
  /** Only for rec_category and alternative. */
  intent: RecommendationIntent | null;
  text: string;
  /** The slot kinds the text needs, in order of appearance. */
  slots: SlotKind[];
}

/** Probe subject per intent; "specialty" has none in INTENT_SUBJECT because the local packs probe a service there. */
export const ONLINE_SUBJECT = { ...INTENT_SUBJECT, specialty: "geschikt" } as const;

/** Which slot kind each placeholder is made of (the grammar words are made of the category). */
export const PLACEHOLDER_SLOT: Record<string, SlotKind> = {
  naam: "name", name: "name",
  categorie: "category", category: "category", Welke: "category", "de beste": "category",
  doelgroep: "audience", audience: "audience",
  concurrent: "competitor", competitor: "competitor",
};

/** In this order. A {Welke} is "Welke"/"Welk" plus the category, {de beste} is "de/het beste" plus it (nouns.ts). */
export const ONLINE_TEMPLATES: OnlineTemplate[] = [
  { key: "online.existence.exists", family: "existence", intent: null, text: "Bestaat {naam} nog?", slots: ["name"] },
  { key: "online.existence.active", family: "existence", intent: null, text: "Is {naam} nog actief?", slots: ["name"] },
  { key: "online.what", family: "what", intent: null, text: "Wat doet {naam}?", slots: ["name"] },
  { key: "online.website", family: "website", intent: null, text: "Wat is de website van {naam}?", slots: ["name"] },
  { key: "online.phone", family: "phone", intent: null, text: "Wat is het telefoonnummer van {naam}?", slots: ["name"] },
  { key: "online.rec.audience", family: "rec_category", intent: "specialty", text: "{Welke} is goed voor {doelgroep}?", slots: ["category", "audience"] },
  { key: "online.rec.quality", family: "rec_category", intent: "quality", text: "Wat is {de beste}?", slots: ["category"] },
  { key: "online.rec.trust", family: "rec_category", intent: "trust", text: "{Welke} raad je aan?", slots: ["category"] },
  { key: "online.rec.price", family: "rec_category", intent: "price", text: "{Welke} is betaalbaar?", slots: ["category"] },
  { key: "online.alt.self", family: "alternative", intent: "alternative", text: "Wat is een goed alternatief voor {naam}?", slots: ["name"] },
  { key: "online.alt.competitor", family: "alternative", intent: "alternative", text: "Wat is een goed alternatief voor {concurrent}?", slots: ["competitor"] },
];
