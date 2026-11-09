/**
 * The comparison profile: the word a customer uses for this kind of business,
 * which every recommendation question is built on ("Wat is het beste
 * Indonesische restaurant in Rotterdam?"). The sector alone is too coarse: a
 * Surinamese takeaway asked about as "restaurant" is compared with Michelin
 * kitchens (Top Exotic, Rotterdam, 9 Nov 2026).
 *
 * In order: the owner's own word (Facts.kind), the sector pack's name and type
 * patterns, Google's specific place type below, the pack's default.
 */
import type { Facts } from "../types.js";

/** Google Places types (the New API's primaryType / types) → the customer's word, Dutch and English. */
export const GOOGLE_TYPE_NOUNS: Record<string, { nl: string; en: string }> = {
  // kind of place
  meal_takeaway: { nl: "afhaalrestaurant", en: "takeaway" },
  meal_delivery: { nl: "bezorgrestaurant", en: "delivery restaurant" },
  fast_food_restaurant: { nl: "snackbar", en: "fast-food restaurant" },
  hamburger_restaurant: { nl: "hamburgerrestaurant", en: "burger restaurant" },
  pizza_restaurant: { nl: "pizzeria", en: "pizzeria" },
  sandwich_shop: { nl: "broodjeszaak", en: "sandwich shop" },
  sushi_restaurant: { nl: "sushirestaurant", en: "sushi restaurant" },
  ramen_restaurant: { nl: "ramenrestaurant", en: "ramen restaurant" },
  seafood_restaurant: { nl: "visrestaurant", en: "seafood restaurant" },
  steak_house: { nl: "steakhouse", en: "steakhouse" },
  barbecue_restaurant: { nl: "barbecuerestaurant", en: "barbecue restaurant" },
  vegan_restaurant: { nl: "veganistisch restaurant", en: "vegan restaurant" },
  vegetarian_restaurant: { nl: "vegetarisch restaurant", en: "vegetarian restaurant" },
  breakfast_restaurant: { nl: "ontbijtzaak", en: "breakfast place" },
  brunch_restaurant: { nl: "brunchzaak", en: "brunch place" },
  ice_cream_shop: { nl: "ijssalon", en: "ice cream parlour" },
  wine_bar: { nl: "wijnbar", en: "wine bar" },
  bar: { nl: "bar", en: "bar" },
  // kitchen
  indonesian_restaurant: { nl: "Indonesisch restaurant", en: "Indonesian restaurant" },
  chinese_restaurant: { nl: "Chinees restaurant", en: "Chinese restaurant" },
  japanese_restaurant: { nl: "Japans restaurant", en: "Japanese restaurant" },
  korean_restaurant: { nl: "Koreaans restaurant", en: "Korean restaurant" },
  thai_restaurant: { nl: "Thais restaurant", en: "Thai restaurant" },
  vietnamese_restaurant: { nl: "Vietnamees restaurant", en: "Vietnamese restaurant" },
  indian_restaurant: { nl: "Indiaas restaurant", en: "Indian restaurant" },
  turkish_restaurant: { nl: "Turks restaurant", en: "Turkish restaurant" },
  lebanese_restaurant: { nl: "Libanees restaurant", en: "Lebanese restaurant" },
  middle_eastern_restaurant: { nl: "Midden-Oosters restaurant", en: "Middle Eastern restaurant" },
  mediterranean_restaurant: { nl: "mediterraan restaurant", en: "Mediterranean restaurant" },
  greek_restaurant: { nl: "Grieks restaurant", en: "Greek restaurant" },
  italian_restaurant: { nl: "Italiaans restaurant", en: "Italian restaurant" },
  french_restaurant: { nl: "Frans restaurant", en: "French restaurant" },
  spanish_restaurant: { nl: "Spaans restaurant", en: "Spanish restaurant" },
  mexican_restaurant: { nl: "Mexicaans restaurant", en: "Mexican restaurant" },
  american_restaurant: { nl: "Amerikaans restaurant", en: "American restaurant" },
  brazilian_restaurant: { nl: "Braziliaans restaurant", en: "Brazilian restaurant" },
  african_restaurant: { nl: "Afrikaans restaurant", en: "African restaurant" },
  afghani_restaurant: { nl: "Afghaans restaurant", en: "Afghan restaurant" },
  // other trades with a Google type more specific than the sector's default
  barber_shop: { nl: "barbier", en: "barber" },
  nail_salon: { nl: "nagelstudio", en: "nail salon" },
  beauty_salon: { nl: "schoonheidssalon", en: "beauty salon" },
  bicycle_store: { nl: "fietsenwinkel", en: "bike shop" },
  car_wash: { nl: "autowasstraat", en: "car wash" },
  car_dealer: { nl: "autodealer", en: "car dealer" },
  dentist: { nl: "tandarts", en: "dentist" },
  physiotherapist: { nl: "fysiotherapeut", en: "physiotherapist" },
  veterinary_care: { nl: "dierenarts", en: "vet" },
  pharmacy: { nl: "apotheek", en: "pharmacy" },
  florist: { nl: "bloemist", en: "florist" },
  book_store: { nl: "boekwinkel", en: "bookshop" },
  pet_store: { nl: "dierenwinkel", en: "pet shop" },
  electrician: { nl: "elektricien", en: "electrician" },
  plumber: { nl: "loodgieter", en: "plumber" },
  roofing_contractor: { nl: "dakdekker", en: "roofer" },
  painter: { nl: "schilder", en: "painter" },
  gym: { nl: "sportschool", en: "gym" },
};

