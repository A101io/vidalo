/**
 * Scanner: sample engines -> extract claims -> compare with facts ->
 * attribute sources -> persist findings -> ScanReport.
 *
 *   const report = await runScan({ businessId, kind: "free" });
 *
 * Mock mode (VIDALO_MOCK=1 or no keys) runs the whole pipeline offline with
 * deterministic synthetic answers.
 */
import { ENGINES, visibilityFor, type Engine, type Facts, type Finding, type InstableFinding, type Prompt, type ScanKind, type ScanReport, type Sample, type SectorSlug } from "../types";
import { type Db, type FindingInput } from "../db";
import { getDb } from "../shared/db.js";
import { generatePrompts, promptsForFullScan, selectFreeScanPrompts } from "../prompts";
import { attributeAll, type AttributionContext } from "./attribute";
import { compare, groupKey, type ComparableSample, type CompareResult } from "./compare";
import { computeStip, groupBySeverity } from "./stip";
import { getEngines, type EngineClient } from "./engines";
import { ENGINE_TIMEOUT_MS } from "./engines/types";
import { defaultExtractMode, extractClaims } from "./extract";
import { normalizeWebsite } from "./normalize";
import { createLimiter, retry, withTimeout } from "./util";
import { promotionCandidates, summarizeRecommendations } from "./recommendations";
import { cellsFromSamples, type ScanSnapshot } from "../progress";

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

/** Defaults per scan kind (ARCHITECTURE.md workflows A and C). */
export const SCAN_DEFAULTS: Record<ScanKind, { engines: Engine[]; samplesPerPrompt: number }> = {
  free: { engines: ["chatgpt", "google_ai", "copilot"], samplesPerPrompt: 3 },
  baseline: { engines: ENGINES, samplesPerPrompt: 10 },
  monthly: { engines: ENGINES, samplesPerPrompt: 10 },
  recheck: { engines: ENGINES, samplesPerPrompt: 10 },
  ondemand: { engines: ENGINES, samplesPerPrompt: 5 },
};

export interface RunScanOptions {
  businessId: string;
  kind: ScanKind;
  engines?: Engine[];
  samplesPerPrompt?: number;
  /** Restrict to these stored prompt ids (rechecks). */
  promptIds?: string[];
  /** Engine clients to use instead of the registry (tests, worker-injected adapters). */
  clients?: EngineClient[];
  /** Parallel engine calls (default VIDALO_CONCURRENCY or 4). */
  concurrency?: number;
  db?: Db;
  /** Progress callback: which prompt is being asked (result page shows this). */
  onProgress?: (ev: ScanProgress) => void;
}

export type ScanProgress =
  | { type: "start"; scanRunId: string; total: number }
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
async function loadPrompts(db: Db, businessId: string, facts: Facts, kind: ScanKind, sector: SectorSlug | null, promptIds?: string[], now = new Date()): Promise<Prompt[]> {
  let prompts = await db.listPrompts(businessId, { activeOnly: true });
  if (promptIds?.length) {
    const set = new Set(promptIds);
    return prompts.filter((p) => set.has(p.id));
  }
  const stored = new Set((await db.listPrompts(businessId)).map((p) => p.textNl));
  const missing = generatePrompts(facts, { sector }).filter((p) => !stored.has(p.textNl));
  if (missing.length) prompts = [...prompts, ...(await db.insertPrompts(businessId, missing))];
  if (kind === "free") {
    const free = selectFreeScanPrompts(prompts, facts, { sector });
    return free.length ? free : prompts.filter((p) => p.pool !== "bank").slice(0, 6);
  }
  return promptsForFullScan(prompts, now);
}

/** Ask every (engine x prompt x sample) with bounded concurrency, retries and timeouts. */
async function sampleAll(
  clients: EngineClient[],
  prompts: Prompt[],
  samplesPerPrompt: number,
  ctx: { business: Awaited<ReturnType<Db["getBusiness"]>> & object; facts: Facts },
  concurrency: number,
  onProgress?: RunScanOptions["onProgress"],
  onError?: (engine: Engine, prompt: Prompt, err: unknown) => void,
): Promise<Asked[]> {
  const limit = createLimiter(concurrency);
  const total = clients.length * prompts.length * samplesPerPrompt;
  let done = 0;
  const tasks: Promise<Asked>[] = [];
  for (const client of clients) {
    for (const prompt of prompts) {
      for (let i = 0; i < samplesPerPrompt; i++) {
        tasks.push(
          limit(async () => {
            try {
              const ans = await retry(
                () => withTimeout(client.ask(prompt.textNl, { business: ctx.business, facts: ctx.facts, prompt, sampleIndex: i }), ENGINE_TIMEOUT_MS, client.engine),
                { retries: 2, baseMs: 1_000 },
              );
              done++;
              onProgress?.({ type: "asked", engine: client.engine, prompt: prompt.textNl, sampleIndex: i, ok: !ans.skipped, done, total });
              return { prompt, engine: client.engine, sampleIndex: i, answerText: ans.answerText, citations: ans.citations, costCents: ans.costCents, skipped: Boolean(ans.skipped) || !ans.answerText.trim() };
            } catch (err) {
              done++;
              onError?.(client.engine, prompt, err);
              onProgress?.({ type: "asked", engine: client.engine, prompt: prompt.textNl, sampleIndex: i, ok: false, done, total });
              return { prompt, engine: client.engine, sampleIndex: i, answerText: "", citations: [], costCents: 0, skipped: true };
            }
          }),
        );
      }
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
    for (const s of samples) {
      if (s.engine !== engine) continue;
      const v = verdicts.get(s.id);
      if (v === "correct") correct++;
      else if (v === "wrong" || v === "other_entity") wrong++;
      else if (v === "not_found") notFound++;
    }
    const hasSamples = samples.some((s) => s.engine === engine);
    return { engine, correct, wrong, notFound, skipped: unavailable.has(engine) || !hasSamples };
  });
}

