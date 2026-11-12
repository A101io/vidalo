/**
 * Claiming and running jobs, shared by the Node entry (index.ts: a loop) and
 * the Cloudflare entry (cloudflare.ts: a cron trigger drains it for a while).
 */
import type { Job } from "@vidalo/core/db";
import { getDb } from "./compat.js";
import { handlerFor, validatePayload, JOB_KINDS, type JobKind } from "./jobs/index.js";
import { errorMessage, log } from "./log.js";

const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 20 * 60 * 1000);

let stopping = false;

/** Ask drainQueue to stop after the job in hand (Node shutdown). */
export function stopDraining(): void {
  stopping = true;
}


function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/** Run one job: dispatch by kind, complete or fail with backoff. Returns true when a job was processed. */
export async function processJob(job: Job): Promise<boolean> {
  const db = getDb();
  const started = Date.now();
  const handler = handlerFor(job.kind);
  const base = { jobId: job.id, kind: job.kind, attempt: job.attempts, businessId: job.payload.businessId ?? null };
  if (!handler) {
    log.error("job.unknown_kind", base);
    await db.failJob(job.id, `unknown job kind ${job.kind}`);
    return true;
  }
  const invalid = JOB_KINDS.includes(job.kind as JobKind) ? validatePayload(job.kind as JobKind, job.payload) : null;
  if (invalid) {
    log.error("job.invalid_payload", { ...base, error: invalid });
    await db.failJob(job.id, invalid);
    return true;
  }
  log.info("job.start", base);
  try {
    const result = await withTimeout(handler(job.payload, job), JOB_TIMEOUT_MS, `job ${job.id} (${job.kind})`);
    await db.completeJob(job.id);
    log.info("job.done", { ...base, ms: Date.now() - started, result: result ?? null });
  } catch (err) {
    const error = errorMessage(err);
    const failed = await db.failJob(job.id, error);
    const exhausted = failed.doneAt !== null;
    log.error("job.failed", { ...base, ms: Date.now() - started, error, exhausted, nextRunAt: exhausted ? null : failed.runAt });
    if (exhausted) {
      // A deletion that gave up stays in the daily overdue count; this line says which (SEC-45, V-COMP-04).
      if (job.kind === "purge") log.error("account.delete_failed", { businessId: job.payload.businessId ?? null });
      await db.logEvent((job.payload.businessId as string | undefined) ?? null, "job.exhausted", { jobId: job.id, kind: job.kind, error });
    }
  }
  return true;
}

/** Claim and run jobs until the queue is empty, `max` jobs ran, or `until` (epoch ms) has passed. */
export async function drainQueue(max = Number.POSITIVE_INFINITY, until = Number.POSITIVE_INFINITY): Promise<number> {
  const db = getDb();
  let n = 0;
  while (!stopping && n < max && Date.now() < until) {
    const job = await db.claimJob();
    if (!job) break;
    await processJob(job);
    n++;
  }
  return n;
}

