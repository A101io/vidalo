/**
 * Scanner: sample engines -> extract claims -> compare with facts ->
 * attribute sources -> persist findings -> ScanReport.
 *
 *   const report = await runScan({ businessId, kind: "free" });
 *
 * Mock mode (VIDALO_MOCK=1 or no keys) runs the whole pipeline offline with
 * deterministic synthetic answers.
 */
import { withCountry } from "../shared/country";
import { ENGINES, visibilityFor, type BusinessProfile, type Claim, type Engine, type Facts, type Finding, type InstableFinding, type ProfileSummary, type Prompt, type ScanKind, type ScanReport, type Sample, type SectorSlug } from "../types";
import { type Db, type FindingInput } from "../db";
import { getDb } from "../shared/db.js";
import { applies, businessNoun, familyOf, generatePrompts, promptsForFullScan, selectFreeScanPrompts, selectQuestions, type QuestionLibrary } from "../prompts";
import { loadLibrary, recordScanUse, useRows } from "../prompts/library";
import { attributeAll, type AttributionContext } from "./attribute";
import { compare, groupKey, type ComparableSample, type CompareResult, type SampleVerdict } from "./compare";
import { computeStip, groupBySeverity } from "./stip";
import { getEngines, type EngineClient } from "./engines";
import { ENGINE_TIMEOUT_MS } from "./engines/types";
import { defaultExtractMode, extractClaims } from "./extract";
import { normalizeWebsite } from "./normalize";
import { createLimiter, retry, withTimeout } from "./util";
import { effectiveProfile } from "./understand";
import { promotionCandidates, summarizeRecommendations } from "./recommendations";
import { cellsFromSamples, type ScanSnapshot } from "../progress";
import { ensureProfile, profileSummary, withProfile, type UnderstandDeps } from "./understand";

export * from "./compare";
export * from "./attribute";
export * from "./extract";
export * from "./normalize";
export { getEngines, getEngine, availableEngines, createMockEngine, setCopilotAdapter } from "./engines";
export type { EngineClient, AskContext, EngineAnswer } from "./engines";
export * from "./resolve";
export * from "./onboard";
export * from "./stip";
export * from "./recommendations";
export * from "./progress";
export * from "./question-sets";
export * from "./understand";

/**
 * Engines a scan asks. Copilot stays out until its adapter ships
 * (engines/copilot.ts is a stub that never answers): asking it only put
 * "Copilot: overgeslagen" on every report, and the copy no longer names it.
 */
export const ASKED_ENGINES: Engine[] = ENGINES.filter((e) => e !== "copilot");

/** Defaults per scan kind (ARCHITECTURE.md workflows A and C). */
export const SCAN_DEFAULTS: Record<ScanKind, { engines: Engine[]; samplesPerPrompt: number }> = {
  free: { engines: ["chatgpt", "google_ai"], samplesPerPrompt: 3 },
  baseline: { engines: ASKED_ENGINES, samplesPerPrompt: 10 },
  monthly: { engines: ASKED_ENGINES, samplesPerPrompt: 10 },
  recheck: { engines: ASKED_ENGINES, samplesPerPrompt: 10 },
  ondemand: { engines: ASKED_ENGINES, samplesPerPrompt: 5 },
};

/**
 * Samples asked first, per (prompt, engine). Only when one of them disagrees
 * with the facts, says not found, names another business or does not name
 * the business in a recommendation does the cell go on to the full
 * `samplesPerPrompt`. A cell that answers right every time stops here; the
 * criteria that flag on a single wrong answer (1, 2, 8, 11) lose nothing, and
 * the ratio criteria keep their ten samples wherever a wrong answer appeared.
 * Override with VIDALO_SAMPLES_FIRST or `firstSamples`.
 */
export const FIRST_SAMPLES = 5;

/**
 * Engines whose answer does not vary between samples. Google's AI Overview
 * for one query is one answer (and SerpApi serves repeats from cache): ten
 * samples would be ten copies that count ten times in the ratios without
 * adding evidence.
 */
export const SAMPLES_CAP: Partial<Record<Engine, number>> = { google_ai: 1 };

/** Samples a scan asks one engine per prompt: the scan's number, capped per engine. */
export function samplesFor(engine: Engine, samplesPerPrompt: number): number {
  return Math.min(samplesPerPrompt, SAMPLES_CAP[engine] ?? samplesPerPrompt);
}

