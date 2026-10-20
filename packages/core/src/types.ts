/**
 * Shared domain types for Vidalo.
 * Facts are owner-asserted. Samples are evidence. Findings are the diff.
 */

export type BusinessStatus = "scanned" | "trial" | "active" | "paused" | "churned";

/**
 * Sector slugs (docs/CRITERIA.md "Sectoren"). The sector picks the extra
 * question set on top of the base prompts. Inferred from the Google category
 * or the KvK SBI code; the owner can override it.
 */
export type SectorSlug =
  | "loodgieters-installateurs"
  | "aannemers-dakdekkers-schilders"
  | "vve-beheer"
  | "zorg-praktijken"
  | "horeca"
  | "winkels"
  | "garages-fietsenmakers"
  | "kappers-schoonheid"
  | "advocaten-notarissen-accountants"
  | "makelaars-hypotheek"
  | "kinderopvang-sport-rijscholen";

export const SECTOR_SLUGS: SectorSlug[] = [
  "loodgieters-installateurs",
  "aannemers-dakdekkers-schilders",
  "vve-beheer",
  "zorg-praktijken",
  "horeca",
  "winkels",
  "garages-fietsenmakers",
  "kappers-schoonheid",
  "advocaten-notarissen-accountants",
  "makelaars-hypotheek",
  "kinderopvang-sport-rijscholen",
];

export interface Business {
  id: string;
  slug: string;
  name: string;
  place: string; // city / town
  domain: string | null;
  kvk: string | null;
  googlePlaceId: string | null;
  /** Sector pack used for the extra questions; null = base questions only. */
  sector: SectorSlug | null;
  plan: "none" | "setup" | "monitor";
  status: BusinessStatus;
  ownerEmail: string | null;
  createdAt: string;
}

export interface Hours {
  /** 0 = Monday … 6 = Sunday */
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  open: string | null; // "09:00"
  close: string | null; // "17:00"
  closed: boolean;
}

export interface PriceItem {
  label: string;
  amount: number; // EUR
  unit?: string; // "per uur", "per stuk"
}

/** Werkgebied: a list of places and/or a radius around the business. */
export interface ServiceArea {
  places: string[];
  radiusKm: number | null;
}

/** Spoed en beschikbaarheid: is there an emergency / same-day service, and when. */
export interface Urgency {
  available: boolean;
  /** "24 uur per dag, 7 dagen per week", "ma-vr 7:00-22:00", ... */
  hoursNl: string | null;
}

export interface Facts {
  businessId: string;
  version: number;
  verifiedAt: string | null; // null = provisional (scraped, not confirmed)
  provisional: boolean;
  name: string;
  place: string;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  openStatus: "open" | "temporarily_closed" | "permanently_closed";
  hours: Hours[];
  servicesYes: string[];
  servicesNo: string[];
  prices: PriceItem[];
  policies: string[]; // "Alleen op afspraak", "Pinnen mogelijk"
  paymentMethods: string[];
  notConfusedWith: string[]; // disambiguation lines
  /** Criterium 4 (werkgebied). Optional for facts stored before the sector layer. */
  serviceArea?: ServiceArea;
  /** Criterium 5 (spoed en beschikbaarheid). */
  urgency?: Urgency;
  /** Criterium 12 (erkenningen en kwalificaties), free list: "Erkend installateur", "BIG-registratie". */
  credentials?: string[];
  /** Owner override of the sector; falls back to Business.sector. */
  sector?: SectorSlug | null;
}

export const EMPTY_SERVICE_AREA: ServiceArea = { places: [], radiusKm: null };

/** Keys an engine's claim can be matched to. */
export type FactKey =
  | "existence" // open / closed / exists
  | "hours"
  | "phone"
  | "address"
  | "website"
  | "service" // services yes/no
  | "price"
  | "policy"
  | "payment"
  | "area" // werkgebied (criterium 4)
  | "urgency" // spoed / beschikbaarheid (criterium 5)
  | "credential" // erkenningen en kwalificaties (criterium 12)
  | "identity"; // naamgenoot (criterium 11); also fed by otherEntity claims

export const FACT_KEYS: FactKey[] = ["existence", "hours", "phone", "address", "website", "service", "price", "policy", "payment", "area", "urgency", "credential", "identity"];

export type PromptCategory = FactKey;

/** Criterium ids 1..12 from docs/CRITERIA.md. */
export type CriteriumId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type Severity = "afhaker" | "misleider" | "verwarring";

/**
 * "about": a question about the business ("Is X zondag open?"), judged on the
 * value. "recommendation": a question for a recommendation ("Welke bakker in
 * Haarlem is zondag open?"), judged on one thing only: is the business named.
 * Never on position.
 */
export type PromptKind = "about" | "recommendation";

/**
 * What a customer is after when asking for a recommendation. Every sector
 * asks one question per intent in its fixed set (docs/CRITERIA.md).
 */
