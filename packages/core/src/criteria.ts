/**
 * The twelve criteria from docs/CRITERIA.md as data, plus the stipregel.
 *
 * A criterium is a fact category a customer decides on. Each one has a
 * severity (afhaker / misleider / verwarring) and a threshold: "any" (one
 * disagreeing sample is already a finding) or "ratio" (>= 30% of the samples).
 * Below the threshold a wrong value is "instabiel": reported, never fixed.
 *
 * Not found is judged per criterium: when >= 50% of an engine's samples for a
 * criterium say "I know nothing", that criterium is not found. Not found on
 * criterium 1 (bestaan) weighs as an afhaker.
 */
import type { CriteriumId, Engine, FactKey, Facts, Severity, Stip, Visibility } from "./types";
import { ENGINES } from "./types";

export type Threshold = { kind: "any" } | { kind: "ratio"; min: number };

export interface Criterium {
  id: CriteriumId;
  key: string;
  labelNl: string;
  /** The question a customer asks, from the table in docs/CRITERIA.md. */
  questionNl: string;
  severity: Severity;
  threshold: Threshold;
  /** Below this share of samples a wrong value is "instabiel" (reported, no fix). */
  instableBelow: number;
  /** Fact keys that feed this criterium. "service" splits into 6/7 on the fact value. */
  factKeys: FactKey[];
}

export const INSTABLE_BELOW = 0.1;
export const RATIO_MIN = 0.3;
/** Share of an engine's samples for a criterium that must say "not found" before the criterium is not found. */
export const CRITERIUM_NOT_FOUND_RATIO = 0.5;

const any: Threshold = { kind: "any" };
const ratio: Threshold = { kind: "ratio", min: RATIO_MIN };

export const CRITERIA: Criterium[] = [
  { id: 1, key: "bestaan", labelNl: "Bestaan", questionNl: "Bestaat X in Y nog? Is X open?", severity: "afhaker", threshold: any, instableBelow: INSTABLE_BELOW, factKeys: ["existence"] },
  { id: 2, key: "telefoonnummer", labelNl: "Telefoonnummer", questionNl: "Wat is het nummer van X?", severity: "afhaker", threshold: any, instableBelow: INSTABLE_BELOW, factKeys: ["phone"] },
  { id: 3, key: "openingstijden", labelNl: "Openingstijden", questionNl: "Is X op zondag open? Tot hoe laat op zaterdag?", severity: "afhaker", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["hours"] },
  { id: 4, key: "werkgebied", labelNl: "Werkgebied", questionNl: "Komt X ook in Z? Werkt X in regio Y?", severity: "afhaker", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["area"] },
  { id: 5, key: "spoed", labelNl: "Spoed en beschikbaarheid", questionNl: "Heeft X een 24-uursdienst? Kan X vandaag nog komen?", severity: "afhaker", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["urgency"] },
  { id: 6, key: "diensten-wel", labelNl: "Diensten: wel", questionNl: "Doet X ook warmtepompen? Verkoopt X glutenvrij?", severity: "misleider", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["service"] },
  { id: 7, key: "diensten-niet", labelNl: "Diensten: niet", questionNl: "Repareert X ook fietsen? Doet X particulieren?", severity: "misleider", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["service"] },
  { id: 8, key: "adres", labelNl: "Adres en locatie", questionNl: "Waar zit X? Is er parkeergelegenheid?", severity: "misleider", threshold: any, instableBelow: INSTABLE_BELOW, factKeys: ["address", "website"] },
  { id: 9, key: "prijzen", labelNl: "Prijzen en tarieven", questionNl: "Wat kost een APK bij X? Wat is het uurtarief?", severity: "misleider", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["price"] },
  { id: 10, key: "afspraken", labelNl: "Afspraken en voorwaarden", questionNl: "Alleen op afspraak? Pinnen? Offerte gratis? Voorrijkosten?", severity: "misleider", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["policy", "payment"] },
  { id: 11, key: "naamgenoot", labelNl: "Identiteit en naamgenoot", questionNl: "Is X hetzelfde als X in Z?", severity: "verwarring", threshold: any, instableBelow: INSTABLE_BELOW, factKeys: ["identity"] },
  { id: 12, key: "erkenningen", labelNl: "Erkenningen en kwalificaties", questionNl: "Is X erkend installateur? Heeft X een BIG-registratie?", severity: "verwarring", threshold: ratio, instableBelow: INSTABLE_BELOW, factKeys: ["credential"] },
];

export const CRITERIUM_IDS: CriteriumId[] = CRITERIA.map((c) => c.id);

export function criterium(id: CriteriumId): Criterium {
  return CRITERIA.find((c) => c.id === id)!;
}

export function criteriumByKey(key: string): Criterium | undefined {
  return CRITERIA.find((c) => c.key === key);
}

