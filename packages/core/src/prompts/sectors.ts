/**
 * Sector packs (docs/CRITERIA.md "Sectoren"): per sector the decisive facts,
 * the typical source of the error, the biggest risk, and the extra questions
 * on top of the base prompts:
 *
 *   core  up to 6 questions about the business, plus 6 recommendation
 *         questions, one per intent: kwaliteit ("Wat is de beste loodgieter in
 *         Utrecht?"), vertrouwen, nu (spoed, zondag open), specialisme, prijs
 *         and plek. Asked on every full scan.
 *   bank  20 to 30 more recommendation questions: other phrasings, the other
 *         places in the werkgebied, other services, seasons. A few rotate into
 *         each monthly scan (rotation.ts); one where the business is mostly not
 *         named moves to the core.
 *
 * Every prompt names the criterium it feeds and its kind. A recommendation
 * prompt is judged on one thing: is the business named. Not being named is a
 * finding on the linked criterium, never a ranking. Questions only ask for
 * what the facts say the business offers (or, for kwaliteit, vertrouwen,
 * prijs and plek, that it is open), so its absence is always a real miss.
 */
import type { CriteriumId, FactKey, Facts, Prompt, PromptKind, PromptPool, RecommendationIntent, Season, SectorSlug } from "../types";
import { INTENT_SUBJECT, SECTOR_SLUGS } from "../types";

export type SectorPromptTemplate = Omit<Prompt, "id" | "businessId"> & { criterium: CriteriumId; kind: PromptKind; pool: PromptPool };