/** Sample verdicts that send a (prompt, engine) cell on to the full sample count. */
const ESCALATE_ON: ReadonlySet<SampleVerdict> = new Set<SampleVerdict>(["wrong", "other_entity", "not_found", "not_named"]);

/** What a scan reports as its profile until the understanding step (BE-04) supplies one. */
const DOOR_PROFILE_SUMMARY: ProfileSummary = { mode: "door", offer: null, audience: null, category: null, source: "fallback" };

export interface RunScanOptions {
  businessId: string;
  kind: ScanKind;
  engines?: Engine[];
  samplesPerPrompt?: number;
  /** Samples asked before deciding whether a cell needs all of them (default FIRST_SAMPLES). */
  firstSamples?: number;
  /** Restrict to these stored prompt ids (rechecks). */
  promptIds?: string[];
  /** Engine clients to use instead of the registry (tests, worker-injected adapters). */
  clients?: EngineClient[];
  /** Parallel engine calls (default VIDALO_CONCURRENCY or 4). */
  concurrency?: number;
  db?: Db;
  /**
   * The profile the scan was asked with, as visitors see it. BE-04's understanding step supplies it;
   * until then every scan reports the door profile it is asked with.
   */
  profile?: ProfileSummary;
  /** Test seam for the understanding step: a recorded OpenAI client and page fetch. */
  understand?: UnderstandDeps;
  /** Progress callback: which prompt is being asked (result page shows this). */
  onProgress?: (ev: ScanProgress) => void;
}

export type ScanProgress =
  | { type: "profile"; profile: ProfileSummary }
  | { type: "questions"; questions: { id: string; text: string }[] }
  | { type: "start"; scanRunId: string; total: number; perEngine: Partial<Record<Engine, number>> }
  | { type: "escalate"; perEngine: Partial<Record<Engine, number>> }
  | { type: "asked"; engine: Engine; prompt: string; sampleIndex: number; ok: boolean; done: number; total: number }
  | { type: "phase"; phase: "extract" | "compare" | "attribute" | "persist" | "done" };

interface Asked {
  prompt: Prompt;
  engine: Engine;
  sampleIndex: number;
  answerText: string;
  citations: string[];
  costCents: number;
  skipped: boolean;
}

/**
 * Load prompts for a scan. Generated prompts the business does not have yet
 * are stored first (new businesses get all of them; existing ones get new
 * questions, such as the recommendation intents and the bank, as they are
 * added). A full scan asks the core plus this month's slice of the bank.
 */
export async function loadPrompts(db: Db, businessId: string, facts: Facts, kind: ScanKind, sector: SectorSlug | null, promptIds?: string[], now = new Date(), profile: BusinessProfile | null = null, library?: QuestionLibrary): Promise<Prompt[]> {
  let prompts = await db.listPrompts(businessId, { activeOnly: true });
  if (promptIds?.length) {
    const set = new Set(promptIds);
    return prompts.filter((p) => set.has(p.id));
  }
  if (profile?.mode === "online") {
    // Online: only the templates of the current profile; rows of other modes stay stored and are not asked.
    const wanted = selectQuestions({ profile, facts, kind, sector, library: { ...(await loadLibrary(db, profile, facts)), ...library } });
    const have = new Set((await db.listPrompts(businessId)).map((p) => p.textNl));
    const missing = wanted.filter((w) => !have.has(w.textNl));
    if (missing.length) prompts = [...prompts, ...(await db.insertPrompts(businessId, missing))];
    const byText = new Map(prompts.map((p) => [p.textNl, p]));
    return wanted.flatMap((w) => byText.get(w.textNl) ?? []);
  }
  // door and visit: today's questions; an online template stored earlier is not asked
  prompts = prompts.filter((p) => !p.templateKey?.startsWith("online."));
  const stored = new Set((await db.listPrompts(businessId)).map((p) => p.textNl));
  const missing = generatePrompts(facts, { sector }).filter((p) => !stored.has(p.textNl));
  if (missing.length) prompts = [...prompts, ...(await db.insertPrompts(businessId, missing))];
  const mine = (list: Prompt[]) => (profile?.mode === "visit" ? list.filter((p) => applies(familyOf(p), profile, facts)) : list);
  if (kind === "free") {
    const free = mine(selectFreeScanPrompts(prompts, facts, { sector }));
    return free.length ? free : mine(prompts.filter((p) => p.pool !== "bank")).slice(0, 6);
  }
  return mine(promptsForFullScan(prompts, now));
}

