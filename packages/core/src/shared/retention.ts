/**
 * The retention purge: deletes what the privacy statement says we no longer
 * keep (copy.legal.privacy, each "Hoe lang" line). The worker's cron runs it
 * once a day (apps/worker/src/cron.ts, retentionPurge).
 *
 *   free check        scan runs 12 months after the check; the business itself
 *                     once none is left, unless an account is linked to it
 *                     (account data stays while the account exists)
 *   hashed IP         the per-day `scan.ip.*` events of earlier days
 *   paid plan ended   churned → 90 days → one free check (cron lifecycle) →
 *                     everything, AFTER_LAST_CHECK_DAYS after that check.
 *                     Invoices stay at Stripe (7 years); nothing local is kept
 *   support@ log      every row of a sender 2 years after their last message
 *
 * Only `scanned` and `churned` businesses are ever touched: trial, active and
 * paused are customers. Counts only, never a name or an address.
 */
import type { Db, EventRow } from "../db/types.js";
import { dayStart } from "./scan-limit.js";

export const FREE_CHECK_MONTHS = 12;
/** "binnen 30 dagen daarna": two days' margin for a missed daily run. */
export const AFTER_LAST_CHECK_DAYS = 28;
export const SUPPORT_LOG_YEARS = 2;
/** Logged once per run (counts only); also the cron's once-a-day guard. */
export const RETENTION_EVENT = "retention.purged";

export interface RetentionCounts {
  dryRun: boolean;
  /** free-check scan runs older than 12 months */
  freeChecks: number;
  /** businesses that were only checked, deleted whole */
  freeBusinesses: number;
  /** events of checked businesses older than 12 months */
  freeEvents: number;
  /** ended customers deleted whole after their last free check */
  endedCustomers: number;
  /** per-day hashed IP events of earlier days */
  ipEvents: number;
  /** support@ log rows */
  supportRows: number;
}

const DAY = 86_400_000;

function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

const time = (iso: string) => new Date(iso).getTime();

/**
 * True when a churned business has had its one free check after the end and
 * that check is AFTER_LAST_CHECK_DAYS old. A business that came back and
 * churned again waits for a new check (only checks after the latest churn count).
 */
export function endedCustomerDue(events: EventRow[], now: Date): boolean {
  const churned = events.filter((e) => e.type === "business.status" && e.payload.status === "churned").map((e) => time(e.at));
  if (!churned.length) return false;
  const since = Math.max(...churned);
  return events.some((e) => e.type === "scan.enqueued" && e.payload.reason === "reengagement" && time(e.at) >= since && now.getTime() - time(e.at) >= AFTER_LAST_CHECK_DAYS * DAY);
}

export async function purgeExpired(db: Db, now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<RetentionCounts> {
  const dryRun = Boolean(opts.dryRun);
  const out: RetentionCounts = { dryRun, freeChecks: 0, freeBusinesses: 0, freeEvents: 0, endedCustomers: 0, ipEvents: 0, supportRows: 0 };
  const cutoff = monthsBefore(now, FREE_CHECK_MONTHS);

  for (const b of await db.listBusinessesByStatus(["scanned"])) {
    const runs = await db.listScanRuns(b.id, 100_000);
    const old = runs.filter((r) => time(r.finishedAt ?? r.startedAt) < cutoff.getTime());
    if (old.length === runs.length && time(b.createdAt) < cutoff.getTime() && !b.ownerUserId) {
      out.freeChecks += old.length;
      out.freeBusinesses++;
      if (!dryRun) await db.deleteBusiness(b.id);
      continue;
    }
    if (!dryRun) await db.deleteScanRuns(old.map((r) => r.id));
    out.freeChecks += old.length;
    out.freeEvents += await db.deleteEvents({ businessId: b.id, before: cutoff }, { dryRun });
  }

  for (const b of await db.listBusinessesByStatus(["churned"])) {
    if (!endedCustomerDue(await db.listEvents(b.id, 1000), now)) continue;
    out.endedCustomers++;
    if (!dryRun) await db.deleteBusiness(b.id);
  }

  out.ipEvents = await db.deleteEvents({ typePrefix: "scan.ip.", before: dayStart(now) }, { dryRun });
  const lastContact = new Date(now);
  lastContact.setUTCFullYear(lastContact.getUTCFullYear() - SUPPORT_LOG_YEARS);
  out.supportRows = await db.purgeSupportAutoreplyLog(lastContact, { dryRun });
  return out;
}