export type RecommendationIntent = "quality" | "trust" | "now" | "specialty" | "price" | "place";
export const RECOMMENDATION_INTENTS: RecommendationIntent[] = ["quality", "trust", "now", "specialty", "price", "place"];

/**
 * Probe subjects for the intents that are not tied to one fact ("existence:beste").
 * The business only has to be open for its absence to count.
 */
export const INTENT_SUBJECT = { quality: "beste", trust: "betrouwbaar", price: "betaalbaar", place: "dichtbij" } as const;

/** "core": asked on every full scan. "bank": a few rotate into each monthly scan. */
export type PromptPool = "core" | "bank";

export interface Prompt {
  id: string;
  businessId: string;
  category: PromptCategory;
  textNl: string;
  /** which fact field(s) this prompt probes, e.g. "hours.6" or "service:verhuur" */
  probes: string[];
  active: boolean;
  /** Criterium this prompt feeds (1..12); derived from the probe when absent. */
  criterium?: CriteriumId | null;
  /** "about" (default) or "recommendation". */
  kind?: PromptKind;
  /** Recommendation prompts: which intent they ask for. */
  intent?: RecommendationIntent | null;
  /** "core" (default) or "bank" (rotates in a few at a time). */
  pool?: PromptPool;
  /** Bank prompts tied to a season ask only in that season. */
  season?: Season | null;
}

export type Season = "winter" | "lente" | "zomer" | "herfst";

/** Season of a date in the Netherlands (meteorological: Dec–Feb winter). */
export function seasonOf(date: Date): Season {
  const m = date.getUTCMonth();
  return m === 11 || m <= 1 ? "winter" : m <= 4 ? "lente" : m <= 7 ? "zomer" : "herfst";
}

export type Engine = "chatgpt" | "gemini" | "perplexity" | "google_ai" | "copilot";

export const ENGINES: Engine[] = ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"];

export const ENGINE_LABEL: Record<Engine, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google_ai: "Google AI",
  copilot: "Copilot",
};

export interface Sample {
  id: string;
  scanRunId: string;
  promptId: string;
  engine: Engine;
  answerText: string;
  citations: string[]; // URLs the engine cited, if any
  capturedAt: string;
  costCents: number;
}

export interface Claim {
  sampleId: string;
  factKey: FactKey;
  /** normalised value, e.g. "closed" | "09:00-17:00" | "+31612345678" | "yes" | "no" | "12.50" */
  value: string;
  /** sub-key, e.g. "6" for Sunday, "verhuur" for a service */
  subject: string | null;
  confidence: number; // 0..1
  otherEntity: boolean; // answer is about a different business with the same name
  rawQuote: string;
}

export type SourceType = "owned_facts_page" | "owned_website" | "directory_api" | "directory_form" | "third_party" | "other_entity" | "none";

/**
 * What an answer did with a fact: it matched, it was wrong, or the engine
 * said it knows nothing about the business ("niet gevonden"). Not found is
 * never counted as wrong: a business the AI has never heard of is its own
 * state, not "nothing wrong".
 */
export type Verdict = "correct" | "wrong" | "not_found";

/** Sentinel claim value an extractor emits when the answer says it has no information. Never a real fact value. */
export const NOT_FOUND_VALUE = "__not_found__";
/** The wrongValue stored on a not_found finding (Dutch, shown as-is). */
export const NOT_FOUND_LABEL = "niet gevonden";
/** Claim value an extractor emits when a recommendation answer does not name the business. */
export const ABSENT_VALUE = "__absent__";
/** Claim value when a recommendation answer does name the business. */
export const PRESENT_VALUE = "__present__";
/** The wrongValue stored on a finding from a recommendation question (Dutch, shown as-is). */
export const ABSENT_LABEL = "niet genoemd";

/** How well the AI knows the business, from the share of not-found answers. */
export type Visibility = "found" | "partial" | "unknown";
export const VISIBILITY_UNKNOWN_RATIO = 0.6;
export const VISIBILITY_PARTIAL_RATIO = 0.25;

export function visibilityFor(totalAnswers: number, notFoundAnswers: number): Visibility {
  if (totalAnswers <= 0) return "found";
  const ratio = notFoundAnswers / totalAnswers;
  if (ratio >= VISIBILITY_UNKNOWN_RATIO) return "unknown";
  if (ratio >= VISIBILITY_PARTIAL_RATIO) return "partial";
  return "found";
}

export type FindingStatus = "open" | "fixing" | "recheck" | "resolved" | "unfixable";