/** One (engine, prompt) cell and the sample indexes [from, to) to ask it. */
interface Cell {
  client: EngineClient;
  prompt: Prompt;
  from: number;
  to: number;
}

/** Ask every (engine x prompt x sample) in the plan with bounded concurrency, retries and timeouts. */
async function sampleAll(
  plan: Cell[],
  ctx: { business: Awaited<ReturnType<Db["getBusiness"]>> & object; facts: Facts },
  concurrency: number,
  progress: { total: number; done: number },
  onProgress?: RunScanOptions["onProgress"],
  onError?: (engine: Engine, prompt: Prompt, err: unknown) => void,
): Promise<Asked[]> {
  const limit = createLimiter(concurrency);
  const tasks: Promise<Asked>[] = [];
  for (const { client, prompt, from, to } of plan) {
    for (let i = from; i < to; i++) {
      tasks.push(
        limit(async () => {
          try {
            const ans = await retry(
              () => withTimeout(client.ask(prompt.textNl, { business: ctx.business, facts: ctx.facts, prompt, sampleIndex: i }), ENGINE_TIMEOUT_MS, client.engine),
              { retries: 2, baseMs: 1_000 },
            );
            progress.done++;
            onProgress?.({ type: "asked", engine: client.engine, prompt: prompt.textNl, sampleIndex: i, ok: !ans.skipped, done: progress.done, total: progress.total });
            return { prompt, engine: client.engine, sampleIndex: i, answerText: ans.answerText, citations: ans.citations, costCents: ans.costCents, skipped: Boolean(ans.skipped) || !ans.answerText.trim() };
          } catch (err) {
            progress.done++;
            onError?.(client.engine, prompt, err);
            onProgress?.({ type: "asked", engine: client.engine, prompt: prompt.textNl, sampleIndex: i, ok: false, done: progress.done, total: progress.total });
            return { prompt, engine: client.engine, sampleIndex: i, answerText: "", citations: [], costCents: 0, skipped: true };
          }
        }),
      );
    }
  }
  return Promise.all(tasks);
}

function attributionContext(business: { domain: string | null; slug: string; name: string; factsHost?: string | null }, facts: Facts): AttributionContext {
  const suffix = process.env.FACTS_HOST_SUFFIX ?? "vidalo.io";
  return {
    business,
    factsHost: business.factsHost ?? `${business.slug}.feiten.${suffix}`,
    websiteHost: normalizeWebsite(facts.website),
  };
}

/** Per-engine correct/wrong/not-found counts at sample level; skipped when unavailable or without samples. */
function engineStats(engines: Engine[], samples: Pick<Sample, "id" | "engine">[], verdicts: CompareResult["verdicts"], unavailable: Set<Engine>) {
  return engines.map((engine) => {
    let correct = 0;
    let wrong = 0;
    let notFound = 0;
    // Answers to fact questions that could not be judged: no fact to compare with, or no usable claim (QA round 2).
    let unchecked = 0;
    for (const s of samples) {
      if (s.engine !== engine) continue;
      const v = verdicts.get(s.id);
      if (v === "correct") correct++;
      else if (v === "wrong" || v === "other_entity") wrong++;
      else if (v === "not_found") notFound++;
      else if (v !== "named" && v !== "not_named") unchecked++;
    }
    const hasSamples = samples.some((s) => s.engine === engine);
    return { engine, correct, wrong, notFound, unchecked, skipped: unavailable.has(engine) || !hasSamples };
  });
}

