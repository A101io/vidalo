/**
 * A scan with a waiting room: the steps a visitor sees while it runs, stored
 * as `scan.progress` events so whoever runs the scan (the web process locally,
 * the queue consumer on Cloudflare) and whoever shows the waiting room can be
 * different processes. Moved here from apps/web/lib/core.ts unchanged.
 */
import type { Db } from "../db/types.js";
import type { Engine, ProfileSummary, ScanKind, ScanReport } from "../types.js";
import { getDb } from "../shared/db.js";
import { REPORT_EMAIL_EVENT, requesterFromEvents } from "../shared/free-check.js";
import { runScan, type ScanProgress } from "./index.js";
import type { EngineClient } from "./engines/types.js";

export interface ScanProgressStep {
  key: string;
  label: string;
  done: boolean;
}

export type ScanStage = "understand" | "choose" | "ask" | "compare" | "done";

export interface ScanJobState {
  token: string;
  businessId: string;
  scanRunId: string | null;
  status: "queued" | "running" | "done" | "failed";
  stage: ScanStage;
  /** set when stage leaves "understand" */
  profile: ProfileSummary | null;
  /** set at "choose", in asking order, scan language */
  questions: { id: string; text: string }[];
  /** one per asked engine, from "ask" on; expected can grow (second round) */
  engines: { engine: Engine; received: number; expected: number }[];
  /** @deprecated v1 waiting room; whichever of BE-07 and FE-01 merges second deletes it. */
  steps?: ScanProgressStep[];
  /** stored, never sent to the browser */
  error?: string | null;
}

export function businessIdFromToken(token: string): string | null {
  // "." for tokens issued before the separator changed to "_".
  const i = Math.max(token.lastIndexOf("_"), token.lastIndexOf("."));
  return i > 0 ? token.slice(0, i) : null;
}

export async function persistScanState(state: ScanJobState, db: Db = getDb()): Promise<void> {
  await db.logEvent(state.businessId, "scan.progress", { token: state.token, scanRunId: state.scanRunId, status: state.status, stage: state.stage, profile: state.profile, questions: state.questions, engines: state.engines, error: state.error ?? null });
}

/** The latest stored state for a waiting-room token, or null. */
export async function readScanState(token: string, db: Db = getDb()): Promise<ScanJobState | null> {
  const businessId = businessIdFromToken(token);
  if (!businessId) return null;
  const events = await db.listEvents(businessId, 200);
  const ev = events.find((e) => e.type === "scan.progress" && e.payload.token === token);
  if (!ev) return null;
  const p = ev.payload as unknown as Omit<ScanJobState, "token" | "businessId">;
  // A state stored before this feature has no stage: read it as "ask" with nothing to list.
  return { token, businessId, scanRunId: p.scanRunId ?? null, status: p.status, stage: p.stage ?? "ask", profile: p.profile ?? null, questions: p.questions ?? [], engines: p.engines ?? [], error: p.error ?? null };
}

/**
 * The body of GET /api/scan/[token]/status: exactly the contract's fields and nothing else.
 * Never the stored error text, the business id or the scan run id (beyond a finished scan's report path).
 */
export function scanStatusBody(state: ScanJobState) {
  return {
    status: state.status,
    stage: state.stage,
    profile: state.profile,
    questions: state.questions,
    engines: state.engines,
    reportUrl: state.status === "done" && state.scanRunId ? `/r/${state.scanRunId}` : null,
  };
}

/** Run the scan and translate its progress events into waiting-room steps. */
export async function runScanWithProgress(
  state: ScanJobState,
  opts: { kind: ScanKind; engines: Engine[]; persist?: (s: ScanJobState) => Promise<void>; db?: Db; clients?: EngineClient[]; profile?: ProfileSummary },
): Promise<ScanReport | null> {
  const db = opts.db ?? getDb();
  const { engines, kind } = opts;
  const save = opts.persist ?? ((s: ScanJobState) => persistScanState(s, db));
  const STAGE_ORDER: ScanStage[] = ["understand", "choose", "ask", "compare", "done"];
  // Stages only move forward, whatever order events arrive in.
  const advance = (to: ScanStage) => {
    if (STAGE_ORDER.indexOf(to) > STAGE_ORDER.indexOf(state.stage)) state.stage = to;
  };
  const row = (engine: Engine) => {
    let r = state.engines.find((x) => x.engine === engine);
    if (!r) {
      r = { engine, received: 0, expected: 0 };
      state.engines.push(r);
    }
    return r;
  };
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
    if (ev.type === "profile") {
      state.profile = ev.profile;
      advance("choose");
    } else if (ev.type === "questions") {
      state.questions = ev.questions;
      advance("choose");
    } else if (ev.type === "start") {
      state.scanRunId = ev.scanRunId;
      state.engines = [];
      for (const [engine, n] of Object.entries(ev.perEngine) as [Engine, number][]) row(engine).expected = n;
      advance("ask");
    } else if (ev.type === "escalate") {
      for (const [engine, n] of Object.entries(ev.perEngine) as [Engine, number][]) row(engine).expected += n;
    } else if (ev.type === "asked") {
      row(ev.engine).received++;
    } else if (ev.type === "phase" && (ev.phase === "extract" || ev.phase === "compare")) {
      advance("compare");
    }
    flush();
  };
  flush();
  try {
    const report = await runScan({ businessId: state.businessId, kind, engines, onProgress, db, clients: opts.clients, profile: opts.profile });
    state.scanRunId = report.scanRunId;
    state.stage = "done";
    state.status = "done";
    await flushing;
    await save(state);
    // A free check asked for an address up front (shared/free-check.ts): the report goes there now.
    // A business with an owner gets its mails through the owner's own paths, not here.
    if (kind === "free") {
      const asker = requesterFromEvents(await db.listEvents(state.businessId, 500));
      const business = await db.getBusiness(state.businessId);
      if (asker && !business?.ownerEmail) {
        await db.enqueueJob("email", { template: "baseline", scanRunId: report.scanRunId, businessId: state.businessId, to: asker.email, lang: asker.lang });
        // Which check this address asked for: the signed-in page lists exactly these (11 Nov 2026).
        await db.logEvent(state.businessId, REPORT_EMAIL_EVENT, { email: asker.email, lang: asker.lang, scanRunId: report.scanRunId, via: "linked" });
      }
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