/** Default criterium per fact key (service defaults to 6; see criteriumFor for the 6/7 split). */
export const FACT_KEY_CRITERIUM: Record<FactKey, CriteriumId> = {
  existence: 1,
  phone: 2,
  hours: 3,
  area: 4,
  urgency: 5,
  service: 6,
  address: 8,
  website: 8,
  price: 9,
  policy: 10,
  payment: 10,
  identity: 11,
  credential: 12,
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which criterium a (factKey, subject) belongs to. A service the owner does
 * NOT offer is criterium 7 (diensten: niet); everything else follows the key.
 * An other-entity answer is criterium 11 regardless of the key it hit.
 */
export function criteriumFor(factKey: FactKey, subject: string | null, facts?: Pick<Facts, "servicesNo"> | null, opts: { otherEntity?: boolean } = {}): CriteriumId {
  if (opts.otherEntity) return 11;
  if (factKey === "service" && subject && facts?.servicesNo.some((s) => norm(s) === norm(subject))) return 7;
  return FACT_KEY_CRITERIUM[factKey];
}

export function severityOf(id: CriteriumId): Severity {
  return criterium(id).severity;
}

/**
 * Judge one (criterium, engine) group: `frequency` wrong samples out of
 * `sampleCount`. "finding" when the threshold is met, "instable" when there
 * is at least one wrong sample below it, "ok" otherwise.
 */
export function judge(id: CriteriumId, frequency: number, sampleCount: number): "finding" | "instable" | "ok" {
  if (frequency <= 0 || sampleCount <= 0) return "ok";
  const c = criterium(id);
  if (c.threshold.kind === "any") return "finding";
  const ratio = frequency / sampleCount;
  return ratio >= c.threshold.min ? "finding" : "instable";
}

/** Not found per criterium: >= 50% of the samples said "I know nothing". */
export function criteriumNotFound(frequency: number, sampleCount: number): boolean {
  return sampleCount > 0 && frequency / sampleCount >= CRITERIUM_NOT_FOUND_RATIO;
}

// ---------------------------------------------------------------------------
// Stipregel
// ---------------------------------------------------------------------------

/**
 * Share of Dutch AI-assistant use per engine (docs/CRITERIA.md "Meetmethode":
 * ChatGPT 83% of chatbot traffic; Google AI Overviews above nearly every local
 * search; Copilot default in Windows/Edge; Gemini; Perplexity and Claude a few percent each,
 * StatCounter NL June 2026).
 * Only engines at or above STIP_ENGINE_MIN_USAGE decide the overall colour.
 */
export const ENGINE_NL_USAGE: Record<Engine, number> = {
  chatgpt: 0.83,
  google_ai: 0.6,
  copilot: 0.15,
  gemini: 0.12,
  perplexity: 0.04,
  claude: 0.05,
};
export const STIP_ENGINE_MIN_USAGE = 0.1;

export function engineCounts(engine: Engine): boolean {
  return (ENGINE_NL_USAGE[engine] ?? 0) >= STIP_ENGINE_MIN_USAGE;
}

/** Overall: >= 30% of all answers wrong is red on its own. */
export const WRONG_ANSWERS_RED_RATIO = 0.3;
/** Green allows at most this share of instable answers. */
export const INSTABLE_GREEN_MAX = 0.1;

export interface EngineStipInput {
  /** severities of the persisted findings for this engine (wrong + other_entity; not_found excluded) */
  findingSeverities: Severity[];
  /** criteria the engine could not say anything about */
  notFoundCriteria: CriteriumId[];
  /** number of findings currently being fixed (status fixing / recheck) */
  fixesInProgress?: number;
  /** share of not-found answers among this engine's answers */
  notFoundShare: number;
  /** share of wrong answers among this engine's answers */
  wrongShare: number;
  /** share of instable (below-threshold wrong) answers among this engine's judged answers */
  instableShare: number;
  /** no usable samples at all */
  skipped?: boolean;
}

export const STIP_ORDER: Stip[] = ["groen", "grijs", "oranje", "rood"];

export function worstStip(a: Stip, b: Stip): Stip {
  return STIP_ORDER.indexOf(a) >= STIP_ORDER.indexOf(b) ? a : b;
}

/** Visibility thresholds reused for the colour: unknown >= 60% not found, partial >= 25%. */
export function visibilityFromShare(notFoundShare: number): Visibility {
  if (notFoundShare >= 0.6) return "unknown";
  if (notFoundShare >= 0.25) return "partial";
  return "found";
}

/**
 * The colour for one engine:
 *   grijs  when the engine barely knows the business (>= 60% not found) or has no samples;
 *   rood   on any afhaker finding, not found on criterium 1, or >= 30% wrong answers;
 *   oranje on any misleider / verwarring finding, fixes in progress, or 25-60% not found,
 *          or more than 10% instable answers;
 *   groen  otherwise.
 */
export function engineStip(input: EngineStipInput): Stip {
  if (input.skipped) return "grijs";
  const visibility = visibilityFromShare(input.notFoundShare);
  if (visibility === "unknown") return "grijs";
  if (input.findingSeverities.includes("afhaker")) return "rood";
  if (input.notFoundCriteria.includes(1)) return "rood";
  if (input.wrongShare >= WRONG_ANSWERS_RED_RATIO) return "rood";
  if (input.findingSeverities.length > 0) return "oranje";
  if ((input.fixesInProgress ?? 0) > 0) return "oranje";
  if (visibility === "partial") return "oranje";
  if (input.instableShare > INSTABLE_GREEN_MAX) return "oranje";
  return "groen";
}

/**
 * Overall colour: the worst colour among the engines that count (>= 10% NL
 * use). ChatGPT alone can make the dot red; Perplexity alone cannot. When no
 * counting engine was scanned, the worst of the rest decides; when nothing
 * was scanned at all, grijs.
 */
export function overallStip(perEngine: { engine: Engine; stip: Stip }[]): Stip {
  const counting = perEngine.filter((e) => engineCounts(e.engine));
  const pool = counting.length ? counting : perEngine;
  if (!pool.length) return "grijs";
  return pool.map((e) => e.stip).reduce(worstStip, "groen");
}

export const ALL_ENGINES_BY_USAGE: Engine[] = [...ENGINES].sort((a, b) => ENGINE_NL_USAGE[b] - ENGINE_NL_USAGE[a]);
