import type { Db } from "../../src/db";

/**
 * Counts the round trips a piece of code makes to a Db (feature 002, AC-7).
 *  - PgDb: every awaited `sql` statement is one trip; the Db method that issued it is not counted again. Methods run
 *    with `this` = a copy of the Db whose `sql` counts, so Db methods that call each other count their queries. A
 *    fragment (sql`and …` inside another query) is never awaited on its own, so it is not a trip.
 *  - MemDb: every top-level Db method call is one. Methods run on the real instance, so the calls they make to each
 *    other are not counted; direct reads of its maps by functions over a Db (db/owner-area.ts) cost nothing, as in memory.
 * Everything else (`kind`, plain properties, `sql.json`) passes through.
 */
export function countingDb<T extends Db>(db: T): { db: T; count(): number; reset(): void } {
  let n = 0;
  const raw = db as unknown as Record<string, unknown>;
  const isPg = raw.kind === "pg";

  let self: object = db;
  if (isPg) {
    const realSql = raw.sql as ((...a: unknown[]) => unknown) & Record<string, unknown>;
    const countedSql = new Proxy(realSql, {
      apply(fn, thisArg, args) {
        const q = Reflect.apply(fn, thisArg, args) as { then?: (...a: unknown[]) => unknown } | null;
        if (q && typeof q.then === "function") {
          const then = q.then.bind(q);
          let counted = false;
          q.then = (...a: unknown[]) => {
            if (!counted) {
              counted = true;
              n++;
            }
            return then(...a);
          };
        }
        return q;
      },
    });
    self = Object.create(db, { sql: { value: countedSql } });
  }

  const proxy = new Proxy(self, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== "function" || prop === "sql" || prop === "constructor") return value;
      return (...args: unknown[]) => {
        if (!isPg) n++;
        return Reflect.apply(value, isPg ? obj : db, args);
      };
    },
  });
  return { db: proxy as T, count: () => n, reset: () => void (n = 0) };
}

// ---------------------------------------------------------------------------
// A business with a long history, for the scale test and scripts/perf/seed-history.mts
// ---------------------------------------------------------------------------
import { prepareBusiness } from "../../src/scanner";
import { saveRunSummary, summarizeRun } from "../../src/db/owner-area";
import type { ScanSnapshot } from "../../src/progress";
import { ENGINES, type CriteriumId, type Engine, type PromptCategory, type ScanReport } from "../../src/types";

export interface HistoryOptions {
  name: string;
  place: string;
  /** Finished checks: the first is a baseline, the rest monthly, one a month back from today. */
  checks: number;
  findings?: number;
  events?: number;
  /** Write samples and claims (10 questions × 5 AI systems × up to `answers`) for every check; else only for the newest. */
  samplesForEvery?: boolean;
  answers?: number;
  ownerUserId?: string;
  ownerEmail?: string;
}

/** Creates the business, its checks (with summaries), findings (with open fixes) and events through the Db API. Returns ids. */
export async function seedHistory(db: Db, o: HistoryOptions): Promise<{ businessId: string; runIds: string[] }> {
  const { business } = await prepareBusiness({ name: o.name, place: o.place, db });
  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, plan: "monitor", status: "active", ownerUserId: o.ownerUserId ?? null, ownerEmail: o.ownerEmail ?? null });
  // prepareBusiness stores no questions (a scan creates them): ten fact questions, with the criterium each feeds.
  if (!(await db.listPrompts(business.id)).length) {
    const asks: [PromptCategory, string, CriteriumId][] = [
      ["existence", "Bestaat {n} nog?", 11], ["phone", "Wat is het telefoonnummer van {n}?", 2], ["address", "Wat is het adres van {n}?", 4], ["hours", "Wanneer is {n} open?", 3], ["website", "Wat is de website van {n}?", 5],
      ["payment", "Kan ik pinnen bij {n}?", 10], ["service", "Biedt {n} bezorging aan?", 6], ["price", "Wat kost een broodje bij {n}?", 7], ["policy", "Kan ik bij {n} annuleren?", 8], ["existence", "Is {n} verhuisd?", 11],
    ];
    await db.insertPrompts(business.id, asks.map(([category, t, criterium], i) => ({ category, textNl: t.replace("{n}", o.name), probes: [`${category}:${i}`], active: true, criterium, kind: "about" as const })));
  }
  const prompts = (await db.listPrompts(business.id)).slice(0, 10);
  const answers = o.answers ?? 10;
  const runIds: string[] = [];
  for (let i = 0; i < o.checks; i++) {
    const at = new Date(Date.now() - (o.checks - 1 - i) * 30 * 86_400_000).toISOString();
    const run = await db.createScanRun({ businessId: business.id, kind: i === 0 ? "baseline" : "monthly", engines: [...ENGINES], samplesPerPrompt: answers, status: "done" });
    await db.updateScanRun(run.id, { startedAt: at, finishedAt: at });
    runIds.push(run.id);
    const newest = i === o.checks - 1;
    if (o.samplesForEvery || newest) {
      const samples = await db.insertSamples(prompts.flatMap((p) => ENGINES.flatMap((engine) => Array.from({ length: answers }, (_, k) => ({ scanRunId: run.id, promptId: p.id, engine, answerText: `Antwoord ${k + 1} over ${p.category}.`, citations: [], costCents: 0 })))));
      await db.insertClaims(samples.map((s, k) => ({ sampleId: s.id, factKey: "existence" as const, subject: null, value: k % 7 === 0 ? "closed" : "open", confidence: 0.9, otherEntity: false, rawQuote: "…" })));
    }
    const snapshot: ScanSnapshot = {
      scanRunId: run.id,
      kind: i === 0 ? "baseline" : "monthly",
      checkedAt: at,
      engines: [...ENGINES] as Engine[],
      stip: i % 3 === 0 ? "rood" : "oranje",
      engineStips: [],
      cells: prompts.flatMap((p) => ENGINES.map((engine, k) => ({ promptId: p.id, engine, criterium: p.criterium ?? 1, kind: p.kind, verdict: (i + k) % 5 === 0 ? ("wrong" as const) : ("correct" as const) }))),
    };
    const report = { stip: snapshot.stip, findings: [], correct: [], asked: [] } as unknown as ScanReport;
    await saveRunSummary(db, run.id, summarizeRun(report, snapshot));
  }
  const last = runIds[runIds.length - 1]!;
  if (o.findings && last) {
    const inputs = Array.from({ length: o.findings }, (_, i) => ({
      businessId: business.id,
      scanRunId: last,
      factKey: "service" as const,
      subject: `dienst-${i}`,
      engine: ENGINES[i % ENGINES.length]!,
      wrongValue: "nee",
      correctValue: "ja",
      frequency: 3,
      sampleCount: 5,
      sourceUrl: null,
      sourceType: "none" as const,
      evidenceBefore: null,
    }));
    const found = await db.upsertFindings(inputs);
    for (const [i, f] of found.entries()) {
      if (i < Math.min(100, found.length / 4)) await db.insertFix({ findingId: f.id, action: "manual", target: "owner" });
      else await db.markFindingResolved(f.id, null);
    }
  }
  for (let i = 0; i < (o.events ?? 0); i++) await db.logEvent(business.id, i % 10 === 0 ? "scan.finished" : "fix.sent", { n: i, scanRunId: runIds[i % runIds.length] });
  return { businessId: business.id, runIds };
}
