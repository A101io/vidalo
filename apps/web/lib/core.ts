/**
 * The seam between apps/web and packages/core. Everything the web app needs
 * from core is imported here (and only here). Mock mode (VIDALO_MOCK=1 or no
 * DATABASE_URL) is handled by core itself: MemDb + deterministic mock engines.
 */
import { randomBytes } from "node:crypto";
import { db as moduleDb, MemDb, type Db } from "@vidalo/core/db";
import { resolveBusiness as coreResolveBusiness, draftProvisionalFacts, prepareBusiness as corePrepareBusiness, buildReport, buildSnapshot, SCAN_DEFAULTS, runScanWithProgress, persistScanState, readScanState, businessIdFromToken, type BusinessCandidate, type ScanProgressStep, type ScanJobState } from "@vidalo/core/scanner";
import { renderFactsPage } from "@vidalo/core/publisher";
import { getDb as scopedDb, setBusinessStatus, setDb } from "@vidalo/core/shared";
import { ENGINE_LABEL, type BusinessStatus, type Engine, type ScanKind, type ScanReport } from "@vidalo/core/types";
import type { CopyShape } from "@vidalo/core/copy";
import { PROGRESS_SCAN_KINDS, type ScanSnapshot } from "@vidalo/core/progress";
import { env } from "./env";
import { seedDemo } from "./demo";
import { seedDomainStatus } from "./demo-domain";

export type { BusinessCandidate, Db };
export { draftProvisionalFacts, buildReport, renderFactsPage, ENGINE_LABEL, SCAN_DEFAULTS };