/** The first of the business's Google types (primary first) that has a word of its own. */
export function nounFromGoogleTypes(types: readonly string[] | undefined, lang: "nl" | "en"): string | null {
  for (const t of types ?? []) {
    const hit = GOOGLE_TYPE_NOUNS[t.toLowerCase()];
    if (hit) return hit[lang];
  }
  return null;
}

/** The owner's own word, when given (Facts.kind, /app/gegevens); it always wins. */
export function ownerKind(facts: Pick<Facts, "kind">): string | null {
  const k = facts.kind?.trim();
  return k ? k : null;
}

// ---------------------------------------------------------------------------
// Dutch grammar around the word: "het beste Indonesische restaurant", "Welk
// café", "een goed Surinaams restaurant", "de beste snackbar".
// ---------------------------------------------------------------------------

/** Endings of the last word that take "het" ("restaurant", also "afhaalrestaurant", "visrestaurant"); everything else takes "de". */
const HET_ENDINGS = ["restaurant", "café", "cafe", "steakhouse", "hotel", "huis", "bureau", "kantoor", "atelier", "centrum"];

export function isHetNoun(noun: string): boolean {
  const last = noun.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  return HET_ENDINGS.some((e) => last.endsWith(e));
}

/** "Welk" before a het-word, "Welke" before a de-word. */
export function welkFor(noun: string): string {
  return isHetNoun(noun) ? "Welk" : "Welke";
}

/**
 * "het beste X" / "de beste X". After a definite article a Dutch adjective
 * takes -e, also before a het-word: "een goed Indonesisch restaurant" but "het
 * beste Indonesische restaurant". Nouns for de-words already carry the -e
 * ("Surinaamse snackbar"), so only a het-word's leading adjective is inflected.
 */
export function deBesteFor(noun: string): string {
  const words = noun.trim().split(/\s+/);
  if (!isHetNoun(noun)) return `de beste ${noun.trim()}`;
  if (words.length < 2) return `het beste ${noun.trim()}`;
  const [adj, ...rest] = words as [string, ...string[]];
  return `het beste ${inflect(adj)} ${rest.join(" ")}`;
}

/** Dutch adjective + e: "Chinees" → "Chinese", "mediterraan" → "mediterrane", "Thais" → "Thaise"; an adjective ending in -e stays. */
export function inflect(adj: string): string {
  if (/e$/i.test(adj)) return adj;
  if (/ees$/i.test(adj)) return adj.slice(0, -2) + "se";
  if (/aan$/i.test(adj)) return adj.slice(0, -2) + "ne";
  return adj + "e";
}
