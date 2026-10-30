/**
 * From a scan's samples, verdicts and findings to the colour of the dot
 * (docs/CRITERIA.md "Ernst en kleur: de stipregel"). Colour per engine,
 * then the worst colour among the engines that count.
 */
import type { CriteriumNotFound, Engine, EngineStip, Finding, InstableFinding, Sample, Severity, Stip } from "../types";
import { ENGINE_NL_USAGE, criteriumFor, engineCounts, engineStip, overallStip, severityOf } from "../criteria";
import type { FindingCandidate, SampleVerdict } from "./compare";

export interface StipInput {
  engines: Engine[];
  samples: Pick<Sample, "id" | "engine">[];
  verdicts: Map<string, SampleVerdict>;
  /** persisted findings of this run (wrong, other_entity and not_found) */
  findings: Finding[];
  instable: (FindingCandidate | InstableFinding)[];
  criteriaNotFound: CriteriumNotFound[];
  unavailable: Set<Engine>;
}

/** Severity of a finding via its criterium (falls back to the fact key). */
export function findingSeverity(f: Pick<Finding, "factKey" | "subject" | "criterium" | "sourceType">): Severity {
  const id = f.criterium ?? criteriumFor(f.factKey, f.subject, null, { otherEntity: f.sourceType === "other_entity" });
  return severityOf(id);
}

export function groupBySeverity(findings: Finding[]): Record<Severity, Finding[]> {
  const out: Record<Severity, Finding[]> = { afhaker: [], misleider: [], verwarring: [] };
  for (const f of findings) out[findingSeverity(f)].push(f);
  return out;
}

const isRecommendationVerdict = (v: SampleVerdict | undefined) => v === "named" || v === "not_named";

export function computeEngineStips(input: StipInput): EngineStip[] {
  return input.engines.map((engine) => {
    // Recommendation answers (named / not named) are not facts: they stay out of the colour.
    const mine = input.samples.filter((s) => s.engine === engine && !isRecommendationVerdict(input.verdicts.get(s.id)));
    let correct = 0;
    let wrong = 0;
    let notFound = 0;
    for (const s of mine) {
      const v = input.verdicts.get(s.id);
      if (v === "correct") correct++;
      else if (v === "wrong" || v === "other_entity") wrong++;
      else if (v === "not_found") notFound++;
    }
    const total = mine.length;
    const judged = correct + wrong;
    const findings = input.findings.filter((f) => f.engine === engine);
    const instableAnswers = input.instable.filter((f) => f.engine === engine).reduce((n, f) => n + f.frequency, 0);
    const stip: Stip = engineStip({
      skipped: input.unavailable.has(engine) || total === 0,
      findingSeverities: findings.filter((f) => f.verdict !== "not_found").map(findingSeverity),
      notFoundCriteria: input.criteriaNotFound.filter((c) => c.engine === engine).map((c) => c.criterium),
      fixesInProgress: findings.filter((f) => f.status === "fixing" || f.status === "recheck").length,
      notFoundShare: total ? notFound / total : 0,
      wrongShare: total ? wrong / total : 0,
      instableShare: judged ? instableAnswers / judged : 0,
    });
    return { engine, stip, usage: ENGINE_NL_USAGE[engine] ?? 0, counts: engineCounts(engine) };
  });
}

export function computeStip(input: StipInput): { stip: Stip; engineStips: EngineStip[] } {
  const engineStips = computeEngineStips(input);
  return { stip: overallStip(engineStips.filter((e) => !input.unavailable.has(e.engine))), engineStips };
}
