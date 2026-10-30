/**
 * Compare extracted claims with the owner facts and aggregate per
 * (factKey, subject, engine, kind) into finding candidates.
 *
 * Thresholds come from the criteria model (docs/CRITERIA.md, ../criteria.ts):
 * criteria 1, 2, 8 and 11 flag on a single disagreeing sample ("any"); the
 * others at >= 30% of the samples ("ratio"). A wrong value below the threshold
 * is "instabiel": reported with `instable: true`, never fixed.
 *
 * Not found: a sample whose extractor emitted the not-found sentinel counts
 * as "the engine knows nothing about this business" for every probe of that
 * prompt. When >= 50% of a group's samples are not found, the group gets a
 * finding with verdict "not_found"; the same rule per criterium gives
 * `criteriaNotFound`. Not-found samples are never wrong and never correct.
 *
 * Recommendation prompts ("welke loodgieter in Zwolle met spoed?") are judged
 * on one thing: is the business named. That is not a fact about the business,
 * so it is never "wrong" or "correct" and never a finding (Julian, 25 Oct
 * 2026: the first real scan turned a bakery with no wrong fact red on
 * "niet genoemd" alone). The sample gets the verdict "named" or "not_named";
 * the report shows it under "Wie AI wel noemt" (recommendations.ts), and the
 * fact counts and the colour leave it out. Position is never counted.
 */
import type { Claim, CriteriumId, Engine, FactKey, Facts, PromptKind, SourceType, Verdict } from "../types";
import { ABSENT_VALUE, NOT_FOUND_LABEL, PRESENT_VALUE } from "../types";
import { criterium as criteriumDef, criteriumFor, criteriumNotFound as isCriteriumNotFound, judge, CRITERIUM_NOT_FOUND_RATIO, RATIO_MIN, INSTABLE_BELOW } from "../criteria";
import { isNotFoundClaim, isRecommendationPrompt, parseProbe, type PromptLike } from "./extract";
import { describeValue, factValue, valuesMatch } from "./normalize";

export const WRONG_THRESHOLD = RATIO_MIN;
export const UNSTABLE_THRESHOLD = INSTABLE_BELOW;
/** One disagreeing sample is enough for these keys (criteria 1, 2, 8, 11). */
export const STRICT_KEYS: FactKey[] = ["phone", "address", "website", "existence", "identity"];
/** Share of a group's samples that must say "not found" before it becomes a not_found finding. */
export const NOT_FOUND_THRESHOLD = CRITERIUM_NOT_FOUND_RATIO;

export interface ComparableSample {
  sampleId: string;
  engine: Engine;
  prompt: PromptLike;
  claims: Claim[];
  citations: string[];
}

/** A finding before it is attributed and persisted. */
export interface FindingCandidate {
  factKey: FactKey;
  subject: string | null;
  engine: Engine;
  verdict: Exclude<Verdict, "correct">;
  wrongValue: string;
  correctValue: string;
  frequency: number;
  sampleCount: number;
  /** Sample ids that carried the wrong value (or said not found), first = evidenceBefore. */
  wrongSampleIds: string[];
  /** Citations of the wrong samples, in order, de-duplicated. */
  citations: string[];
  /** Pre-classified when the claims were about another business, or "none" for a not_found finding. */
  sourceType?: Extract<SourceType, "other_entity" | "none">;
  /** Raw quotes carrying the wrong value (for attribution / display). */
  quotes: string[];
  /** "about" or "recommendation" */
  evidenceKind: PromptKind;
  criterium: CriteriumId;
  /** Below the criterium threshold: shown, not fixed. */
  instable?: boolean;
}

export type SampleVerdict = "correct" | "wrong" | "unknown" | "other_entity" | "not_found" | "named" | "not_named";

export interface CriteriumNotFoundCandidate {
  criterium: CriteriumId;
  engine: Engine;
  frequency: number;
  sampleCount: number;
}

export interface CompareResult {
  findings: FindingCandidate[];
  /** Wrong values below the threshold (instable: true). Same list as `instable`. */
  unstable: FindingCandidate[];
  instable: FindingCandidate[];
  correct: { prompt: string; engine: Engine; value: string; raw: string; sampleId: string; factKey: FactKey; subject: string | null }[];
  verdicts: Map<string, SampleVerdict>;
  /** (factKey|subject|engine[|rec]) keys that were actually checked in this run. */
  checkedKeys: Set<string>;
  /** Criteria an engine could not say anything about (>= 50% of its samples for that criterium not found). */
  criteriaNotFound: CriteriumNotFoundCandidate[];
}