export interface SectorPack {
  slug: SectorSlug;
  labelNl: string;
  /** Google Places types and Dutch category words that map to this sector (lowercase, substring match). */
  googleCategories: string[];
  /** KvK SBI code prefixes. */
  sbiCodes: string[];
  /** Three short Dutch lines: the facts that decide for this sector. */
  decisiveFacts: [string, string, string];
  typicalSource: string;
  biggestRisk: string;
  /** Criterium ids that matter most, in order. */
  decisiveCriteria: CriteriumId[];
  /** The noun a customer uses when asking for a recommendation ("loodgieter", "kapper"). */
  nouns: { match: RegExp; noun: string }[];
  defaultNoun: string;
  prompts(facts: Facts): SectorPromptTemplate[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Ctx {
  slug: SectorSlug;
  facts: Facts;
  name: string;
  place: string;
  x: string; // "Naam in Plaats"
  noun: string;
  yes: string[];
  no: string[];
  areaPlace: string | null;
  urgency: boolean | null;
  cred: string | null;
  policies: string[];
  sundayOpen: boolean;
  saturdayOpen: boolean;
  firstPrice: string | null;
}

const about = (category: FactKey, criterium: CriteriumId, textNl: string, probes: string[]): SectorPromptTemplate => ({ category, criterium, kind: "about", textNl, probes, active: true, pool: "core" });
const rec = (category: FactKey, criterium: CriteriumId, textNl: string, probes: string[]): SectorPromptTemplate => ({ category, criterium, kind: "recommendation", textNl, probes, active: true, pool: "core" });

function ctxFor(facts: Facts, pack: Pick<SectorPack, "slug" | "nouns" | "defaultNoun">): Ctx {
  const noun = pack.nouns.find((n) => n.match.test(facts.name))?.noun ?? pack.defaultNoun;
  const open = (day: number) => {
    const h = facts.hours.find((x) => x.day === day);
    return !!h && !h.closed && !!h.open && !!h.close;
  };
  return {
    slug: pack.slug,
    facts,
    name: facts.name,
    place: facts.place,
    x: `${facts.name} in ${facts.place}`,
    noun,
    yes: facts.servicesYes,
    no: facts.servicesNo,
    areaPlace: facts.serviceArea?.places.find((p) => p.toLowerCase() !== facts.place.toLowerCase()) ?? null,
    urgency: facts.urgency ? facts.urgency.available : null,
    cred: facts.credentials?.[0] ?? null,
    policies: facts.policies,
    sundayOpen: open(6),
    saturdayOpen: open(5),
    firstPrice: facts.prices[0]?.label ?? null,
  };
}

const policyMatching = (c: Ctx, re: RegExp) => c.policies.find((p) => re.test(p)) ?? null;

/** Shared building blocks so each pack stays short. */
const block = {
  area: (c: Ctx) => (c.areaPlace ? [about("area", 4, `Komt ${c.x} ook in ${c.areaPlace}?`, [`area:${c.areaPlace}`])] : []),
  areaRec: (c: Ctx) => (c.areaPlace ? [rec("area", 4, `${welk(c)} ${c.noun} komt in ${c.areaPlace}?`, [`area:${c.areaPlace}`])] : []),
  urgency: (c: Ctx, text: string) => (c.urgency != null ? [about("urgency", 5, text, ["urgency"])] : []),
  urgencyRec: (c: Ctx, text: string) => (c.urgency ? [rec("urgency", 5, text, ["urgency"])] : []),
  serviceYes: (c: Ctx, i: number, build: (s: string) => string) => (c.yes[i] ? [about("service", 6, build(c.yes[i]!), [`service:${c.yes[i]}`])] : []),
  serviceNo: (c: Ctx, i: number, build: (s: string) => string) => (c.no[i] ? [about("service", 7, build(c.no[i]!), [`service:${c.no[i]}`])] : []),
  serviceRec: (c: Ctx, i: number, build: (s: string) => string) => (c.yes[i] ? [rec("service", 6, build(c.yes[i]!), [`service:${c.yes[i]}`])] : []),
  cred: (c: Ctx, build: (s: string) => string) => (c.cred ? [about("credential", 12, build(c.cred), [`credential:${c.cred}`])] : []),
  credRec: (c: Ctx, build: (s: string) => string) => (c.cred ? [rec("credential", 12, build(c.cred), [`credential:${c.cred}`])] : []),
  policy: (c: Ctx, re: RegExp, build: (p: string) => string) => {
    const p = policyMatching(c, re);
    return p ? [about("policy", 10, build(p), [`policy:${p}`])] : [];
  },
  policyRec: (c: Ctx, re: RegExp, build: (p: string) => string) => {
    const p = policyMatching(c, re);
    return p ? [rec("policy", 10, build(p), [`policy:${p}`])] : [];
  },
  price: (c: Ctx, build: (label: string) => string) => (c.firstPrice ? [about("price", 9, build(c.firstPrice), [`price:${c.firstPrice}`])] : []),
  sundayRec: (c: Ctx) => (c.sundayOpen ? [rec("hours", 3, `${welk(c)} ${c.noun} in ${c.place} is op zondag open?`, ["hours.6"])] : []),
  saturdayRec: (c: Ctx) => (c.saturdayOpen ? [rec("hours", 3, `${welk(c)} ${c.noun} in ${c.place} is op zaterdag open?`, ["hours.5"])] : []),
  identity: (facts: Facts, c: Ctx) => (facts.notConfusedWith[0] ? [about("identity", 11, `Is ${c.x} hetzelfde bedrijf als ${facts.notConfusedWith[0]}?`, [`identity:${facts.notConfusedWith[0]}`])] : []),
};

// ---------------------------------------------------------------------------
// recommendation intents: one per intent in the core, the rest in the bank
// ---------------------------------------------------------------------------

/** Nouns that take "het" ("het beste restaurant", "Welk café"). */
const HET_NOUNS = new Set(["restaurant", "café"]);
const welk = (c: Ctx) => (HET_NOUNS.has(c.noun) ? "Welk" : "Welke");
const deBeste = (c: Ctx) => `${HET_NOUNS.has(c.noun) ? "het" : "de"} beste ${c.noun}`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Phrasings per intent; the first one goes in the core, the others in the bank. */
interface IntentWords {
  quality: string[];
  trust: string[];
  /** empty when price is not something customers of this sector ask about (care: the insurer pays) */
  price: string[];
  /** questions for a business with an emergency service / free places */
  urgent: string[];
}

function intentWords(c: Ctx): IntentWords {
  const N = c.noun;
  const P = c.place;
  const W = welk(c);
  const generic: IntentWords = {
    quality: [
      `Wat is ${deBeste(c)} in ${P}?`,
      `Kun je een goede ${N} in ${P} aanraden?`,
      `${W} ${N} in ${P} is echt goed?`,
      `Ik zoek een goede ${N} in ${P}, wie raad je aan?`,
      `${W} ${N} in ${P} zou jij kiezen?`,
      `${W} ${N} in ${P} heeft de meeste ervaring?`,
    ],
    trust: [
      `Betrouwbare ${N} in ${P}, wie raad je aan?`,
      `${W} ${N} in ${P} heeft goede reviews?`,
      `${W} ${N} in ${P} wordt vaak aangeraden?`,
      `Eerlijke ${N} in ${P}, wie kun je vertrouwen?`,
    ],
    price: [
      `Betaalbare ${N} in ${P}, wie raad je aan?`,
      `${W} ${N} in ${P} is niet te duur?`,
      `${upper(N)} in ${P} met een goede prijs-kwaliteitverhouding?`,
    ],
    urgent: [`${upper(N)} met spoed in ${P}, wie kan vandaag nog?`, `${W} ${N} in ${P} is ook in het weekend bereikbaar?`],
  };
  switch (c.slug) {
    case "horeca":
      return {
        quality: [`Wat is ${deBeste(c)} in ${P}?`, `Waar kan ik lekker eten in ${P}?`, `${W} ${N} in ${P} moet ik echt eens proberen?`, `Leuk ${N} in ${P} voor een etentje?`, `${W} ${N} in ${P} zou jij aanraden voor een verjaardag?`, `Waar eet je het lekkerst in ${P}?`, `${upper(N)} met een goede sfeer in ${P}?`],
        trust: [`${W} ${N} in ${P} heeft de beste reviews?`, `${W} ${N} in ${P} wordt het vaakst aangeraden?`, `Goed aangeschreven ${N} in ${P}?`, `Waar gaan mensen uit ${P} zelf graag eten?`],
        price: [`Goedkoop en lekker eten in ${P}, ${W.toLowerCase()} ${N}?`, `${W} ${N} in ${P} is betaalbaar?`],
        urgent: [],
      };
    case "loodgieters-installateurs":
      return { ...generic, urgent: [`Lekkage, wie kan vandaag nog komen in ${P}?`, `${W} ${N} in ${P} heeft een 24-uursdienst?`, `${upper(N)} met spoed in ${P}, wie kan vandaag nog?`, `Storing in het weekend, welke ${N} komt in ${P}?`] };
    case "zorg-praktijken":
      return {
        quality: [`Wat is ${deBeste(c)} in ${P}?`, `Kun je een goede ${N} in ${P} aanraden?`, `${W} ${N} in ${P} heeft goede ervaringen?`, `Ik ben nieuw in ${P}, welke ${N} raad je aan?`],
        trust: [`${W} ${N} in ${P} heeft goede reviews van patiënten?`, `Betrouwbare ${N} in ${P}, wie raad je aan?`, `${W} ${N} in ${P} neemt de tijd voor je?`],
        price: [],
        urgent: [`${W} ${N} in ${P} kan ik vandaag nog terecht?`, `${upper(N)} met spoed in ${P}, wie helpt vandaag nog?`],
      };
    case "kinderopvang-sport-rijscholen":
      return { ...generic, urgent: [`${W} ${N} in ${P} heeft nu plek?`, `${upper(N)} in ${P} zonder wachtlijst?`] };
    case "vve-beheer":
      return { ...generic, quality: [`Wat is ${deBeste(c)} in ${P}?`, `Goede VvE-beheerder voor een klein gebouw in ${P}?`, `Kun je een VvE-beheerder in ${P} aanraden?`, `Welke VvE-beheerder in ${P} zou jij kiezen?`] };
    case "advocaten-notarissen-accountants":
      return { ...generic, trust: [`Betrouwbare ${N} in ${P}, wie raad je aan?`, `${W} ${N} in ${P} heeft goede reviews?`, `${W} ${N} in ${P} legt dingen helder uit?`, `${W} ${N} in ${P} wordt vaak aangeraden?`] };
    default:
      return generic;
  }
}

/** Two ways to ask for a service: shops and restaurants "have" it, trades "do" it. */
function specialtyPhrases(c: Ctx, s: string): string[] {
  const W = welk(c);
  if (c.slug === "horeca" || c.slug === "winkels" || c.slug === "kinderopvang-sport-rijscholen") {
    return [`${W} ${c.noun} in ${c.place} heeft ${s}?`, `Waar in ${c.place} vind ik ${s}?`];
  }
  return [`${W} ${c.noun} in ${c.place} doet ${s}?`, `Wie is gespecialiseerd in ${s} in ${c.place}?`];
}

const intentRec = (intent: RecommendationIntent, category: FactKey, criterium: CriteriumId, textNl: string, probes: string[], pool: PromptPool = "core", season: Season | null = null): SectorPromptTemplate => ({
  ...rec(category, criterium, textNl, probes),
  intent,
  pool,
  ...(season ? { season } : {}),
});

/** Intent of a pack-specific recommendation prompt, from what it probes. */
function intentOf(p: SectorPromptTemplate): RecommendationIntent {
  if (p.intent) return p.intent;
  switch (p.category) {
    case "urgency":
    case "hours":
      return "now";
    case "area":
      return "place";
    case "price":
      return "price";
    default:
      return "specialty";
  }
}

/** Services that belong to a season: asked only then (rotation.ts). */
const SEASONAL: { match: RegExp; season: Season; build: (c: Ctx, s: string) => string }[] = [
  { match: /terras/i, season: "zomer", build: (c, s) => `${welk(c)} ${c.noun} in ${c.place} heeft een ${s} in de zon?` },
  { match: /airco|koeling/i, season: "zomer", build: (c, s) => `Wie installeert ${s} in ${c.place} voor de zomer?` },
  { match: /cv|verwarming|ketel|warmtepomp/i, season: "winter", build: (c, s) => `Verwarming doet het niet, wie helpt met ${s} in ${c.place}?` },
  { match: /goot|dak/i, season: "herfst", build: (c, s) => `Wie maakt ${s} in ${c.place} klaar voor de herfst?` },
  { match: /tuin|snoei|gras/i, season: "lente", build: (c, s) => `Wie doet ${s} in ${c.place} dit voorjaar?` },
  { match: /kerst|oliebol|feest/i, season: "winter", build: (c, s) => `Waar haal ik ${s} in ${c.place} rond de feestdagen?` },
];

/**
 * Turn a pack's raw list (questions about the business + its own
 * recommendation questions) into the core and the bank.
 */
function finish(list: SectorPromptTemplate[], c: Ctx): SectorPromptTemplate[] {
  const seen = new Set<string>();
  const add = (out: SectorPromptTemplate[], p: SectorPromptTemplate) => {
    if (seen.has(p.textNl)) return;
    seen.add(p.textNl);
    out.push(p);
  };
  const words = intentWords(c);
  const packRecs = list.filter((p) => p.kind === "recommendation").map((p) => ({ ...p, intent: intentOf(p) }));
  const core: SectorPromptTemplate[] = [];
  const bank: SectorPromptTemplate[] = [];
  for (const p of list.filter((x) => x.kind === "about").slice(0, 6)) add(core, p);

  // One core question per intent; what is left over goes to the bank.
  const quality = words.quality.map((t) => intentRec("quality", "existence", 6, t, [`existence:${INTENT_SUBJECT.quality}`]));
  const trust = words.trust.map((t) => intentRec("trust", "existence", 6, t, [`existence:${INTENT_SUBJECT.trust}`]));
  const price = words.price.map((t) => intentRec("price", "existence", 9, t, [`existence:${INTENT_SUBJECT.price}`]));
  const urgent = c.urgency ? words.urgent.map((t) => intentRec("now", "urgency", 5, t, ["urgency"])) : [];
  const now = [
    ...packRecs.filter((p) => p.intent === "now" && p.category === "urgency"),
    ...urgent,
    ...block.sundayRec(c).map((p) => ({ ...p, intent: "now" as const })),
    ...block.saturdayRec(c).map((p) => ({ ...p, intent: "now" as const })),
    ...packRecs.filter((p) => p.intent === "now" && p.category !== "urgency"),
  ];
  const specialty = [
    ...packRecs.filter((p) => p.intent === "specialty"),
    ...c.yes.slice(0, 3).flatMap((s) => specialtyPhrases(c, s).map((t) => intentRec("specialty", "service", 6, t, [`service:${s}`]))),
    ...(c.facts.credentials ?? []).map((s) => intentRec("specialty", "credential", 12, `${welk(c)} ${c.noun} in ${c.place} is erkend voor ${s}?`, [`credential:${s}`])),
  ];
  const otherPlaces = (c.facts.serviceArea?.places ?? []).filter((p) => p.toLowerCase() !== c.place.toLowerCase());
  const place = [
    ...packRecs.filter((p) => p.intent === "place"),
    ...otherPlaces.map((pl) => intentRec("place", "area", 4, `${welk(c)} ${c.noun} komt ook in ${pl}?`, [`area:${pl}`])),
    intentRec("place", "existence", 6, `${upper(c.noun)} bij mij in de buurt in ${c.place}?`, [`existence:${INTENT_SUBJECT.place}`]),
    intentRec("place", "existence", 6, `${upper(c.noun)} in het centrum van ${c.place}?`, [`existence:${INTENT_SUBJECT.place}`]),
  ];
  const groups: SectorPromptTemplate[][] = [quality, trust, now, specialty, price, place];
  for (const g of groups) if (g[0]) add(core, { ...g[0], pool: "core" });
  // Fewer than six intents apply (no spoed, no services, no price question): fill with more phrasings.
  const fillers = [quality[1], trust[1], quality[2], trust[2], place[1]].filter((x): x is SectorPromptTemplate => !!x);
  while (core.filter((p) => p.kind === "recommendation").length < 6 && fillers.length) add(core, { ...fillers.shift()!, pool: "core" });

  for (const g of groups) for (const p of g) add(bank, { ...p, pool: "bank" });
  for (const s of c.yes) {
    const seasonal = SEASONAL.find((x) => x.match.test(s));
    if (seasonal) add(bank, intentRec("specialty", "service", 6, seasonal.build(c, s), [`service:${s}`], "bank", seasonal.season));
  }
  return [...core, ...bank];
}

// ---------------------------------------------------------------------------
// the eleven packs
// ---------------------------------------------------------------------------

export const SECTORS: Record<SectorSlug, SectorPack> = {
  "loodgieters-installateurs": {
    slug: "loodgieters-installateurs",
    labelNl: "Loodgieters en installateurs",
    googleCategories: ["plumber", "electrician", "hvac_contractor", "heating_contractor", "loodgieter", "installateur", "elektricien", "cv-monteur", "installatiebedrijf"],
    sbiCodes: ["4321", "4322"],
    decisiveFacts: ["Werkgebied: in welke plaatsen je komt", "Spoed: of je vandaag of in het weekend kunt komen", "Erkenning: waarvoor je erkend bent"],
    typicalSource: "Gidsen, oude website",
    biggestRisk: "Niet genoemd bij spoedvraag",
    decisiveCriteria: [4, 5, 6, 12],
    nouns: [
      { match: /elektr/i, noun: "elektricien" },
      { match: /cv|verwarming|warmte/i, noun: "cv-monteur" },
      { match: /install/i, noun: "installateur" },
    ],
    defaultNoun: "loodgieter",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.area(c),
          ...block.urgency(c, `Heeft ${c.x} een storingsdienst in het weekend?`),
          ...block.cred(c, (s) => `Is ${c.x} erkend voor ${s}?`),
          ...block.policy(c, /voorrij/i, () => `Rekent ${c.x} voorrijkosten?`),
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.urgencyRec(c, `Lekkage, wie kan vandaag komen in ${c.place}?`),
          ...block.urgencyRec(c, `Welke ${c.noun} in ${c.place} heeft een 24-uursdienst?`),
          ...block.serviceRec(c, 0, (s) => `Wie installeert ${s} in ${c.place}?`),
          ...block.areaRec(c),
          ...block.credRec(c, () => `Welke erkende installateurs zitten in ${c.place}?`),
        ],
        c,
      );
    },
  },

  "aannemers-dakdekkers-schilders": {
    slug: "aannemers-dakdekkers-schilders",
    labelNl: "Aannemers, dakdekkers, schilders en hoveniers",
    googleCategories: ["general_contractor", "roofing_contractor", "painter", "landscaper", "aannemer", "dakdekker", "schilder", "hovenier", "stukadoor", "bouwbedrijf", "klusbedrijf"],
    sbiCodes: ["41", "4391", "4334", "4331", "8130", "4399"],
    decisiveFacts: ["Welke klussen je precies doet", "Of een naamgenoot met jou verward wordt", "Wat je rekent en waar je werkt"],
    typicalSource: "Naamgenoot, oud tarief",
    biggestRisk: "Niet op de shortlist",
    decisiveCriteria: [6, 11, 9, 4],
    nouns: [
      { match: /dak/i, noun: "dakdekker" },
      { match: /schilder/i, noun: "schilder" },
      { match: /hoven|tuin/i, noun: "hovenier" },
      { match: /stuk/i, noun: "stukadoor" },
    ],
    defaultNoun: "aannemer",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x} ongeveer?`),
          ...block.policy(c, /offerte/i, () => `Kan ik bij ${c.x} een gratis offerte krijgen?`),
          ...block.identity(facts, c),
          ...block.area(c),
          ...block.serviceRec(c, 0, (s) => `Wie doet ${s} in ${c.place}?`),
          ...block.serviceRec(c, 1, (s) => `Welke ${c.noun} in ${c.place} doet ${s}?`),
          ...block.areaRec(c),
          ...block.policyRec(c, /offerte/i, () => `Welke ${c.noun} in ${c.place} geeft een gratis offerte?`),
        ],
        c,
      );
    },
  },

  "vve-beheer": {
    slug: "vve-beheer",
    labelNl: "VvE-beheer en vastgoedbeheer",
    googleCategories: ["property_management_company", "property_management", "vve", "vastgoedbeheer", "vve-beheer", "vve beheer"],
    sbiCodes: ["6832"],
    decisiveFacts: ["Dat je bestaat en wat je doet (financieel, technisch, administratief)", "Wat je rekent per appartement", "Of je ergens bij aangesloten bent"],
    typicalSource: "Nergens vindbaar",
    biggestRisk: "Grijze stip",
    decisiveCriteria: [1, 6, 9, 12, 4],
    nouns: [],
    defaultNoun: "VvE-beheerder",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          about("existence", 1, `Welke VvE-beheerder is ${c.x}? Bestaat dat bedrijf?`, ["existence"]),
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.cred(c, (s) => `Is ${c.x} aangesloten bij ${s}?`),
          ...block.area(c),
          ...block.identity(facts, c),
          ...block.serviceRec(c, 0, (s) => `Welke VvE-beheerder in ${c.place} doet ook ${s}?`),
          rec("existence", 1, `VvE-beheerder voor 12 appartementen in ${c.place}, wie kan dat doen?`, ["existence"]),
          ...block.areaRec(c),
          ...block.credRec(c, (s) => `Welke VvE-beheerders in ${c.place} zijn aangesloten bij ${s}?`),
        ],
        c,
      );
    },
  },

  "zorg-praktijken": {
    slug: "zorg-praktijken",
    labelNl: "Fysiotherapie, tandarts, huisarts, dierenarts en psycholoog",
    googleCategories: ["physiotherapist", "dentist", "doctor", "veterinary_care", "psychologist", "dental_clinic", "medical_clinic", "fysio", "tandarts", "huisarts", "dierenarts", "psycholoog", "praktijk"],
    sbiCodes: ["8621", "8622", "8623", "8691", "8692", "7500"],
    decisiveFacts: ["Of je nieuwe patiënten aanneemt", "Spoed: of je vandaag nog terecht kunt", "Verwijzing, verzekeraars en registratie"],
    typicalSource: "Oud bericht, gids",
    biggestRisk: "\"Neemt niemand aan\"",
    decisiveCriteria: [1, 5, 10, 12],
    nouns: [
      { match: /fysio/i, noun: "fysio" },
      { match: /tandarts|mondzorg/i, noun: "tandarts" },
      { match: /huisarts/i, noun: "huisarts" },
      { match: /dierenarts|dierenkliniek/i, noun: "dierenarts" },
      { match: /psycho/i, noun: "psycholoog" },
    ],
    defaultNoun: "praktijk",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.serviceYes(c, 0, (s) => `Kan ik bij ${c.x} terecht voor ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.urgency(c, `Heeft ${c.x} een spoeddienst?`),
          ...block.policy(c, /verwijz/i, () => `Kan ik bij ${c.x} terecht zonder verwijzing?`),
          ...block.policy(c, /patiënt|patient/i, (p) => `Geldt bij ${c.x}: "${p}"?`),
          ...block.cred(c, (s) => `Heeft ${c.x} een ${s}?`),
          ...block.urgencyRec(c, `Welke ${c.noun} in ${c.place} heeft vanavond een spoeddienst?`),
          ...block.policyRec(c, /verwijz/i, () => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} zonder verwijzing in ${c.place}?`),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} doet ${s}?`),
          ...block.policyRec(c, /nieuwe patiënt|nieuwe patient/i, () => `Welke ${c.noun} in ${c.place} neemt nieuwe patiënten aan?`),
        ],
        c,
      );
    },
  },

  horeca: {
    slug: "horeca",
    labelNl: "Horeca: restaurants, cafés en lunchrooms",
    googleCategories: ["restaurant", "cafe", "bar", "meal_takeaway", "coffee_shop", "lunchroom", "eetcafe", "eetcafé", "brasserie", "bistro", "pizzeria", "grand café"],
    sbiCodes: ["5610", "5630", "5629"],
    decisiveFacts: ["Openingstijden per dag, ook de keuken", "Reserveren en pinnen", "Terras, groepen en vegetarisch"],
    typicalSource: "Gids 2022, naamgenoot",
    biggestRisk: "\"Gesloten\" terwijl open",
    decisiveCriteria: [3, 1, 10, 6],
    nouns: [
      { match: /caf[eé]/i, noun: "café" },
      { match: /lunch/i, noun: "lunchroom" },
    ],
    defaultNoun: "restaurant",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          about("hours", 3, `Is ${c.x} op maandag open?`, ["hours.0"]),
          ...block.policy(c, /reserv/i, () => `Kan ik bij ${c.x} reserveren voor 6 personen?`),
          ...block.serviceYes(c, 0, (s) => `Heeft ${c.x} ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Heeft ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.identity(facts, c),
          ...block.sundayRec(c),
          ...block.serviceRec(c, 0, (s) => `Welk ${c.noun} in ${c.place} heeft ${s}?`),
          ...block.policyRec(c, /reserv/i, () => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} in ${c.place} waar ik kan reserveren voor 6?`),
          ...block.saturdayRec(c),
        ],
        c,
      );
    },
  },

  winkels: {
    slug: "winkels",
    labelNl: "Winkels en retail",
    googleCategories: ["store", "bakery", "supermarket", "clothing_store", "florist", "book_store", "shoe_store", "jewelry_store", "pet_store", "hardware_store", "winkel", "bakkerij", "slager", "bloemist", "boekhandel", "drogist", "kledingwinkel"],
    sbiCodes: ["47", "1071"],
    decisiveFacts: ["Koopzondag en feestdagen", "Je adres, ook na een verhuizing", "Wat je verkoopt"],
    typicalSource: "Gidsen na verhuizing",
    biggestRisk: "Bezoek dat niet komt",
    decisiveCriteria: [3, 8, 6],
    nouns: [
      { match: /bakker/i, noun: "bakker" },
      { match: /slager/i, noun: "slager" },
      { match: /bloem/i, noun: "bloemist" },
      { match: /boek/i, noun: "boekhandel" },
      { match: /drogist/i, noun: "drogist" },
    ],
    defaultNoun: "winkel",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          about("hours", 3, `Is ${c.x} op koopzondag open?`, ["hours.6"]),
          ...block.serviceYes(c, 0, (s) => `Verkoopt ${c.x} ook ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Heeft ${c.x} ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Kan ik bij ${c.x} ${s}?`),
          ...block.policy(c, /bestel|afhal/i, (p) => `Geldt bij ${c.x}: "${p}"?`),
          about("address", 8, `Zit ${c.x} nog op hetzelfde adres?`, ["address"]),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} verkoopt ${s}?`),
          ...block.sundayRec(c),
          ...block.serviceRec(c, 1, (s) => `Waar in ${c.place} kan ik ${s} kopen?`),
          ...block.saturdayRec(c),
        ],
        c,
      );
    },
  },

  "garages-fietsenmakers": {
    slug: "garages-fietsenmakers",
    labelNl: "Autogarages, fietsenmakers en reparatie",
    googleCategories: ["car_repair", "car_dealer", "auto_parts_store", "bicycle_store", "bicycle_repair", "garage", "autobedrijf", "fietsenmaker", "fietsenwinkel", "rijwiel", "apk"],
    sbiCodes: ["4520", "4511", "9529", "4764"],
    decisiveFacts: ["Wat een APK of reparatie kost", "Welke merken en soorten je doet", "Of je zonder afspraak terecht kunt"],
    typicalSource: "Oude prijs op site",
    biggestRisk: "Verkeerde vergelijking",
    decisiveCriteria: [9, 6, 7, 10],
    nouns: [
      { match: /fiets|rijwiel|bike/i, noun: "fietsenmaker" },
    ],
    defaultNoun: "garage",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Repareert ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.policy(c, /afspraak/i, () => `Kan ik bij ${c.x} zonder afspraak langskomen?`),
          ...block.area(c),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} doet ${s}?`),
          ...block.serviceRec(c, 1, (s) => `Wie repareert ${s} in ${c.place}?`),
          ...block.policyRec(c, /zonder afspraak/i, () => `Welke ${c.noun} in ${c.place} helpt zonder afspraak?`),
          ...block.saturdayRec(c),
        ],
        c,
      );
    },
  },

  "kappers-schoonheid": {
    slug: "kappers-schoonheid",
    labelNl: "Kappers, schoonheid en wellness",
    googleCategories: ["hair_care", "hair_salon", "beauty_salon", "spa", "nail_salon", "barber_shop", "kapper", "kapsalon", "barbier", "schoonheidssalon", "nagelstudio", "wellness"],
    sbiCodes: ["9602", "9604"],
    decisiveFacts: ["Of je zonder afspraak terecht kunt", "Wat knippen kost", "Je openingstijden"],
    typicalSource: "Geen website",
    biggestRisk: "Grijze stip",
    decisiveCriteria: [3, 10, 9, 1],
    nouns: [
      { match: /barber|barbier/i, noun: "barbier" },
      { match: /schoonheid|beauty|nagel/i, noun: "schoonheidssalon" },
    ],
    defaultNoun: "kapper",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.policy(c, /afspraak/i, () => `Kan ik bij ${c.x} zonder afspraak terecht?`),
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          about("hours", 3, `Is ${c.x} op maandag open?`, ["hours.0"]),
          ...block.policyRec(c, /zonder afspraak/i, () => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} in ${c.place} zonder afspraak?`),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} doet ${s}?`),
          ...block.saturdayRec(c),
          ...block.sundayRec(c),
        ],
        c,
      );
    },
  },

  "advocaten-notarissen-accountants": {
    slug: "advocaten-notarissen-accountants",
    labelNl: "Advocaten, notarissen, accountants en administratiekantoren",
    googleCategories: ["lawyer", "notary_public", "accounting", "tax_consultant", "advocaat", "advocatenkantoor", "notaris", "accountant", "administratiekantoor", "belastingadviseur"],
    sbiCodes: ["6910", "6920"],
    decisiveFacts: ["Welke specialismen je hebt", "Of je ook particulieren helpt", "Of een naamgenoot met een tuchtzaak jou wordt aangerekend"],
    typicalSource: "Oud artikel, tuchtzaak naamgenoot",
    biggestRisk: "Vertrouwen weg",
    decisiveCriteria: [6, 7, 11, 12, 9],
    nouns: [
      { match: /notar/i, noun: "notaris" },
      { match: /account|administratie|belasting/i, noun: "accountant" },
    ],
    defaultNoun: "advocaat",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Kan ik bij ${c.x} terecht voor ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.cred(c, (s) => `Is ${c.x} aangesloten bij ${s}?`),
          ...block.identity(facts, c),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} doet ${s}?`),
          ...block.serviceRec(c, 1, (s) => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} ${s} in ${c.place}, wie kan ik bellen?`),
          ...block.credRec(c, (s) => `Welke ${c.noun} in ${c.place} is aangesloten bij ${s}?`),
          ...block.areaRec(c),
        ],
        c,
      );
    },
  },

  "makelaars-hypotheek": {
    slug: "makelaars-hypotheek",
    labelNl: "Makelaars en hypotheekadviseurs",
    googleCategories: ["real_estate_agency", "real_estate_agent", "mortgage_broker", "mortgage_lender", "makelaar", "makelaardij", "hypotheekadviseur", "hypotheek"],
    sbiCodes: ["6831", "6619"],
    decisiveFacts: ["Wat je rekent (courtage of vaste prijs)", "Waar je bij aangesloten bent", "In welke plaatsen je werkt"],
    typicalSource: "Oude pagina",
    biggestRisk: "Verkeerde prijs",
    decisiveCriteria: [9, 12, 4],
    nouns: [{ match: /hypotheek/i, noun: "hypotheekadviseur" }],
    defaultNoun: "makelaar",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.cred(c, (s) => `Is ${c.x} ${s}?`),
          ...block.serviceYes(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.area(c),
          ...block.policy(c, /vaste prijs|courtage/i, (p) => `Geldt bij ${c.x}: "${p}"?`),
          ...block.areaRec(c),
          ...block.credRec(c, (s) => `Welke ${c.noun} in ${c.place} is ${s}?`),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} doet ook ${s}?`),
          ...block.policyRec(c, /vaste prijs/i, () => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} in ${c.place} met vaste prijs?`),
        ],
        c,
      );
    },
  },

  "kinderopvang-sport-rijscholen": {
    slug: "kinderopvang-sport-rijscholen",
    labelNl: "Kinderopvang, sportscholen en rijscholen",
    googleCategories: ["child_care_agency", "day_care", "preschool", "gym", "fitness_center", "sports_club", "driving_school", "kinderopvang", "kinderdagverblijf", "bso", "sportschool", "fitness", "rijschool", "autorijschool"],
    sbiCodes: ["8891", "9311", "9313", "8553"],
    decisiveFacts: ["Of er plek is of een wachtlijst", "Je openingstijden", "Wat je aanbiedt (baby, automaat, vroeg open)"],
    typicalSource: "Oud bericht",
    biggestRisk: "\"Vol\" terwijl plek",
    decisiveCriteria: [5, 3, 6],
    nouns: [
      { match: /sport|fit|gym/i, noun: "sportschool" },
      { match: /rijschool|rijles|autorij/i, noun: "rijschool" },
    ],
    defaultNoun: "kinderopvang",
    prompts(facts) {
      const c = ctxFor(facts, this);
      return finish(
        [
          ...block.urgency(c, `Heeft ${c.x} nu plek, of is er een wachtlijst?`),
          about("hours", 3, `Hoe laat gaat ${c.x} op maandag open?`, ["hours.0"]),
          ...block.serviceYes(c, 0, (s) => `Heeft ${c.x} ${s}?`),
          ...block.serviceYes(c, 1, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.serviceNo(c, 0, (s) => `Doet ${c.x} ook ${s}?`),
          ...block.price(c, (l) => `Wat kost ${l} bij ${c.x}?`),
          ...block.urgencyRec(c, `Welke ${c.noun} in ${c.place} heeft nu plek?`),
          ...block.serviceRec(c, 0, (s) => `Welke ${c.noun} in ${c.place} heeft ${s}?`),
          ...block.saturdayRec(c),
          ...block.serviceRec(c, 1, (s) => `${c.noun.charAt(0).toUpperCase() + c.noun.slice(1)} in ${c.place} met ${s}?`),
        ],
        c,
      );
    },
  },
};

