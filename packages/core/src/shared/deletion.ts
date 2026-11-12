/**
 * "Verwijder alles" for every plan (feature 002, AC-5b, Julian Q3, ADR-0005). Pure: when a
 * deletion can happen. Without a running subscription (Vidalo Scan, never paid, churned) it
 * happens now; a running Vidalo Monthly is cancelled at the end of its period and deleted that day.
 */
import type { BusinessRecord, PurgeGuard } from "../db/types.js";

/** Vidalo Scan data is deleted this many months after the last sign-in or payment (F-012, Julian 11 Nov 2026). null = no automatic deletion. */
export const SCAN_RETENTION_MONTHS: number | null = 24;
/** A Vidalo Scan's Google connection ends this many days after its first full check, when nothing is open (F-015, Julian 11 Nov 2026). */
export const SCAN_GOOGLE_DAYS = 60;
/** A churned business is deleted this many days after churn: 90 kept, one free check, deletion within 30 days after it. */
export const CHURN_DELETE_DAYS = 120;
/** The reminder before a retention deletion. */
export const DELETION_REMINDER_DAYS = 14;

export type DeletionPlan = { kind: "now" } | { kind: "at_period_end"; at: string | null; needsCancel: boolean };

/** True while Stripe bills a Vidalo Monthly (the same test as subscriptionOptions). */
export function hasRunningSubscription(b: Pick<BusinessRecord, "plan" | "status">): boolean {
  return b.plan === "monitor" && (b.status === "trial" || b.status === "active" || b.status === "paused");
}

export function deletionPlan(b: BusinessRecord, _now: Date = new Date()): DeletionPlan {
  if (!hasRunningSubscription(b)) return { kind: "now" };
  if (b.cancelAt) return { kind: "at_period_end", at: b.cancelAt, needsCancel: false };
  return { kind: "at_period_end", at: null, needsCancel: true };
}

/** The Vidalo Scan retention date for a business last active at `lastActive`, or null when the rule is off. */
export function scanRetentionDate(lastActive: string, months: number | null = SCAN_RETENTION_MONTHS): string | null {
  if (months === null) return null;
  const d = new Date(lastActive);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/** The same rule as Db.purgeBusiness's SQL, for the early exit. */
export function purgeAllowed(b: Pick<BusinessRecord, "plan" | "status" | "deleteAt" | "deleteReason">, guard: PurgeGuard, now: Date): boolean {
  if (guard === "no_subscription") return !(b.plan === "monitor" && (b.status === "trial" || b.status === "active" || b.status === "paused"));
  if (!b.deleteAt || Date.parse(b.deleteAt) > now.getTime()) return false;
  return b.status === "scanned" || b.status === "churned" || (b.plan === "setup" && b.status === "trial" && b.deleteReason === "retention");
}