export const groupKey = (factKey: FactKey, subject: string | null, engine: Engine, kind: PromptKind = "about") =>
  `${factKey}|${subject ?? ""}|${engine}${kind === "recommendation" ? "|rec" : ""}`;

/**
 * For a recommendation prompt the business must actually have the fact the
 * question is about (open on Sunday, offers the service, has the emergency
 * line). Otherwise its absence is not an error and the group is skipped.
 */
function recommendationApplies(factKey: FactKey, expected: string): boolean {
  switch (factKey) {
    case "existence":
      return expected === "open";
    case "hours":
      return expected !== "closed";
    case "identity":
      return false;
    case "price":
    case "phone":
    case "address":
    case "website":
      return true;
    default:
      return expected === "yes";
  }
}

export function compare(samples: ComparableSample[], facts: Facts): CompareResult {
  interface Group {
    factKey: FactKey;
    subject: string | null;
    engine: Engine;
    kind: PromptKind;
    criterium: CriteriumId;
    /** the owner fact in the normalised value space */
    expected: string;
    samples: { sampleId: string; claim: Claim | null; citations: string[] }[];
  }
  const groups = new Map<string, Group>();
  const verdicts = new Map<string, SampleVerdict>();
  const wrongSamples = new Set<string>();
  const judgedSamples = new Set<string>();
  const otherEntitySamples = new Set<string>();
  const notFoundSamples = new Set<string>();
  // Recommendation samples: named or not, kept out of every fact count.
  const recommendationVerdicts = new Map<string, "named" | "not_named">();
  const correct: CompareResult["correct"] = [];
  // Per (criterium, engine): how many samples, how many of them not found.
  const perCriterium = new Map<string, CriteriumNotFoundCandidate>();

  for (const s of samples) {
    if (s.claims.some(isNotFoundClaim)) notFoundSamples.add(s.sampleId);
    const kind: PromptKind = isRecommendationPrompt(s.prompt) ? "recommendation" : "about";
    const probes = s.prompt.probes.length ? s.prompt.probes : [s.prompt.category];
    const criteriaSeen = new Set<CriteriumId>();
    for (const probe of probes) {
      const { factKey, subject } = parseProbe(probe);
      const expected = factValue(facts, factKey, subject);
      if (expected == null) continue; // nothing to check this probe against
      if (kind === "recommendation" && !recommendationApplies(factKey, expected)) continue;
      const crit = s.prompt.criterium && criteriumDef(s.prompt.criterium) ? s.prompt.criterium : criteriumFor(factKey, subject, facts);
      const key = groupKey(factKey, subject, s.engine, kind);
      let g = groups.get(key);
      if (!g) {
        g = { factKey, subject, engine: s.engine, kind, criterium: crit, expected, samples: [] };
        groups.set(key, g);
      }
      const claim = s.claims.find((c) => c.factKey === factKey && (c.subject ?? null) === subject) ?? null;
      g.samples.push({ sampleId: s.sampleId, claim, citations: s.citations });
      if (kind === "about" && !criteriaSeen.has(crit)) {
        criteriaSeen.add(crit);
        const ck = `${crit}|${s.engine}`;
        const row = perCriterium.get(ck) ?? { criterium: crit, engine: s.engine, frequency: 0, sampleCount: 0 };
        row.sampleCount++;
        if (notFoundSamples.has(s.sampleId)) row.frequency++;
        perCriterium.set(ck, row);
      }
    }
  }

  const findings: FindingCandidate[] = [];
  const instable: FindingCandidate[] = [];
  const checkedKeys = new Set<string>();

  for (const g of groups.values()) {
    // Recommendation groups are not checked facts: an open finding from an older scan is neither confirmed nor resolved by them.
    if (g.kind !== "recommendation") checkedKeys.add(groupKey(g.factKey, g.subject, g.engine, g.kind));
    const wrong: { sampleId: string; value: string; citations: string[]; quote: string }[] = [];
    const other: { sampleId: string; value: string; citations: string[]; quote: string }[] = [];
    const notFound: { sampleId: string; value: string; citations: string[]; quote: string }[] = [];
    for (const s of g.samples) {
      if (g.kind === "about" && notFoundSamples.has(s.sampleId)) {
        const quote = samples.find((x) => x.sampleId === s.sampleId)?.claims.find(isNotFoundClaim)?.rawQuote ?? "";
        notFound.push({ sampleId: s.sampleId, value: NOT_FOUND_LABEL, citations: [], quote });
        continue;
      }
      if (!s.claim) continue;
      if (g.kind === "recommendation") {
        // Named once on any probe is named.
        if (s.claim.value === PRESENT_VALUE) recommendationVerdicts.set(s.sampleId, "named");
        else if (s.claim.value === ABSENT_VALUE && !recommendationVerdicts.has(s.sampleId)) recommendationVerdicts.set(s.sampleId, "not_named");
        continue;
      }
      judgedSamples.add(s.sampleId);
      if (s.claim.otherEntity) {
        other.push({ sampleId: s.sampleId, value: s.claim.value, citations: s.citations, quote: s.claim.rawQuote });
        otherEntitySamples.add(s.sampleId);
        continue;
      }
      if (valuesMatch(g.factKey, s.claim.value, g.expected)) {
        if (!wrongSamples.has(s.sampleId)) {
          const promptText = samples.find((x) => x.sampleId === s.sampleId)?.prompt.textNl ?? "";
          correct.push({ prompt: promptText, engine: g.engine, value: describeValue(g.factKey, s.claim.value, g.subject), raw: s.claim.value, sampleId: s.sampleId, factKey: g.factKey, subject: g.subject });
        }
      } else {
        wrong.push({ sampleId: s.sampleId, value: s.claim.value, citations: s.citations, quote: s.claim.rawQuote });
        wrongSamples.add(s.sampleId);
      }
    }

    const sampleCount = g.samples.length;
    const build = (list: typeof wrong, opts: { sourceType?: "other_entity" | "none"; verdict?: FindingCandidate["verdict"]; criterium?: CriteriumId; instable?: boolean } = {}): FindingCandidate => {
      // Dominant wrong value.
      const counts = new Map<string, number>();
      for (const w of list) counts.set(w.value, (counts.get(w.value) ?? 0) + 1);
      const wrongValue = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const carriers = list.filter((w) => w.value === wrongValue);
      return {
        factKey: g.factKey,
        subject: g.subject,
        engine: g.engine,
        verdict: opts.verdict ?? "wrong",
        wrongValue,
        correctValue: g.expected,
        frequency: list.length,
        sampleCount,
        wrongSampleIds: carriers.map((w) => w.sampleId),
        citations: [...new Set(carriers.flatMap((w) => w.citations))],
        quotes: carriers.map((w) => w.quote).filter(Boolean),
        evidenceKind: g.kind,
        criterium: opts.criterium ?? g.criterium,
        ...(opts.sourceType ? { sourceType: opts.sourceType } : {}),
        ...(opts.instable ? { instable: true } : {}),
      };
    };

    // Not found is its own finding next to a possible wrong one (different verdict, same key).
    if (notFound.length && notFound.length / sampleCount >= NOT_FOUND_THRESHOLD) findings.push(build(notFound, { sourceType: "none", verdict: "not_found" }));

    // One wrong candidate per group: a wrong value beats an other-entity answer.
    let pushed = false;
    if (wrong.length) {
      const outcome = judge(g.criterium, wrong.length, sampleCount);
      if (outcome === "finding") {
        findings.push(build(wrong));
        pushed = true;
      } else if (outcome === "instable") instable.push(build(wrong, { instable: true }));
    }
    // An answer about a namesake is criterium 11 (naamgenoot): one sample is enough.
    if (other.length && !pushed) findings.push(build(other, { sourceType: "other_entity", criterium: 11 }));
  }

  // Remove "correct" entries for samples that turned out wrong on another probe.
  const cleanCorrect = correct.filter((c) => !wrongSamples.has(c.sampleId) && !otherEntitySamples.has(c.sampleId));
  for (const s of samples) {
    if (notFoundSamples.has(s.sampleId)) verdicts.set(s.sampleId, "not_found");
    else if (wrongSamples.has(s.sampleId)) verdicts.set(s.sampleId, "wrong");
    else if (otherEntitySamples.has(s.sampleId)) verdicts.set(s.sampleId, "other_entity");
    else if (judgedSamples.has(s.sampleId)) verdicts.set(s.sampleId, "correct");
    else if (recommendationVerdicts.has(s.sampleId)) verdicts.set(s.sampleId, recommendationVerdicts.get(s.sampleId)!);
    else verdicts.set(s.sampleId, "unknown");
  }

  const criteriaNotFound = [...perCriterium.values()].filter((r) => isCriteriumNotFound(r.frequency, r.sampleCount)).sort((a, b) => a.criterium - b.criterium || a.engine.localeCompare(b.engine));

  return { findings, unstable: instable, instable, correct: cleanCorrect, verdicts, checkedKeys, criteriaNotFound };
}
