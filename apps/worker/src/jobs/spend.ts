import { dayStart, getDb } from "@vidalo/core/shared";
import { log } from "../log.js";
import type { JobKind } from "./types.js";

/**
 * A ceiling on what paid scans and rechecks may spend on AI calls per UTC day
 * (review R-11). Free checks have their own cap (`/api/scan`). Above it a job
 * is not dropped but moved to the next day, so nothing a customer paid for is
 * lost; a burst of on-demand checks or a bug in the cron only waits.
 *
 * The baseline and the monthly check are what the customer pays for, so they
 * wait at most one day: a job that was moved once runs the next time, above the
 * ceiling or not (review CMP-05). On-demand checks and rechecks stay capped.
 * Moved jobs are spread over the next day instead of all starting at 00:00 UTC
 * (review SEC-05), so one full day does not become one burst at midnight.
 */
export const DEFAULT_DAILY_AI_CAP_CENTS = 3000;

export function dailyAiCapCents(): number {
  const v = Number(process.env.VIDALO_DAILY_AI_CAP_CENTS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_AI_CAP_CENTS;
}

/** The jobs that call AI systems on a customer's behalf. */
function spends(kind: JobKind, payload: Record<string, unknown>): boolean {
  return kind === "recheck" || (kind === "scan" && payload.kind !== "free");
}

/** Scan kinds that are deferred once at most, then run. */
const DEFER_ONCE = new Set(["baseline", "monthly"]);

/** A stable moment in the day after `today`, picked by the job's key, so moved jobs do not all start together. */
export function spreadOverNextDay(today: Date, key: string): Date {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return new Date(today.getTime() + 86_400_000 + (h % 86_400) * 1000);
}

/** null when the job may run; otherwise it was moved to the next day and this says when. */
export async function spendBlock(kind: JobKind, payload: Record<string, unknown>, now: Date = new Date()): Promise<string | null> {
  if (!spends(kind, payload)) return null;
  if (kind === "scan" && DEFER_ONCE.has(String(payload.kind)) && payload.deferredOnce) return null;
  const db = getDb();
  const today = dayStart(now);
  const spent = await db.paidScanCentsSince(today);
  const cap = dailyAiCapCents();
  if (spent < cap) return null;
  const key = String(payload.businessId ?? payload.fixId ?? "") + String(payload.kind ?? kind);
  const retryAt = spreadOverNextDay(today, key);
  // A recheck comes back by itself: the cron pushed its fix's recheck_at a day ahead when it queued it.
  if (kind === "scan") await db.enqueueJob(kind, DEFER_ONCE.has(String(payload.kind)) ? { ...payload, deferredOnce: true } : payload, retryAt);
  if (typeof payload.businessId === "string") await db.logEvent(payload.businessId, "job.deferred", { kind, reason: "daily_ai_cap", spent, cap, retryAt: retryAt.toISOString() });
  log.warn("job.deferred.daily_ai_cap", { kind, spent, cap, retryAt: retryAt.toISOString() });
  return retryAt.toISOString();
}