export interface Finding {
  id: string;
  businessId: string;
  scanRunId: string;
  factKey: FactKey;
  subject: string | null;
  engine: Engine;
  /** "wrong": the engine gave another value. "not_found": the engine said it has no information. */
  verdict: Exclude<Verdict, "correct">;
  /** the value the engine gave; NOT_FOUND_LABEL for a not_found finding */
  wrongValue: string;
  correctValue: string;
  /** how many of N samples carried the wrong value (or said not found) */
  frequency: number;
  sampleCount: number;
  sourceUrl: string | null;
  sourceType: SourceType;
  status: FindingStatus;
  firstSeenAt: string;
  resolvedAt: string | null;
  evidenceBefore: string | null; // sample id
  evidenceAfter: string | null; // sample id
  /** "about" (default): a wrong value. "recommendation": the business was not named where its facts say it belongs. */
  evidenceKind?: PromptKind;
  /** Criterium 1..12 this finding belongs to. */
  criterium?: CriteriumId | null;
}

/**
 * A finding-shaped entry for a wrong value seen below the criterium threshold
 * (the "instabiel" band). Reported, never persisted, never fixed.
 */
export type InstableFinding = Omit<Finding, "id" | "status" | "firstSeenAt" | "resolvedAt" | "evidenceAfter"> & { instable: true };

export type ScanKind = "free" | "baseline" | "monthly" | "recheck" | "ondemand";

export interface ScanRun {
  id: string;
  businessId: string;
  kind: ScanKind;
  engines: Engine[];
  samplesPerPrompt: number;
  startedAt: string;
  finishedAt: string | null;
  costCents: number;
  status: "queued" | "running" | "done" | "failed";
}

export type FixAction = "republish" | "sync" | "form" | "email" | "manual" | "none";

export interface Fix {
  id: string;
  findingId: string;
  action: FixAction;
  target: string; // url / channel id / email address
  scheduledAt: string;
  sentAt: string | null;
  recheckAt: string | null;
  resolvedAt: string | null;
  evidence: Record<string, unknown>;
}

export type ChannelType = "facts_page" | "gbp" | "bing" | "apple" | "directory";

export interface Channel {
  id: string;
  businessId: string;
  type: ChannelType;
  name: string; // "Google Bedrijfsprofiel", "openingstijden.nl"
  externalId: string | null;
  url: string | null;
  status: "pending" | "synced" | "mismatch" | "failed" | "manual";
  lastSyncedAt: string | null;
}

/** The colour of the dot (docs/CRITERIA.md "Ernst en kleur: de stipregel"). */
export type Stip = "rood" | "oranje" | "groen" | "grijs";

export interface EngineStip {
  engine: Engine;
  stip: Stip;
  /** share of NL assistant use; engines under STIP_ENGINE_MIN_USAGE do not decide the overall colour */
  usage: number;
  counts: boolean;
}

/** A criterium an engine could not say anything about (>= 50% of its samples not found). */
export interface CriteriumNotFound {
  criterium: CriteriumId;
  engine: Engine;
  frequency: number;
  sampleCount: number;
}

/** Result of a scan as shown on the result page. */
/** One recommendation question in a scan: was the business named, and who was named instead. */
export interface RecommendationSummary {
  promptId: string;
  prompt: string;
  intent: RecommendationIntent | null;
  pool: PromptPool;
  /** first probe of the prompt ("existence:beste", "urgency"), to link a finding to its question */
  probe: string | null;
  answers: number;
  /** answers that named the business */
  named: number;
  /** other businesses named, by how many answers named them */
  others: { name: string; answers: number }[];
  /** sites the answers cited, by how many answers cited them */
  sources: { host: string; url: string; answers: number }[];
}

export interface ScanReport {
  business: Pick<Business, "id" | "slug" | "name" | "place">;
  scanRunId: string;
  kind: ScanKind;
  checkedAt: string;
  totalAnswers: number;
  /** answers that carried a wrong value (never includes not-found answers) */
  wrongAnswers: number;
  /** answers in which the engine said it has no information about the business */
  notFoundAnswers: number;
  visibility: Visibility;
  engines: { engine: Engine; correct: number; wrong: number; notFound: number; skipped: boolean }[];
  findings: Finding[];
  /** Answers that matched the facts; factKey/subject identify the question (absent on reports stored before the G redesign). */
  correct: { prompt: string; engine: Engine; value: string; factKey?: FactKey; subject?: string | null; /** The normalised value, so the web can word it in its own language (absent on older reports). */ raw?: string }[];
  /** Overall colour: worst colour among the engines that count (>= 10% NL usage). */
  stip: Stip;
  engineStips: EngineStip[];
  /** Persisted findings grouped by the severity of their criterium. */
  findingsBySeverity: Record<Severity, Finding[]>;
  /** Wrong values below the threshold: shown, no fix. */
  instable: InstableFinding[];
  /** Criteria the engine said it knows nothing about. Criterium 1 here weighs as an afhaker. */
  criteriaNotFound: CriteriumNotFound[];
  /** Per recommendation question: named or not, who was named instead, which sites were cited. Absent on older reports. */
  recommendations?: RecommendationSummary[];
}