/** Run a scan end-to-end and persist everything. */
export async function runScan(opts: RunScanOptions): Promise<ScanReport> {
  const db = opts.db ?? getDb();
  const defaults = SCAN_DEFAULTS[opts.kind];
  const engines = opts.engines?.length ? opts.engines : defaults.engines;
  const samplesPerPrompt = opts.samplesPerPrompt ?? Number(process.env.VIDALO_SAMPLES ?? defaults.samplesPerPrompt);
  const firstSamples = Math.min(samplesPerPrompt, Math.max(1, opts.firstSamples ?? Number(process.env.VIDALO_SAMPLES_FIRST ?? FIRST_SAMPLES)));
  const concurrency = opts.concurrency ?? Number(process.env.VIDALO_CONCURRENCY ?? 4);

  const business = await db.getBusiness(opts.businessId);
  if (!business) throw new Error(`business ${opts.businessId} not found`);
  const stored = await db.latestFacts(business.id);
  if (!stored) throw new Error(`business ${business.id} has no facts yet`);
  // The understanding step (BE-04): what the business is decides which questions are asked and how answers are judged.
  // A recheck re-asks stored questions and keeps the profile the business has; every other kind runs the step.
  const withCountryFacts = withCountry(stored, business);
  let profile: BusinessProfile | null = null;
  let understandCents = 0;
  if (opts.kind === "recheck") {
    profile = effectiveProfile(business);
  } else {
    const understood = await ensureProfile(db, business, withCountryFacts, opts.kind, opts.understand);
    profile = understood.profile;
    understandCents = understood.costCents;
  }
  const facts = withProfile(withCountryFacts, profile);
  opts.onProgress?.({ type: "profile", profile: profile ? profileSummary(profile) : (opts.profile ?? DOOR_PROFILE_SUMMARY) });
  let prompts = await loadPrompts(db, business.id, facts, opts.kind, business.sector, opts.promptIds, undefined, profile);
  // Never blocks (AC-A3): an online profile whose name no template may carry (the sanitiser refused it) is asked today's questions.
  if (!prompts.length && profile?.mode === "online") prompts = await loadPrompts(db, business.id, facts, opts.kind, business.sector, opts.promptIds, undefined, null);
  if (!prompts.length) throw new Error(`business ${business.id} has no prompts to scan`);
  opts.onProgress?.({ type: "questions", questions: prompts.map((p) => ({ id: p.id, text: p.textNl })) });

  const clients = opts.clients?.length ? opts.clients.filter((c) => engines.includes(c.engine)) : getEngines(engines);
  const active = clients.filter((c) => c.available());
  const unavailable = new Set(clients.filter((c) => !c.available()).map((c) => c.engine));

  const scanRun = await db.createScanRun({ businessId: business.id, kind: opts.kind, engines, samplesPerPrompt, status: "running", profile });
  await db.logEvent(business.id, "scan.started", { scanRunId: scanRun.id, kind: opts.kind, engines, samplesPerPrompt, firstSamples, prompts: prompts.length, skippedEngines: [...unavailable] });
  const firstRound: Cell[] = active.flatMap((client) => prompts.map((prompt) => ({ client, prompt, from: 0, to: Math.min(firstSamples, samplesFor(client.engine, samplesPerPrompt)) })));
  const progress = { total: firstRound.reduce((n, c) => n + (c.to - c.from), 0), done: 0 };
  const countPerEngine = (plan: Cell[]) => {
    const n: Partial<Record<Engine, number>> = {};
    for (const c of plan) n[c.client.engine] = (n[c.client.engine] ?? 0) + (c.to - c.from);
    return n;
  };
  opts.onProgress?.({ type: "start", scanRunId: scanRun.id, total: progress.total, perEngine: countPerEngine(firstRound) });

  // Previous open findings, loaded before we upsert so we can diff afterwards.
  const previousOpen = await db.listFindings(business.id, ["open", "fixing", "recheck"]);

  try {
    const promptById = new Map(prompts.map((p) => [p.id, p]));
    const extractLimit = createLimiter(defaultExtractMode() === "llm" ? concurrency : 16);
    const samples: Sample[] = [];
    const claimsPerSample: Claim[][] = [];
    let costCents = 0;

    // Ask the cells in the plan, store the usable answers (skipped ones carry no evidence) and extract their claims.
    const round = async (plan: Cell[]) => {
      const asked = await sampleAll(plan, { business, facts }, concurrency, progress, opts.onProgress, (engine, prompt, err) => {
        void db.logEvent(business.id, "scan.sample_failed", { scanRunId: scanRun.id, engine, prompt: prompt.textNl, error: String((err as Error)?.message ?? err) });
      });
      costCents += asked.reduce((sum, a) => sum + a.costCents, 0);
      const usable = asked.filter((a) => !a.skipped);
      const stored = await db.insertSamples(
        usable.map((a) => ({ scanRunId: scanRun.id, promptId: a.prompt.id, engine: a.engine, answerText: a.answerText, citations: a.citations, costCents: a.costCents })),
      );
      const claims = await Promise.all(stored.map((s) => extractLimit(() => extractClaims(s.answerText, facts, promptById.get(s.promptId)!, { sampleId: s.id }))));
      await db.insertClaims(claims.flat());
      samples.push(...stored);
      claimsPerSample.push(...claims);
    };
    const comparableNow = (): ComparableSample[] => samples.map((s, i) => ({ sampleId: s.id, engine: s.engine, prompt: promptById.get(s.promptId)!, claims: claimsPerSample[i]!, citations: s.citations }));

    // Round 1: the first samples of every cell.
    await round(firstRound);

    // Round 2: only the cells where a first answer was wrong, not found, about a namesake or did not name the business.
    const verdicts = compare(comparableNow(), facts).verdicts;
    const secondRound: Cell[] = firstRound
      .map((c) => ({ ...c, from: c.to, to: samplesFor(c.client.engine, samplesPerPrompt) }))
      .filter((c) => c.to > c.from && samples.some((s) => s.engine === c.client.engine && s.promptId === c.prompt.id && ESCALATE_ON.has(verdicts.get(s.id) ?? "unknown")));
    if (secondRound.length) {
      progress.total += secondRound.reduce((n, c) => n + (c.to - c.from), 0);
      opts.onProgress?.({ type: "escalate", perEngine: countPerEngine(secondRound) });
      await round(secondRound);
    }
    // The understanding step's calls count towards the run's cost, so the daily ceiling sees them.
    costCents = Math.round(costCents + understandCents);

    opts.onProgress?.({ type: "phase", phase: "persist" });
    opts.onProgress?.({ type: "phase", phase: "extract" });

    // Compare.
    opts.onProgress?.({ type: "phase", phase: "compare" });
    const comparable = comparableNow();
    const result = compare(comparable, facts);

    // Attribute.
    opts.onProgress?.({ type: "phase", phase: "attribute" });
    const attributed = await attributeAll(result.findings, attributionContext(business, facts));

    // Persist findings (upsert on business + factKey + subject + engine + verdict).
    const inputs: FindingInput[] = attributed.map((f) => ({
      businessId: business.id,
      scanRunId: scanRun.id,
      factKey: f.factKey,
      subject: f.subject,
      engine: f.engine,
      verdict: f.verdict,
      wrongValue: f.wrongValue,
      correctValue: f.correctValue,
      frequency: f.frequency,
      sampleCount: f.sampleCount,
      sourceUrl: f.sourceUrl,
      sourceType: f.sourceType,
      evidenceBefore: f.wrongSampleIds[0] ?? null,
      evidenceKind: f.evidenceKind,
      criterium: f.criterium,
    }));
    const findings = await db.upsertFindings(inputs);

    // Diff vs previous open findings: anything we re-checked and no longer saw wrong is resolved.
    const stillWrong = new Set(findings.map((f) => `${groupKey(f.factKey, f.subject, f.engine, f.evidenceKind)}|${f.verdict}`));
    const resolved: Finding[] = [];
    for (const prev of previousOpen) {
      const key = groupKey(prev.factKey, prev.subject, prev.engine, prev.evidenceKind);
      if (!result.checkedKeys.has(key) || stillWrong.has(`${key}|${prev.verdict}`)) continue;
      const after = result.correct.find((c) => c.engine === prev.engine && comparable.some((s) => s.sampleId === c.sampleId && s.prompt.probes.some((p) => p.startsWith(prev.factKey))));
      resolved.push(await db.markFindingResolved(prev.id, after?.sampleId ?? null));
    }

    await db.updateScanRun(scanRun.id, { status: "done", finishedAt: new Date().toISOString(), costCents });
    await db.logEvent(business.id, "scan.finished", {
      scanRunId: scanRun.id,
      samples: samples.length,
      findings: findings.length,
      notFound: findings.filter((f) => f.verdict === "not_found").length,
      newFindings: findings.filter((f) => f.scanRunId === scanRun.id && !previousOpen.some((p) => p.id === f.id)).length,
      resolved: resolved.length,
      unstable: result.instable.length,
      firstSamples,
      escalatedCells: secondRound.length,
      cells: firstRound.length,
      costCents,
      mode: profile?.mode ?? "door",
    });
    // The question library: what each template was asked and how often it gave a usable answer. Never fails the scan.
    await recordScanUse(db, business.id, scanRun.id, () =>
      useRows({ scanRunId: scanRun.id, profile, facts, prompts, samples, claimsPerSample, verdicts: result.verdicts }),
    );
    opts.onProgress?.({ type: "phase", phase: "done" });

    const report = assembleReport({ business, facts, prompts, scanRun: { ...scanRun, costCents }, engines, samples, result, findings, unavailable, profile });
    // A bank question where the business is mostly not named becomes a fixed question.
    if (opts.kind === "monthly" || opts.kind === "baseline") {
      const promote = promotionCandidates(report.recommendations ?? []);
      for (const id of promote) await db.setPromptPool(id, "core");
      if (promote.length) await db.logEvent(business.id, "prompts.promoted", { scanRunId: scanRun.id, promptIds: promote });
    }
    return report;
  } catch (err) {
    await db.updateScanRun(scanRun.id, { status: "failed", finishedAt: new Date().toISOString(), error: String((err as Error)?.message ?? err) });
    await db.logEvent(business.id, "scan.failed", { scanRunId: scanRun.id, error: String((err as Error)?.message ?? err) });
    throw err;
  }
}