export const SECTOR_LIST: SectorPack[] = SECTOR_SLUGS.map((s) => SECTORS[s]);

export function sectorPack(slug: SectorSlug | null | undefined): SectorPack | null {
  return slug ? (SECTORS[slug] ?? null) : null;
}

export function isSectorSlug(s: unknown): s is SectorSlug {
  return typeof s === "string" && (SECTOR_SLUGS as string[]).includes(s);
}

/**
 * Infer the sector from the Google category (Places type or a Dutch category
 * word) or the KvK SBI code. An explicit override always wins. Returns null
 * when nothing matches, so the owner picks one by hand.
 */
export function inferSector(googleCategory?: string | null, sbi?: string | null, override?: SectorSlug | null): SectorSlug | null {
  if (override && isSectorSlug(override)) return override;
  const cat = (googleCategory ?? "").toLowerCase().trim();
  if (cat) {
    // Whole-word match on the category ("hair_salon" -> hair, salon; "Bakkerij De Vries" -> bakkerij),
    // or a longer category word inside it ("installatiebedrijf" contains "installateur"? no; "loodgietersbedrijf" contains "loodgieter").
    const words = new Set(cat.split(/[^a-z\u00c0-\u024f-]+/).filter(Boolean));
    for (const pack of SECTOR_LIST) {
      if (pack.googleCategories.some((g) => cat === g || words.has(g) || (g.length >= 6 && cat.includes(g)))) return pack.slug;
    }
  }
  const code = (sbi ?? "").replace(/\D/g, "");
  if (code) {
    // Longest prefix wins ("4322" before "43").
    let best: { slug: SectorSlug; len: number } | null = null;
    for (const pack of SECTOR_LIST) {
      for (const prefix of pack.sbiCodes) {
        if (code.startsWith(prefix) && (!best || prefix.length > best.len)) best = { slug: pack.slug, len: prefix.length };
      }
    }
    if (best) return best.slug;
  }
  return null;
}

/** Prompts for a sector pack, or none when the business has no sector. */
export function sectorPrompts(facts: Facts, sector: SectorSlug | null | undefined): SectorPromptTemplate[] {
  const pack = sectorPack(sector);
  return pack ? pack.prompts(facts) : [];
}