/** Run a scan end-to-end and persist everything. */
export async function runScan(opts: RunScanOptions): Promise<ScanReport> {
  const db = opts.db ?? getDb();
  const defaults = SCAN_DEFAULTS[opts.kind];
  const engines = opts.engines?.length ? opts.engines : defaults.engines;
  const samplesPerPrompt = opts.samplesPerPrompt ?? Number(process.env.VIDALO_SAMPLES ?? defaults.samplesPerPrompt);
  const concurrency = opts.concurrency ?? Number(process.env.VIDALO_CONCURRENCY ?? 4);

  const business = await db.getBusiness(opts.businessId);
  if (!business) throw new Error(`business ${opts.businessId} not found`);
  const facts = await db.latestFacts(business.id);
  if (!facts) throw new Error(`business ${business.id} has no facts yet`);
  const prompts = await loadPrompts(db, business.id, facts, opts.kind, business.sector, opts.promptIds);
  if (!prompts.length) throw new Error(`business ${business.id} has no prompts to scan`);

  const clients = opts.clients?.length ? opts.clients.filter((c) => engines.includes(c.engine)) : getEngines(engines);
  const active = clients.filter((c) => c.available());
  const unavailable = new Set(clients.filter((c) => !c.available()).map((c) => c.engine));

  const scanRun = await db.createScanRun({ businessId: business.id, kind: opts.kind, engines, samplesPerPrompt, status: "running" });
  await db.logEvent(business.id, "scan.started", { scanRunId: scanRun.id, kind: opts.kind, engines, samplesPerPrompt, prompts: prompts.length, skippedEngines: [...unavailable] });
  opts.onProgress?.({ type: "start", scanRunId: scanRun.id, total: active.length * prompts.length * samplesPerPrompt });

  // Previous open findings, loaded before we upsert so we can diff afterwards.
  const previousOpen = await db.listFindings(business.id, ["open", "fixing", "recheck"]);

  try {
    const asked = await sampleAll(active, prompts, samplesPerPrompt, { business, facts }, concurrency, opts.onProgress, (engine, prompt, err) => {
      void db.logEvent(business.id, "scan.sample_failed", { scanRunId: scanRun.id, engine, prompt: prompt.textNl, error: String((err as Error)?.message ?? err) });
    });
    const costCents = Math.round(asked.reduce((sum, a) => sum + a.costCents, 0));

    // Persist samples (skipped ones carry no evidence and are not stored).
    opts.onProgress?.({ type: "phase", phase: "persist" });
    const usable = asked.filter((a) => !a.skipped);
    const samples = await db.insertSamples(
      usable.map((a) => ({ scanRunId: scanRun.id, promptId: a.prompt.id, engine: a.engine, answerText: a.answerText, citations: a.citations, costCents: a.costCents })),
    );
    const promptById = new Map(prompts.map((p) => [p.id, p]));

    // Extract claims.
    opts.onProgress?.({ type: "phase", phase: "extract" });
    const extractLimit = createLimiter(defaultExtractMode() === "llm" ? concurrency : 16);
    const claimsPerSample = await Promise.all(
      samples.map((s) => extractLimit(() => extractClaims(s.answerText, facts, promptById.get(s.promptId)!, { sampleId: s.id }))),
    );
    const allClaims = claimsPerSample.flat();
    await db.insertClaims(allClaims);

    // Compare.
    opts.onProgress?.({ type: "phase", phase: "compare" });
    const comparable: ComparableSample[] = samples.map((s, i) => ({ sampleId: s.id, engine: s.engine, prompt: promptById.get(s.promptId)!, claims: claimsPerSample[i]!, citations: s.citations }));
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
      costCents,
    });
    opts.onProgress?.({ type: "phase", phase: "done" });

    const report = assembleReport({ business, facts, prompts, scanRun: { ...scanRun, costCents }, engines, samples, result, findings, unavailable });
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
  business: { id: string; slug: string; name: string; place: string };
  facts: Facts;
  prompts: Prompt[];
  scanRun: { id: string; kind: ScanKind; startedAt: string; finishedAt?: string | null; costCents?: number };
  engines: Engine[];
  samples: Sample[];
  result: CompareResult;
  findings: Finding[];
  unavailable: Set<Engine>;
}): ScanReport {
  const { business, facts, prompts, scanRun, engines, samples, result, findings, unavailable } = args;
  const verdictOf = (s: Sample) => result.verdicts.get(s.id);
  const wrongAnswers = samples.filter((s) => verdictOf(s) === "wrong" || verdictOf(s) === "other_entity").length;
  const notFoundAnswers = samples.filter((s) => verdictOf(s) === "not_found").length;
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
    totalAnswers: samples.length,
    wrongAnswers,
    notFoundAnswers,
    visibility: visibilityFor(samples.length, notFoundAnswers),
    engines: engineStats(engines, samples, result.verdicts, unavailable),
    findings,
    correct: result.correct.map(({ prompt, engine, value, raw, factKey, subject }) => ({ prompt, engine, value, raw, factKey, subject })),
    stip,
    engineStips,
    findingsBySeverity: groupBySeverity(findings),
    instable,
    criteriaNotFound,
    recommendations: summarizeRecommendations({ samples, prompts, verdicts: result.verdicts, facts }),
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
  const facts = await db.latestFacts(scanRun.businessId);
  if (!facts) return null;
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
  const facts = await db.latestFacts(business.id);
  if (!facts) throw new Error(`business ${business.id} has no facts`);
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
  return assembleReport({ business, facts, prompts, scanRun, engines: scanRun.engines, samples, result, findings, unavailable });
}