/** prepareBusiness bound to this request's db. */
export function prepareBusiness(opts: Omit<Parameters<typeof corePrepareBusiness>[0], "db">) {
  return corePrepareBusiness({ ...opts, db: getDb() });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type G = typeof globalThis & { __vidaloDb?: Db; __vidaloSeeded?: Promise<void>; __vidaloProgress?: Map<string, ScanJobState> };
const g = globalThis as G;

/**
 * One Db for the whole process. `next dev` compiles every route into its own
 * module graph, so core's module-level `db` would be a different MemDb per
 * route; keeping the instance on globalThis (and telling this module graph's
 * core about it via setDb) makes mock mode consistent across routes.
 */
const db: Db = (() => {
  if (!g.__vidaloDb) g.__vidaloDb = env.mock ? new MemDb() : moduleDb;
  setDb(g.__vidaloDb);
  return g.__vidaloDb;
})();

/** The request's handle on Cloudflare (core's withDb scope), else the process-wide one. */
export function getDb(): Db {
  if (env.mock && !g.__vidaloSeeded) g.__vidaloSeeded = seedDemo(db).then(() => seedDomainStatus(db)).catch((err) => console.warn("[web] demo seed failed", err));
  return scopedDb();
}

/** Awaits the mock demo seed (no-op outside mock mode). */
export async function ready(): Promise<Db> {
  const d = getDb();
  if (g.__vidaloSeeded) await g.__vidaloSeeded;
  return d;
}

/** Status transition with a `business.status` event (worker cron relies on it). */
export async function transitionStatus(businessId: string, status: BusinessStatus, extra: Record<string, unknown> = {}) {
  return setBusinessStatus(businessId, status, extra);
}

// ---------------------------------------------------------------------------
// Business resolution
// ---------------------------------------------------------------------------

/** "Bakkerij De Vries, Haarlem" / "Bakkerij De Vries in Haarlem" / "bakkerijdevries.nl" → query + optional place. */
export function parseQuery(raw: string): { query: string; place?: string } {
  const q = raw.trim().replace(/\s+/g, " ");
  const comma = q.match(/^(.+?)\s*,\s*([^,]+)$/);
  if (comma) return { query: comma[1]!.trim(), place: comma[2]!.trim() };
  const inMatch = q.match(/^(.+?)\s+(?:in|te)\s+([A-Za-zÀ-ÿ'’. -]{2,})$/);
  if (inMatch) return { query: inMatch[1]!.trim(), place: inMatch[2]!.trim() };
  return { query: q };
}

export async function resolveBusiness(query: string, place?: string): Promise<BusinessCandidate[]> {
  await ready();
  return coreResolveBusiness(query, place);
}

// ---------------------------------------------------------------------------
// Free scan with a token-keyed waiting room
// ---------------------------------------------------------------------------

export type { ScanProgressStep, ScanJobState };

export const FREE_SCAN_ENGINES: Engine[] = SCAN_DEFAULTS.free.engines;

/** The ordered list of steps the waiting room shows; engines in scan order. */
export function progressTemplate(engines: Engine[], copy: CopyShape): ScanProgressStep[] {
  return [
    { key: "found", label: copy.scan.steps.found, done: false },
    ...engines.map((e) => ({ key: `ask:${e}`, label: copy.scan.steps.asking(ENGINE_LABEL[e]), done: false })),
    { key: "comparing", label: copy.scan.steps.comparing, done: false },
    { key: "sources", label: copy.scan.steps.sources, done: false },
    { key: "done", label: copy.scan.steps.done, done: false },
  ];
}

function progressMap() {
  g.__vidaloProgress ??= new Map();
  return g.__vidaloProgress;
}

/**
 * `<businessId>_<hex>`. Not a dot: a path ending in ".<hex>" looks like a file
 * to the middleware matcher, so /en/scan/<token> was never rewritten (404).
 */
export function newScanToken(businessId: string): string {
  return `${businessId}_${randomBytes(6).toString("hex")}`;
}

export { businessIdFromToken };

async function persist(state: ScanJobState) {
  progressMap().set(state.token, state);
  try {
    await persistScanState(state, getDb());
  } catch (err) {
    console.warn("[web] scan.progress event failed", err);
  }
}

/**
 * Current waiting-room state. Memory answers only once the scan runs in this
 * process; a scan still "queued" here may be running elsewhere (the queue
 * consumer on Cloudflare), so then the latest stored event decides.
 */
export async function getScanState(token: string): Promise<ScanJobState | null> {
  const mem = progressMap().get(token);
  if (mem && mem.status !== "queued") return mem;
  return (await readScanState(token, getDb())) ?? mem ?? null;
}

/** Create the waiting-room state (status queued). Call before the scan is started or queued. */
export async function createScanState(businessId: string, copy: CopyShape, engines: Engine[] = FREE_SCAN_ENGINES): Promise<ScanJobState> {
  const state: ScanJobState = { token: newScanToken(businessId), businessId, scanRunId: null, status: "queued", steps: progressTemplate(engines, copy), error: null };
  await persist(state);
  return state;
}

/** Run the free scan here, in this process (local dev, mock mode). On Cloudflare the queue consumer runs it instead. */
export async function startFreeScan(state: ScanJobState, opts: { kind?: ScanKind; engines?: Engine[] } = {}): Promise<ScanReport | null> {
  return runScanWithProgress(state, { kind: opts.kind ?? "free", engines: opts.engines ?? FREE_SCAN_ENGINES, persist, db: getDb() });
}

/** Load a finished scan as a ScanReport, or null when the run does not exist. */
export async function getScanReport(scanRunId: string): Promise<ScanReport | null> {
  await ready();
  try {
    return await buildReport(scanRunId, getDb());
  } catch {
    return null;
  }
}

/** Latest finished scan report of a business (used when /r/ is opened with a business slug or id). */
export async function latestScanReport(businessIdOrSlug: string): Promise<ScanReport | null> {
  const d = await ready();
  const business = await d.getBusiness(businessIdOrSlug);
  if (!business) return null;
  const runs = await d.listScanRuns(business.id, 20);
  const done = runs.find((r) => r.status === "done");
  return done ? getScanReport(done.id) : null;
}

/** Most finished full scans the progress view reads (two years of monthly checks plus extras). */
export const PROGRESS_MAX_SCANS = 30;

/**
 * Finished scans of a business as progress snapshots, oldest first. Rechecks
 * are left out: they ask only the questions under repair. Built a few at a
 * time so one dashboard load does not open a connection per scan at once.
 */
export async function loadSnapshots(businessId: string): Promise<ScanSnapshot[]> {
  const d = await ready();
  const runs = (await d.listScanRuns(businessId, PROGRESS_MAX_SCANS * 2)).filter((r) => r.status === "done" && PROGRESS_SCAN_KINDS.includes(r.kind)).slice(0, PROGRESS_MAX_SCANS);
  const out: ScanSnapshot[] = [];
  for (let i = 0; i < runs.length; i += 4) {
    const batch = await Promise.all(runs.slice(i, i + 4).map((r) => buildSnapshot(r.id, d).catch(() => null)));
    for (const s of batch) if (s) out.push(s);
  }
  return out.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
}
