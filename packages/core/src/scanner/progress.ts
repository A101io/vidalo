/**
 * A scan with a waiting room: the steps a visitor sees while it runs, stored
 * as `scan.progress` events so whoever runs the scan (the web process locally,
 * the queue consumer on Cloudflare) and whoever shows the waiting room can be
 * different processes. Moved here from apps/web/lib/core.ts unchanged.
 */
import type { Db } from "../db/types.js";
import type { Engine, ScanKind, ScanReport } from "../types.js";
import { getDb } from "../shared/db.js";
import { requesterFromEvents } from "../shared/free-check.js";
import { runScan, type ScanProgress } from "./index.js";

export interface ScanProgressStep {
  key: string;
  label: string;
  done: boolean;
}

export interface ScanJobState {
  token: string;
  businessId: string;
  scanRunId: string | null;
  status: "queued" | "running" | "done" | "failed";
  steps: ScanProgressStep[];
  error?: string | null;
}

export function businessIdFromToken(token: string): string | null {
  // "." for tokens issued before the separator changed to "_".
  const i = Math.max(token.lastIndexOf("_"), token.lastIndexOf("."));
  return i > 0 ? token.slice(0, i) : null;
}

export async function persistScanState(state: ScanJobState, db: Db = getDb()): Promise<void> {
  await db.logEvent(state.businessId, "scan.progress", { token: state.token, scanRunId: state.scanRunId, status: state.status, steps: state.steps, error: state.error ?? null });
}

/** The latest stored state for a waiting-room token, or null. */
export async function readScanState(token: string, db: Db = getDb()): Promise<ScanJobState | null> {
  const businessId = businessIdFromToken(token);
  if (!businessId) return null;
  const events = await db.listEvents(businessId, 200);
  const ev = events.find((e) => e.type === "scan.progress" && e.payload.token === token);
  if (!ev) return null;
  const p = ev.payload as unknown as Omit<ScanJobState, "token" | "businessId">;
  return { token, businessId, scanRunId: p.scanRunId ?? null, status: p.status, steps: p.steps, error: p.error ?? null };
}

/** Run the scan and translate its progress events into waiting-room steps. */
export async function runScanWithProgress(
  state: ScanJobState,
  opts: { kind: ScanKind; engines: Engine[]; persist?: (s: ScanJobState) => Promise<void>; db?: Db },
): Promise<ScanReport | null> {
  const db = opts.db ?? getDb();
  const { engines, kind } = opts;
  const save = opts.persist ?? ((s: ScanJobState) => persistScanState(s, db));
  const perEngine = new Map<Engine, number>();
  let perEngineTotal = Number.POSITIVE_INFINITY;
  const mark = (key: string) => {
    const s = state.steps.find((x) => x.key === key);
    if (s) s.done = true;
  };
  const markAllAsk = () => engines.forEach((e) => mark(`ask:${e}`));
  let dirty = false;
  let flushing: Promise<void> | null = null;
  const flush = () => {
    dirty = true;
    if (!flushing) {
      flushing = (async () => {
        while (dirty) {
          dirty = false;
          await save(state);
        }
        flushing = null;
      })();
    }
  };

  state.status = "running";
  const onProgress = (ev: ScanProgress) => {
    if (ev.type === "start") {
      state.scanRunId = ev.scanRunId;
      perEngineTotal = engines.length ? Math.ceil(ev.total / engines.length) : ev.total;
      mark("found");
    } else if (ev.type === "asked") {
      const n = (perEngine.get(ev.engine) ?? 0) + 1;
      perEngine.set(ev.engine, n);
      if (n >= perEngineTotal) mark(`ask:${ev.engine}`);
    } else if (ev.type === "phase") {
      if (ev.phase === "extract" || ev.phase === "compare") {
        markAllAsk();
        if (ev.phase === "compare") mark("comparing");
      } else if (ev.phase === "attribute" || ev.phase === "persist") {
        markAllAsk();
        mark("comparing");
        if (ev.phase === "persist") mark("sources");
      } else if (ev.phase === "done") {
        state.steps.forEach((s) => (s.done = true));
      }
    }
    flush();
  };
  flush();
  try {
    const report = await runScan({ businessId: state.businessId, kind, engines, onProgress, db });
    state.scanRunId = report.scanRunId;
    state.steps.forEach((s) => (s.done = true));
    state.status = "done";
    await flushing;
    await save(state);
    // A free check asked for an address up front (shared/free-check.ts): the report goes there now.
    // A business with an owner gets its mails through the owner's own paths, not here.
    if (kind === "free") {
      const asker = requesterFromEvents(await db.listEvents(state.businessId, 500));
      const business = await db.getBusiness(state.businessId);
      if (asker && !business?.ownerEmail) await db.enqueueJob("email", { template: "baseline", scanRunId: report.scanRunId, businessId: state.businessId, to: asker.email, lang: asker.lang });
    }
    return report;
  } catch (err) {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : String(err);
    await flushing;
    await save(state);
    return null;
  }
}
