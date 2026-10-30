/**
 * English sector questions, for businesses outside the Netherlands.
 *
 * sectorPromptsEn(facts, sector) returns the same list as sectorPrompts in
 * sectors.ts, item for item: same category, criterium, kind, pool, probes,
 * intent, season and order. Only textNl differs; it holds the question in the
 * scan language (here English), the way a customer would type it.
 *
 * The branching mirrors sectors.ts line by line. Every question is built as a
 * pair (Dutch, English) and de-duplicated on the Dutch text, exactly as
 * finish() does there, so the two lists stay aligned even where two Dutch
 * phrasings would read the same in English. test/sectors-en.test.ts checks the
 * alignment for every pack; a change to sectors.ts must be made here too.
 *
 * Owner-entered values (services, places, policies, prices, credentials) are
 * inserted verbatim. Which policies and seasonal services produce a question
 * is decided by the Dutch patterns in sectors.ts, so the lists match.
 */
import type { CriteriumId, FactKey, Facts, PromptPool, RecommendationIntent, Season, SectorSlug } from "../types";
import { INTENT_SUBJECT } from "../types";
import { SECTORS, type SectorPromptTemplate } from "./sectors";

/** A question in Dutch (the de-duplication key, as in sectors.ts) and in English (the text). */
type Text = { nl: string; en: string };
type Tpl = SectorPromptTemplate & { key: string };