function assembleReport(args: {
  business: { id: string; slug: string; name: string; place: string; sector?: SectorSlug | null };
  facts: Facts;
  prompts: Prompt[];
  scanRun: { id: string; kind: ScanKind; startedAt: string; finishedAt?: string | null; costCents?: number };
  engines: Engine[];
  samples: Sample[];
  result: CompareResult;
  findings: Finding[];
  unavailable: Set<Engine>;
  /** The profile the scan was asked with; null reads as door. */
  profile?: BusinessProfile | null;
}): ScanReport {
  const { business, facts, prompts, scanRun, engines, samples, result, findings, unavailable } = args;
  const verdictOf = (s: Sample) => result.verdicts.get(s.id);
  const wrongAnswers = samples.filter((s) => verdictOf(s) === "wrong" || verdictOf(s) === "other_entity").length;
  const notFoundAnswers = samples.filter((s) => verdictOf(s) === "not_found").length;
  // "X van Y antwoorden kloppen niet" counts answers to fact questions; recommendation answers are reported on their own.
  const factSamples = samples.filter((s) => verdictOf(s) !== "named" && verdictOf(s) !== "not_named");
  const instable: InstableFinding[] = result.instable.map((c) => ({
    businessId: business.id,
    scanRunId: scanRun.id,
    factKey: c.factKey,
    subject: c.subject,
    engine: c.engine,
    verdict: c.verdict,
    wrongValue: c.wrongValue,
    correctValue: c.correctValue,
    frequency: c.frequency,
    sampleCount: c.sampleCount,
    sourceUrl: null,
    sourceType: c.sourceType ?? "none",
    evidenceBefore: c.wrongSampleIds[0] ?? null,
    evidenceKind: c.evidenceKind,
    criterium: c.criterium,
    instable: true,
  }));
  const criteriaNotFound = result.criteriaNotFound.map((c) => ({ ...c }));
  const { stip, engineStips } = computeStip({ engines, samples, verdicts: result.verdicts, findings, instable, criteriaNotFound, unavailable });
  return {
    business: { id: business.id, slug: business.slug, name: business.name, place: business.place },
    scanRunId: scanRun.id,
    kind: scanRun.kind,
    checkedAt: scanRun.finishedAt ?? new Date().toISOString(),
    totalAnswers: factSamples.length,
    wrongAnswers,
    notFoundAnswers,
    visibility: visibilityFor(factSamples.length, notFoundAnswers),
    engines: engineStats(engines, samples, result.verdicts, unavailable),
    findings,
    correct: result.correct.map(({ prompt, engine, value, raw, factKey, subject }) => ({ prompt, engine, value, raw, factKey, subject })),
    stip,
    engineStips,
    findingsBySeverity: groupBySeverity(findings),
    instable,
    criteriaNotFound,
    recommendations: summarizeRecommendations({ samples, prompts, verdicts: result.verdicts, facts }),
    comparedAs: businessNoun(facts, business.sector ?? null),
    asked: result.asked.map((a) => ({ ...a })),
    profile: args.profile ? profileSummary(args.profile) : null,
  };
}

/**
 * A stored scan as a progress snapshot (the owner's "Voortgang" view): per
 * (question, AI system) the verdict most samples carried, and the colour of
 * the dot. The colour uses the findings the comparison produced for this run
 * itself, so an older run keeps its own colour after later scans moved the
 * finding rows on. Judged against the current facts, like buildReport.
 */
export async function buildSnapshot(scanRunId: string, dbOverride?: Db): Promise<ScanSnapshot | null> {
  const db = dbOverride ?? getDb();
  const scanRun = await db.getScanRun(scanRunId);
  if (!scanRun || scanRun.status !== "done") return null;
  const business = await db.getBusiness(scanRun.businessId);
  const stored = await db.latestFacts(scanRun.businessId);
  if (!business || !stored) return null;
  // Judged with the profile the scan was asked with, not the business's current one.
  const facts = withProfile(withCountry(stored, business), scanRun.profile ?? null);
  const samples = await db.listSamples(scanRunId);
  const claims = await db.listClaims(samples.map((s) => s.id));
  const prompts = await db.listPrompts(scanRun.businessId);
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const comparable: ComparableSample[] = samples
    .filter((s) => promptById.has(s.promptId))
    .map((s) => ({ sampleId: s.id, engine: s.engine, prompt: promptById.get(s.promptId)!, claims: claims.filter((c) => c.sampleId === s.id), citations: s.citations }));
  const result = compare(comparable, facts);
  const unavailable = new Set(scanRun.engines.filter((e) => !samples.some((s) => s.engine === e)));
  const ownFindings = result.findings.map((c) => ({ ...c, status: "open" as const })) as unknown as Finding[];
  const { stip, engineStips } = computeStip({ engines: scanRun.engines, samples, verdicts: result.verdicts, findings: ownFindings, instable: result.instable, criteriaNotFound: result.criteriaNotFound, unavailable });
  return {
    scanRunId,
    kind: scanRun.kind,
    checkedAt: scanRun.finishedAt ?? scanRun.startedAt,
    engines: scanRun.engines.filter((e) => !unavailable.has(e)),
    stip,
    engineStips: engineStips.filter((e) => !unavailable.has(e.engine)),
    cells: cellsFromSamples(samples, result.verdicts, prompts),
  };
}