interface Ctx {
  slug: SectorSlug;
  facts: Facts;
  place: string;
  x: string; // "Name in Place", the same in both languages
  nounNl: string;
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

// ---------------------------------------------------------------------------
// English nouns: matched on the name first, then on the Google types (English
// and Dutch words both, so a Dutch-named business still gets a sensible noun)
// ---------------------------------------------------------------------------

const NOUNS_EN: Record<SectorSlug, { nouns: { match: RegExp; noun: string }[]; defaultNoun: string }> = {
  "loodgieters-installateurs": {
    nouns: [
      { match: /elektr|electric/i, noun: "electrician" },
      { match: /cv|verwarming|warmte|hvac|heating|boiler/i, noun: "heating engineer" },
      { match: /install/i, noun: "installer" },
    ],
    defaultNoun: "plumber",
  },
  "aannemers-dakdekkers-schilders": {
    nouns: [
      { match: /dak|roof/i, noun: "roofer" },
      { match: /schilder|paint/i, noun: "painter" },
      { match: /hoven|tuin|landscap|garden/i, noun: "landscaper" },
      { match: /stuk|plaster/i, noun: "plasterer" },
    ],
    defaultNoun: "builder",
  },
  "vve-beheer": { nouns: [], defaultNoun: "homeowners' association manager" },
  "zorg-praktijken": {
    nouns: [
      { match: /fysio|physio/i, noun: "physiotherapist" },
      { match: /tandarts|mondzorg|dentist|dental/i, noun: "dentist" },
      { match: /huisarts|general practi|\bgp\b|doctor/i, noun: "GP" },
      { match: /dierenarts|dierenkliniek|veterinar|\bvets?\b/i, noun: "vet" },
      { match: /psycho/i, noun: "psychologist" },
    ],
    defaultNoun: "practice",
  },
  horeca: {
    nouns: [
      { match: /caf[eé]|coffee/i, noun: "café" },
      { match: /lunch/i, noun: "lunch spot" },
    ],
    defaultNoun: "restaurant",
  },
  winkels: {
    nouns: [
      { match: /bakker|bakery/i, noun: "bakery" },
      { match: /slager|butcher/i, noun: "butcher" },
      { match: /bloem|florist|flower/i, noun: "florist" },
      { match: /boek|book/i, noun: "bookshop" },
      { match: /drogist|drugstore|chemist|pharmac/i, noun: "chemist" },
    ],
    defaultNoun: "shop",
  },
  "garages-fietsenmakers": {
    nouns: [{ match: /fiets|rijwiel|bike|bicycle|cycle/i, noun: "bike repair shop" }],
    defaultNoun: "garage",
  },
  "kappers-schoonheid": {
    nouns: [
      { match: /barber|barbier/i, noun: "barber" },
      { match: /schoonheid|beauty|nagel|nail/i, noun: "beauty salon" },
    ],
    defaultNoun: "hair salon",
  },
  "advocaten-notarissen-accountants": {
    nouns: [
      { match: /notar/i, noun: "notary" },
      { match: /account|administratie|belasting|tax|bookkeep/i, noun: "accountant" },
    ],
    defaultNoun: "lawyer",
  },
  "makelaars-hypotheek": {
    nouns: [{ match: /hypotheek|mortgage/i, noun: "mortgage adviser" }],
    defaultNoun: "estate agent",
  },
  "kinderopvang-sport-rijscholen": {
    nouns: [
      { match: /sport|fit|gym/i, noun: "gym" },
      { match: /rijschool|rijles|autorij|driving/i, noun: "driving school" },
    ],
    defaultNoun: "daycare",
  },
};

function pickNoun(facts: Facts, nouns: { match: RegExp; noun: string }[], fallback: string): string {
  const types = facts.googleTypes ?? [];
  return nouns.find((n) => n.match.test(facts.name))?.noun ?? nouns.find((n) => types.some((t) => n.match.test(t)))?.noun ?? fallback;
}

function ctxFor(facts: Facts, slug: SectorSlug): Ctx {
  const nl = SECTORS[slug];
  const en = NOUNS_EN[slug];
  const open = (day: number) => {
    const h = facts.hours.find((x) => x.day === day);
    return !!h && !h.closed && !!h.open && !!h.close;
  };
  return {
    slug,
    facts,
    place: facts.place,
    x: `${facts.name} in ${facts.place}`,
    nounNl: pickNoun(facts, nl.nouns, nl.defaultNoun),
    noun: pickNoun(facts, en.nouns, en.defaultNoun),
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

// ---------------------------------------------------------------------------
// helpers (mirroring sectors.ts)
// ---------------------------------------------------------------------------

const T = (nl: string, en: string): Text => ({ nl, en });
const about = (category: FactKey, criterium: CriteriumId, t: Text, probes: string[]): Tpl => ({ category, criterium, kind: "about", textNl: t.en, key: t.nl, probes, active: true, pool: "core" });
const rec = (category: FactKey, criterium: CriteriumId, t: Text, probes: string[]): Tpl => ({ category, criterium, kind: "recommendation", textNl: t.en, key: t.nl, probes, active: true, pool: "core" });

const HET_NOUNS = new Set(["restaurant", "café"]);
const welk = (c: Ctx) => (HET_NOUNS.has(c.nounNl) ? "Welk" : "Welke");
const deBeste = (c: Ctx) => `${HET_NOUNS.has(c.nounNl) ? "het" : "de"} beste ${c.nounNl}`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a plumber", "an electrician". */
const a = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;

const policyMatching = (c: Ctx, re: RegExp) => c.policies.find((p) => re.test(p)) ?? null;

const block = {
  area: (c: Ctx) => (c.areaPlace ? [about("area", 4, T(`Komt ${c.x} ook in ${c.areaPlace}?`, `Does ${c.x} also cover ${c.areaPlace}?`), [`area:${c.areaPlace}`])] : []),
  areaRec: (c: Ctx) => (c.areaPlace ? [rec("area", 4, T(`${welk(c)} ${c.nounNl} komt in ${c.areaPlace}?`, `Which ${c.noun} covers ${c.areaPlace}?`), [`area:${c.areaPlace}`])] : []),
  urgency: (c: Ctx, t: Text) => (c.urgency != null ? [about("urgency", 5, t, ["urgency"])] : []),
  urgencyRec: (c: Ctx, t: Text) => (c.urgency ? [rec("urgency", 5, t, ["urgency"])] : []),
  serviceYes: (c: Ctx, i: number, build: (s: string) => Text) => (c.yes[i] ? [about("service", 6, build(c.yes[i]!), [`service:${c.yes[i]}`])] : []),
  serviceNo: (c: Ctx, i: number, build: (s: string) => Text) => (c.no[i] ? [about("service", 7, build(c.no[i]!), [`service:${c.no[i]}`])] : []),
  serviceRec: (c: Ctx, i: number, build: (s: string) => Text) => (c.yes[i] ? [rec("service", 6, build(c.yes[i]!), [`service:${c.yes[i]}`])] : []),
  cred: (c: Ctx, build: (s: string) => Text) => (c.cred ? [about("credential", 12, build(c.cred), [`credential:${c.cred}`])] : []),
  credRec: (c: Ctx, build: (s: string) => Text) => (c.cred ? [rec("credential", 12, build(c.cred), [`credential:${c.cred}`])] : []),
  policy: (c: Ctx, re: RegExp, build: (p: string) => Text) => {
    const p = policyMatching(c, re);
    return p ? [about("policy", 10, build(p), [`policy:${p}`])] : [];
  },
  policyRec: (c: Ctx, re: RegExp, build: (p: string) => Text) => {
    const p = policyMatching(c, re);
    return p ? [rec("policy", 10, build(p), [`policy:${p}`])] : [];
  },
  price: (c: Ctx, build: (label: string) => Text) => (c.firstPrice ? [about("price", 9, build(c.firstPrice), [`price:${c.firstPrice}`])] : []),
  sundayRec: (c: Ctx) => (c.sundayOpen ? [rec("hours", 3, T(`${welk(c)} ${c.nounNl} in ${c.place} is op zondag open?`, `Which ${c.noun} in ${c.place} is open on Sunday?`), ["hours.6"])] : []),
  saturdayRec: (c: Ctx) => (c.saturdayOpen ? [rec("hours", 3, T(`${welk(c)} ${c.nounNl} in ${c.place} is op zaterdag open?`, `Which ${c.noun} in ${c.place} is open on Saturday?`), ["hours.5"])] : []),
  identity: (facts: Facts, c: Ctx) =>
    facts.notConfusedWith[0] ? [about("identity", 11, T(`Is ${c.x} hetzelfde bedrijf als ${facts.notConfusedWith[0]}?`, `Is ${c.x} the same business as ${facts.notConfusedWith[0]}?`), [`identity:${facts.notConfusedWith[0]}`])] : [],
};

interface IntentWords {
  quality: Text[];
  trust: Text[];
  price: Text[];
  urgent: Text[];
}

function intentWords(c: Ctx): IntentWords {
  const N = c.nounNl;
  const E = c.noun;
  const P = c.place;
  const W = welk(c);
  const generic: IntentWords = {
    quality: [
      T(`Wat is ${deBeste(c)} in ${P}?`, `What is the best ${E} in ${P}?`),
      T(`Kun je een goede ${N} in ${P} aanraden?`, `Can you recommend a good ${E} in ${P}?`),
      T(`${W} ${N} in ${P} is echt goed?`, `Which ${E} in ${P} is really good?`),
      T(`Ik zoek een goede ${N} in ${P}, wie raad je aan?`, `I'm looking for a good ${E} in ${P}, who would you recommend?`),
      T(`${W} ${N} in ${P} zou jij kiezen?`, `Which ${E} in ${P} would you choose?`),
      T(`${W} ${N} in ${P} heeft de meeste ervaring?`, `Which ${E} in ${P} has the most experience?`),
    ],
    trust: [
      T(`Betrouwbare ${N} in ${P}, wie raad je aan?`, `Reliable ${E} in ${P}, who would you recommend?`),
      T(`${W} ${N} in ${P} heeft goede reviews?`, `Which ${E} in ${P} has good reviews?`),
      T(`${W} ${N} in ${P} wordt vaak aangeraden?`, `Which ${E} in ${P} is often recommended?`),
      T(`Eerlijke ${N} in ${P}, wie kun je vertrouwen?`, `Honest ${E} in ${P}, who can you trust?`),
    ],
    price: [
      T(`Betaalbare ${N} in ${P}, wie raad je aan?`, `Affordable ${E} in ${P}, who would you recommend?`),
      T(`${W} ${N} in ${P} is niet te duur?`, `Which ${E} in ${P} isn't too expensive?`),
      T(`${upper(N)} in ${P} met een goede prijs-kwaliteitverhouding?`, `${upper(E)} in ${P} with good value for money?`),
    ],
    urgent: [
      T(`${upper(N)} met spoed in ${P}, wie kan vandaag nog?`, `I need ${a(E)} in ${P} urgently, who can come today?`),
      T(`${W} ${N} in ${P} is ook in het weekend bereikbaar?`, `Which ${E} in ${P} can also be reached at the weekend?`),
    ],
  };
  switch (c.slug) {
    case "horeca":
      return {
        quality: [
          T(`Wat is ${deBeste(c)} in ${P}?`, `What is the best ${E} in ${P}?`),
          T(`Waar kan ik lekker eten in ${P}?`, `Where can I get a good meal in ${P}?`),
          T(`${W} ${N} in ${P} moet ik echt eens proberen?`, `Which ${E} in ${P} should I really try?`),
          T(`Leuk ${N} in ${P} voor een etentje?`, `A nice ${E} in ${P} for dinner out?`),
          T(`${W} ${N} in ${P} zou jij aanraden voor een verjaardag?`, `Which ${E} in ${P} would you recommend for a birthday?`),
          T(`Waar eet je het lekkerst in ${P}?`, `Where is the best food in ${P}?`),
          T(`${upper(N)} met een goede sfeer in ${P}?`, `${upper(E)} with a good atmosphere in ${P}?`),
        ],
        trust: [
          T(`${W} ${N} in ${P} heeft de beste reviews?`, `Which ${E} in ${P} has the best reviews?`),
          T(`${W} ${N} in ${P} wordt het vaakst aangeraden?`, `Which ${E} in ${P} is recommended most often?`),
          T(`Goed aangeschreven ${N} in ${P}?`, `Well-reviewed ${E} in ${P}?`),
          T(`Waar gaan mensen uit ${P} zelf graag eten?`, `Where do locals in ${P} like to eat?`),
        ],
        price: [
          T(`Goedkoop en lekker eten in ${P}, ${W.toLowerCase()} ${N}?`, `Cheap and good food in ${P}, which ${E}?`),
          T(`${W} ${N} in ${P} is betaalbaar?`, `Which ${E} in ${P} is affordable?`),
        ],
        urgent: [],
      };
    case "loodgieters-installateurs":
      return {
        ...generic,
        urgent: [
          T(`Lekkage, wie kan vandaag nog komen in ${P}?`, `I have a leak, who can still come out today in ${P}?`),
          T(`${W} ${N} in ${P} heeft een 24-uursdienst?`, `Which ${E} in ${P} has a 24-hour service?`),
          T(`${upper(N)} met spoed in ${P}, wie kan vandaag nog?`, `I need ${a(E)} in ${P} urgently, who can come today?`),
          T(`Storing in het weekend, welke ${N} komt in ${P}?`, `Something broke down at the weekend, which ${E} will come out in ${P}?`),
        ],
      };
    case "zorg-praktijken":
      return {
        quality: [
          T(`Wat is ${deBeste(c)} in ${P}?`, `What is the best ${E} in ${P}?`),
          T(`Kun je een goede ${N} in ${P} aanraden?`, `Can you recommend a good ${E} in ${P}?`),
          T(`${W} ${N} in ${P} heeft goede ervaringen?`, `Which ${E} in ${P} do people have good experiences with?`),
          T(`Ik ben nieuw in ${P}, welke ${N} raad je aan?`, `I'm new to ${P}, which ${E} would you recommend?`),
        ],
        trust: [
          T(`${W} ${N} in ${P} heeft goede reviews van patiënten?`, `Which ${E} in ${P} has good reviews from patients?`),
          T(`Betrouwbare ${N} in ${P}, wie raad je aan?`, `Reliable ${E} in ${P}, who would you recommend?`),
          T(`${W} ${N} in ${P} neemt de tijd voor je?`, `Which ${E} in ${P} takes the time for you?`),
        ],
        price: [],
        urgent: [
          T(`${W} ${N} in ${P} kan ik vandaag nog terecht?`, `Which ${E} in ${P} can see me today?`),
          T(`${upper(N)} met spoed in ${P}, wie helpt vandaag nog?`, `I need ${a(E)} in ${P} urgently, who can help today?`),
        ],
      };
    case "kinderopvang-sport-rijscholen":
      return {
        ...generic,
        urgent: [
          T(`${W} ${N} in ${P} heeft nu plek?`, `Which ${E} in ${P} has places available now?`),
          T(`${upper(N)} in ${P} zonder wachtlijst?`, `${upper(E)} in ${P} without a waiting list?`),
        ],
      };
    case "vve-beheer":
      return {
        ...generic,
        quality: [
          T(`Wat is ${deBeste(c)} in ${P}?`, `What is the best ${E} in ${P}?`),
          T(`Goede VvE-beheerder voor een klein gebouw in ${P}?`, `A good ${E} for a small building in ${P}?`),
          T(`Kun je een VvE-beheerder in ${P} aanraden?`, `Can you recommend ${a(E)} in ${P}?`),
          T(`Welke VvE-beheerder in ${P} zou jij kiezen?`, `Which ${E} in ${P} would you choose?`),
        ],
      };
    case "advocaten-notarissen-accountants":
      return {
        ...generic,
        trust: [
          T(`Betrouwbare ${N} in ${P}, wie raad je aan?`, `Reliable ${E} in ${P}, who would you recommend?`),
          T(`${W} ${N} in ${P} heeft goede reviews?`, `Which ${E} in ${P} has good reviews?`),
          T(`${W} ${N} in ${P} legt dingen helder uit?`, `Which ${E} in ${P} explains things clearly?`),
          T(`${W} ${N} in ${P} wordt vaak aangeraden?`, `Which ${E} in ${P} is often recommended?`),
        ],
      };
    default:
      return generic;
  }
}

function specialtyPhrases(c: Ctx, s: string): Text[] {
  const W = welk(c);
  if (c.slug === "horeca" || c.slug === "winkels" || c.slug === "kinderopvang-sport-rijscholen") {
    return [T(`${W} ${c.nounNl} in ${c.place} heeft ${s}?`, `Which ${c.noun} in ${c.place} has ${s}?`), T(`Waar in ${c.place} vind ik ${s}?`, `Where in ${c.place} can I find ${s}?`)];
  }
  return [T(`${W} ${c.nounNl} in ${c.place} doet ${s}?`, `Which ${c.noun} in ${c.place} does ${s}?`), T(`Wie is gespecialiseerd in ${s} in ${c.place}?`, `Who specialises in ${s} in ${c.place}?`)];
}

const intentRec = (intent: RecommendationIntent, category: FactKey, criterium: CriteriumId, t: Text, probes: string[], pool: PromptPool = "core", season: Season | null = null): Tpl => ({
  ...rec(category, criterium, t, probes),
  intent,
  pool,
  ...(season ? { season } : {}),
});

function intentOf(p: Tpl): RecommendationIntent {
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

/** Same match patterns and seasons as sectors.ts, so the same services get a seasonal question. */
const SEASONAL: { match: RegExp; season: Season; build: (c: Ctx, s: string) => Text }[] = [
  { match: /terras/i, season: "zomer", build: (c, s) => T(`${welk(c)} ${c.nounNl} in ${c.place} heeft een ${s} in de zon?`, `Which ${c.noun} in ${c.place} has ${s} in the sun?`) },
  { match: /airco|koeling/i, season: "zomer", build: (c, s) => T(`Wie installeert ${s} in ${c.place} voor de zomer?`, `Who can install ${s} in ${c.place} before the summer?`) },
  { match: /cv|verwarming|ketel|warmtepomp/i, season: "winter", build: (c, s) => T(`Verwarming doet het niet, wie helpt met ${s} in ${c.place}?`, `My heating isn't working, who can help with ${s} in ${c.place}?`) },
  { match: /goot|dak/i, season: "herfst", build: (c, s) => T(`Wie maakt ${s} in ${c.place} klaar voor de herfst?`, `Who can get ${s} in ${c.place} ready for autumn?`) },
  { match: /tuin|snoei|gras/i, season: "lente", build: (c, s) => T(`Wie doet ${s} in ${c.place} dit voorjaar?`, `Who does ${s} in ${c.place} this spring?`) },
  { match: /kerst|oliebol|feest/i, season: "winter", build: (c, s) => T(`Waar haal ik ${s} in ${c.place} rond de feestdagen?`, `Where can I get ${s} in ${c.place} over the holidays?`) },
];

function finish(list: Tpl[], c: Ctx): SectorPromptTemplate[] {
  const seen = new Set<string>();
  const add = (out: Tpl[], p: Tpl) => {
    if (seen.has(p.key)) return;
    seen.add(p.key);
    out.push(p);
  };
  const words = intentWords(c);
  const packRecs = list.filter((p) => p.kind === "recommendation").map((p) => ({ ...p, intent: intentOf(p) }));
  const core: Tpl[] = [];
  const bank: Tpl[] = [];
  for (const p of list.filter((x) => x.kind === "about").slice(0, 6)) add(core, p);

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
    ...(c.facts.credentials ?? []).map((s) =>
      intentRec("specialty", "credential", 12, T(`${welk(c)} ${c.nounNl} in ${c.place} is erkend voor ${s}?`, `Which ${c.noun} in ${c.place} is accredited for ${s}?`), [`credential:${s}`]),
    ),
  ];
  const otherPlaces = (c.facts.serviceArea?.places ?? []).filter((p) => p.toLowerCase() !== c.place.toLowerCase());
  const place = [
    ...packRecs.filter((p) => p.intent === "place"),
    ...otherPlaces.map((pl) => intentRec("place", "area", 4, T(`${welk(c)} ${c.nounNl} komt ook in ${pl}?`, `Which ${c.noun} also covers ${pl}?`), [`area:${pl}`])),
    intentRec("place", "existence", 6, T(`${upper(c.nounNl)} bij mij in de buurt in ${c.place}?`, `${upper(c.noun)} near me in ${c.place}?`), [`existence:${INTENT_SUBJECT.place}`]),
    intentRec("place", "existence", 6, T(`${upper(c.nounNl)} in het centrum van ${c.place}?`, `${upper(c.noun)} in the centre of ${c.place}?`), [`existence:${INTENT_SUBJECT.place}`]),
  ];
  const groups: Tpl[][] = [quality, trust, now, specialty, price, place];
  for (const g of groups) if (g[0]) add(core, { ...g[0], pool: "core" });
  const fillers = [quality[1], trust[1], quality[2], trust[2], place[1]].filter((x): x is Tpl => !!x);
  while (core.filter((p) => p.kind === "recommendation").length < 6 && fillers.length) add(core, { ...fillers.shift()!, pool: "core" });

  for (const g of groups) for (const p of g) add(bank, { ...p, pool: "bank" });
  for (const s of c.yes) {
    const seasonal = SEASONAL.find((x) => x.match.test(s));
    if (seasonal) add(bank, intentRec("specialty", "service", 6, seasonal.build(c, s), [`service:${s}`], "bank", seasonal.season));
  }
  return [...core, ...bank].map(({ key: _key, ...p }) => p);
}

// ---------------------------------------------------------------------------
// the eleven packs, in the order of sectors.ts
// ---------------------------------------------------------------------------

const PACKS: Record<SectorSlug, (facts: Facts) => SectorPromptTemplate[]> = {
  "loodgieters-installateurs"(facts) {
    const c = ctxFor(facts, "loodgieters-installateurs");
    const P = c.place;
    return finish(
      [
        ...block.area(c),
        ...block.urgency(c, T(`Heeft ${c.x} een storingsdienst in het weekend?`, `Does ${c.x} have a weekend emergency service?`)),
        ...block.cred(c, (s) => T(`Is ${c.x} erkend voor ${s}?`, `Is ${c.x} accredited for ${s}?`)),
        ...block.policy(c, /voorrij/i, () => T(`Rekent ${c.x} voorrijkosten?`, `Does ${c.x} charge a call-out fee?`)),
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.urgencyRec(c, T(`Lekkage, wie kan vandaag komen in ${P}?`, `I have a leak, who can come out today in ${P}?`)),
        ...block.urgencyRec(c, T(`Welke ${c.nounNl} in ${P} heeft een 24-uursdienst?`, `Which ${c.noun} in ${P} has a 24-hour service?`)),
        ...block.serviceRec(c, 0, (s) => T(`Wie installeert ${s} in ${P}?`, `Who installs ${s} in ${P}?`)),
        ...block.areaRec(c),
        ...block.credRec(c, () => T(`Welke erkende installateurs zitten in ${P}?`, `Which accredited installers are there in ${P}?`)),
      ],
      c,
    );
  },

  "aannemers-dakdekkers-schilders"(facts) {
    const c = ctxFor(facts, "aannemers-dakdekkers-schilders");
    const P = c.place;
    return finish(
      [
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x} ongeveer?`, `Roughly what does ${l} cost at ${c.x}?`)),
        ...block.policy(c, /offerte/i, () => T(`Kan ik bij ${c.x} een gratis offerte krijgen?`, `Can I get a free quote from ${c.x}?`)),
        ...block.identity(facts, c),
        ...block.area(c),
        ...block.serviceRec(c, 0, (s) => T(`Wie doet ${s} in ${P}?`, `Who does ${s} in ${P}?`)),
        ...block.serviceRec(c, 1, (s) => T(`Welke ${c.nounNl} in ${P} doet ${s}?`, `Which ${c.noun} in ${P} does ${s}?`)),
        ...block.areaRec(c),
        ...block.policyRec(c, /offerte/i, () => T(`Welke ${c.nounNl} in ${P} geeft een gratis offerte?`, `Which ${c.noun} in ${P} gives a free quote?`)),
      ],
      c,
    );
  },

  "vve-beheer"(facts) {
    const c = ctxFor(facts, "vve-beheer");
    const P = c.place;
    return finish(
      [
        about("existence", 1, T(`Welke VvE-beheerder is ${c.x}? Bestaat dat bedrijf?`, `What kind of ${c.noun} is ${c.x}? Does the company exist?`), ["existence"]),
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.cred(c, (s) => T(`Is ${c.x} aangesloten bij ${s}?`, `Is ${c.x} a member of ${s}?`)),
        ...block.area(c),
        ...block.identity(facts, c),
        ...block.serviceRec(c, 0, (s) => T(`Welke VvE-beheerder in ${P} doet ook ${s}?`, `Which ${c.noun} in ${P} also does ${s}?`)),
        rec("existence", 1, T(`VvE-beheerder voor 12 appartementen in ${P}, wie kan dat doen?`, `${upper(c.noun)} for 12 apartments in ${P}, who can do that?`), ["existence"]),
        ...block.areaRec(c),
        ...block.credRec(c, (s) => T(`Welke VvE-beheerders in ${P} zijn aangesloten bij ${s}?`, `Which ${c.noun}s in ${P} are members of ${s}?`)),
      ],
      c,
    );
  },

  "zorg-praktijken"(facts) {
    const c = ctxFor(facts, "zorg-praktijken");
    const P = c.place;
    return finish(
      [
        ...block.serviceYes(c, 0, (s) => T(`Kan ik bij ${c.x} terecht voor ${s}?`, `Can I go to ${c.x} for ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.urgency(c, T(`Heeft ${c.x} een spoeddienst?`, `Does ${c.x} have an emergency service?`)),
        ...block.policy(c, /verwijz/i, () => T(`Kan ik bij ${c.x} terecht zonder verwijzing?`, `Can I go to ${c.x} without a referral?`)),
        ...block.policy(c, /patiënt|patient/i, (p) => T(`Geldt bij ${c.x}: "${p}"?`, `Does this apply at ${c.x}: "${p}"?`)),
        ...block.cred(c, (s) => T(`Heeft ${c.x} een ${s}?`, `Does ${c.x} have ${s}?`)),
        ...block.urgencyRec(c, T(`Welke ${c.nounNl} in ${P} heeft vanavond een spoeddienst?`, `Which ${c.noun} in ${P} has an emergency service tonight?`)),
        ...block.policyRec(c, /verwijz/i, () => T(`${upper(c.nounNl)} zonder verwijzing in ${P}?`, `${upper(c.noun)} without a referral in ${P}?`)),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} doet ${s}?`, `Which ${c.noun} in ${P} does ${s}?`)),
        ...block.policyRec(c, /nieuwe patiënt|nieuwe patient/i, () => T(`Welke ${c.nounNl} in ${P} neemt nieuwe patiënten aan?`, `Which ${c.noun} in ${P} is taking on new patients?`)),
      ],
      c,
    );
  },

  horeca(facts) {
    const c = ctxFor(facts, "horeca");
    const P = c.place;
    return finish(
      [
        about("hours", 3, T(`Is ${c.x} op maandag open?`, `Is ${c.x} open on Monday?`), ["hours.0"]),
        ...block.policy(c, /reserv/i, () => T(`Kan ik bij ${c.x} reserveren voor 6 personen?`, `Can I book a table for 6 at ${c.x}?`)),
        ...block.serviceYes(c, 0, (s) => T(`Heeft ${c.x} ${s}?`, `Does ${c.x} have ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Heeft ${c.x} ook ${s}?`, `Does ${c.x} also have ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.identity(facts, c),
        ...block.sundayRec(c),
        // "Welk lunchroom" here and "Welke lunchroom" in specialtyPhrases are two Dutch texts, so the English needs two as well.
        ...block.serviceRec(c, 0, (s) => T(`Welk ${c.nounNl} in ${P} heeft ${s}?`, `Which ${c.noun} in ${P} offers ${s}?`)),
        ...block.policyRec(c, /reserv/i, () => T(`${upper(c.nounNl)} in ${P} waar ik kan reserveren voor 6?`, `${upper(c.noun)} in ${P} where I can book a table for 6?`)),
        ...block.saturdayRec(c),
      ],
      c,
    );
  },

  winkels(facts) {
    const c = ctxFor(facts, "winkels");
    const P = c.place;
    return finish(
      [
        about("hours", 3, T(`Is ${c.x} op koopzondag open?`, `Is ${c.x} open on Sundays?`), ["hours.6"]),
        ...block.serviceYes(c, 0, (s) => T(`Verkoopt ${c.x} ook ${s}?`, `Does ${c.x} also sell ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Heeft ${c.x} ${s}?`, `Does ${c.x} have ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Kan ik bij ${c.x} ${s}?`, `Can I ${s} at ${c.x}?`)),
        ...block.policy(c, /bestel|afhal/i, (p) => T(`Geldt bij ${c.x}: "${p}"?`, `Does this apply at ${c.x}: "${p}"?`)),
        about("address", 8, T(`Zit ${c.x} nog op hetzelfde adres?`, `Is ${c.x} still at the same address?`), ["address"]),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} verkoopt ${s}?`, `Which ${c.noun} in ${P} sells ${s}?`)),
        ...block.sundayRec(c),
        ...block.serviceRec(c, 1, (s) => T(`Waar in ${P} kan ik ${s} kopen?`, `Where in ${P} can I buy ${s}?`)),
        ...block.saturdayRec(c),
      ],
      c,
    );
  },

  "garages-fietsenmakers"(facts) {
    const c = ctxFor(facts, "garages-fietsenmakers");
    const P = c.place;
    return finish(
      [
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Repareert ${c.x} ook ${s}?`, `Does ${c.x} also repair ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.policy(c, /afspraak/i, () => T(`Kan ik bij ${c.x} zonder afspraak langskomen?`, `Can I drop in at ${c.x} without an appointment?`)),
        ...block.area(c),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} doet ${s}?`, `Which ${c.noun} in ${P} does ${s}?`)),
        ...block.serviceRec(c, 1, (s) => T(`Wie repareert ${s} in ${P}?`, `Who repairs ${s} in ${P}?`)),
        ...block.policyRec(c, /zonder afspraak/i, () => T(`Welke ${c.nounNl} in ${P} helpt zonder afspraak?`, `Which ${c.noun} in ${P} can help without an appointment?`)),
        ...block.saturdayRec(c),
      ],
      c,
    );
  },

  "kappers-schoonheid"(facts) {
    const c = ctxFor(facts, "kappers-schoonheid");
    const P = c.place;
    return finish(
      [
        ...block.policy(c, /afspraak/i, () => T(`Kan ik bij ${c.x} zonder afspraak terecht?`, `Can I walk in at ${c.x} without an appointment?`)),
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        about("hours", 3, T(`Is ${c.x} op maandag open?`, `Is ${c.x} open on Monday?`), ["hours.0"]),
        ...block.policyRec(c, /zonder afspraak/i, () => T(`${upper(c.nounNl)} in ${P} zonder afspraak?`, `${upper(c.noun)} in ${P} without an appointment?`)),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} doet ${s}?`, `Which ${c.noun} in ${P} does ${s}?`)),
        ...block.saturdayRec(c),
        ...block.sundayRec(c),
      ],
      c,
    );
  },

  "advocaten-notarissen-accountants"(facts) {
    const c = ctxFor(facts, "advocaten-notarissen-accountants");
    const P = c.place;
    return finish(
      [
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Kan ik bij ${c.x} terecht voor ${s}?`, `Can ${c.x} help me with ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.cred(c, (s) => T(`Is ${c.x} aangesloten bij ${s}?`, `Is ${c.x} a member of ${s}?`)),
        ...block.identity(facts, c),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} doet ${s}?`, `Which ${c.noun} in ${P} does ${s}?`)),
        ...block.serviceRec(c, 1, (s) => T(`${upper(c.nounNl)} ${s} in ${P}, wie kan ik bellen?`, `I need ${a(c.noun)} for ${s} in ${P}, who can I call?`)),
        ...block.credRec(c, (s) => T(`Welke ${c.nounNl} in ${P} is aangesloten bij ${s}?`, `Which ${c.noun} in ${P} is a member of ${s}?`)),
        ...block.areaRec(c),
      ],
      c,
    );
  },

  "makelaars-hypotheek"(facts) {
    const c = ctxFor(facts, "makelaars-hypotheek");
    const P = c.place;
    return finish(
      [
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.cred(c, (s) => T(`Is ${c.x} ${s}?`, `Is ${c.x} ${s}?`)),
        ...block.serviceYes(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.area(c),
        ...block.policy(c, /vaste prijs|courtage/i, (p) => T(`Geldt bij ${c.x}: "${p}"?`, `Does this apply at ${c.x}: "${p}"?`)),
        ...block.areaRec(c),
        ...block.credRec(c, (s) => T(`Welke ${c.nounNl} in ${P} is ${s}?`, `Which ${c.noun} in ${P} is ${s}?`)),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} doet ook ${s}?`, `Which ${c.noun} in ${P} also does ${s}?`)),
        ...block.policyRec(c, /vaste prijs/i, () => T(`${upper(c.nounNl)} in ${P} met vaste prijs?`, `${upper(c.noun)} in ${P} with a fixed fee?`)),
      ],
      c,
    );
  },

  "kinderopvang-sport-rijscholen"(facts) {
    const c = ctxFor(facts, "kinderopvang-sport-rijscholen");
    const P = c.place;
    return finish(
      [
        ...block.urgency(c, T(`Heeft ${c.x} nu plek, of is er een wachtlijst?`, `Does ${c.x} have places now, or is there a waiting list?`)),
        about("hours", 3, T(`Hoe laat gaat ${c.x} op maandag open?`, `What time does ${c.x} open on Monday?`), ["hours.0"]),
        ...block.serviceYes(c, 0, (s) => T(`Heeft ${c.x} ${s}?`, `Does ${c.x} have ${s}?`)),
        ...block.serviceYes(c, 1, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.serviceNo(c, 0, (s) => T(`Doet ${c.x} ook ${s}?`, `Does ${c.x} also do ${s}?`)),
        ...block.price(c, (l) => T(`Wat kost ${l} bij ${c.x}?`, `What does ${l} cost at ${c.x}?`)),
        ...block.urgencyRec(c, T(`Welke ${c.nounNl} in ${P} heeft nu plek?`, `Which ${c.noun} in ${P} has places available now?`)),
        ...block.serviceRec(c, 0, (s) => T(`Welke ${c.nounNl} in ${P} heeft ${s}?`, `Which ${c.noun} in ${P} has ${s}?`)),
        ...block.saturdayRec(c),
        ...block.serviceRec(c, 1, (s) => T(`${upper(c.nounNl)} in ${P} met ${s}?`, `${upper(c.noun)} in ${P} with ${s}?`)),
      ],
      c,
    );
  },
};

/** English prompts for a sector pack, aligned item for item with sectorPrompts; none when the business has no sector. */
export function sectorPromptsEn(facts: Facts, sector: SectorSlug | null | undefined): SectorPromptTemplate[] {
  const pack = sector ? PACKS[sector] : undefined;
  return pack ? pack(facts) : [];
}