/** Rebuild the ScanReport for a stored scan run (result page, emails). */
export async function buildReport(scanRunId: string, dbOverride?: Db): Promise<ScanReport> {
  const db = dbOverride ?? getDb();
  const scanRun = await db.getScanRun(scanRunId);
  if (!scanRun) throw new Error(`scan_run ${scanRunId} not found`);
  const business = await db.getBusiness(scanRun.businessId);
  if (!business) throw new Error(`business ${scanRun.businessId} not found`);
  const stored = await db.latestFacts(business.id);
  if (!stored) throw new Error(`business ${business.id} has no facts`);
  const facts = withProfile(withCountry(stored, business), scanRun.profile ?? null);
  const samples = await db.listSamples(scanRunId);
  const claims = await db.listClaims(samples.map((s) => s.id));
  const prompts = await db.listPrompts(business.id);
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const comparable: ComparableSample[] = samples
    .filter((s) => promptById.has(s.promptId))
    .map((s) => ({ sampleId: s.id, engine: s.engine, prompt: promptById.get(s.promptId)!, claims: claims.filter((c) => c.sampleId === s.id), citations: s.citations }));
  const result = compare(comparable, facts);
  const findings = await db.listFindingsByScanRun(scanRunId);
  const unavailable = new Set(scanRun.engines.filter((e) => !samples.some((s) => s.engine === e)));
  return assembleReport({ business, facts, prompts, scanRun, engines: scanRun.engines, samples, result, findings, unavailable, profile: scanRun.profile ?? null });
}
